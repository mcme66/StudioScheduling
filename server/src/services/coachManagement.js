import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { assertSlotOpenOnDate } from '../utils/assertSlotOpen.js';
import {
  addDays,
  isDateInSeries,
  nextWeekdayOnOrAfter,
  todayISO,
  weekdayOf,
} from '../utils/week.js';
import { sendCancellationRequest, sendLessonMoved } from './email.js';
import {
  notifyCoachLessonsAdded,
  notifyCoachRequestResolved,
  notifyStudentCoachFilled,
  notifyStudentsHeldCancelled,
  notifyStudentsLessonCancelled,
  notifyStudentsWeeklyDeclined,
} from './notifications.js';

const pool = { query };

export const ACTION_LABELS = {
  booking_cancel: 'Cancel this lesson',
  week_skip: 'Cancel this week only',
  week_block: 'Cancel the slot this week',
  recurring_remove: 'Remove from weekly slot',
  slot_delete: 'Delete this slot',
  series_end: 'Delete this week and all future',
  invite_cancel: 'Cancel a held lesson',
};

const SERIES_ACTIONS = new Set(['recurring_remove', 'series_end']);

const fmtDate = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const fmtTime = (t) => (t ? String(t).slice(0, 5) : t);

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = aStart || '0001-01-01';
  const ae = aEnd || '9999-12-31';
  const bs = bStart || '0001-01-01';
  const be = bEnd || '9999-12-31';
  return as <= be && bs <= ae;
}

function coversRange(existingStart, existingEnd, needStart, needEnd) {
  const es = existingStart || '0001-01-01';
  const ee = existingEnd || '9999-12-31';
  const ns = needStart || '0001-01-01';
  const ne = needEnd || '9999-12-31';
  return es <= ns && ee >= ne;
}

async function one(db, text, params) {
  const { rows } = await db.query(text, params);
  return rows[0] || null;
}

export async function isOwnerManaged(teacherId) {
  const row = await one(
    pool,
    `SELECT 1 FROM teacher_studios WHERE teacher_id = $1 AND owner_managed = true LIMIT 1`,
    [teacherId],
  );
  return !!row;
}

/** Managed coaches cannot change the schedule except by requesting a cancellation. */
export async function assertCoachMayEdit(req) {
  if (req.user?.role !== 'teacher') return;
  if (await isOwnerManaged(req.user.id)) {
    throw new HttpError(
      403,
      'Your studio manages this schedule. You can view it and request a cancellation.',
    );
  }
}

export async function listPendingCancellationRequests(teacherId) {
  const { rows } = await query(
    `SELECT id, slot_id, lesson_date, action, booking_id, recurring_assignment_id, invite_id
       FROM cancellation_requests
      WHERE teacher_id = $1 AND status = 'pending'
      ORDER BY created_at`,
    [teacherId],
  );
  return rows.map((r) => ({
    id: r.id,
    slotId: r.slot_id,
    lessonDate: fmtDate(r.lesson_date),
    action: r.action,
    bookingId: r.booking_id,
    recurringAssignmentId: r.recurring_assignment_id,
    inviteId: r.invite_id,
  }));
}

function occupantPayload(student, childName, paymentPartnerId) {
  if (!student) {
    return {
      studentId: null,
      childName: null,
      paymentPartnerId: null,
      label: 'Empty',
      detail: null,
    };
  }
  const studentId = student.student_id ?? student.id ?? null;
  const label = childName || student.full_name;
  const parts = [];
  if (childName && student.full_name) parts.push(`Parent: ${student.full_name}`);
  if (student.email) parts.push(student.email);
  if (student.phone) parts.push(student.phone);
  return {
    studentId,
    childName: childName || null,
    paymentPartnerId: paymentPartnerId ?? null,
    label,
    detail: parts.join(' · ') || null,
  };
}

async function studentById(db, studentId) {
  if (!studentId) return null;
  return one(
    db,
    'SELECT id, full_name, email, phone, receive_emails FROM students WHERE id = $1',
    [studentId],
  );
}

