import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import {
  weekdayOf,
  isValidDateStr,
  todayISO,
  getMonday,
  dateForWeekday,
  addDays,
  lastWeekdayOnOrBefore,
  isDateInSeries,
  isLessonPast,
} from '../utils/week.js';

export const slotsRouter = Router();

slotsRouter.use(requireRole('teacher'));

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const dateSchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
});

const createSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(timeRegex, 'Time must be HH:MM (24h).'),
    durationMin: z.number().int().min(5).max(240).optional(),
    priceCents: z.number().int().min(0).optional(),
    // One-time slot for a specific date in the viewed week.
    date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.').optional(),
    // Weekly series options (ignored when `date` is set).
    seriesMode: z.enum(['count', 'until', 'forever']).optional(),
    weekCount: z.number().int().min(1).max(104).optional(),
    untilDate: z.string().refine(isValidDateStr, 'untilDate must be YYYY-MM-DD.').optional(),
    // Date of the chosen weekday in the week the teacher is viewing.
    anchorDate: z.string().refine(isValidDateStr, 'anchorDate must be YYYY-MM-DD.').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.date) return; // one-time
    if (!data.seriesMode) {
      // Backward-compatible: bare create = forever weekly from today-ish.
      return;
    }
    if (data.seriesMode === 'count' && data.weekCount == null) {
      ctx.addIssue({ code: 'custom', message: 'weekCount is required for count mode.', path: ['weekCount'] });
    }
    if (data.seriesMode === 'until' && !data.untilDate) {
      ctx.addIssue({ code: 'custom', message: 'untilDate is required for until mode.', path: ['untilDate'] });
    }
    if (!data.anchorDate) {
      ctx.addIssue({ code: 'custom', message: 'anchorDate is required for weekly series.', path: ['anchorDate'] });
    }
  });

const endSeriesSchema = z.object({
  fromDate: z.string().refine(isValidDateStr, 'fromDate must be YYYY-MM-DD.'),
});

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

function serializeSlot(row) {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : row.start_time,
    durationMin: row.duration_min,
    priceCents: row.price_cents,
    active: row.active,
    oneOffDate: row.one_off_date ? fmtDate(row.one_off_date) : null,
    seriesStartDate: row.series_start_date ? fmtDate(row.series_start_date) : null,
    seriesEndDate: row.series_end_date ? fmtDate(row.series_end_date) : null,
    // Only populated when the list is requested for a specific week.
    blockedThisWeek: row.blockedThisWeek === true,
  };
}

/** First future occurrence of weekday/time on or after candidateDate. */
function firstFutureOccurrence(candidateDate, startTime) {
  let date = candidateDate;
  while (isLessonPast(date, startTime)) {
    date = addDays(date, 7);
  }
  return date;
}

function computeSeriesEnd(seriesMode, seriesStart, weekday, weekCount, untilDate) {
  if (seriesMode === 'forever' || !seriesMode) return null;
  if (seriesMode === 'count') {
    return addDays(seriesStart, (weekCount - 1) * 7);
  }
  // until
  const end = lastWeekdayOnOrBefore(untilDate, weekday);
  if (!end || end < seriesStart) {
    throw new HttpError(400, 'Until date must cover at least one weekly occurrence.');
  }
  return end;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = aStart || '0001-01-01';
  const ae = aEnd || '9999-12-31';
  const bs = bStart || '0001-01-01';
  const be = bEnd || '9999-12-31';
  return as <= be && bs <= ae;
}

async function assertNoOverlappingWeekly(teacherId, weekday, startTime, seriesStart, seriesEnd) {
  const { rows } = await query(
    `SELECT id, series_start_date, series_end_date FROM slots
      WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3 AND one_off_date IS NULL`,
    [teacherId, weekday, startTime],
  );
  for (const r of rows) {
    const existingStart = r.series_start_date ? fmtDate(r.series_start_date) : null;
    const existingEnd = r.series_end_date ? fmtDate(r.series_end_date) : null;
    if (rangesOverlap(existingStart, existingEnd, seriesStart, seriesEnd)) {
      throw new HttpError(
        409,
        'You already have a weekly series at that day and time that overlaps these dates. End the existing series first.',
      );
    }
  }
}

slotsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Without a week, return recurring slots only (the raw weekly template).
    // With ?week=, return the effective times for that week: recurring slots
    // inside their series bounds (annotated with whether they're blocked that
    // week) plus any one-off slots that fall inside the week.
    const week = isValidDateStr(req.query.week) ? req.query.week : null;

    if (!week) {
      const { rows } = await query(
        'SELECT * FROM slots WHERE teacher_id = $1 AND one_off_date IS NULL ORDER BY weekday, start_time',
        [req.user.id],
      );
      res.json({ slots: rows.map(serializeSlot) });
      return;
    }

    const monday = getMonday(week);
    const sunday = dateForWeekday(monday, 0);

    const { rows } = await query(
      `SELECT * FROM slots
        WHERE teacher_id = $1
          AND (
            (one_off_date IS NOT NULL AND one_off_date BETWEEN $2 AND $3)
            OR (
              one_off_date IS NULL
              AND (series_start_date IS NULL OR series_start_date <= $3)
              AND (series_end_date IS NULL OR series_end_date >= $2)
            )
          )
        ORDER BY weekday, start_time`,
      [req.user.id, monday, sunday],
    );

    // Drop weekly slots whose concrete weekday in this week falls outside bounds.
    const inWeek = rows.filter((r) => {
      if (r.one_off_date != null) return true;
      const lessonDate = dateForWeekday(monday, r.weekday);
      return isDateInSeries(
        lessonDate,
        r.series_start_date ? fmtDate(r.series_start_date) : null,
        r.series_end_date ? fmtDate(r.series_end_date) : null,
      );
    });

    const recurringIds = inWeek.filter((r) => r.one_off_date == null).map((r) => r.id);
    let blockedBySlot = new Set();
    if (recurringIds.length) {
      const { rows: excRows } = await query(
        `SELECT slot_id FROM slot_exceptions
          WHERE slot_id = ANY($1::int[]) AND kind = 'blocked'
            AND exception_date BETWEEN $2 AND $3`,
        [recurringIds, monday, sunday],
      );
      blockedBySlot = new Set(excRows.map((e) => e.slot_id));
    }

    const slots = inWeek.map((r) =>
      serializeSlot({ ...r, blockedThisWeek: blockedBySlot.has(r.id) }),
    );
    res.json({ slots });
  }),
);

slotsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const oneOffDate = data.date ?? null;

    let seriesStartDate = null;
    let seriesEndDate = null;

    if (oneOffDate) {
      if (weekdayOf(oneOffDate) !== data.weekday) {
        throw new HttpError(400, 'That date does not match the lesson day.');
      }
      if (isLessonPast(oneOffDate, data.startTime)) {
        throw new HttpError(400, 'That time has already passed.');
      }
      // Avoid a one-off shadowing an existing weekly time at the same slot
      // for that date.
      const { rows: existingRecurring } = await query(
        `SELECT id, series_start_date, series_end_date FROM slots
          WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3 AND one_off_date IS NULL`,
        [req.user.id, data.weekday, data.startTime],
      );
      if (existingRecurring[0]) {
        const r = existingRecurring[0];
        const inSeries = isDateInSeries(
          oneOffDate,
          r.series_start_date ? fmtDate(r.series_start_date) : null,
          r.series_end_date ? fmtDate(r.series_end_date) : null,
        );
        if (inSeries) {
          throw new HttpError(
            409,
            'You already offer this time every week. Adjust the weekly time for this week instead.',
          );
        }
      }
    } else {
      const seriesMode = data.seriesMode || 'forever';
      const anchor = data.anchorDate || todayISO();
      if (weekdayOf(anchor) !== data.weekday) {
        throw new HttpError(400, 'Anchor date does not match the lesson day.');
      }
      seriesStartDate = firstFutureOccurrence(anchor, data.startTime);
      seriesEndDate = computeSeriesEnd(
        seriesMode,
        seriesStartDate,
        data.weekday,
        data.weekCount,
        data.untilDate,
      );
      await assertNoOverlappingWeekly(
        req.user.id,
        data.weekday,
        data.startTime,
        seriesStartDate,
        seriesEndDate,
      );
    }

    const { rows: teacherRows } = await query(
      'SELECT default_price_cents, default_duration_min FROM teachers WHERE id = $1',
      [req.user.id],
    );
    const teacher = teacherRows[0];

    const result = await query(
      `INSERT INTO slots (
         teacher_id, weekday, start_time, duration_min, price_cents,
         one_off_date, series_start_date, series_end_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        data.weekday,
        data.startTime,
        data.durationMin ?? teacher.default_duration_min,
        data.priceCents ?? teacher.default_price_cents,
        oneOffDate,
        seriesStartDate,
        seriesEndDate,
      ],
    ).catch((err) => {
      if (err?.code === '23505') {
        throw new HttpError(
          409,
          oneOffDate
            ? 'You already have a lesson time at that day and time this week.'
            : 'You already have a slot at that day and time. End the existing series first.',
        );
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
    const data = z
      .object({
        durationMin: z.number().int().min(5).max(240).optional(),
        priceCents: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

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
      'SELECT id, weekday, one_off_date, series_start_date, series_end_date FROM slots WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id],
    );
    const slot = rows[0];
    if (!slot) throw new HttpError(404, 'Slot not found.');
    if (slot.one_off_date) {
      throw new HttpError(400, 'Use delete for one-time lesson slots.');
    }
    if (date < todayISO()) throw new HttpError(400, 'That date is in the past.');
    if (weekdayOf(date) !== slot.weekday) {
      throw new HttpError(400, 'That date does not match the lesson day.');
    }
    if (
      !isDateInSeries(
        date,
        slot.series_start_date ? fmtDate(slot.series_start_date) : null,
        slot.series_end_date ? fmtDate(slot.series_end_date) : null,
      )
    ) {
      throw new HttpError(400, 'That date is outside this lesson series.');
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

// End a weekly series from a given date forward. Past occurrences remain.
// If there is no occurrence before fromDate, the slot row is deleted.
slotsRouter.post(
  '/:id/end-series',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { fromDate } = endSeriesSchema.parse(req.body);

    const { rows } = await query(
      'SELECT * FROM slots WHERE id = $1 AND teacher_id = $2',
      [id, req.user.id],
    );
    const slot = rows[0];
    if (!slot) throw new HttpError(404, 'Slot not found.');
    if (slot.one_off_date) {
      throw new HttpError(400, 'One-time slots cannot be ended as a series.');
    }
    if (weekdayOf(fromDate) !== slot.weekday) {
      throw new HttpError(400, 'That date does not match the lesson day.');
    }

    const seriesStart = slot.series_start_date ? fmtDate(slot.series_start_date) : null;
    const seriesEnd = slot.series_end_date ? fmtDate(slot.series_end_date) : null;
    if (!isDateInSeries(fromDate, seriesStart, seriesEnd)) {
      throw new HttpError(400, 'That date is outside this lesson series.');
    }

    // Legacy unbounded starts (null series_start) are treated as having past
    // history to preserve. Otherwise keep the slot only if fromDate is after start.
    const hasPastInSeries = !seriesStart || fromDate > seriesStart;
    const previousOccurrence = addDays(fromDate, -7);

    await withTransaction(async (client) => {
      // Cancel future one-off bookings from fromDate forward.
      await client.query(
        `UPDATE bookings
            SET status = 'cancelled', cancelled_at = now()
          WHERE slot_id = $1 AND lesson_date >= $2 AND status = 'booked'`,
        [id, fromDate],
      );

      // Weekly spots cannot continue past the series end.
      await client.query(
        `UPDATE recurring_assignments
            SET status = 'cancelled', decided_at = now()
          WHERE slot_id = $1 AND status IN ('pending', 'approved')`,
        [id],
      );

      if (!hasPastInSeries) {
        await client.query('DELETE FROM slots WHERE id = $1', [id]);
      } else {
        await client.query(
          'UPDATE slots SET series_end_date = $1 WHERE id = $2',
          [previousOccurrence, id],
        );
      }
    });

    res.json({ ok: true, deleted: !hasPastInSeries });
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
