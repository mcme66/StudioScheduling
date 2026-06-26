import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendRecurringApproved } from '../services/email.js';

export const recurringRouter = Router();

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

const requestSchema = z.object({ slotId: z.number().int().positive() });

// Student requests a weekly spot.
recurringRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'student') {
      throw new HttpError(403, 'Only students can request a weekly spot.');
    }
    const { slotId } = requestSchema.parse(req.body);

    const { rows: slotRows } = await query(
      'SELECT id, active FROM slots WHERE id = $1',
      [slotId],
    );
    if (!slotRows[0] || !slotRows[0].active) {
      throw new HttpError(404, 'That lesson time is not available.');
    }

    const { rows: approvedRows } = await query(
      "SELECT student_id FROM recurring_assignments WHERE slot_id = $1 AND status = 'approved'",
      [slotId],
    );
    if (approvedRows[0]) {
      throw new HttpError(409, 'This time already has a weekly student.');
    }

    const { rows: pendingRows } = await query(
      "SELECT student_id FROM recurring_assignments WHERE slot_id = $1 AND status = 'pending'",
      [slotId],
    );
    if (pendingRows[0]) {
      if (pendingRows[0].student_id === req.user.id) {
        throw new HttpError(409, 'You already have a pending request for this time.');
      }
      throw new HttpError(409, 'This time already has a pending weekly spot request.');
    }

    const { rows } = await query(
      `INSERT INTO recurring_assignments (slot_id, student_id, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [slotId, req.user.id],
    );

    res.status(201).json({ request: { id: rows[0].id, slotId, status: 'pending' } });
  }),
);

// Teacher: list pending weekly-spot requests for their slots.
recurringRouter.get(
  '/pending',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT ra.id, ra.requested_at, s.id AS slot_id, s.weekday, s.start_time, s.duration_min,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone,
              (
                SELECT b.lesson_date FROM bookings b
                 WHERE b.slot_id = ra.slot_id AND b.student_id = ra.student_id AND b.status = 'booked'
                 ORDER BY b.lesson_date LIMIT 1
              ) AS first_lesson_date
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN students st ON st.id = ra.student_id
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
        firstLessonDate: r.first_lesson_date
          ? r.first_lesson_date instanceof Date
            ? r.first_lesson_date.toISOString().slice(0, 10)
            : String(r.first_lesson_date).slice(0, 10)
          : null,
        student: { name: r.student_name, email: r.student_email, phone: r.student_phone },
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
      const { rows } = await client.query(
        `SELECT ra.*, s.teacher_id FROM recurring_assignments ra
           JOIN slots s ON s.id = ra.slot_id
          WHERE ra.id = $1 FOR UPDATE`,
        [id],
      );
      const reqRow = rows[0];
      if (!reqRow || reqRow.teacher_id !== req.user.id) {
        throw new HttpError(404, 'Request not found.');
      }
      if (reqRow.status !== 'pending') {
        throw new HttpError(409, 'This request was already handled.');
      }

      await client.query(
        "UPDATE recurring_assignments SET status = 'approved', decided_at = now() WHERE id = $1",
        [id],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'This time already has an approved weekly student.');
        }
        throw err;
      });

      // Decline any other pending requests for the same slot.
      await client.query(
        `UPDATE recurring_assignments SET status = 'declined', decided_at = now()
          WHERE slot_id = $1 AND status = 'pending' AND id <> $2`,
        [reqRow.slot_id, id],
      );

      return reqRow;
    });

    const [{ rows: studentRows }, { rows: teacherRows }, { rows: slotRows }] = await Promise.all([
      query('SELECT full_name, email, receive_emails FROM students WHERE id = $1', [result.student_id]),
      query('SELECT full_name FROM teachers WHERE id = $1', [req.user.id]),
      query('SELECT weekday, start_time, duration_min FROM slots WHERE id = $1', [result.slot_id]),
    ]);
    await sendRecurringApproved({
      student: studentRows[0],
      teacher: teacherRows[0],
      slot: slotRows[0],
    });

    res.json({ ok: true });
  }),
);

recurringRouter.post(
  '/:id/decline',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT ra.id, ra.status, s.teacher_id FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id WHERE ra.id = $1`,
      [id],
    );
    const reqRow = rows[0];
    if (!reqRow || reqRow.teacher_id !== req.user.id) {
      throw new HttpError(404, 'Request not found.');
    }
    if (reqRow.status !== 'pending') {
      throw new HttpError(409, 'This request was already handled.');
    }
    await query(
      "UPDATE recurring_assignments SET status = 'declined', decided_at = now() WHERE id = $1",
      [id],
    );
    res.json({ ok: true });
  }),
);