async function resolveOccupant(db, { action, slot, lessonDate, bookingId, recurringAssignmentId, inviteId }) {
  if (action === 'booking_cancel' && bookingId) {
    const booking = await one(
      db,
      `SELECT b.student_id, b.child_name, b.payment_partner_id, st.full_name, st.email, st.phone
         FROM bookings b
         JOIN students st ON st.id = b.student_id
        WHERE b.id = $1`,
      [bookingId],
    );
    if (!booking) return occupantPayload(null);
    return occupantPayload(
      booking,
      booking.child_name,
      booking.payment_partner_id,
    );
  }

  if ((action === 'week_skip' || action === 'recurring_remove') && recurringAssignmentId) {
    const ra = await one(
      db,
      `SELECT ra.student_id, ra.child_name, ra.payment_partner_id, st.full_name, st.email, st.phone
         FROM recurring_assignments ra
         JOIN students st ON st.id = ra.student_id
        WHERE ra.id = $1`,
      [recurringAssignmentId],
    );
    if (!ra) return occupantPayload(null);
    return occupantPayload(ra, ra.child_name, ra.payment_partner_id);
  }

  if (action === 'invite_cancel' && inviteId) {
    const invite = await one(
      db,
      `SELECT li.student_id, li.child_name, st.full_name, st.email, st.phone
         FROM lesson_invites li
         JOIN students st ON st.id = li.student_id
        WHERE li.id = $1`,
      [inviteId],
    );
    if (!invite) return occupantPayload(null);
    return occupantPayload(invite, invite.child_name, null);
  }

  if (lessonDate) {
    const booking = await one(
      db,
      `SELECT b.id, b.student_id, b.child_name, b.payment_partner_id, st.full_name, st.email, st.phone
         FROM bookings b
         JOIN students st ON st.id = b.student_id
        WHERE b.slot_id = $1 AND b.lesson_date = $2 AND b.status = 'booked'`,
      [slot.id, lessonDate],
    );
    if (booking) {
      const payload = occupantPayload(booking, booking.child_name, booking.payment_partner_id);
      payload.bookingId = booking.id;
      return payload;
    }
  }

  const recurring = await one(
    db,
    `SELECT ra.id, ra.student_id, ra.child_name, ra.payment_partner_id, ra.starts_on,
            st.full_name, st.email, st.phone
       FROM recurring_assignments ra
       JOIN students st ON st.id = ra.student_id
      WHERE ra.slot_id = $1 AND ra.status = 'approved'
      ORDER BY ra.starts_on
      LIMIT 1`,
    [slot.id],
  );
  if (recurring && action !== 'slot_delete') {
    const startsOn = fmtDate(recurring.starts_on);
    if (!lessonDate || !startsOn || lessonDate >= startsOn) {
      const payload = occupantPayload(recurring, recurring.child_name, recurring.payment_partner_id);
      payload.recurringAssignmentId = recurring.id;
      return payload;
    }
  }

  if (action === 'series_end') {
    const future = await one(
      db,
      `SELECT b.student_id, b.child_name, b.payment_partner_id, st.full_name, st.email, st.phone
         FROM bookings b
         JOIN students st ON st.id = b.student_id
        WHERE b.slot_id = $1 AND b.status = 'booked' AND b.lesson_date >= $2
        ORDER BY b.lesson_date
        LIMIT 1`,
      [slot.id, lessonDate || todayISO()],
    );
    if (future) return occupantPayload(future, future.child_name, future.payment_partner_id);
  }

  return occupantPayload(null);
}

/**
 * When the caller is a managed coach, record the cancellation and email the
 * studio owner instead of changing the schedule. Returns null for everyone else.
 */
export async function maybeRequestCancellation(req, details) {
  if (req.user?.role !== 'teacher') return null;
  if (!(await isOwnerManaged(req.user.id))) return null;
  return createCancellationRequest({ teacherId: req.user.id, ...details });
}

export async function createCancellationRequest({
  teacherId,
  action,
  slotId,
  lessonDate = null,
  bookingId = null,
  recurringAssignmentId = null,
  inviteId = null,
  fromDate = null,
}) {
  const slot = await one(
    pool,
    'SELECT * FROM slots WHERE id = $1 AND teacher_id = $2',
    [slotId, teacherId],
  );
  if (!slot) throw new HttpError(404, 'Slot not found.');

  const date = lessonDate ? fmtDate(lessonDate) : null;
  const existing = await one(
    pool,
    `SELECT id FROM cancellation_requests
      WHERE teacher_id = $1 AND slot_id = $2 AND action = $3 AND status = 'pending'
        AND COALESCE(lesson_date, DATE '1970-01-01') = COALESCE($4::date, DATE '1970-01-01')`,
    [teacherId, slotId, action, date],
  );
  if (existing) return { ok: true, requested: true, alreadyRequested: true };

  const occupant = await resolveOccupant(pool, {
    action,
    slot,
    lessonDate: date,
    bookingId,
    recurringAssignmentId,
    inviteId,
  });

  const studio = await one(
    pool,
    `SELECT ts.studio_id, s.name AS studio_name, t.full_name AS coach_name,
            so.email AS owner_email, so.full_name AS owner_name
       FROM teacher_studios ts
       JOIN studios s ON s.id = ts.studio_id
       JOIN teachers t ON t.id = ts.teacher_id
       LEFT JOIN studio_owners so ON so.studio_id = ts.studio_id
      WHERE ts.teacher_id = $1
      ORDER BY ts.owner_managed DESC, ts.created_at
      LIMIT 1`,
    [teacherId],
  );
  if (!studio) throw new HttpError(400, 'This coach is not listed at a studio.');

  let inserted;
  try {
    const result = await query(
      `INSERT INTO cancellation_requests (
         studio_id, teacher_id, slot_id, lesson_date, weekday, start_time, duration_min, price_cents,
         action, booking_id, recurring_assignment_id, invite_id, from_date,
         student_id, child_name, payment_partner_id, occupant_label, occupant_detail
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18
       )
       RETURNING id`,
      [
        studio.studio_id,
        teacherId,
        slotId,
        date,
        slot.weekday,
        slot.start_time,
        slot.duration_min,
        slot.price_cents,
        action,
        occupant.bookingId || bookingId,
        occupant.recurringAssignmentId || recurringAssignmentId,
        inviteId,
        fromDate ? fmtDate(fromDate) : null,
        occupant.studentId,
        occupant.childName,
        occupant.paymentPartnerId,
        occupant.label,
        occupant.detail,
      ],
    );
    inserted = result.rows[0];
  } catch (err) {
    if (err?.code === '23505') {
      return { ok: true, requested: true, alreadyRequested: true };
    }
    throw err;
  }

  await sendCancellationRequest({
    owner: studio.owner_email ? { email: studio.owner_email, full_name: studio.owner_name } : null,
    coachName: studio.coach_name,
    studioName: studio.studio_name,
    actionLabel: ACTION_LABELS[action] || action,
    weekday: slot.weekday,
    lessonDate: date,
    fromDate: fromDate ? fmtDate(fromDate) : null,
    startTime: slot.start_time,
    durationMin: slot.duration_min,
    series: SERIES_ACTIONS.has(action),
    occupantLabel: occupant.label,
    occupantDetail: occupant.detail,
  });

  return { ok: true, requested: true, alreadyRequested: false, id: inserted.id };
}

