import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  sendRecurringApproved,
  sendWeeklySpotRequested,
  sendWeeklySpotDeclined,
  sendWeeklySpotOneTime,
} from '../services/email.js';
import {
  weekdayOf,
  isValidDateStr,
  todayISO,
  isDateInSeries,
  isLessonPast,
  addDays,
} from '../utils/week.js';
import { normalizeChildrenNames } from './students.js';
import { resolveBookerStudentId } from '../utils/booker.js';
import { resolvePaymentPartnerId } from '../utils/partners.js';
import { loadSlotForUpdate, assertSlotOpenOnDate } from '../utils/assertSlotOpen.js';

export const recurringRouter = Router();

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const requestSchema = z.object({
  slotId: z.number().int().positive(),
  lessonDate: z.string().refine(isValidDateStr, 'lessonDate must be YYYY-MM-DD.'),
  childName: z.string().max(120).optional().nullable(),
  paymentPartnerId: z.number().int().positive().optional().nullable(),
});

const skipSchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
});

const paidSchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
  paid: z.boolean(),
});

function seriesBounds(slot) {
  return {
    seriesStart: slot.series_start_date ? fmtDate(slot.series_start_date) : null,
    seriesEnd: slot.series_end_date ? fmtDate(slot.series_end_date) : null,
  };
}

/** Next occurrence of this weekly time that has not already started. */
function upcomingStart(startsOn, startTime, seriesStart, seriesEnd) {
  let date = fmtDate(startsOn);
  while (isLessonPast(date, startTime)) {
    date = addDays(date, 7);
  }
  if (!isDateInSeries(date, seriesStart, seriesEnd)) return null;
  return date;
}

/** Drop this student's not-yet-started lessons on the slot from `fromDate` on. */
async function cancelUnstartedBookings(client, { slotId, studentId, fromDate }) {
  await client.query(
    `UPDATE bookings b
        SET status = 'cancelled', cancelled_at = now()
       FROM slots s
      WHERE b.slot_id = s.id
        AND b.slot_id = $1
        AND b.student_id = $2
        AND b.status = 'booked'
        AND b.lesson_date >= $3::date
        AND (b.lesson_date + s.start_time) > now()`,
    [slotId, studentId, fromDate],
  );
}

async function lockPendingRequest(client, id, teacherId) {
  const { rows } = await client.query(
    `SELECT ra.*, s.teacher_id, s.weekday, s.start_time, s.duration_min, s.active,
            s.series_start_date, s.series_end_date, s.one_off_date
       FROM recurring_assignments ra
       JOIN slots s ON s.id = ra.slot_id
      WHERE ra.id = $1
      FOR UPDATE OF ra`,
    [id],
  );
  const reqRow = rows[0];
  if (!reqRow || reqRow.teacher_id !== teacherId) {
    throw new HttpError(404, 'Request not found.');
  }
  if (reqRow.status !== 'pending') {
    throw new HttpError(409, 'This request was already handled.');
  }
  return reqRow;
}

async function peopleForRequest(studentId, teacherId) {
  const [{ rows: studentRows }, { rows: teacherRows }] = await Promise.all([
    query('SELECT full_name, email, receive_emails FROM students WHERE id = $1', [studentId]),
    query('SELECT full_name, email, receive_emails FROM teachers WHERE id = $1', [teacherId]),
  ]);
  return { student: studentRows[0], teacher: teacherRows[0] };
}

