import { withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { isScheduleTeacher } from '../middleware/scheduleTeacher.js';
import { resolveBookerStudentId } from './booker.js';
import { loadSlotForUpdate, assertSlotOpenOnDate } from './assertSlotOpen.js';
import { isLessonPast } from './week.js';

const UNDOABLE = new Set(['student', 'teacher']);

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** student, teacher (the coach themselves), or studio (owner acting for a managed coach). */
export function cancelActor(req, slotTeacherId) {
  if (req.user?.role === 'studio_owner') return 'studio';
  if (req.user?.role === 'teacher' && Number(req.user.id) === Number(slotTeacherId)) return 'teacher';
  return 'student';
}

async function assertMayUndo(req, { slotTeacherId, studentId, cancelledBy }) {
  if (cancelledBy === 'studio' || cancelledBy === 'closed' || !UNDOABLE.has(cancelledBy)) {
    throw new HttpError(403, "This cancellation can't be undone.");
  }
  const bookerStudentId =
    req.user.role === 'student' || req.user.role === 'teacher'
      ? await resolveBookerStudentId(req.user).catch(() => null)
      : null;
  const isBooker = bookerStudentId != null && Number(bookerStudentId) === Number(studentId);
  let isCoach = false;
  if (req.user.role === 'teacher' || req.user.role === 'studio_owner') {
    isCoach = await isScheduleTeacher(req, slotTeacherId);
  }
  if (cancelledBy === 'student' && (isBooker || isCoach)) return;
  if (cancelledBy === 'teacher' && isCoach) return;
  throw new HttpError(403, 'You cannot undo this cancellation.');
}

export async function undoBookingCancellation(req, bookingId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.*, s.teacher_id, s.start_time
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
        WHERE b.id = $1
        FOR UPDATE OF b`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking || booking.status !== 'cancelled') {
      throw new HttpError(404, 'Cancelled lesson not found.');
    }
    const lessonDate = fmtDate(booking.lesson_date);
    if (isLessonPast(lessonDate, booking.start_time)) {
      throw new HttpError(400, 'That lesson time has already passed.');
    }
    await assertMayUndo(req, {
      slotTeacherId: booking.teacher_id,
      studentId: booking.student_id,
      cancelledBy: booking.cancelled_by,
    });

    const { rows: taken } = await client.query(
      `SELECT id FROM bookings
        WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked' AND id <> $3`,
      [booking.slot_id, lessonDate, booking.id],
    );
    if (taken[0]) throw new HttpError(409, 'That time is already booked.');

    await client.query(
      `DELETE FROM slot_exceptions
        WHERE slot_id = $1 AND exception_date = $2
          AND cancelled_by IN ('student', 'teacher')`,
      [booking.slot_id, lessonDate],
    );

    const slot = await loadSlotForUpdate(client, booking.slot_id);
    await assertSlotOpenOnDate(client, slot, lessonDate, { bookerStudentId: booking.student_id });
    await client.query(
      `UPDATE bookings
          SET status = 'booked', cancelled_at = NULL, cancelled_by = NULL
        WHERE id = $1`,
      [booking.id],
    );
  });
}

export async function undoWeeklyCancellation(req, assignmentId, date) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ra.id, ra.student_id, ra.slot_id, s.teacher_id, s.start_time
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
        WHERE ra.id = $1 AND ra.status = 'approved'
        FOR UPDATE OF ra`,
      [assignmentId],
    );
    const ra = rows[0];
    if (!ra) throw new HttpError(404, 'Weekly spot not found.');
    if (isLessonPast(date, ra.start_time)) {
      throw new HttpError(400, 'That lesson time has already passed.');
    }

    const { rows: exceptions } = await client.query(
      `SELECT kind, cancelled_by FROM slot_exceptions
        WHERE slot_id = $1 AND exception_date = $2
        FOR UPDATE`,
      [ra.slot_id, date],
    );
    const exception = exceptions[0];
    if (!exception) throw new HttpError(404, 'That week is not cancelled.');
    await assertMayUndo(req, {
      slotTeacherId: ra.teacher_id,
      studentId: ra.student_id,
      cancelledBy: exception.cancelled_by,
    });

    const { rows: taken } = await client.query(
      `SELECT id FROM bookings
        WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked'
          AND student_id <> $3`,
      [ra.slot_id, date, ra.student_id],
    );
    if (taken[0]) throw new HttpError(409, 'That time is already booked.');

    await client.query(
      'DELETE FROM slot_exceptions WHERE slot_id = $1 AND exception_date = $2',
      [ra.slot_id, date],
    );
    await client.query(
      `UPDATE bookings
          SET status = 'booked', cancelled_at = NULL, cancelled_by = NULL
        WHERE slot_id = $1 AND lesson_date = $2 AND student_id = $3
          AND status = 'cancelled' AND cancelled_by IN ('student', 'teacher')`,
      [ra.slot_id, date, ra.student_id],
    );
  });
}