function mapRequestRow(row) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    action: row.action,
    actionLabel: ACTION_LABELS[row.action] || row.action,
    lessonDate: fmtDate(row.lesson_date),
    fromDate: fmtDate(row.from_date),
    weekday: row.weekday,
    startTime: fmtTime(row.start_time),
    durationMin: row.duration_min,
    occupantLabel: row.occupant_label,
    occupantDetail: row.occupant_detail,
    canFill: row.occupant_label !== 'Empty' && row.student_id != null,
    series: SERIES_ACTIONS.has(row.action),
    createdAt: row.created_at,
  };
}

export async function listStudioCancellationRequests(ownerUserId) {
  const { rows } = await query(
    `SELECT cr.*, t.full_name AS teacher_name
       FROM cancellation_requests cr
       JOIN studio_owners so ON so.studio_id = cr.studio_id
       JOIN teachers t ON t.id = cr.teacher_id
      WHERE so.id = $1 AND cr.status = 'pending'
      ORDER BY cr.created_at`,
    [ownerUserId],
  );
  return rows.map(mapRequestRow);
}

export async function countPendingCancellationRequests(studioId) {
  const row = await one(
    pool,
    `SELECT COUNT(*)::int AS count
       FROM cancellation_requests
      WHERE studio_id = $1 AND status = 'pending'`,
    [studioId],
  );
  return row?.count || 0;
}

async function lockPendingRequest(client, ownerUserId, requestId) {
  const row = await one(
    client,
    `SELECT cr.*, t.full_name AS teacher_name
       FROM cancellation_requests cr
       JOIN studio_owners so ON so.studio_id = cr.studio_id
       JOIN teachers t ON t.id = cr.teacher_id
      WHERE cr.id = $1 AND so.id = $2
      FOR UPDATE OF cr`,
    [requestId, ownerUserId],
  );
  if (!row) throw new HttpError(404, 'Request not found.');
  if (row.status !== 'pending') throw new HttpError(409, 'This request was already handled.');
  return row;
}

async function endSeries(client, slot, fromDate) {
  if (slot.one_off_date) throw new HttpError(400, 'One-time slots cannot be ended as a series.');
  if (weekdayOf(fromDate) !== slot.weekday) {
    throw new HttpError(400, 'That date does not match the lesson day.');
  }
  const seriesStart = fmtDate(slot.series_start_date);
  const seriesEnd = fmtDate(slot.series_end_date);
  if (!isDateInSeries(fromDate, seriesStart, seriesEnd)) {
    throw new HttpError(400, 'That date is outside this lesson series.');
  }
  const hasPastInSeries = !seriesStart || fromDate > seriesStart;
  const previousOccurrence = addDays(fromDate, -7);

  const { rows: booked } = await client.query(
    `UPDATE bookings
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'closed'
      WHERE slot_id = $1 AND lesson_date >= $2 AND status = 'booked'
      RETURNING student_id, child_name, lesson_date`,
    [slot.id, fromDate],
  );
  const { rows: weekly } = await client.query(
    `UPDATE recurring_assignments ra
        SET status = 'cancelled', decided_at = now()
       FROM recurring_assignments prev
      WHERE ra.id = prev.id AND ra.slot_id = $1 AND ra.status IN ('pending', 'approved')
      RETURNING ra.student_id, ra.child_name, prev.status AS previous_status`,
    [slot.id],
  );
  if (!hasPastInSeries) {
    await client.query('DELETE FROM slots WHERE id = $1', [slot.id]);
  } else {
    await client.query('UPDATE slots SET series_end_date = $1 WHERE id = $2', [
      previousOccurrence,
      slot.id,
    ]);
  }
  return {
    lessons: booked.map(toLesson),
    weekly: weekly.filter((r) => r.previous_status === 'approved').map(toWeekly),
    requests: weekly.filter((r) => r.previous_status === 'pending').map(toWeekly),
  };
}