// Student (or teacher-as-student) requests a weekly spot.
recurringRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookerStudentId = await resolveBookerStudentId(req.user);
    const {
      slotId,
      lessonDate,
      childName: requestedChildName,
      paymentPartnerId: requestedPartnerId,
    } = requestSchema.parse(req.body);

    const created = await withTransaction(async (client) => {
      const slot = await loadSlotForUpdate(client, slotId);
      if (req.user.role === 'teacher' && slot.teacher_id === req.user.id) {
        throw new HttpError(400, 'You cannot request a weekly spot on your own schedule.');
      }
      if (slot.one_off_date) {
        throw new HttpError(
          400,
          'Weekly time slots cannot be requested for this lesson slot because this is a temporary slot.',
        );
      }
      if (weekdayOf(lessonDate) !== slot.weekday) {
        throw new HttpError(400, 'That date does not match the lesson day.');
      }
      if (isLessonPast(lessonDate, slot.start_time)) {
        throw new HttpError(400, 'Weekly spots cannot start in the past.');
      }

      const { rows: studentRows } = await client.query(
        'SELECT is_parent, children_names FROM students WHERE id = $1',
        [bookerStudentId],
      );
      const student = studentRows[0];
      if (!student) throw new HttpError(401, 'Account no longer exists.');

      let childName = null;
      if (student.is_parent) {
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
        childName = match;
      } else if (requestedChildName) {
        throw new HttpError(400, 'Only parent accounts can book for a child.');
      }

      // Pending only. The instructor decides whether any lesson is booked.
      await assertSlotOpenOnDate(client, slot, lessonDate, { bookerStudentId });

      const { rows: laterRows } = await client.query(
        `SELECT 1 FROM bookings
          WHERE slot_id = $1 AND status = 'booked' AND lesson_date > $2::date
         UNION ALL
         SELECT 1 FROM lesson_invites
          WHERE slot_id = $1 AND status = 'pending' AND lesson_date > $2::date
         LIMIT 1`,
        [slotId, lessonDate],
      );
      if (laterRows[0]) {
        throw new HttpError(
          409,
          'A later week of this time is already booked, so it cannot be requested as a weekly spot yet.',
        );
      }

      const { rows: approvedRows } = await client.query(
        "SELECT student_id FROM recurring_assignments WHERE slot_id = $1 AND status = 'approved'",
        [slotId],
      );
      if (approvedRows[0]) {
        throw new HttpError(409, 'This time already has a weekly student.');
      }

      const paymentPartnerId = await resolvePaymentPartnerId(
        bookerStudentId,
        requestedPartnerId,
        (text, params) => client.query(text, params),
        childName,
      );

      const { rows } = await client.query(
        `INSERT INTO recurring_assignments
           (slot_id, student_id, status, child_name, payment_partner_id, starts_on)
         VALUES ($1, $2, 'pending', $3, $4, $5) RETURNING *`,
        [slotId, bookerStudentId, childName, paymentPartnerId, lessonDate],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'This time already has a pending weekly spot request.');
        }
        throw err;
      });

      return {
        id: rows[0].id,
        slot,
        childName,
        paymentPartnerId,
      };
    });

    const { student, teacher } = await peopleForRequest(bookerStudentId, created.slot.teacher_id);
    await sendWeeklySpotRequested({
      teacher,
      student,
      slot: created.slot,
      lessonDate,
      childName: created.childName,
    });

    res.status(201).json({
      request: {
        id: created.id,
        slotId,
        status: 'pending',
        childName: created.childName,
        paymentPartnerId: created.paymentPartnerId,
        startsOn: lessonDate,
      },
    });
  }),
);

