import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveScheduleTeacherId } from '../middleware/scheduleTeacher.js';
import { resolveBookerStudentId } from '../utils/booker.js';
import { addDays, isLessonPast, isValidDateStr, todayISO } from '../utils/week.js';
import { listTaughtLessons, loadStudioStudentIdSet } from '../utils/taughtLessons.js';
import { feeForLesson, loadFloorFeeRates } from '../utils/floorFees.js';
import {
  notifyPaymentReported,
  notifyStudentPaymentConfirmed,
  notifyStudentPaymentNotFound,
  notifyStudentsCharged,
  retractPaymentReported,
} from '../services/notifications.js';

export const paymentsRouter = Router();

/** How far back the "to complete" list looks, even when tracking started earlier. */
const COMPLETE_LOOKBACK_DAYS = 120;
/** Settled, fully paid lessons older than this drop off the coach's list. */
const HISTORY_DAYS = 60;
/** Paid charges older than this drop off the student's list. */
const STUDENT_HISTORY_DAYS = 180;

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

const lessonRefSchema = z
  .object({
    bookingId: z.number().int().positive().optional(),
    recurringAssignmentId: z.number().int().positive().optional(),
    date: z.string().refine(isValidDateStr, 'Invalid date.').optional(),
  })
  .refine((v) => v.bookingId || (v.recurringAssignmentId && v.date), {
    message: 'Choose a lesson.',
  });

const coachMethodSchema = z.object({
  method: z.enum(['cash', 'venmo']).optional(),
});

const studentMethodSchema = z.object({
  method: z.enum(['cash', 'venmo']),
});

function parseId(raw, label) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${label}.`);
  return id;
}

async function coachPaymentContext(teacherId) {
  const { rows } = await query(
    `SELECT t.track_payments, t.track_payments_since, ts.studio_id, ts.owner_managed
       FROM teachers t
       LEFT JOIN LATERAL (
         SELECT studio_id, owner_managed
           FROM teacher_studios
          WHERE teacher_id = t.id
          ORDER BY owner_managed DESC, created_at
          LIMIT 1
       ) ts ON true
      WHERE t.id = $1`,
    [teacherId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Coach not found.');
  return {
    teacherId,
    studioId: row.studio_id ?? null,
    managed: row.owner_managed === true,
    trackPayments: row.track_payments === true || row.owner_managed === true,
    since: fmtDate(row.track_payments_since),
  };
}

/** Coach (or the studio owner of a managed coach) whose payments this request handles. */
async function resolveCoach(req) {
  const teacherId = await resolveScheduleTeacherId(req);
  const ctx = await coachPaymentContext(teacherId);
  if (req.user.role === 'teacher' && ctx.managed) {
    throw new HttpError(403, 'Your studio handles payments for your lessons.');
  }
  if (!ctx.trackPayments) {
    throw new HttpError(403, 'Turn on Track payments on your profile first.');
  }
  if (!ctx.studioId) {
    throw new HttpError(400, 'Join a studio to track payments.');
  }
  return ctx;
}

function lessonKey(lesson) {
  return lesson.bookingId
    ? `b:${lesson.bookingId}`
    : `w:${lesson.recurringAssignmentId}:${lesson.lessonDate}`;
}

function completionKey(row) {
  return row.booking_id
    ? `b:${row.booking_id}`
    : `w:${row.recurring_assignment_id}:${fmtDate(row.lesson_date)}`;
}

function mapToComplete(lesson) {
  return {
    key: lessonKey(lesson),
    bookingId: lesson.bookingId,
    recurringAssignmentId: lesson.recurringAssignmentId,
    lessonDate: lesson.lessonDate,
    startTime: lesson.startTime,
    durationMin: lesson.durationMin,
    priceCents: lesson.priceCents,
    kind: lesson.kind,
    studentName: lesson.studentName,
    childName: lesson.childName,
    paymentPartnerName: lesson.paymentPartnerName,
  };
}

function mapCharge(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    amountCents: row.amount_cents,
    floorFeeCents: row.floor_fee_cents,
    status: row.status,
    method: row.method || null,
    reportedAt: row.reported_at,
    paidAt: row.paid_at,
    collectedBy: row.collected_by || null,
    settled: row.settlement_id != null,
  };
}

async function loadCoachSummary(teacherId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(sc.amount_cents) FILTER (WHERE sc.status = 'due'), 0)::int AS due_cents,
       COALESCE(SUM(sc.amount_cents) FILTER (WHERE sc.status = 'reported'), 0)::int AS reported_cents,
       COALESCE(SUM(sc.amount_cents) FILTER (
         WHERE sc.status = 'paid' AND sc.paid_at >= date_trunc('month', now())
       ), 0)::int AS collected_month_cents,
       COALESCE(SUM(sc.floor_fee_cents) FILTER (
         WHERE sc.status = 'paid' AND sc.collected_by = 'coach' AND sc.settlement_id IS NULL
       ), 0)::int AS floor_fees_owed_cents,
       COALESCE(SUM(sc.amount_cents - sc.floor_fee_cents) FILTER (
         WHERE sc.status = 'paid' AND sc.collected_by = 'studio' AND sc.settlement_id IS NULL
       ), 0)::int AS payout_owed_cents
       FROM student_charges sc
       JOIN lesson_completions lc ON lc.id = sc.lesson_completion_id
      WHERE lc.teacher_id = $1`,
    [teacherId],
  );
  const r = rows[0];
  return {
    outstandingCents: r.due_cents + r.reported_cents,
    awaitingCents: r.reported_cents,
    collectedThisMonthCents: r.collected_month_cents,
    floorFeesOwedCents: r.floor_fees_owed_cents,
    payoutOwedCents: r.payout_owed_cents,
  };
}

