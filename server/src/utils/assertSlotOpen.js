import { HttpError } from '../middleware/error.js';
import {
  weekdayOf,
  isLessonPast,
  isDateInSeries,
  recurringCoversDate,
} from './week.js';

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);

export async function loadSlotForUpdate(client, slotId) {
  const { rows } = await client.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [slotId]);
  const slot = rows[0];
  if (!slot || !slot.active) throw new HttpError(404, 'That lesson time is not available.');
  return slot;
}

/**
 * Throw if `lessonDate` cannot be booked (or invited) on this slot.
 * `ignoreInviteId` lets a student accept their own pending invite.
 */
export async function assertSlotOpenOnDate(client, slot, lessonDate, opts = {}) {
  const { bookerStudentId = null, ignoreInviteId = null } = opts;

  if (isLessonPast(lessonDate, slot.start_time)) {
    throw new HttpError(400, 'That lesson time has already passed.');
  }

  if (weekdayOf(lessonDate) !== slot.weekday) {
    throw new HttpError(400, 'That date does not match the lesson day.');
  }

  if (slot.one_off_date && fmtDate(slot.one_off_date) !== lessonDate) {
    throw new HttpError(404, 'That lesson time is not available.');
  }

  if (
    !slot.one_off_date &&
    !isDateInSeries(
      lessonDate,
      slot.series_start_date ? fmtDate(slot.series_start_date) : null,
      slot.series_end_date ? fmtDate(slot.series_end_date) : null,
    )
  ) {
    throw new HttpError(404, 'That lesson time is not available.');
  }

  const { rows: excRows } = await client.query(
    'SELECT kind FROM slot_exceptions WHERE slot_id = $1 AND exception_date = $2',
    [slot.id, lessonDate],
  );
  const exception = excRows[0];
  if (exception?.kind === 'blocked') {
    throw new HttpError(409, 'That time is unavailable that week.');
  }
  const skippedThisWeek = exception?.kind === 'skipped';

  const { rows: recRows } = await client.query(
    `SELECT student_id, starts_on FROM recurring_assignments
      WHERE slot_id = $1 AND status = 'approved'`,
    [slot.id],
  );
  const recCovers =
    recRows[0] &&
    recurringCoversDate(
      lessonDate,
      recRows[0].starts_on ? fmtDate(recRows[0].starts_on) : null,
      slot.series_start_date ? fmtDate(slot.series_start_date) : null,
      slot.series_end_date ? fmtDate(slot.series_end_date) : null,
    );
  if (recCovers && !skippedThisWeek) {
    if (bookerStudentId && recRows[0].student_id === bookerStudentId) {
      throw new HttpError(409, 'You already hold this time as a weekly spot.');
    }
    throw new HttpError(409, 'This time is reserved for a weekly student.');
  }

  const { rows: pendingRows } = await client.query(
    `SELECT student_id, starts_on FROM recurring_assignments
      WHERE slot_id = $1 AND status = 'pending'`,
    [slot.id],
  );
  const pendingCovers =
    pendingRows[0] &&
    pendingRows[0].student_id !== bookerStudentId &&
    recurringCoversDate(
      lessonDate,
      pendingRows[0].starts_on ? fmtDate(pendingRows[0].starts_on) : null,
      slot.series_start_date ? fmtDate(slot.series_start_date) : null,
      slot.series_end_date ? fmtDate(slot.series_end_date) : null,
    );
  if (pendingCovers) {
    throw new HttpError(409, 'This time has a pending weekly spot request.');
  }

  const { rows: bookedRows } = await client.query(
    `SELECT student_id FROM bookings
      WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked'`,
    [slot.id, lessonDate],
  );
  if (bookedRows[0]) {
    if (bookerStudentId && bookedRows[0].student_id === bookerStudentId) {
      throw new HttpError(409, 'You already have a lesson at this time.');
    }
    throw new HttpError(409, 'That time was just booked. Please choose another.');
  }

  const { rows: inviteRows } = await client.query(
    `SELECT id, student_id FROM lesson_invites
      WHERE slot_id = $1 AND lesson_date = $2 AND status = 'pending'`,
    [slot.id, lessonDate],
  );
  const invite = inviteRows[0];
  if (invite && invite.id !== ignoreInviteId) {
    if (bookerStudentId && invite.student_id === bookerStudentId) {
      throw new HttpError(
        409,
        'This lesson is already scheduled for you. Open My Lessons to accept it.',
      );
    }
    throw new HttpError(409, 'This time is being held for a student.');
  }
}

export { fmtDate, fmtTime };