// Teacher: list pending weekly-spot requests for their slots.
recurringRouter.get(
  '/pending',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT ra.id, ra.requested_at, ra.child_name, ra.payment_partner_id, ra.starts_on,
              s.id AS slot_id, s.weekday, s.start_time, s.duration_min,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone,
              pp.full_name AS payment_partner_name
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN students st ON st.id = ra.student_id
         LEFT JOIN students pp ON pp.id = ra.payment_partner_id
        WHERE s.teacher_id = $1 AND ra.status = 'pending'
        ORDER BY ra.requested_at`,
      [req.user.id],
    );
    res.json({
      pending: rows.map((r) => ({
        id: r.id,
        slotId: r.slot_id,
        weekday: r.weekday,
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        requestedAt: r.requested_at,
        firstLessonDate: r.starts_on ? fmtDate(r.starts_on) : null,
        student: {
          name: r.student_name,
          email: r.student_email,
          phone: r.student_phone,
          childName: r.child_name || null,
        },
        paymentPartner: r.payment_partner_name ? { name: r.payment_partner_name } : null,
      })),
    });
  }),
);

recurringRouter.post(
  '/:id/approve',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const result = await withTransaction(async (client) => {
      const reqRow = await lockPendingRequest(client, id, req.user.id);
      if (!reqRow.active || reqRow.one_off_date) {
        throw new HttpError(409, 'That lesson time is no longer available.');
      }
      if (!reqRow.starts_on) {
        throw new HttpError(409, 'This request has no start date.');
      }

      const { seriesStart, seriesEnd } = seriesBounds(reqRow);
      const startsOn = upcomingStart(reqRow.starts_on, reqRow.start_time, seriesStart, seriesEnd);
      if (!startsOn) {
        throw new HttpError(409, 'This weekly time has no upcoming weeks left to accept.');
      }

      await loadSlotForUpdate(client, reqRow.slot_id);

      const { rows: conflictRows } = await client.query(
        `SELECT 1 FROM bookings
          WHERE slot_id = $1 AND status = 'booked' AND lesson_date >= $2::date AND student_id <> $3
         UNION ALL
         SELECT 1 FROM lesson_invites
          WHERE slot_id = $1 AND status = 'pending' AND lesson_date >= $2::date
         LIMIT 1`,
        [reqRow.slot_id, startsOn, reqRow.student_id],
      );
      if (conflictRows[0]) {
        throw new HttpError(
          409,
          'Another lesson is already on this time. Clear those weeks before accepting the weekly spot.',
        );
      }

      // A weekly spot is the only record for these weeks. Drop any one-off
      // lesson this student already has so it is not counted twice.
      await cancelUnstartedBookings(client, {
        slotId: reqRow.slot_id,
        studentId: reqRow.student_id,
        fromDate: startsOn,
      });

      await client.query(
        `UPDATE recurring_assignments
            SET status = 'approved', starts_on = $2, decided_at = now()
          WHERE id = $1`,
        [id, startsOn],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'This time already has an approved weekly student.');
        }
        throw err;
      });

      await client.query(
        `UPDATE recurring_assignments SET status = 'declined', decided_at = now()
          WHERE slot_id = $1 AND status = 'pending' AND id <> $2`,
        [reqRow.slot_id, id],
      );

      return { ...reqRow, starts_on: startsOn };
    });

    const { student, teacher } = await peopleForRequest(result.student_id, req.user.id);
    await sendRecurringApproved({
      student,
      teacher,
      slot: result,
      childName: result.child_name || null,
      startsOn: fmtDate(result.starts_on),
    });

    res.json({ ok: true, startsOn: fmtDate(result.starts_on) });
  }),
);

recurringRouter.post(
  '/:id/one-time',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const result = await withTransaction(async (client) => {
      const reqRow = await lockPendingRequest(client, id, req.user.id);
      if (!reqRow.active || reqRow.one_off_date) {
        throw new HttpError(409, 'That lesson time is no longer available.');
      }
      const lessonDate = fmtDate(reqRow.starts_on);
      if (!lessonDate || isLessonPast(lessonDate, reqRow.start_time)) {
        throw new HttpError(
          409,
          'That date has already passed. Accept the weekly spot for upcoming weeks, or decline the request.',
        );
      }

      const { rows: existing } = await client.query(
        `SELECT id FROM bookings
          WHERE slot_id = $1 AND lesson_date = $2 AND student_id = $3 AND status = 'booked'`,
        [reqRow.slot_id, lessonDate, reqRow.student_id],
      );

      await client.query(
        "UPDATE recurring_assignments SET status = 'declined', decided_at = now() WHERE id = $1",
        [id],
      );

      if (!existing[0]) {
        const slot = await loadSlotForUpdate(client, reqRow.slot_id);
        await assertSlotOpenOnDate(client, slot, lessonDate, {
          bookerStudentId: reqRow.student_id,
        });
        await client.query(
          `INSERT INTO bookings (slot_id, student_id, lesson_date, child_name, payment_partner_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            reqRow.slot_id,
            reqRow.student_id,
            lessonDate,
            reqRow.child_name,
            reqRow.payment_partner_id,
          ],
        ).catch((err) => {
          if (err?.code === '23505') {
            throw new HttpError(409, 'That time was just booked. Please choose another.');
          }
          throw err;
        });
      }

      return { ...reqRow, lessonDate };
    });

    const { student, teacher } = await peopleForRequest(result.student_id, req.user.id);
    await sendWeeklySpotOneTime({
      student,
      teacher,
      slot: result,
      lessonDate: result.lessonDate,
      childName: result.child_name || null,
    });

    res.json({ ok: true, lessonDate: result.lessonDate });
  }),
);