const toLesson = (r) => ({ studentId: r.student_id, childName: r.child_name, lessonDate: fmtDate(r.lesson_date) });
const toWeekly = (r) => ({ studentId: r.student_id, childName: r.child_name });

/** Approved weekly students who still have a lesson on `date` (no skip/block recorded yet). */
async function weeklyStudentsOnDate(client, slotId, date, recurringAssignmentId = null) {
  const { rows } = await client.query(
    `SELECT ra.student_id, ra.child_name, $2::date AS lesson_date
       FROM recurring_assignments ra
      WHERE ra.slot_id = $1 AND ra.status = 'approved'
        AND ($3::int IS NULL OR ra.id = $3)
        AND (ra.starts_on IS NULL OR ra.starts_on <= $2::date)
        AND NOT EXISTS (
          SELECT 1 FROM slot_exceptions se
           WHERE se.slot_id = ra.slot_id AND se.exception_date = $2::date
        )`,
    [slotId, date, recurringAssignmentId],
  );
  return rows.map(toLesson);
}

/** Applies the cancellation and returns the students whose lessons it removed. */
async function performClear(client, request) {
  const slot = request.slot_id
    ? await one(client, 'SELECT * FROM slots WHERE id = $1', [request.slot_id])
    : null;
  const gone = new HttpError(409, 'That lesson is no longer on the schedule.');

  switch (request.action) {
    case 'booking_cancel': {
      const updated = await client.query(
        `UPDATE bookings
            SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'studio'
          WHERE id = $1 AND status = 'booked'
          RETURNING student_id, child_name, lesson_date`,
        [request.booking_id],
      );
      if (!updated.rows[0]) throw new HttpError(409, 'That lesson is no longer booked.');
      return { lessons: updated.rows.map(toLesson), weekly: [] };
    }
    case 'week_skip': {
      if (!slot) throw gone;
      const date = fmtDate(request.lesson_date);
      const lessons = await weeklyStudentsOnDate(client, slot.id, date, request.recurring_assignment_id);
      await client.query(
        `INSERT INTO slot_exceptions (slot_id, exception_date, kind, cancelled_by)
         VALUES ($1, $2, 'skipped', 'studio')
         ON CONFLICT (slot_id, exception_date)
         DO UPDATE SET kind = 'skipped', cancelled_by = 'studio'`,
        [slot.id, date],
      );
      return { lessons, weekly: [] };
    }
    case 'week_block': {
      if (!slot) throw gone;
      const date = fmtDate(request.lesson_date);
      const weeklyOnDate = await weeklyStudentsOnDate(client, slot.id, date);
      await client.query(
        `INSERT INTO slot_exceptions (slot_id, exception_date, kind, cancelled_by)
         VALUES ($1, $2, 'blocked', 'studio')
         ON CONFLICT (slot_id, exception_date)
         DO UPDATE SET kind = 'blocked', cancelled_by = 'studio'`,
        [slot.id, date],
      );
      const { rows: booked } = await client.query(
        `UPDATE bookings
            SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'studio'
          WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked'
          RETURNING student_id, child_name, lesson_date`,
        [slot.id, date],
      );
      return { lessons: [...weeklyOnDate, ...booked.map(toLesson)], weekly: [] };
    }
    case 'recurring_remove': {
      const updated = await client.query(
        `UPDATE recurring_assignments ra
            SET status = 'cancelled', decided_at = now()
           FROM recurring_assignments prev
          WHERE ra.id = prev.id AND ra.id = $1 AND ra.status IN ('approved', 'pending')
          RETURNING ra.student_id, ra.child_name, prev.status AS previous_status`,
        [request.recurring_assignment_id],
      );
      if (!updated.rows[0]) throw new HttpError(409, 'That weekly spot is no longer active.');
      return {
        lessons: [],
        weekly: updated.rows.filter((r) => r.previous_status === 'approved').map(toWeekly),
      };
    }
    case 'slot_delete': {
      if (!slot) throw gone;
      const { rows: booked } = await client.query(
        `SELECT b.student_id, b.child_name, b.lesson_date
           FROM bookings b
          WHERE b.slot_id = $1 AND b.status = 'booked'
            AND (b.lesson_date + $2::time) > now()`,
        [slot.id, slot.start_time],
      );
      const { rows: assignments } = await client.query(
        `SELECT student_id, child_name, status FROM recurring_assignments
          WHERE slot_id = $1 AND status IN ('approved', 'pending')`,
        [slot.id],
      );
      const { rows: held } = await client.query(
        `SELECT student_id, child_name, lesson_date FROM lesson_invites
          WHERE slot_id = $1 AND status = 'pending'`,
        [slot.id],
      );
      await client.query('DELETE FROM slots WHERE id = $1', [slot.id]);
      return {
        lessons: booked.map(toLesson),
        weekly: assignments.filter((r) => r.status === 'approved').map(toWeekly),
        requests: assignments.filter((r) => r.status === 'pending').map(toWeekly),
        held: held.map(toLesson),
      };
    }
    case 'series_end': {
      if (!slot) throw gone;
      return endSeries(client, slot, fmtDate(request.from_date || request.lesson_date));
    }
    case 'invite_cancel': {
      const updated = await client.query(
        `UPDATE lesson_invites
            SET status = 'cancelled', decided_at = now()
          WHERE id = $1 AND status = 'pending'
          RETURNING id, student_id, child_name, lesson_date`,
        [request.invite_id],
      );
      if (!updated.rows[0]) throw new HttpError(409, 'That held lesson is no longer pending.');
      return { lessons: [], weekly: [], held: updated.rows.map(toLesson) };
    }
    default:
      throw new HttpError(400, 'Unknown cancellation request.');
  }
}

