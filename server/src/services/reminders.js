import cron from 'node-cron';
import { query } from '../db.js';
import { env } from '../env.js';
import { sendReminder } from './email.js';

/**
 * Find booked lessons whose start is within the next REMINDER_LEAD_HOURS and
 * email the student. `reminder_sent_at` makes this idempotent so a lesson is
 * only reminded once even though the job runs hourly.
 */
export async function runReminderSweep(now = new Date()) {
  const leadMs = env.reminderLeadHours * 60 * 60 * 1000;
  const windowEnd = new Date(now.getTime() + leadMs);

  const { rows } = await query(
    `SELECT b.id,
            b.lesson_date,
            s.start_time, s.duration_min, s.weekday,
            st.full_name AS student_name, st.email AS student_email, st.receive_emails,
            t.full_name  AS teacher_name
       FROM bookings b
       JOIN slots s    ON s.id = b.slot_id
       JOIN students st ON st.id = b.student_id
       JOIN teachers t  ON t.id = s.teacher_id
      WHERE b.status = 'booked'
        AND b.reminder_sent_at IS NULL
        AND st.receive_emails = true
        AND (b.lesson_date + s.start_time) >= $1
        AND (b.lesson_date + s.start_time) <= $2`,
    [now.toISOString(), windowEnd.toISOString()],
  );

  for (const row of rows) {
    await sendReminder({
      student: { full_name: row.student_name, email: row.student_email, receive_emails: row.receive_emails },
      teacher: { full_name: row.teacher_name },
      slot: { start_time: row.start_time, duration_min: row.duration_min, weekday: row.weekday },
      lessonDate: row.lesson_date instanceof Date ? row.lesson_date.toISOString().slice(0, 10) : row.lesson_date,
    });
    await query('UPDATE bookings SET reminder_sent_at = now() WHERE id = $1', [row.id]);
  }

  if (rows.length) {
    console.log(`Reminder sweep: sent ${rows.length} reminder(s).`);
  }
  return rows.length;
}

export function startReminderJob() {
  // Run at the top of every hour.
  cron.schedule('0 * * * *', () => {
    runReminderSweep().catch((err) => console.error('Reminder sweep failed:', err.message));
  });
  console.log('Reminder job scheduled (hourly).');
}
