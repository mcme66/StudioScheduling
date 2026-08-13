import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import {
  weekdayOf,
  isValidDateStr,
  todayISO,
  isLessonPast,
  isDateInSeries,
} from '../utils/week.js';
import { sendBookingConfirmation } from '../services/email.js';
import { normalizeChildrenNames } from './students.js';
import { resolveBookerStudentId } from '../utils/booker.js';
import {
  partnerIdsFor,
  paymentPartnerPayload,
  resolvePaymentPartnerId,
} from '../utils/partners.js';

export const bookingsRouter = Router();

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const createSchema = z.object({
  slotId: z.number().int().positive(),
  lessonDate: z.string().refine(isValidDateStr, 'lessonDate must be YYYY-MM-DD.'),
  childName: z.string().max(120).optional().nullable(),
  paymentPartnerId: z.number().int().positive().optional().nullable(),
});

/** Resolve which child name (if any) a parent account is booking for. */
async function resolveChildName(client, studentId, requestedChildName) {
  const { rows } = await client.query(
    'SELECT is_parent, children_names FROM students WHERE id = $1',
    [studentId],
  );
  const student = rows[0];
  if (!student) throw new HttpError(401, 'Account no longer exists.');

  if (!student.is_parent) {
    if (requestedChildName) {
      throw new HttpError(400, 'Only parent accounts can book for a child.');
    }
    return null;
  }

  const children = normalizeChildrenNames(student.children_names);
  if (!children.length) {
    throw new HttpError(
      400,
      'Add at least one child on your profile before booking as a parent.',
    );
  }
  const name = String(requestedChildName || '').trim();
  if (!name) {
    throw new HttpError(400, 'Select which child this lesson is for.');
  }
  const match = children.find((c) => c.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new HttpError(400, 'That child is not on your profile.');
  }
  return match;
}

const paidSchema = z.object({
  paid: z.boolean(),
});

bookingsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookerStudentId = await resolveBookerStudentId(req.user);
    const {
      slotId,
      lessonDate,
      childName: requestedChildName,
      paymentPartnerId: requestedPartnerId,
    } = createSchema.parse(req.body);

    if (lessonDate < todayISO()) {
      throw new HttpError(400, 'That date is in the past.');
    }

    const booking = await withTransaction(async (client) => {
      const childName = await resolveChildName(client, bookerStudentId, requestedChildName);
      const paymentPartnerId = await resolvePaymentPartnerId(
        bookerStudentId,
        requestedPartnerId,
        (text, params) => client.query(text, params),
      );

      const { rows: slotRows } = await client.query(
        'SELECT * FROM slots WHERE id = $1 FOR UPDATE',
        [slotId],
      );
      const slot = slotRows[0];
      if (!slot || !slot.active) throw new HttpError(404, 'That lesson time is not available.');

      // Teachers-as-students may only book other instructors.
      if (req.user.role === 'teacher' && slot.teacher_id === req.user.id) {
        throw new HttpError(400, 'You cannot book a lesson on your own schedule.');
      }

      if (isLessonPast(lessonDate, slot.start_time)) {
        throw new HttpError(400, 'That lesson time has already passed.');
      }

      if (weekdayOf(lessonDate) !== slot.weekday) {
        throw new HttpError(400, 'That date does not match the lesson day.');
      }

      // A one-off ("this week only") slot can only be booked on its date.
      if (slot.one_off_date && fmtDate(slot.one_off_date) !== lessonDate) {
        throw new HttpError(404, 'That lesson time is not available.');
      }

      // Weekly series bounds.
      if (
        !slot.one_off_date &&
        !isDateInSeries(
          lessonDate,
          slot.series_start_date ? fmtDate(slot.series_start_date) : null,
          slot.series_end_date ? fmtDate(slot.series_end_date) : null,
        )
      ) {
        throw new HttpError(404, 'That lesson time is not available.');
      }

      const { rows: excRows } = await client.query(
        'SELECT kind FROM slot_exceptions WHERE slot_id = $1 AND exception_date = $2',
        [slotId, lessonDate],
      );
      const exception = excRows[0];
      if (exception?.kind === 'blocked') {
        throw new HttpError(409, 'That time is unavailable that week.');
      }
      const skippedThisWeek = exception?.kind === 'skipped';

      const { rows: recRows } = await client.query(
        `SELECT student_id, starts_on FROM recurring_assignments
          WHERE slot_id = $1 AND status = 'approved'`,
        [slotId],
      );
      // A skipped week reopens the slot for anyone, so the weekly holder does
      // not block bookings on that specific date. Weeks before the weekly
      // assignment starts stay open for one-off bookings.
      const recCovers =
        recRows[0] &&
        (!recRows[0].starts_on || lessonDate >= fmtDate(recRows[0].starts_on));
      if (recCovers && !skippedThisWeek) {
        if (recRows[0].student_id === bookerStudentId) {
          throw new HttpError(409, 'You already hold this time as a weekly spot.');
        }
        throw new HttpError(409, 'This time is reserved for a weekly student.');
      }

      const { rows: pendingRows } = await client.query(
        `SELECT student_id, starts_on FROM recurring_assignments
          WHERE slot_id = $1 AND status = 'pending'`,
        [slotId],
      );
      const pendingCovers =
        pendingRows[0] &&
        pendingRows[0].student_id !== bookerStudentId &&
        (!pendingRows[0].starts_on || lessonDate >= fmtDate(pendingRows[0].starts_on));
      if (pendingCovers) {
        throw new HttpError(409, 'This time has a pending weekly spot request.');
      }

      const { rows } = await client.query(
        `INSERT INTO bookings (slot_id, student_id, lesson_date, child_name, payment_partner_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [slotId, bookerStudentId, lessonDate, childName, paymentPartnerId],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'That time was just booked. Please choose another.');
        }
        throw err;
      });
      return { booking: rows[0], slot, childName, paymentPartnerId };
    });

    // Send confirmation (best-effort) after the transaction commits.
    const [{ rows: studentRows }, { rows: teacherRows }] = await Promise.all([
      query('SELECT full_name, email, receive_emails FROM students WHERE id = $1', [bookerStudentId]),
      query('SELECT full_name FROM teachers WHERE id = $1', [booking.slot.teacher_id]),
    ]);
    await sendBookingConfirmation({
      student: studentRows[0],
      teacher: teacherRows[0],
      slot: booking.slot,
      lessonDate,
      childName: booking.childName,
    });

    res.status(201).json({
      booking: {
        id: booking.booking.id,
        slotId,
        lessonDate,
        status: booking.booking.status,
        childName: booking.childName,
        paymentPartnerId: booking.paymentPartnerId,
      },
    });
  }),
);

bookingsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookerStudentId = await resolveBookerStudentId(req.user);
    const partnerIds = await partnerIdsFor(bookerStudentId);
    const visibleIds = [bookerStudentId, ...partnerIds];

    const { rows: bookings } = await query(
      `SELECT b.id, b.lesson_date, b.status, b.created_at, b.paid, b.partner_paid, b.child_name,
              b.student_id, b.payment_partner_id,
              st.full_name AS booker_name, pp.full_name AS payment_partner_name,
              s.weekday, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name AS teacher_name, t.track_payments
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN teachers t ON t.id = s.teacher_id
         JOIN students st ON st.id = b.student_id
         LEFT JOIN students pp ON pp.id = b.payment_partner_id
        WHERE b.student_id = ANY($1::int[]) AND b.status = 'booked'
        ORDER BY b.lesson_date`,
      [visibleIds],
    );

    const { rows: recurring } = await query(
      `SELECT ra.id, ra.slot_id, ra.child_name, ra.student_id, ra.payment_partner_id, ra.starts_on,
              st.full_name AS booker_name, pp.full_name AS payment_partner_name,
              s.weekday, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name AS teacher_name, t.track_payments
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN teachers t ON t.id = s.teacher_id
         JOIN students st ON st.id = ra.student_id
         LEFT JOIN students pp ON pp.id = ra.payment_partner_id
        WHERE ra.student_id = ANY($1::int[]) AND ra.status = 'approved'
        ORDER BY s.weekday, s.start_time`,
      [visibleIds],
    );

    const today = todayISO();

    // Upcoming per-week exceptions for this student's weekly slots.
    const recurringSlotIds = recurring.map((r) => r.slot_id);
    let exceptionsBySlot = new Map();
    if (recurringSlotIds.length) {
      const { rows: excRows } = await query(
        `SELECT slot_id, exception_date, kind FROM slot_exceptions
          WHERE slot_id = ANY($1::int[]) AND exception_date >= $2`,
        [recurringSlotIds, today],
      );
      for (const e of excRows) {
        const date = fmtDate(e.exception_date);
        if (!exceptionsBySlot.has(e.slot_id)) exceptionsBySlot.set(e.slot_id, []);
        exceptionsBySlot.get(e.slot_id).push({ date, kind: e.kind });
      }
    }

    let paymentsByRecurring = new Map();
    if (recurring.length) {
      const recurringIds = recurring.map((r) => r.id);
      const { rows: payRows } = await query(
        `SELECT recurring_assignment_id, lesson_date, paid, partner_paid
           FROM recurring_lesson_payments
          WHERE recurring_assignment_id = ANY($1::int[])
            AND lesson_date >= $2`,
        [recurringIds, today],
      );
      for (const p of payRows) {
        const rid = p.recurring_assignment_id;
        if (!paymentsByRecurring.has(rid)) paymentsByRecurring.set(rid, []);
        paymentsByRecurring.get(rid).push({
          date: fmtDate(p.lesson_date),
          paid: p.paid === true,
          partnerPaid: p.partner_paid === true,
        });
      }
    }

    const accessFor = (row) => {
      const isBooker = row.student_id === bookerStudentId;
      const isPaymentPartner = row.payment_partner_id === bookerStudentId;
      return {
        isPartner: !isBooker,
        partnerName: isBooker ? null : row.booker_name || null,
        paymentPartner: paymentPartnerPayload(row.payment_partner_id, row.payment_partner_name),
        canMarkPaid: isBooker || isPaymentPartner,
        canManage: isBooker,
        isPaymentPartner,
      };
    };

    const mapped = bookings.map((b) => {
      const access = accessFor(b);
      return {
        id: b.id,
        lessonDate: fmtDate(b.lesson_date),
        startTime: fmtTime(b.start_time),
        durationMin: b.duration_min,
        priceCents: b.price_cents,
        paid: access.isPaymentPartner ? b.partner_paid === true : b.paid === true,
        trackPayments: b.track_payments === true,
        childName: b.child_name || null,
        teacher: { id: b.teacher_id, name: b.teacher_name },
        past: fmtDate(b.lesson_date) < today,
        isPartner: access.isPartner,
        partnerName: access.partnerName,
        paymentPartner: access.paymentPartner,
        canMarkPaid: access.canMarkPaid,
        canManage: access.canManage,
      };
    });

    res.json({
      upcoming: mapped.filter((b) => !b.past),
      past: mapped.filter((b) => b.past).reverse(),
      recurring: recurring.map((r) => {
        const access = accessFor(r);
        const rawPayments = paymentsByRecurring.get(r.id) || [];
        return {
          id: r.id,
          slotId: r.slot_id,
          weekday: r.weekday,
          startTime: fmtTime(r.start_time),
          durationMin: r.duration_min,
          priceCents: r.price_cents,
          trackPayments: r.track_payments === true,
          childName: r.child_name || null,
          startsOn: r.starts_on ? fmtDate(r.starts_on) : null,
          teacher: { id: r.teacher_id, name: r.teacher_name },
          exceptions: exceptionsBySlot.get(r.slot_id) || [],
          payments: rawPayments.map((p) => ({
            date: p.date,
            paid: access.isPaymentPartner ? p.partnerPaid : p.paid,
          })),
          isPartner: access.isPartner,
          partnerName: access.partnerName,
          paymentPartner: access.paymentPartner,
          canMarkPaid: access.canMarkPaid,
          canManage: access.canManage,
        };
      }),
    });
  }),
);

bookingsRouter.patch(
  '/:id/paid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { paid } = paidSchema.parse(req.body);

    const { rows } = await query(
      `SELECT b.*, s.teacher_id, t.track_payments
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN teachers t ON t.id = s.teacher_id
        WHERE b.id = $1`,
      [id],
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'booked') {
      throw new HttpError(404, 'Booking not found.');
    }
    if (!booking.track_payments) {
      throw new HttpError(403, 'This instructor does not track payments.');
    }

    const bookerStudentId =
      req.user.role === 'student' || req.user.role === 'teacher'
        ? await resolveBookerStudentId(req.user).catch(() => null)
        : null;
    const isOwnerStudent = bookerStudentId != null && booking.student_id === bookerStudentId;
    const isPaymentPartner =
      bookerStudentId != null && booking.payment_partner_id === bookerStudentId;
    const isOwnerTeacher = req.user.role === 'teacher' && booking.teacher_id === req.user.id;
    if (!isOwnerStudent && !isPaymentPartner && !isOwnerTeacher) {
      throw new HttpError(403, 'You cannot update payment for this booking.');
    }

    let updated;
    if (isOwnerTeacher) {
      const result = await query(
        'UPDATE bookings SET paid = $1, partner_paid = $1 WHERE id = $2 RETURNING id, paid, partner_paid',
        [paid, id],
      );
      updated = result.rows[0];
    } else if (isPaymentPartner && !isOwnerStudent) {
      const result = await query(
        'UPDATE bookings SET partner_paid = $1 WHERE id = $2 RETURNING id, paid, partner_paid',
        [paid, id],
      );
      updated = result.rows[0];
    } else {
      const result = await query(
        'UPDATE bookings SET paid = $1 WHERE id = $2 RETURNING id, paid, partner_paid',
        [paid, id],
      );
      updated = result.rows[0];
    }
    const viewerPaid =
      isPaymentPartner && !isOwnerStudent ? updated.partner_paid === true : updated.paid === true;
    res.json({ booking: { id: updated.id, paid: viewerPaid } });
  }),
);

bookingsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT b.*, s.teacher_id FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id = $1`,
      [id],
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'booked') {
      throw new HttpError(404, 'Booking not found.');
    }

    const bookerStudentId =
      req.user.role === 'student' || req.user.role === 'teacher'
        ? await resolveBookerStudentId(req.user).catch(() => null)
        : null;
    const isOwnerStudent = bookerStudentId != null && booking.student_id === bookerStudentId;
    const isOwnerTeacher = req.user.role === 'teacher' && booking.teacher_id === req.user.id;
    if (!isOwnerStudent && !isOwnerTeacher) {
      throw new HttpError(403, 'You cannot cancel this booking.');
    }

    await query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [id],
    );
    res.json({ ok: true });
  }),
);