async function assertDestinationOpen(client, slot, lessonDate, studentId) {
  try {
    await assertSlotOpenOnDate(client, slot, lessonDate, { bookerStudentId: studentId });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      throw new HttpError(409, 'That coach is already booked at that time.');
    }
    throw err;
  }
}

async function ensureOneOffSlot(client, teacherId, { date, weekday, startTime, durationMin, priceCents, studentId }) {
  const oneOff = await one(
    client,
    `SELECT * FROM slots
      WHERE teacher_id = $1 AND one_off_date = $2 AND start_time = $3::time
      FOR UPDATE`,
    [teacherId, date, startTime],
  );
  if (oneOff) {
    await assertDestinationOpen(client, oneOff, date, studentId);
    return oneOff;
  }

  const { rows: weeklies } = await client.query(
    `SELECT * FROM slots
      WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3::time AND one_off_date IS NULL
      FOR UPDATE`,
    [teacherId, weekday, startTime],
  );
  const covering = weeklies.find((slot) =>
    isDateInSeries(date, fmtDate(slot.series_start_date), fmtDate(slot.series_end_date)),
  );
  if (covering) {
    await assertDestinationOpen(client, covering, date, studentId);
    return covering;
  }

  const inserted = await client.query(
    `INSERT INTO slots (
       teacher_id, weekday, start_time, duration_min, price_cents, one_off_date
     ) VALUES ($1, $2, $3::time, $4, $5, $6)
     RETURNING *`,
    [teacherId, weekday, startTime, durationMin, priceCents, date],
  );
  return inserted.rows[0];
}

