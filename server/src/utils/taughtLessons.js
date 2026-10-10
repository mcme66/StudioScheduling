import { query } from '../db.js';
import { env } from '../env.js';
import { addDays, addWeeks, dateForWeekday, getMonday, todayISO } from './week.js';

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

/** Higher of (percent of lesson price) and the flat fee, in cents. */
export function expectedFloorFeeCents(priceCents, percent, flatCents) {
  const price = Number(priceCents) || 0;
  const pct = Number(percent) || 0;
  const flat = Number(flatCents) || 0;
  const fromPercent = Math.round(price * (pct / 100));
  return Math.max(fromPercent, flat);
}

/** Lesson start as timestamptz in the studio timezone ($5). */
const LESSON_START = `((d.lesson_date + s.start_time) AT TIME ZONE $5)`;

/**
 * One-off bookings and weekly lessons that occur in [from, to].
 * Always scoped to teachers listed at `studioId`. Pass `teacherId` to limit to one coach.
 *
 * Future cancels (before the lesson starts) do not count. Cancelling after the
 * lesson has started still counts, so a past lesson cannot be dropped from
 * expected floor fees.
 */
export async function listTaughtLessons({
  studioId,
  from,
  to,
  teacherId = null,
  studentId = null,
}) {
  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series($2::date, $3::date, interval '1 day')::date AS lesson_date
     )
     SELECT teacher_id, lesson_date, start_time, duration_min, price_cents,
            student_id, student_name, child_name, payment_partner_name, kind
       FROM (
         SELECT s.teacher_id, d.lesson_date, s.start_time, s.duration_min, s.price_cents,
                st.id AS student_id, st.full_name AS student_name, b.child_name,
                pp.full_name AS payment_partner_name,
                'one-off'::text AS kind
           FROM days d
           JOIN bookings b ON b.lesson_date = d.lesson_date
           JOIN slots s ON s.id = b.slot_id
           JOIN students st ON st.id = b.student_id
           LEFT JOIN students pp ON pp.id = b.payment_partner_id
          WHERE ($1::int IS NULL OR s.teacher_id = $1)
            AND ($6::int IS NULL OR st.id = $6)
            AND EXISTS (
              SELECT 1 FROM teacher_studios ts
               WHERE ts.teacher_id = s.teacher_id AND ts.studio_id = $4
            )
            AND (
              b.status = 'booked'
              OR (
                b.status = 'cancelled'
                AND b.cancelled_at >= ${LESSON_START}
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM recurring_assignments ra
               WHERE ra.slot_id = b.slot_id
                 AND ra.student_id = b.student_id
                 AND ra.status IN ('pending', 'approved')
                 AND ra.starts_on <= d.lesson_date
            )
            AND NOT EXISTS (
              SELECT 1 FROM slot_exceptions se
               WHERE se.slot_id = s.id
                 AND se.exception_date = d.lesson_date
                 AND se.kind = 'blocked'
                 AND se.created_at < ${LESSON_START}
            )
         UNION ALL
         SELECT s.teacher_id, d.lesson_date, s.start_time, s.duration_min, s.price_cents,
                st.id AS student_id, st.full_name AS student_name, ra.child_name,
                pp.full_name AS payment_partner_name,
                'weekly'::text AS kind
           FROM days d
           JOIN slots s ON s.weekday = EXTRACT(DOW FROM d.lesson_date)::smallint
           JOIN recurring_assignments ra ON ra.slot_id = s.id
           JOIN students st ON st.id = ra.student_id
           LEFT JOIN students pp ON pp.id = ra.payment_partner_id
          WHERE ($1::int IS NULL OR s.teacher_id = $1)
            AND ($6::int IS NULL OR st.id = $6)
            AND EXISTS (
              SELECT 1 FROM teacher_studios ts
               WHERE ts.teacher_id = s.teacher_id AND ts.studio_id = $4
            )
            AND (
              ra.status = 'approved'
              OR (
                ra.status = 'cancelled'
                AND ra.decided_at >= ${LESSON_START}
              )
            )
            AND (ra.starts_on IS NULL OR ra.starts_on <= d.lesson_date)
            AND (s.series_start_date IS NULL OR s.series_start_date <= d.lesson_date)
            AND (s.series_end_date IS NULL OR s.series_end_date >= d.lesson_date)
            AND NOT EXISTS (
              SELECT 1 FROM bookings b
               WHERE b.slot_id = s.id
                 AND b.lesson_date = d.lesson_date
                 AND (
                   b.status = 'booked'
                   OR (
                     b.status = 'cancelled'
                     AND b.cancelled_at >= ${LESSON_START}
                   )
                 )
            )
            AND NOT EXISTS (
              SELECT 1 FROM slot_exceptions se
               WHERE se.slot_id = s.id
                 AND se.exception_date = d.lesson_date
                 AND se.created_at < ${LESSON_START}
            )
       ) lessons
      ORDER BY lesson_date, start_time, student_name`,
    [teacherId, from, to, studioId, env.teacherDailyScheduleTimezone, studentId],
  );

  return rows.map((r) => ({
    teacherId: r.teacher_id,
    studentId: Number(r.student_id),
    lessonDate: fmtDate(r.lesson_date),
    startTime: fmtTime(r.start_time),
    durationMin: r.duration_min,
    priceCents: Number(r.price_cents) || 0,
    kind: r.kind,
    studentName: r.student_name,
    childName: r.child_name || null,
    paymentPartnerName: r.payment_partner_name || null,
  }));
}

/** Monday-anchored weeks that overlap [from, to], clipped to that range. */
export function weeksOverlappingRange(from, to) {
  const weeks = [];
  let monday = getMonday(from);
  const lastMonday = getMonday(to);
  while (monday <= lastMonday) {
    const weekStart = monday;
    const weekEnd = dateForWeekday(monday, 0);
    const clipFrom = weekStart < from ? from : weekStart;
    const clipTo = weekEnd > to ? to : weekEnd;
    weeks.push({
      monday: weekStart,
      from: clipFrom,
      to: clipTo,
    });
    monday = addWeeks(monday, 1);
  }
  return weeks;
}

/** How far back the owner’s recent-student card looks, in days. */
const RECENT_STUDENT_LOOKBACK_DAYS = 180;

/** Upcoming bookable horizon: Sunday of the week 4 weeks ahead. */
export function recentStudentRange() {
  const today = todayISO();
  const from = addDays(today, -RECENT_STUDENT_LOOKBACK_DAYS);
  const to = dateForWeekday(addWeeks(getMonday(today), 4), 0);
  return { from, to };
}

/** Students who attend this studio: they selected it, or the owner marked them. */
export async function loadStudioStudentIdSet(studioId) {
  const { rows } = await query(
    `SELECT id FROM students WHERE home_studio_id = $1
     UNION
     SELECT student_id FROM studio_student_marks WHERE studio_id = $1`,
    [studioId],
  );
  return new Set(rows.map((r) => Number(r.id)));
}

function laterLesson(a, b) {
  if (a.lessonDate !== b.lessonDate) return a.lessonDate > b.lessonDate ? a : b;
  if (a.startTime !== b.startTime) return a.startTime > b.startTime ? a : b;
  return a;
}

/** Most recent lesson first. */
function compareLessonRecency(a, b) {
  if (a.lessonDate !== b.lessonDate) return a.lessonDate < b.lessonDate ? 1 : -1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? 1 : -1;
  return String(a.studentName).localeCompare(String(b.studentName));
}

/**
 * Up to 10 distinct students with a taught lesson at this studio, most recent
 * lesson first. Uses the same lesson rules as floor fees over a bounded window.
 */
export async function listRecentStudioStudents(studioId, limit = 10) {
  const { from, to } = recentStudentRange();
  const lessons = await listTaughtLessons({ studioId, from, to });
  const latest = new Map();
  for (const lesson of lessons) {
    const prev = latest.get(lesson.studentId);
    latest.set(lesson.studentId, prev ? laterLesson(prev, lesson) : lesson);
  }
  const recent = [...latest.values()].sort(compareLessonRecency).slice(0, limit);
  if (!recent.length) return [];

  const ids = recent.map((lesson) => lesson.studentId);
  const { rows } = await query(
    `SELECT st.id,
            st.home_studio_id = $2 AS selected_by_student,
            EXISTS (
              SELECT 1 FROM studio_student_marks m
               WHERE m.studio_id = $2 AND m.student_id = st.id
            ) AS marked_by_owner
       FROM students st
      WHERE st.id = ANY($1::int[])`,
    [ids, studioId],
  );
  const flags = new Map(rows.map((r) => [Number(r.id), r]));
  return recent.map((lesson) => {
    const flag = flags.get(lesson.studentId);
    const selectedByStudent = flag?.selected_by_student === true;
    const markedByOwner = flag?.marked_by_owner === true;
    return {
      studentId: lesson.studentId,
      fullName: lesson.studentName,
      childName: lesson.childName,
      lessonDate: lesson.lessonDate,
      markedByOwner,
      selectedByStudent,
      reducedFeeApplies: selectedByStudent || markedByOwner,
    };
  });
}

/** True when this student has a taught lesson at the studio in the recent window. */
export async function studentHasLessonAtStudio(studioId, studentId) {
  const { from, to } = recentStudentRange();
  const lessons = await listTaughtLessons({ studioId, studentId, from, to });
  return lessons.length > 0;
}
