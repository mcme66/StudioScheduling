import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { weekdayOf, isValidDateStr, todayISO } from '../utils/week.js';

export const slotsRouter = Router();

slotsRouter.use(requireRole('teacher'));

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const dateSchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
});

const createSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(timeRegex, 'Time must be HH:MM (24h).'),
  durationMin: z.number().int().min(5).max(240).optional(),
  priceCents: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  durationMin: z.number().int().min(5).max(240).optional(),
  priceCents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

function serializeSlot(row) {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : row.start_time,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    active: row.active,
  };
}

slotsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM slots WHERE teacher_id = $1 ORDER BY weekday, start_time',
      [req.user.id],
    );
    res.json({ slots: rows.map(serializeSlot) });
  }),
);

slotsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);

    // Default duration/price come from the teacher profile when not provided.
    const { rows: teacherRows } = await query(
      'SELECT default_price_cents, default_duration_min FROM teachers WHERE id = $1',
      [req.user.id],
    );
    const teacher = teacherRows[0];

    const result = await query(
      `INSERT INTO slots (teacher_id, weekday, start_time, duration_min, price_cents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.user.id,
        data.weekday,
        data.startTime,
        data.durationMin ?? teacher.default_duration_min,
        data.priceCents ?? teacher.default_price_cents,
      ],
    ).catch((err) => {
      if (err?.code === '23505') {
        throw new HttpError(409, 'You already have a slot at that day and time.');
      }
      throw err;
    });

    res.status(201).json({ slot: serializeSlot(result.rows[0]) });
  }),
);

slotsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;
    if (data.durationMin !== undefined) {
      fields.push(`duration_min = $${idx++}`);
      values.push(data.durationMin);
    }
    if (data.priceCents !== undefined) {
      fields.push(`price_cents = $${idx++}`);
      values.push(data.priceCents);
    }
    if (data.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(data.active);
    }
    if (!fields.length) {
      throw new HttpError(400, 'Nothing to update.');
    }

    values.push(id, req.user.id);
    const { rows } = await query(
      `UPDATE slots SET ${fields.join(', ')}
        WHERE id = $${idx++} AND teacher_id = $${idx}
        RETURNING *`,
      values,
    );
    if (!rows[0]) {
      throw new HttpError(404, 'Slot not found.');
    }
    res.json({ slot: serializeSlot(rows[0]) });
  }),
);

// Block a single week of a slot: nobody can book it that week and any active
// booking on that date is cancelled.
slotsRouter.post(
  '/:id/block',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { date } = dateSchema.parse(req.body);

    const { rows } = await query(
      'SELECT id, weekday FROM slots WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id],
    );
    const slot = rows[0];
    if (!slot) throw new HttpError(404, 'Slot not found.');
    if (date < todayISO()) throw new HttpError(400, 'That date is in the past.');
    if (weekdayOf(date) !== slot.weekday) {
      throw new HttpError(400, 'That date does not match the lesson day.');
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO slot_exceptions (slot_id, exception_date, kind)
         VALUES ($1, $2, 'blocked')
         ON CONFLICT (slot_id, exception_date) DO UPDATE SET kind = 'blocked'`,
        [id, date],
      );
      await client.query(
        "UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked'",
        [id, date],
      );
    });
    res.json({ ok: true });
  }),
);

// Remove a single-week exception (undo a skip or block).
slotsRouter.delete(
  '/:id/exceptions',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { date } = dateSchema.parse(req.body);

    const { rows } = await query(
      'SELECT id FROM slots WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Slot not found.');

    await query(
      'DELETE FROM slot_exceptions WHERE slot_id = $1 AND exception_date = $2',
      [id, date],
    );
    res.json({ ok: true });
  }),
);

slotsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query(
      'DELETE FROM slots WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id],
    );
    if (!rowCount) {
      throw new HttpError(404, 'Slot not found.');
    }
    res.json({ ok: true });
  }),
);