// --- Coach -----------------------------------------------------------------

paymentsRouter.get(
  '/coach',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const today = todayISO();
    const lookback = addDays(today, -COMPLETE_LOOKBACK_DAYS);
    const since = ctx.since || today;
    const from = since > lookback ? since : lookback;

    const [lessons, { rows: recentCompletions }] = await Promise.all([
      listTaughtLessons({ studioId: ctx.studioId, teacherId: ctx.teacherId, from, to: today }),
      query(
        `SELECT booking_id, recurring_assignment_id, lesson_date
           FROM lesson_completions
          WHERE teacher_id = $1 AND lesson_date >= $2`,
        [ctx.teacherId, from],
      ),
    ]);
    const done = new Set(recentCompletions.map(completionKey));
    const toComplete = lessons
      .filter((l) => (l.bookingId || l.recurringAssignmentId) && isLessonPast(l.lessonDate, l.startTime))
      .filter((l) => !done.has(lessonKey(l)))
      .map(mapToComplete)
      .reverse();

    const { rows: completionRows } = await query(
      `SELECT lc.*, st.full_name AS student_name, pp.full_name AS partner_name
         FROM lesson_completions lc
         JOIN students st ON st.id = lc.student_id
         LEFT JOIN students pp ON pp.id = lc.payment_partner_id
        WHERE lc.teacher_id = $1
          AND (
            lc.lesson_date >= $2
            OR EXISTS (
              SELECT 1 FROM student_charges sc
               WHERE sc.lesson_completion_id = lc.id
                 AND (sc.status <> 'paid' OR sc.settlement_id IS NULL)
            )
          )
        ORDER BY lc.lesson_date DESC, lc.start_time DESC, lc.id DESC`,
      [ctx.teacherId, addDays(today, -HISTORY_DAYS)],
    );
    const ids = completionRows.map((r) => r.id);
    const chargesByCompletion = new Map();
    if (ids.length) {
      const { rows: chargeRows } = await query(
        `SELECT sc.*, st.full_name AS student_name
           FROM student_charges sc
           JOIN students st ON st.id = sc.student_id
          WHERE sc.lesson_completion_id = ANY($1::int[])
          ORDER BY sc.id`,
        [ids],
      );
      for (const c of chargeRows) {
        if (!chargesByCompletion.has(c.lesson_completion_id)) chargesByCompletion.set(c.lesson_completion_id, []);
        chargesByCompletion.get(c.lesson_completion_id).push(mapCharge(c));
      }
    }

    const completed = completionRows.map((r) => {
      const charges = chargesByCompletion.get(r.id) || [];
      return {
        id: r.id,
        status: r.status,
        lessonDate: fmtDate(r.lesson_date),
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        priceCents: r.price_cents,
        floorFeeCents: r.floor_fee_cents,
        studentName: r.student_name,
        childName: r.child_name || null,
        paymentPartnerName: r.partner_name || null,
        charges,
        canUndo: charges.every((c) => c.status !== 'paid'),
      };
    });

    res.json({
      managed: ctx.managed,
      collectedBy: ctx.managed ? 'studio' : 'coach',
      trackingSince: since,
      toComplete,
      completed,
      summary: await loadCoachSummary(ctx.teacherId),
    });
  }),
);

