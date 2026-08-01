import cron from 'node-cron';
import { query } from '../db.js';
import { env } from '../env.js';
import { weekdayOf } from '../utils/week.js';
import { sendTeacherDailySchedule } from './email.js';

function todayInTimezone(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function fetchLessonsForTeacher(teacherId, lessonDate, weekday) {
  const { rows } = await query(
    `SELECT start_time, duration_min, student_name
       FROM (
         SELECT s.start_time, s.duration_min,
                CASE
                  WHEN b.child_name IS NOT NULL AND b.child_name <> ''
                    THEN b.child_name || ' (parent: ' || st.full_name || ')'
                  ELSE st.full_name
                END AS student_name
           FROM bookings b
           JOIN slots s ON s.id = b.slot_id
           JOIN students st ON st.id = b.student_id
          WHERE s.teacher_id = $1
            AND b.lesson_date = $2::date
            AND b.status = 'booked'
            AND NOT EXISTS (
              SELECT 1 FROM slot_exceptions se
               WHERE se.slot_id = s.id
                 AND se.exception_date = $2::date
                 AND se.kind = 'blocked'
            )
         UNION
         SELECT s.start_time, s.duration_min,
                CASE
                  WHEN ra.child_name IS NOT NULL AND ra.child_name <> ''
                    THEN ra.child_name || ' (parent: ' || st.full_name || ')'
                  ELSE st.full_name
                END AS student_name
           FROM recurring_assignments ra
           JOIN slots s ON s.id = ra.slot_id
           JOIN students st ON st.id = ra.student_id
          WHERE s.teacher_id = $1
            AND ra.status = 'approved'
            AND s.weekday = $3
            AND (s.series_start_date IS NULL OR s.series_start_date <= $2::date)
            AND (s.series_end_date IS NULL OR s.series_end_date >= $2::date)
            AND NOT EXISTS (
              SELECT 1 FROM bookings b
               WHERE b.slot_id = s.id
                 AND b.lesson_date = $2::date
                 AND b.status = 'booked'
            )
            AND NOT EXISTS (
              SELECT 1 FROM slot_exceptions se
               WHERE se.slot_id = s.id
                 AND se.exception_date = $2::date
            )
       ) lessons
      ORDER BY start_time`,
    [teacherId, lessonDate, weekday],
  );
  return rows;
}

/**
 * Email each teacher their schedule for today. `daily_schedule_sent_on` makes
 * this idempotent so a teacher only gets one digest per calendar day even if
 * the job is triggered more than once.
 */
export async function runTeacherDailySchedule(now = new Date()) {
  const timezone = env.teacherDailyScheduleTimezone;
  const lessonDate = todayInTimezone(timezone);
  const weekday = weekdayOf(lessonDate);

  const { rows: teachers } = await query(
    `SELECT id, email, full_name, receive_emails
       FROM teachers
      WHERE daily_schedule_sent_on IS DISTINCT FROM $1::date`,
    [lessonDate],
  );

  let sent = 0;
  for (const teacher of teachers) {
    if (teacher.receive_emails !== false) {
      const lessons = await fetchLessonsForTeacher(teacher.id, lessonDate, weekday);
      // Only send the digest on days the teacher actually has lessons.
      if (lessons.length > 0) {
        await sendTeacherDailySchedule({
          teacher,
          lessons,
          lessonDate,
        });
        sent += 1;
      }
    }
    await query(
      'UPDATE teachers SET daily_schedule_sent_on = $1::date WHERE id = $2',
      [lessonDate, teacher.id],
    );
  }

  if (sent) {
    console.log(`Teacher daily schedule: sent ${sent} email(s) for ${lessonDate}.`);
  }
  return sent;
}

export function startTeacherDailyScheduleJob() {
  cron.schedule(
    '0 9 * * *',
    () => {
      runTeacherDailySchedule().catch((err) => {
        console.error('Teacher daily schedule failed:', err.message);
      });
    },
    { timezone: env.teacherDailyScheduleTimezone },
  );
  console.log(
    `Teacher daily schedule job scheduled (9:00 AM ${env.teacherDailyScheduleTimezone}).`,
  );
}
