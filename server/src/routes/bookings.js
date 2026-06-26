import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { weekdayOf, isValidDateStr, todayISO } from '../utils/week.js';
import { sendBookingConfirmation } from '../services/email.js';

export const bookingsRouter = Router();

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const createSchema = z.object({
  slotId: z.number().int().positive(),
  lessonDate: z.string().refine(isValidDateStr, 'lessonDate must be YYYY-MM-DD.'),
});

bookingsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'student') {
      throw new HttpError(403, 'Only students can book lessons.');
    }
    const { slotId, lessonDate } = createSchema.parse(req.body);

    if (lessonDate < todayISO()) {
      throw new HttpError(400, 'That date is in the past.');
    }

    const booking = await withTransaction(async (client) => {
      const { rows: slotRows } = await client.query(
        'SELECT * FROM slots WHERE id = $1 FOR UPDATE',
        [slotId],
      );
      const slot = slotRows[0];
      if (!slot || !slot.active) throw new HttpError(404, 'That lesson time is not available.');

      if (weekdayOf(lessonDate) !== slot.weekday) {
        throw new HttpError(400, 'That date does not match the lesson day.');
      }

      const { rows: recRows } = await client.query(
        "SELECT student_id FROM recurring_assignments WHERE slot_id = $1 AND status = 'approved'",
        [slotId],
      );
      if (recRows[0]) {
        if (recRows[0].student_id === req.user.id) {
          throw new HttpError(409, 'You already hold this time as a weekly spot.');
        }
        throw new HttpError(409, 'This time is reserved for a weekly student.');
      }

      const { rows: pendingRows } = await client.query(
        "SELECT student_id FROM recurring_assignments WHERE slot_id = $1 AND status = 'pending'",
        [slotId],
      );
      if (pendingRows[0] && pendingRows[0].student_id !== req.user.id) {
        throw new HttpError(409, 'This time has a pending weekly spot request.');
      }

      const { rows } = await client.query(
        `INSERT INTO bookings (slot_id, student_id, lesson_date)
         VALUES ($1, $2, $3) RETURNING *`,
        [slotId, req.user.id, lessonDate],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'That time was just booked. Please choose another.');
        }
        throw err;
      });
      return { booking: rows[0], slot };
    });

    // Send confirmation (best-effort) after the transaction commits.
    const [{ rows: studentRows }, { rows: teacherRows }] = await Promise.all([
      query('SELECT full_name, email, receive_emails FROM students WHERE id = $1', [req.user.id]),
      query('SELECT full_name FROM teachers WHERE id = $1', [booking.slot.teacher_id]),
    ]);
    await sendBookingConfirmation({
      student: studentRows[0],
      teacher: teacherRows[0],
      slot: booking.slot,
      lessonDate,
    });

    res.status(201).json({
      booking: {
        id: booking.booking.id,
        slotId,
        lessonDate,
        status: booking.booking.status,
      },
    });
  }),
);

bookingsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'student') {
      throw new HttpError(403, 'Only students have personal bookings.');
    }
    const { rows: bookings } = await query(
      `SELECT b.id, b.lesson_date, b.status, b.created_at,
              s.weekday, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name AS teacher_name
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN teachers t ON t.id = s.teacher_id
        WHERE b.student_id = $1 AND b.status = 'booked'
        ORDER BY b.lesson_date`,
      [req.user.id],
    );

    const { rows: recurring } = await query(
      `SELECT ra.id, s.weekday, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name AS teacher_name
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN teachers t ON t.id = s.teacher_id
        WHERE ra.student_id = $1 AND ra.status = 'approved'
        ORDER BY s.weekday, s.start_time`,
      [req.user.id],
    );

    const today = todayISO();
    const mapped = bookings.map((b) => ({
      id: b.id,
      lessonDate: fmtDate(b.lesson_date),
      startTime: fmtTime(b.start_time),
      durationMin: b.duration_min,
      priceCents: b.price_cents,
      teacher: { id: b.teacher_id, name: b.teacher_name },
      past: fmtDate(b.lesson_date) < today,
    }));

    res.json({
      upcoming: mapped.filter((b) => !b.past),
      past: mapped.filter((b) => b.past).reverse(),
      recurring: recurring.map((r) => ({
        id: r.id,
        weekday: r.weekday,
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        priceCents: r.price_cents,
        teacher: { id: r.teacher_id, name: r.teacher_name },
      })),
    });
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

    const isOwnerStudent = req.user.role === 'student' && booking.student_id === req.user.id;
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