/** The taught lesson a request points at, if it belongs to this coach and has started. */
async function findLesson(ctx, ref) {
  let date = ref.date;
  if (ref.bookingId) {
    const { rows } = await query('SELECT lesson_date FROM bookings WHERE id = $1', [ref.bookingId]);
    if (!rows[0]) throw new HttpError(404, 'Lesson not found.');
    date = fmtDate(rows[0].lesson_date);
  }
  const lessons = await listTaughtLessons({
    studioId: ctx.studioId,
    teacherId: ctx.teacherId,
    from: date,
    to: date,
  });
  const lesson = lessons.find((l) =>
    ref.bookingId
      ? l.bookingId === ref.bookingId
      : l.recurringAssignmentId === ref.recurringAssignmentId,
  );
  if (!lesson) throw new HttpError(404, 'Lesson not found.');
  if (!isLessonPast(lesson.lessonDate, lesson.startTime)) {
    throw new HttpError(400, 'This lesson hasn’t started yet.');
  }
  return lesson;
}

/** Split cents between booker and partner; the booker takes the odd cent. */
function splitCents(total) {
  const partner = Math.floor(total / 2);
  return [total - partner, partner];
}

async function insertCompletion(client, ctx, lesson, { status, floorFeeCents, role }) {
  const { rows } = await client.query(
    `INSERT INTO lesson_completions (
       studio_id, teacher_id, slot_id, booking_id, recurring_assignment_id, student_id,
       payment_partner_id, child_name, lesson_date, start_time, duration_min, price_cents,
       floor_fee_cents, status, completed_by_role
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      ctx.studioId,
      ctx.teacherId,
      lesson.slotId,
      lesson.bookingId,
      lesson.recurringAssignmentId,
      lesson.studentId,
      lesson.paymentPartnerId,
      lesson.childName,
      lesson.lessonDate,
      lesson.startTime,
      lesson.durationMin,
      lesson.priceCents,
      floorFeeCents,
      status,
      role,
    ],
  );
  return rows[0].id;
}

const completeBodySchema = lessonRefSchema.and(
  z.object({
    priceCents: z.number().int().optional(),
  }),
);

paymentsRouter.post(
  '/coach/complete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const body = completeBodySchema.parse(req.body);
    const lesson = await findLesson(ctx, body);
    if (body.priceCents !== undefined) {
      if (body.priceCents === 0) {
        throw new HttpError(400, 'Use No charge for a $0 lesson.');
      }
      if (body.priceCents < 0) {
        throw new HttpError(400, 'Enter an amount greater than $0.');
      }
    }
    const priceCents = body.priceCents ?? lesson.priceCents;
    const chargedLesson = { ...lesson, priceCents };
    const [rates, studioStudentIds] = await Promise.all([
      loadFloorFeeRates(ctx.studioId),
      loadStudioStudentIdSet(ctx.studioId),
    ]);
    const floorFeeCents = feeForLesson(chargedLesson, studioStudentIds, rates);

    const payers = chargedLesson.paymentPartnerId
      ? (() => {
          const [bookerAmount, partnerAmount] = splitCents(priceCents);
          const [bookerFee, partnerFee] = splitCents(floorFeeCents);
          return [
            { studentId: chargedLesson.studentId, amountCents: bookerAmount, floorFeeCents: bookerFee },
            {
              studentId: chargedLesson.paymentPartnerId,
              amountCents: partnerAmount,
              floorFeeCents: partnerFee,
            },
          ];
        })()
      : [{ studentId: chargedLesson.studentId, amountCents: priceCents, floorFeeCents }];

    const completionId = await withTransaction(async (client) => {
      const id = await insertCompletion(client, ctx, chargedLesson, {
        status: 'charged',
        floorFeeCents,
        role: req.user.role,
      });
      for (const p of payers) {
        await client.query(
          `INSERT INTO student_charges (lesson_completion_id, student_id, amount_cents, floor_fee_cents)
           VALUES ($1, $2, $3, $4)`,
          [id, p.studentId, p.amountCents, p.floorFeeCents],
        );
      }
      return id;
    });

    await notifyStudentsCharged({
      charges: payers,
      teacherId: ctx.teacherId,
      childName: chargedLesson.childName,
      lessonDate: chargedLesson.lessonDate,
      startTime: chargedLesson.startTime,
    });
    res.status(201).json({ completion: { id: completionId } });
  }),
);

paymentsRouter.post(
  '/coach/skip',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const lesson = await findLesson(ctx, lessonRefSchema.parse(req.body));
    const id = await withTransaction((client) =>
      insertCompletion(client, ctx, lesson, { status: 'skipped', floorFeeCents: 0, role: req.user.role }),
    );
    res.status(201).json({ completion: { id } });
  }),
);

paymentsRouter.delete(
  '/coach/completions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const id = parseId(req.params.id, 'lesson');
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT id FROM lesson_completions WHERE id = $1 AND teacher_id = $2 FOR UPDATE',
        [id, ctx.teacherId],
      );
      if (!rows[0]) throw new HttpError(404, 'Lesson not found.');
      const { rows: paid } = await client.query(
        `SELECT 1 FROM student_charges WHERE lesson_completion_id = $1 AND status = 'paid' LIMIT 1`,
        [id],
      );
      if (paid[0]) throw new HttpError(400, 'Undo the payment before undoing this lesson.');
      await client.query('DELETE FROM lesson_completions WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  }),
);

async function loadCoachCharge(client, ctx, chargeId) {
  const { rows } = await client.query(
    `SELECT sc.*, lc.lesson_date, lc.start_time, lc.child_name, lc.student_id AS booker_id
       FROM student_charges sc
       JOIN lesson_completions lc ON lc.id = sc.lesson_completion_id
      WHERE sc.id = $1 AND lc.teacher_id = $2
      FOR UPDATE OF sc`,
    [chargeId, ctx.teacherId],
  );
  if (!rows[0]) throw new HttpError(404, 'Charge not found.');
  return rows[0];
}

paymentsRouter.post(
  '/coach/charges/:id/paid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const id = parseId(req.params.id, 'charge');
    const body = coachMethodSchema.parse(req.body ?? {});
    const charge = await withTransaction(async (client) => {
      const row = await loadCoachCharge(client, ctx, id);
      if (row.status === 'paid') throw new HttpError(400, 'This charge is already paid.');
      const method = body.method || row.method;
      if (!method) throw new HttpError(400, 'Choose cash or Venmo.');
      const collectedBy = ctx.managed ? 'studio' : 'coach';
      await client.query(
        `UPDATE student_charges
            SET status = 'paid', method = $1, paid_at = now(), collected_by = $2
          WHERE id = $3`,
        [method, collectedBy, id],
      );
      // Coach-collected $0 floor fees (exempt / zero rates) need no owner action — settle now.
      if (collectedBy === 'coach' && Number(row.floor_fee_cents) === 0) {
        const { rows: sett } = await client.query(
          `INSERT INTO studio_settlements (studio_id, teacher_id, direction, amount_cents)
           VALUES ($1, $2, 'coach_to_studio', 0)
           RETURNING id`,
          [ctx.studioId, ctx.teacherId],
        );
        await client.query('UPDATE student_charges SET settlement_id = $1 WHERE id = $2', [
          sett[0].id,
          id,
        ]);
      }
      return row;
    });
    await notifyStudentPaymentConfirmed({
      studentId: charge.student_id,
      teacherId: ctx.teacherId,
      amountCents: charge.amount_cents,
      lessonDate: fmtDate(charge.lesson_date),
      startTime: fmtTime(charge.start_time),
      byStudio: req.user.role === 'studio_owner',
    });
    res.json({ ok: true });
  }),
);

paymentsRouter.post(
  '/coach/charges/:id/unpaid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const id = parseId(req.params.id, 'charge');
    await withTransaction(async (client) => {
      const row = await loadCoachCharge(client, ctx, id);
      if (row.status !== 'paid') throw new HttpError(400, 'This charge isn’t marked paid.');
      if (row.settlement_id != null) {
        throw new HttpError(400, 'The studio already settled this payment.');
      }
      await client.query(
        `UPDATE student_charges
            SET status = 'due', method = NULL, reported_at = NULL, paid_at = NULL, collected_by = NULL
          WHERE id = $1`,
        [id],
      );
    });
    res.json({ ok: true });
  }),
);

paymentsRouter.post(
  '/coach/charges/:id/not-found',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await resolveCoach(req);
    const id = parseId(req.params.id, 'charge');
    const charge = await withTransaction(async (client) => {
      const row = await loadCoachCharge(client, ctx, id);
      if (row.status !== 'reported') throw new HttpError(400, 'This payment isn’t awaiting confirmation.');
      await client.query(
        `UPDATE student_charges SET status = 'due', method = NULL, reported_at = NULL WHERE id = $1`,
        [id],
      );
      return row;
    });
    await notifyStudentPaymentNotFound({
      studentId: charge.student_id,
      teacherId: ctx.teacherId,
      amountCents: charge.amount_cents,
      method: charge.method,
      lessonDate: fmtDate(charge.lesson_date),
      startTime: fmtTime(charge.start_time),
      byStudio: req.user.role === 'studio_owner',
    });
    res.json({ ok: true });
  }),
);

// --- Student ---------------------------------------------------------------

paymentsRouter.get(
  '/student',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const { rows } = await query(
      `SELECT sc.id, sc.student_id, sc.amount_cents, sc.status, sc.method, sc.reported_at, sc.paid_at,
              lc.lesson_date, lc.start_time, lc.duration_min, lc.price_cents, lc.child_name,
              lc.student_id AS booker_id, lc.payment_partner_id,
              bk.full_name AS booker_name, pp.full_name AS partner_name,
              t.id AS teacher_id, t.full_name AS teacher_name
         FROM student_charges sc
         JOIN lesson_completions lc ON lc.id = sc.lesson_completion_id
         JOIN teachers t ON t.id = lc.teacher_id
         JOIN students bk ON bk.id = lc.student_id
         LEFT JOIN students pp ON pp.id = lc.payment_partner_id
        WHERE sc.student_id = $1
          AND (sc.status <> 'paid' OR sc.paid_at >= now() - make_interval(days => $2))
        ORDER BY lc.lesson_date DESC, lc.start_time DESC, sc.id DESC`,
      [studentId, STUDENT_HISTORY_DAYS],
    );
    const charges = rows.map((r) => {
      const isBooker = r.student_id === r.booker_id;
      const splitWith = r.payment_partner_id ? (isBooker ? r.partner_name : r.booker_name) : null;
      return {
        id: r.id,
        status: r.status,
        method: r.method || null,
        amountCents: r.amount_cents,
        priceCents: r.price_cents,
        reportedAt: r.reported_at,
        paidAt: r.paid_at,
        lessonDate: fmtDate(r.lesson_date),
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        childName: isBooker ? r.child_name || null : null,
        splitWith: splitWith || null,
        teacher: { id: r.teacher_id, name: r.teacher_name },
      };
    });
    const sum = (status) =>
      charges.filter((c) => c.status === status).reduce((n, c) => n + c.amountCents, 0);
    res.json({
      charges,
      summary: { dueCents: sum('due'), awaitingCents: sum('reported') },
    });
  }),
);

paymentsRouter.post(
  '/student/charges/:id/report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const id = parseId(req.params.id, 'charge');
    const { method } = studentMethodSchema.parse(req.body);
    const charge = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT sc.*, lc.teacher_id, lc.lesson_date, lc.start_time, lc.child_name,
                lc.student_id AS booker_id, t.full_name AS teacher_name
           FROM student_charges sc
           JOIN lesson_completions lc ON lc.id = sc.lesson_completion_id
           JOIN teachers t ON t.id = lc.teacher_id
          WHERE sc.id = $1 AND sc.student_id = $2
          FOR UPDATE OF sc`,
        [id, studentId],
      );
      const row = rows[0];
      if (!row) throw new HttpError(404, 'Charge not found.');
      if (row.status !== 'due') throw new HttpError(400, 'This charge is already recorded.');
      await client.query(
        `UPDATE student_charges SET status = 'reported', method = $1, reported_at = now() WHERE id = $2`,
        [method, id],
      );
      return row;
    });
    const ctx = await coachPaymentContext(charge.teacher_id);
    await notifyPaymentReported({
      chargeId: id,
      teacherId: charge.teacher_id,
      managed: ctx.managed,
      studentId,
      childName: charge.student_id === charge.booker_id ? charge.child_name : null,
      amountCents: charge.amount_cents,
      method,
      lessonDate: fmtDate(charge.lesson_date),
      startTime: fmtTime(charge.start_time),
    });
    res.json({ ok: true, teacherName: charge.teacher_name, managed: ctx.managed });
  }),
);

/** Undo "I paid" while the coach hasn't confirmed it yet. */
paymentsRouter.post(
  '/student/charges/:id/undo-report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const id = parseId(req.params.id, 'charge');
    const { rows } = await query(
      `UPDATE student_charges
          SET status = 'due', method = NULL, reported_at = NULL
        WHERE id = $1 AND student_id = $2 AND status = 'reported'
        RETURNING id`,
      [id, studentId],
    );
    if (!rows[0]) {
      const { rows: existing } = await query(
        'SELECT status FROM student_charges WHERE id = $1 AND student_id = $2',
        [id, studentId],
      );
      if (!existing[0]) throw new HttpError(404, 'Charge not found.');
      throw new HttpError(
        400,
        existing[0].status === 'paid'
          ? 'Your coach already confirmed this payment.'
          : 'This payment isn’t awaiting confirmation.',
      );
    }
    await retractPaymentReported(id);
    res.json({ ok: true });
  }),
);
