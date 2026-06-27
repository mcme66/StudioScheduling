import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import {
  addWeeks,
  dateForWeekday,
  getMonday,
  isValidDateStr,
  todayISO,
  weekdayOf,
  isLessonPast,
} from '../utils/week.js';

export const studiosRouter = Router();

function mapStudio(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    instructorCount: Number(row.instructor_count ?? 0),
  };
}

function mapTeacher(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    bio: row.bio,
    defaultPriceCents: row.default_price_cents,
    defaultDurationMin: row.default_duration_min,
    activeSlots: Number(row.active_slots),
  };
}

studiosRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.description,
              COUNT(DISTINCT ts.teacher_id) AS instructor_count
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
        GROUP BY s.id
        ORDER BY s.name`,
    );
    res.json({ studios: rows.map(mapStudio) });
  }),
);

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

const availabilityQuerySchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM.'),
});

const MAX_WEEKS_AHEAD = 2;

studiosRouter.get(
  '/:slug/availability',
  asyncHandler(async (req, res) => {
    const { date, time } = availabilityQuerySchema.parse(req.query);

    const today = todayISO();
    if (date < today) {
      throw new HttpError(400, 'That date is in the past.');
    }
    if (isLessonPast(date, time)) {
      throw new HttpError(400, 'That time has already passed.');
    }

    const maxDate = dateForWeekday(addWeeks(getMonday(today), MAX_WEEKS_AHEAD), 0);
    if (date > maxDate) {
      throw new HttpError(400, 'You can only search up to 2 weeks ahead.');
    }

    const { rows: studioRows } = await query('SELECT id, name, slug FROM studios WHERE slug = $1', [
      req.params.slug,
    ]);
    const studio = studioRows[0];
    if (!studio) throw new HttpError(404, 'Studio not found.');

    const weekday = weekdayOf(date);
    const timeValue = `${time}:00`;

    const { rows } = await query(
      `SELECT s.id AS slot_id, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name
         FROM slots s
         JOIN teachers t ON t.id = s.teacher_id
         JOIN teacher_studios ts ON ts.teacher_id = t.id AND ts.studio_id = $1
        WHERE s.active = true
          AND s.weekday = $2
          AND s.start_time = $3::time
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = s.id AND ra.status = 'approved'
          )
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = s.id AND ra.status = 'pending'
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.slot_id = s.id AND b.status = 'booked' AND b.lesson_date = $4::date
          )
        ORDER BY t.full_name`,
      [studio.id, weekday, timeValue, date],
    );

    res.json({
      date,
      time,
      results: rows.map((r) => ({
        slotId: r.slot_id,
        teacherId: r.teacher_id,
        teacherName: r.full_name,
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        priceCents: r.price_cents,
        lessonDate: date,
      })),
    });
  }),
);

studiosRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const { rows: studioRows } = await query(
      `SELECT s.id, s.name, s.slug, s.description,
              COUNT(DISTINCT ts.teacher_id) AS instructor_count
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
        WHERE s.slug = $1
        GROUP BY s.id`,
      [req.params.slug],
    );
    const studio = studioRows[0];
    if (!studio) throw new HttpError(404, 'Studio not found.');

    const { rows: teachers } = await query(
      `SELECT t.id, t.full_name, t.bio, t.default_price_cents, t.default_duration_min,
              COUNT(sl.id) FILTER (WHERE sl.active) AS active_slots
         FROM teachers t
         JOIN teacher_studios ts ON ts.teacher_id = t.id
         LEFT JOIN slots sl ON sl.teacher_id = t.id
        WHERE ts.studio_id = $1
        GROUP BY t.id
        ORDER BY t.full_name`,
      [studio.id],
    );

    res.json({
      studio: mapStudio(studio),
      teachers: teachers.map(mapTeacher),
    });
  }),
);
