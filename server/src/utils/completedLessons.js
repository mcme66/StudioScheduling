import { query } from '../db.js';
import { isLessonFinished, isLessonPast, todayISO } from './week.js';
import { listTaughtLessons, loadStudioStudentIdSet, recentStudentRange } from './taughtLessons.js';
import { feeForLesson, loadFloorFeeRates } from './floorFees.js';

function lessonKey(bookingId, recurringAssignmentId, lessonDate) {
  return bookingId ? `b:${bookingId}` : `w:${recurringAssignmentId}:${lessonDate}`;
}

function compareLessons(a, b) {
  if (a.lessonDate !== b.lessonDate) return a.lessonDate < b.lessonDate ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  return String(a.studentName).localeCompare(String(b.studentName));
}

/** Coaches at the studio and the first lesson date their payment tracking covers. */
async function loadTrackingStart(studioId) {
  const { rows } = await query(
    `SELECT t.id, t.track_payments_since::text AS since,
            (t.track_payments
              OR EXISTS (
                SELECT 1 FROM teacher_studios x
                 WHERE x.teacher_id = t.id AND x.owner_managed = true
              )) AS tracks
       FROM teacher_studios ts
       JOIN teachers t ON t.id = ts.teacher_id
      WHERE ts.studio_id = $1`,
    [studioId],
  );
  const today = todayISO();
  return new Map(rows.filter((r) => r.tracks).map((r) => [r.id, r.since || today]));
}

async function loadCompletions({ studioId, from, to, teacherId, studentId }) {
  const { rows } = await query(
    `SELECT lc.studio_id, lc.teacher_id, lc.slot_id, lc.booking_id, lc.recurring_assignment_id,
            lc.student_id, lc.payment_partner_id, lc.child_name, lc.lesson_date::text AS lesson_date,
            lc.start_time::text AS start_time, lc.duration_min, lc.price_cents, lc.floor_fee_cents,
            lc.status, st.full_name AS student_name, pp.full_name AS partner_name
       FROM lesson_completions lc
       JOIN students st ON st.id = lc.student_id
       LEFT JOIN students pp ON pp.id = lc.payment_partner_id
      WHERE lc.lesson_date BETWEEN $2::date AND $3::date
        AND lc.teacher_id IN (SELECT teacher_id FROM teacher_studios WHERE studio_id = $1)
        AND ($4::int IS NULL OR lc.teacher_id = $4)
        AND ($5::int IS NULL OR lc.student_id = $5)`,
    [studioId, from, to, teacherId, studentId],
  );
  return rows;
}

/**
 * Lessons the owner's metrics count over [from, to], never past today:
 * - lessons a coach marked "Lesson complete", with the price and floor fee saved at that time;
 * - for coaches not tracking payments (or lessons before tracking started), scheduled lessons
 *   that have ended, priced at the current floor-fee rates.
 * "No charge" lessons are left out. Tracked lessons that started but aren't marked yet are
 * left out too and counted in `awaitingCount`.
 */
export async function listCompletedLessons({ studioId, from, to, teacherId = null, studentId = null }) {
  const today = todayISO();
  const end = to < today ? to : today;
  if (from > end) return { lessons: [], awaitingCount: 0 };

  const [scheduled, completions, trackingStart, studioStudentIds, rates] = await Promise.all([
    listTaughtLessons({ studioId, from, to: end, teacherId, studentId }),
    loadCompletions({ studioId, from, to: end, teacherId, studentId }),
    loadTrackingStart(studioId),
    loadStudioStudentIdSet(studioId),
    loadFloorFeeRates(studioId),
  ]);

  const marked = new Set(
    completions.map((c) => lessonKey(c.booking_id, c.recurring_assignment_id, c.lesson_date)),
  );
  const lessons = completions
    .filter((c) => c.status === 'charged' && c.studio_id === studioId)
    .map((c) => ({
      teacherId: c.teacher_id,
      slotId: c.slot_id,
      bookingId: c.booking_id ?? null,
      recurringAssignmentId: c.recurring_assignment_id ?? null,
      studentId: Number(c.student_id),
      lessonDate: c.lesson_date,
      startTime: c.start_time.slice(0, 5),
      durationMin: c.duration_min,
      priceCents: Number(c.price_cents) || 0,
      floorFeeCents: Number(c.floor_fee_cents) || 0,
      kind: c.booking_id ? 'one-off' : 'weekly',
      studentName: c.student_name,
      childName: c.child_name || null,
      paymentPartnerId: c.payment_partner_id ?? null,
      paymentPartnerName: c.partner_name || null,
      source: 'completed',
    }));

  let awaitingCount = 0;
  for (const lesson of scheduled) {
    if (marked.has(lessonKey(lesson.bookingId, lesson.recurringAssignmentId, lesson.lessonDate))) continue;
    const since = trackingStart.get(lesson.teacherId);
    if (since && lesson.lessonDate >= since) {
      if (isLessonPast(lesson.lessonDate, lesson.startTime)) awaitingCount += 1;
      continue;
    }
    if (!isLessonFinished(lesson.lessonDate, lesson.startTime, lesson.durationMin)) continue;
    lessons.push({
      ...lesson,
      floorFeeCents: feeForLesson(lesson, studioStudentIds, rates),
      source: 'scheduled',
    });
  }

  lessons.sort(compareLessons);
  return { lessons, awaitingCount };
}

/** Each student's most recent counted lesson at the studio within the recent-student window. */
export async function latestCompletedLessonByStudent(studioId) {
  const { from } = recentStudentRange();
  const { lessons } = await listCompletedLessons({ studioId, from, to: todayISO() });
  const latest = new Map();
  for (const lesson of lessons) latest.set(lesson.studentId, lesson);
  return latest;
}

/** Up to 10 distinct students with a counted lesson at this studio, most recent lesson first. */
export async function listRecentStudioStudents(studioId, limit = 10) {
  const latest = await latestCompletedLessonByStudent(studioId);
  const recent = [...latest.values()].sort((a, b) => compareLessons(b, a)).slice(0, limit);
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