async function insertBooking(client, slotId, source) {
  try {
    await client.query(
      `INSERT INTO bookings (
         slot_id, student_id, lesson_date, child_name, payment_partner_id, paid, partner_paid
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        slotId,
        source.studentId,
        source.lessonDate,
        source.childName,
        source.paymentPartnerId,
        source.paid === true,
        source.partnerPaid === true,
      ],
    );
  } catch (err) {
    if (err?.code === '23505') {
      throw new HttpError(409, 'That coach is already booked at that time.');
    }
    throw err;
  }
}

async function copyOneDate(client, request) {
  let source = null;
  if (request.booking_id) {
    const booking = await one(
      client,
      `SELECT * FROM bookings WHERE id = $1 AND status = 'booked'`,
      [request.booking_id],
    );
    if (!booking) throw new HttpError(409, 'That lesson is no longer booked.');
    source = {
      studentId: booking.student_id,
      childName: booking.child_name,
      paymentPartnerId: booking.payment_partner_id,
      paid: booking.paid,
      partnerPaid: booking.partner_paid,
      lessonDate: fmtDate(booking.lesson_date),
    };
  } else if (request.recurring_assignment_id) {
    const ra = await one(
      client,
      `SELECT * FROM recurring_assignments WHERE id = $1 AND status = 'approved'`,
      [request.recurring_assignment_id],
    );
    if (!ra) throw new HttpError(409, 'That weekly spot is no longer active.');
    const lessonDate = fmtDate(request.lesson_date);
    const pay = await one(
      client,
      `SELECT paid, partner_paid FROM recurring_lesson_payments
        WHERE recurring_assignment_id = $1 AND lesson_date = $2`,
      [ra.id, lessonDate],
    );
    source = {
      studentId: ra.student_id,
      childName: ra.child_name,
      paymentPartnerId: ra.payment_partner_id,
      paid: pay?.paid === true,
      partnerPaid: pay?.partner_paid === true,
      lessonDate,
    };
  } else if (request.student_id && request.lesson_date) {
    source = {
      studentId: request.student_id,
      childName: request.child_name,
      paymentPartnerId: request.payment_partner_id,
      paid: false,
      partnerPaid: false,
      lessonDate: fmtDate(request.lesson_date),
    };
  }
  if (!source?.studentId || !source.lessonDate) {
    throw new HttpError(400, 'This opening is empty. Cancel it or dismiss the request.');
  }

  const slot = await ensureOneOffSlot(client, request.filled_teacher_id, {
    date: source.lessonDate,
    weekday: request.weekday,
    startTime: request.start_time,
    durationMin: request.duration_min,
    priceCents: request.price_cents,
    studentId: source.studentId,
  });
  await insertBooking(client, slot.id, source);
  return { series: false, lessonDate: source.lessonDate };
}

async function ensureWeeklySlot(client, teacherId, { weekday, startTime, durationMin, priceCents, seriesStart, seriesEnd }) {
  const { rows: weeklies } = await client.query(
    `SELECT * FROM slots
      WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3::time AND one_off_date IS NULL
      FOR UPDATE`,
    [teacherId, weekday, startTime],
  );
  for (const slot of weeklies) {
    const start = fmtDate(slot.series_start_date);
    const end = fmtDate(slot.series_end_date);
    if (!rangesOverlap(start, end, seriesStart, seriesEnd)) continue;
    if (!coversRange(start, end, seriesStart, seriesEnd)) {
      throw new HttpError(409, 'That coach is already booked at that time.');
    }
    const taken = await one(
      client,
      `SELECT 1 FROM recurring_assignments
        WHERE slot_id = $1 AND status IN ('approved', 'pending') LIMIT 1`,
      [slot.id],
    );
    if (taken) throw new HttpError(409, 'That coach is already booked at that time.');
    const booked = await one(
      client,
      `SELECT 1 FROM bookings
        WHERE slot_id = $1 AND status = 'booked' AND lesson_date >= $2
        LIMIT 1`,
      [slot.id, seriesStart || todayISO()],
    );
    if (booked) throw new HttpError(409, 'That coach is already booked at that time.');
    return slot;
  }

  const oneOff = await one(
    client,
    `SELECT 1 FROM slots
      WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3::time
        AND one_off_date IS NOT NULL AND one_off_date >= $4
      LIMIT 1`,
    [teacherId, weekday, startTime, seriesStart || todayISO()],
  );
  if (oneOff) throw new HttpError(409, 'That coach is already booked at that time.');

  const inserted = await client.query(
    `INSERT INTO slots (
       teacher_id, weekday, start_time, duration_min, price_cents,
       series_start_date, series_end_date
     ) VALUES ($1, $2, $3::time, $4, $5, $6, $7)
     RETURNING *`,
    [teacherId, weekday, startTime, durationMin, priceCents, seriesStart, seriesEnd],
  );
  return inserted.rows[0];
}

async function createWeeklyAssignment(client, request, { fromDate, seriesEnd }) {
  const ra = request.recurring_assignment_id
    ? await one(
        client,
        `SELECT * FROM recurring_assignments WHERE id = $1 AND status = 'approved'`,
        [request.recurring_assignment_id],
      )
    : null;
  const studentId = ra?.student_id || request.student_id;
  if (!studentId) {
    throw new HttpError(400, 'This opening is empty. Cancel it or dismiss the request.');
  }
  let startsOn = fromDate || nextWeekdayOnOrAfter(todayISO(), request.weekday);
  const assignmentStart = fmtDate(ra?.starts_on);
  if (assignmentStart && assignmentStart > startsOn) startsOn = assignmentStart;
  const slot = await ensureWeeklySlot(client, request.filled_teacher_id, {
    weekday: request.weekday,
    startTime: request.start_time,
    durationMin: request.duration_min,
    priceCents: request.price_cents,
    seriesStart: startsOn,
    seriesEnd,
  });
  const inserted = await client.query(
    `INSERT INTO recurring_assignments (
       slot_id, student_id, status, child_name, payment_partner_id, starts_on, decided_at
     ) VALUES ($1, $2, 'approved', $3, $4, $5, now())
     RETURNING id`,
    [
      slot.id,
      studentId,
      ra?.child_name ?? request.child_name,
      ra?.payment_partner_id ?? request.payment_partner_id,
      startsOn,
    ],
  ).catch((err) => {
    if (err?.code === '23505') {
      throw new HttpError(409, 'That coach is already booked at that time.');
    }
    throw err;
  });

  if (ra) {
    await client.query(
      `INSERT INTO recurring_lesson_payments (recurring_assignment_id, lesson_date, paid, partner_paid)
       SELECT $1, lesson_date, paid, partner_paid
         FROM recurring_lesson_payments
        WHERE recurring_assignment_id = $2 AND lesson_date >= $3
       ON CONFLICT (recurring_assignment_id, lesson_date) DO NOTHING`,
      [inserted.rows[0].id, ra.id, startsOn],
    );
    await client.query(
      `DELETE FROM recurring_lesson_payments
        WHERE recurring_assignment_id = $1 AND lesson_date >= $2`,
      [ra.id, startsOn],
    );
    await client.query(
      `UPDATE bookings
          SET slot_id = $1
        WHERE slot_id = $2 AND student_id = $3 AND status = 'booked' AND lesson_date >= $4`,
      [slot.id, request.slot_id, studentId, startsOn],
    );
  }
  return { series: true, lessonDate: startsOn, studentId };
}

async function copyOtherFutureBookings(client, request, fromDate, keepStudentId) {
  const { rows } = await client.query(
    `SELECT * FROM bookings
      WHERE slot_id = $1 AND status = 'booked' AND lesson_date >= $2
        AND ($3::int IS NULL OR student_id <> $3)
      ORDER BY lesson_date`,
    [request.slot_id, fromDate, keepStudentId],
  );
  for (const booking of rows) {
    const lessonDate = fmtDate(booking.lesson_date);
    const slot = await ensureOneOffSlot(client, request.filled_teacher_id, {
      date: lessonDate,
      weekday: request.weekday,
      startTime: request.start_time,
      durationMin: request.duration_min,
      priceCents: request.price_cents,
      studentId: booking.student_id,
    });
    await insertBooking(client, slot.id, {
      studentId: booking.student_id,
      childName: booking.child_name,
      paymentPartnerId: booking.payment_partner_id,
      paid: booking.paid,
      partnerPaid: booking.partner_paid,
      lessonDate,
    });
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'closed' WHERE id = $1`,
      [booking.id],
    );
  }
  return rows.map(toLesson);
}

