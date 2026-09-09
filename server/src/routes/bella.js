import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

export const bellaRouter = Router();

const TEACHER_NAME = 'Isabella Siller';
const MONTH_START = '2026-08-01';
const MONTH_END = '2026-08-31';

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

/** Temporary: lessons Isabella Siller taught in August 2026. */
bellaRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows: teachers } = await query(
      `SELECT id, full_name
         FROM teachers
        WHERE lower(trim(full_name)) = lower($1)
        LIMIT 1`,
      [TEACHER_NAME],
    );
    const teacher = teachers[0];
    if (!teacher) {
      throw new HttpError(404, `No instructor named ${TEACHER_NAME} was found.`);
    }

    const { rows } = await query(
      `WITH days AS (
         SELECT generate_series($2::date, $3::date, interval '1 day')::date AS lesson_date
       )
       SELECT DISTINCT ON (lesson_date, start_time)
              lesson_date, start_time, duration_min, student_name, child_name,
              payment_partner_name, kind
         FROM (
           SELECT d.lesson_date, s.start_time, s.duration_min,
                  st.full_name AS student_name, b.child_name,
                  pp.full_name AS payment_partner_name,
                  'one-off'::text AS kind
             FROM days d
             JOIN bookings b ON b.lesson_date = d.lesson_date AND b.status = 'booked'
             JOIN slots s ON s.id = b.slot_id
             JOIN students st ON st.id = b.student_id
             LEFT JOIN students pp ON pp.id = b.payment_partner_id
            WHERE s.teacher_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM slot_exceptions se
                 WHERE se.slot_id = s.id
                   AND se.exception_date = d.lesson_date
                   AND se.kind = 'blocked'
              )
           UNION ALL
           SELECT d.lesson_date, s.start_time, s.duration_min,
                  st.full_name AS student_name, ra.child_name,
                  pp.full_name AS payment_partner_name,
                  'weekly'::text AS kind
             FROM days d
             JOIN slots s ON s.weekday = EXTRACT(DOW FROM d.lesson_date)::smallint
             JOIN recurring_assignments ra ON ra.slot_id = s.id
             JOIN students st ON st.id = ra.student_id
             LEFT JOIN students pp ON pp.id = ra.payment_partner_id
            WHERE s.teacher_id = $1
              AND (
                    ra.status = 'approved'
                 OR (ra.status = 'cancelled' AND ra.decided_at::date > d.lesson_date)
              )
              AND (ra.starts_on IS NULL OR ra.starts_on <= d.lesson_date)
              AND (s.series_start_date IS NULL OR s.series_start_date <= d.lesson_date)
              AND (s.series_end_date IS NULL OR s.series_end_date >= d.lesson_date)
              AND NOT EXISTS (
                SELECT 1 FROM bookings b
                 WHERE b.slot_id = s.id
                   AND b.lesson_date = d.lesson_date
                   AND b.status = 'booked'
              )
              AND NOT EXISTS (
                SELECT 1 FROM slot_exceptions se
                 WHERE se.slot_id = s.id
                   AND se.exception_date = d.lesson_date
              )
         ) lessons
        ORDER BY lesson_date, start_time`,
      [teacher.id, MONTH_START, MONTH_END],
    );

    res.json({
      teacher: { id: teacher.id, fullName: teacher.full_name },
      monthLabel: 'August 2026',
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      lessons: rows.map((r) => ({
        lessonDate: fmtDate(r.lesson_date),
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        kind: r.kind,
        student: {
          name: r.student_name,
          childName: r.child_name || null,
        },
        paymentPartner: r.payment_partner_name ? { name: r.payment_partner_name } : null,
      })),
    });
  }),
);