recurringRouter.post(
  '/:id/decline',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await withTransaction(async (client) => {
      const reqRow = await lockPendingRequest(client, id, req.user.id);
      if (reqRow.starts_on) {
        await cancelUnstartedBookings(client, {
          slotId: reqRow.slot_id,
          studentId: reqRow.student_id,
          fromDate: fmtDate(reqRow.starts_on),
        });
      }
      await client.query(
        "UPDATE recurring_assignments SET status = 'declined', decided_at = now() WHERE id = $1",
        [id],
      );
      return reqRow;
    });

    const { student, teacher } = await peopleForRequest(result.student_id, req.user.id);
    await sendWeeklySpotDeclined({
      student,
      teacher,
      slot: result,
      lessonDate: result.starts_on ? fmtDate(result.starts_on) : null,
      childName: result.child_name || null,
    });

    res.json({ ok: true });
  }),
);

// Mark a single week of an approved weekly spot as paid/unpaid.
recurringRouter.patch(
  '/:id/paid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { date, paid } = paidSchema.parse(req.body);

    const { rows } = await query(
      `SELECT ra.id, ra.status, ra.student_id, ra.payment_partner_id, ra.slot_id, s.teacher_id, s.weekday,
              t.track_payments
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN teachers t ON t.id = s.teacher_id
        WHERE ra.id = $1`,
      [id],
    );
    const ra = rows[0];
    if (!ra) throw new HttpError(404, 'Weekly spot not found.');
    if (!ra.track_payments) {
      throw new HttpError(403, 'This instructor does not track payments.');
    }

    const bookerStudentId = await resolveBookerStudentId(req.user).catch(() => null);
    const isTeacher = req.user.role === 'teacher' && ra.teacher_id === req.user.id;
    const isStudent = bookerStudentId != null && ra.student_id === bookerStudentId;
    const isPaymentPartner =
      bookerStudentId != null && ra.payment_partner_id === bookerStudentId;
    if (!isTeacher && !isStudent && !isPaymentPartner) {
      throw new HttpError(403, 'You cannot update payment for this weekly spot.');
    }
    if (ra.status !== 'approved') {
      throw new HttpError(409, 'This weekly spot is not active.');
    }
    if (weekdayOf(date) !== ra.weekday) {
      throw new HttpError(400, 'That date does not match the lesson day.');
    }

    const bookerPaid = isTeacher || isStudent ? paid : null;
    const partnerPaid = isTeacher || (isPaymentPartner && !isStudent) ? paid : null;
    const { rows: updated } = await query(
      `INSERT INTO recurring_lesson_payments (recurring_assignment_id, lesson_date, paid, partner_paid)
       VALUES (
         $1, $2,
         COALESCE($3, false),
         COALESCE($4, false)
       )
       ON CONFLICT (recurring_assignment_id, lesson_date)
       DO UPDATE SET
         paid = COALESCE($3, recurring_lesson_payments.paid),
         partner_paid = COALESCE($4, recurring_lesson_payments.partner_paid)
       RETURNING recurring_assignment_id, lesson_date, paid, partner_paid`,
      [id, date, bookerPaid, partnerPaid],
    );
    const viewerPaid =
      isPaymentPartner && !isStudent && !isTeacher
        ? updated[0].partner_paid === true
        : updated[0].paid === true;
    res.json({
      payment: {
        recurringId: updated[0].recurring_assignment_id,
        lessonDate: updated[0].lesson_date instanceof Date
          ? updated[0].lesson_date.toISOString().slice(0, 10)
          : updated[0].lesson_date,
        paid: viewerPaid,
      },
    });
  }),
);