async function performFill(client, request) {
  if (!request.student_id || request.occupant_label === 'Empty') {
    throw new HttpError(400, 'This opening is empty. Cancel it or dismiss the request.');
  }
  if (request.action === 'recurring_remove') {
    const original = request.slot_id
      ? await one(client, 'SELECT series_end_date FROM slots WHERE id = $1', [request.slot_id])
      : null;
    return createWeeklyAssignment(client, request, {
      fromDate: null,
      seriesEnd: fmtDate(original?.series_end_date),
    });
  }
  if (request.action === 'series_end') {
    const fromDate = fmtDate(request.from_date || request.lesson_date);
    const original = await one(client, 'SELECT * FROM slots WHERE id = $1', [request.slot_id]);
    if (!original) throw new HttpError(409, 'That lesson is no longer on the schedule.');
    if (request.recurring_assignment_id) {
      const moved = await createWeeklyAssignment(client, request, {
        fromDate,
        seriesEnd: fmtDate(original.series_end_date),
      });
      const others = await copyOtherFutureBookings(
        client,
        request,
        fromDate,
        moved.studentId || request.student_id,
      );
      return { series: true, lessonDate: fromDate, movedLessons: others };
    }
    const lessons = await copyOtherFutureBookings(client, request, fromDate, null);
    return { series: true, lessonDate: fromDate, movedLessons: lessons, occupantInLessons: true };
  }
  if (request.action === 'invite_cancel') {
    const lessonDate = fmtDate(request.lesson_date);
    const slot = await ensureOneOffSlot(client, request.filled_teacher_id, {
      date: lessonDate,
      weekday: request.weekday,
      startTime: request.start_time,
      durationMin: request.duration_min,
      priceCents: request.price_cents,
      studentId: request.student_id,
    });
    await client.query(
      `INSERT INTO lesson_invites (slot_id, student_id, lesson_date, child_name)
       VALUES ($1, $2, $3, $4)`,
      [slot.id, request.student_id, lessonDate, request.child_name],
    ).catch((err) => {
      if (err?.code === '23505') {
        throw new HttpError(409, 'That coach is already booked at that time.');
      }
      throw err;
    });
    return { series: false, lessonDate };
  }
  if (request.action === 'slot_delete' && !request.lesson_date && request.recurring_assignment_id) {
    return createWeeklyAssignment(client, request, {
      fromDate: nextWeekdayOnOrAfter(todayISO(), request.weekday),
      seriesEnd: null,
    });
  }
  return copyOneDate(client, request);
}

async function notifyMoved(request, substituteTeacherId, moved) {
  const student = await studentById(pool, request.student_id);
  const fromCoach = await one(pool, 'SELECT id, full_name, email, receive_emails FROM teachers WHERE id = $1', [
    request.teacher_id,
  ]);
  const toCoach = await one(pool, 'SELECT id, full_name, email, receive_emails FROM teachers WHERE id = $1', [
    substituteTeacherId,
  ]);
  if (!student || !fromCoach || !toCoach) return;
  await sendLessonMoved({
    student,
    fromCoach,
    toCoach,
    weekday: request.weekday,
    lessonDate: moved.lessonDate,
    fromDate: moved.series ? moved.lessonDate : null,
    startTime: request.start_time,
    durationMin: request.duration_min,
    series: moved.series,
    childName: request.child_name,
  });
}

