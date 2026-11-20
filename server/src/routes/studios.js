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
  isDateInSeries,
} from '../utils/week.js';
import { listRooms, listClassSchedules } from '../utils/classSchedules.js';
import { listCoachTiers } from '../utils/coachTiers.js';

export const studiosRouter = Router();

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

/** Active lesson times for the current week (filled or open). */
async function weekSlotCountsByTeacher(teacherIds) {
  const counts = new Map(teacherIds.map((id) => [id, 0]));
  if (!teacherIds.length) return counts;

  const monday = getMonday(todayISO());
  const sunday = dateForWeekday(monday, 0);
  const { rows } = await query(
    `SELECT teacher_id, weekday, one_off_date, series_start_date, series_end_date
       FROM slots
      WHERE teacher_id = ANY($1::int[])
        AND active = true
        AND (
          (one_off_date IS NOT NULL AND one_off_date BETWEEN $2 AND $3)
          OR (
            one_off_date IS NULL
            AND (series_start_date IS NULL OR series_start_date <= $3)
            AND (series_end_date IS NULL OR series_end_date >= $2)
          )
        )`,
    [teacherIds, monday, sunday],
  );

  for (const row of rows) {
    if (row.one_off_date == null) {
      const lessonDate = dateForWeekday(monday, row.weekday);
      if (
        !isDateInSeries(
          lessonDate,
          row.series_start_date ? fmtDate(row.series_start_date) : null,
          row.series_end_date ? fmtDate(row.series_end_date) : null,
        )
      ) {
        continue;
      }
    }
    counts.set(row.teacher_id, (counts.get(row.teacher_id) || 0) + 1);
  }
  return counts;
}

function mapStudio(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    instructorCount: Number(row.instructor_count ?? 0),
    hasOwner: row.has_owner === true,
    showManagedLabel: row.show_managed_label === true,
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
    tierId: row.tier_id || null,
    tierName: row.tier_name || null,
    ownerManaged: row.owner_managed === true,
  };
}

studiosRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.description, s.show_managed_label,
              COUNT(DISTINCT t.id) AS instructor_count,
              EXISTS (
                SELECT 1 FROM studio_owners so WHERE so.studio_id = s.id
              ) AS has_owner
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
         LEFT JOIN teachers t ON t.id = ts.teacher_id AND t.is_active
        GROUP BY s.id
        ORDER BY s.name`,
    );
    res.json({ studios: rows.map(mapStudio) });
  }),
);

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

const quarterHour = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Times must be in 15-minute steps.');

const availabilityQuerySchema = z.object({
  date: z.string().refine(isValidDateStr, 'date must be YYYY-MM-DD.'),
  from: quarterHour,
  to: quarterHour,
});

const MAX_WEEKS_AHEAD = 4;

studiosRouter.get(
  '/:slug/availability',
  asyncHandler(async (req, res) => {
    const { date, from, to } = availabilityQuerySchema.parse(req.query);

    const today = todayISO();
    if (date < today) {
      throw new HttpError(400, 'That date is in the past.');
    }
    if (from >= to) {
      throw new HttpError(400, 'The end of the range has to be after the start.');
    }
    if (isLessonPast(date, to)) {
      throw new HttpError(400, 'That time has already passed.');
    }

    const maxDate = dateForWeekday(addWeeks(getMonday(today), MAX_WEEKS_AHEAD), 0);
    if (date > maxDate) {
      throw new HttpError(400, 'You can only search up to 5 weeks ahead.');
    }

    const { rows: studioRows } = await query(
      'SELECT id, name, slug, show_managed_label FROM studios WHERE slug = $1',
      [req.params.slug],
    );
    const studio = studioRows[0];
    if (!studio) throw new HttpError(404, 'Studio not found.');

    const weekday = weekdayOf(date);

    const { rows } = await query(
      `SELECT s.id AS slot_id, s.start_time, s.duration_min, s.price_cents,
              t.id AS teacher_id, t.full_name, ct.name AS tier_name, ts.owner_managed
         FROM slots s
         JOIN teachers t ON t.id = s.teacher_id
         JOIN teacher_studios ts ON ts.teacher_id = t.id AND ts.studio_id = $1
         LEFT JOIN coach_tiers ct ON ct.id = ts.tier_id
        WHERE s.active = true
          AND t.is_active
          AND s.weekday = $2
          AND s.start_time >= $3::time
          AND (s.start_time + make_interval(mins => s.duration_min)) <= $5::time
          AND (s.start_time + make_interval(mins => s.duration_min)) > s.start_time
          AND (s.one_off_date IS NULL OR s.one_off_date = $4::date)
          AND (
            s.one_off_date IS NOT NULL
            OR (
              (s.series_start_date IS NULL OR s.series_start_date <= $4::date)
              AND (s.series_end_date IS NULL OR s.series_end_date >= $4::date)
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = s.id AND ra.status = 'approved'
               AND ra.starts_on <= $4::date
               AND (s.series_start_date IS NULL OR s.series_start_date <= $4::date)
               AND (s.series_end_date IS NULL OR s.series_end_date >= $4::date)
          )
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = s.id AND ra.status = 'pending'
               AND ra.starts_on <= $4::date
               AND (s.series_start_date IS NULL OR s.series_start_date <= $4::date)
               AND (s.series_end_date IS NULL OR s.series_end_date >= $4::date)
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.slot_id = s.id AND b.status = 'booked' AND b.lesson_date = $4::date
          )
          AND NOT EXISTS (
            SELECT 1 FROM lesson_invites li
             WHERE li.slot_id = s.id AND li.status = 'pending' AND li.lesson_date = $4::date
          )
        ORDER BY s.start_time, ct.sort_order NULLS LAST, t.full_name`,
      [studio.id, weekday, `${from}:00`, date, `${to}:00`],
    );

    res.json({
      date,
      from,
      to,
      showManagedLabel: studio.show_managed_label === true,
      results: rows
        .filter((r) => !isLessonPast(date, fmtTime(r.start_time)))
        .map((r) => ({
          slotId: r.slot_id,
          teacherId: r.teacher_id,
          teacherName: r.full_name,
          tierName: r.tier_name || null,
          ownerManaged: r.owner_managed === true,
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
      `SELECT s.id, s.name, s.slug, s.description, s.show_managed_label,
              COUNT(DISTINCT t.id) AS instructor_count
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
         LEFT JOIN teachers t ON t.id = ts.teacher_id AND t.is_active
        WHERE s.slug = $1
        GROUP BY s.id`,
      [req.params.slug],
    );
    const studio = studioRows[0];
    if (!studio) throw new HttpError(404, 'Studio not found.');

    const [teachers, rooms, classSchedules, tiers] = await Promise.all([
      query(
        `SELECT t.id, t.full_name, t.bio, t.default_price_cents, t.default_duration_min,
                ct.id AS tier_id, ct.name AS tier_name, ts.owner_managed
           FROM teachers t
           JOIN teacher_studios ts ON ts.teacher_id = t.id
           LEFT JOIN coach_tiers ct ON ct.id = ts.tier_id
          WHERE ts.studio_id = $1
            AND t.is_active
          ORDER BY ct.sort_order NULLS LAST, ct.id NULLS LAST, t.full_name`,
        [studio.id],
      ).then((r) => r.rows),
      listRooms(studio.id),
      listClassSchedules(studio.id),
      listCoachTiers(studio.id),
    ]);

    const weekSlots = await weekSlotCountsByTeacher(teachers.map((t) => t.id));

    res.json({
      studio: mapStudio(studio),
      teachers: teachers.map((t) =>
        mapTeacher({ ...t, active_slots: weekSlots.get(t.id) || 0 }),
      ),
      tiers,
      rooms,
      classSchedules,
    });
  }),
);