// Skip a single week of an approved weekly spot. The slot reopens for that
// date. Allowed for the slot's teacher or the assignment's student.
recurringRouter.post(
  '/:id/skip',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { date } = skipSchema.parse(req.body);

    const { rows } = await query(
      `SELECT ra.id, ra.status, ra.student_id, ra.slot_id, ra.starts_on, s.teacher_id, s.weekday,
              s.series_start_date, s.series_end_date
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id WHERE ra.id = $1`,
      [id],
    );
    const ra = rows[0];
    if (!ra) throw new HttpError(404, 'Weekly spot not found.');

    const bookerStudentId = await resolveBookerStudentId(req.user).catch(() => null);
    const isTeacher = req.user.role === 'teacher' && ra.teacher_id === req.user.id;
    const isStudent = bookerStudentId != null && ra.student_id === bookerStudentId;
    if (!isTeacher && !isStudent) {
      throw new HttpError(403, 'You cannot change this weekly spot.');
    }
    if (ra.status !== 'approved') {
      throw new HttpError(409, 'This weekly spot is not active.');
    }
    if (date < todayISO()) {
      throw new HttpError(400, 'That date is in the past.');
    }
    if (weekdayOf(date) !== ra.weekday) {
      throw new HttpError(400, 'That date does not match the lesson day.');
    }
    if (ra.starts_on && date < fmtDate(ra.starts_on)) {
      throw new HttpError(400, 'That week is before this weekly spot starts.');
    }
    if (
      !isDateInSeries(
        date,
        ra.series_start_date ? fmtDate(ra.series_start_date) : null,
        ra.series_end_date ? fmtDate(ra.series_end_date) : null,
      )
    ) {
      throw new HttpError(400, 'That week is outside this weekly slot.');
    }

    await query(
      `INSERT INTO slot_exceptions (slot_id, exception_date, kind)
       VALUES ($1, $2, 'skipped')
       ON CONFLICT (slot_id, exception_date) DO UPDATE SET kind = 'skipped'`,
      [ra.slot_id, date],
    );
    res.json({ ok: true });
  }),
);

// Permanently end a weekly spot (frees the slot every week going forward).
// Allowed for the slot's teacher or the assignment's student.
recurringRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ra.id, ra.status, ra.student_id, ra.starts_on, ra.slot_id, s.teacher_id
           FROM recurring_assignments ra
           JOIN slots s ON s.id = ra.slot_id
          WHERE ra.id = $1
          FOR UPDATE OF ra`,
        [id],
      );
      const ra = rows[0];
      if (!ra) throw new HttpError(404, 'Weekly spot not found.');

      const bookerStudentId = await resolveBookerStudentId(req.user).catch(() => null);
      const isTeacher = req.user.role === 'teacher' && ra.teacher_id === req.user.id;
      const isStudent = bookerStudentId != null && ra.student_id === bookerStudentId;
      if (!isTeacher && !isStudent) {
        throw new HttpError(403, 'You cannot remove this weekly spot.');
      }
      if (ra.status !== 'approved' && ra.status !== 'pending') {
        throw new HttpError(409, 'This weekly spot is not active.');
      }

      if (ra.status === 'pending' && ra.starts_on) {
        await cancelUnstartedBookings(client, {
          slotId: ra.slot_id,
          studentId: ra.student_id,
          fromDate: fmtDate(ra.starts_on),
        });
      }

      await client.query(
        "UPDATE recurring_assignments SET status = 'cancelled', decided_at = now() WHERE id = $1",
        [id],
      );
    });
    res.json({ ok: true });
  }),
);