async function assertSubstitute(client, request, substituteTeacherId) {
  if (substituteTeacherId === request.teacher_id) {
    throw new HttpError(400, 'Choose a different coach.');
  }
  const coach = await one(
    client,
    `SELECT 1 FROM teacher_studios WHERE teacher_id = $1 AND studio_id = $2`,
    [substituteTeacherId, request.studio_id],
  );
  if (!coach) throw new HttpError(400, 'That coach is not at your studio.');
}

export async function applyCancellationRequest(ownerUserId, requestId) {
  const { request, cleared } = await withTransaction(async (client) => {
    const locked = await lockPendingRequest(client, ownerUserId, requestId);
    const result = await performClear(client, locked);
    await client.query(
      `UPDATE cancellation_requests SET status = 'applied', resolved_at = now() WHERE id = $1`,
      [requestId],
    );
    return { request: locked, cleared: result };
  });
  await notifyCleared(request, cleared);
  await notifyRequestResolved(request, 'applied');
  return { ok: true };
}

async function notifyCleared(request, cleared, skipStudentId = null) {
  const keep = (s) => s.studentId !== skipStudentId;
  const pick = (list) => (list || []).filter(keep);
  const notice = {
    teacherId: request.teacher_id,
    weekday: request.weekday,
    startTime: request.start_time,
    byStudio: true,
  };
  await notifyStudentsLessonCancelled({ ...notice, scope: 'weekly', students: pick(cleared.weekly) });
  await notifyStudentsLessonCancelled({ ...notice, scope: 'lesson', students: pick(cleared.lessons) });
  await notifyStudentsWeeklyDeclined({ ...notice, reason: 'closed', students: pick(cleared.requests) });
  await notifyStudentsHeldCancelled({ ...notice, students: pick(cleared.held) });
}

function notifyRequestResolved(request, outcome, substituteTeacherId = null) {
  return notifyCoachRequestResolved({
    teacherId: request.teacher_id,
    outcome,
    actionLabel: ACTION_LABELS[request.action] || request.action,
    occupantLabel: request.occupant_label,
    lessonDate: fmtDate(request.from_date || request.lesson_date),
    weekday: request.weekday,
    startTime: request.start_time,
    series: SERIES_ACTIONS.has(request.action) || (request.action === 'slot_delete' && !request.lesson_date),
    substituteTeacherId,
  });
}

export async function dismissCancellationRequest(ownerUserId, requestId) {
  const { rows } = await query(
    `UPDATE cancellation_requests cr
        SET status = 'dismissed', resolved_at = now()
       FROM studio_owners so
      WHERE cr.id = $1 AND so.id = $2 AND so.studio_id = cr.studio_id AND cr.status = 'pending'
      RETURNING cr.*`,
    [requestId, ownerUserId],
  );
  if (!rows[0]) throw new HttpError(404, 'Request not found.');
  await notifyRequestResolved(rows[0], 'dismissed');
  return { ok: true };
}

export async function fillCancellationRequest(ownerUserId, requestId, substituteTeacherId) {
  const moved = await withTransaction(async (client) => {
    const request = await lockPendingRequest(client, ownerUserId, requestId);
    await assertSubstitute(client, request, substituteTeacherId);
    request.filled_teacher_id = substituteTeacherId;
    const result = await performFill(client, request);
    const cleared = await performClear(client, request);
    await client.query(
      `UPDATE cancellation_requests
          SET status = 'filled', filled_teacher_id = $2, resolved_at = now()
        WHERE id = $1`,
      [requestId, substituteTeacherId],
    );
    return { request, moved: result, cleared };
  });
  const { request } = moved;
  await notifyMoved(request, substituteTeacherId, moved.moved);

  const filled = {
    fromTeacherId: request.teacher_id,
    toTeacherId: substituteTeacherId,
    weekday: request.weekday,
    startTime: request.start_time,
  };
  const movedToSubstitute = (moved.moved.movedLessons || []).map((l) => ({ ...l, series: false }));
  if (!moved.moved.occupantInLessons) {
    movedToSubstitute.unshift({
      studentId: request.student_id,
      childName: request.child_name,
      series: moved.moved.series,
      lessonDate: moved.moved.lessonDate,
    });
  }
  for (const lesson of movedToSubstitute) {
    await notifyStudentCoachFilled({ ...filled, ...lesson });
  }
  await notifyCoachLessonsAdded({
    teacherId: substituteTeacherId,
    fromTeacherId: request.teacher_id,
    lessons: movedToSubstitute,
    weekday: request.weekday,
    startTime: request.start_time,
  });
  // Anyone the clear removed who was not moved to the substitute lost their lesson.
  await notifyCleared(request, moved.cleared, request.student_id);
  await notifyRequestResolved(request, 'filled', substituteTeacherId);
  return { ok: true };
}
