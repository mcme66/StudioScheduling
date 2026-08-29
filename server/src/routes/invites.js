import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  isValidDateStr,
  todayISO,
  getMonday,
  dateForWeekday,
} from '../utils/week.js';
import { resolveBookerStudentId } from '../utils/booker.js';
import { normalizeChildrenNames } from './students.js';
import { loadSlotForUpdate, assertSlotOpenOnDate, fmtDate, fmtTime } from '../utils/assertSlotOpen.js';
import { sendBookingConfirmation } from '../services/email.js';
import { resolvePaymentPartnerId } from '../utils/partners.js';

export const invitesRouter = Router();

const createSchema = z.object({
  slotId: z.number().int().positive(),
  lessonDate: z.string().refine(isValidDateStr, 'lessonDate must be YYYY-MM-DD.'),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  childName: z.string().max(120).optional().nullable(),
});

const acceptSchema = z.object({
  childName: z.string().max(120).optional().nullable(),
  paymentPartnerId: z.number().int().positive().optional().nullable(),
});

async function resolveChildName(client, studentId, requestedChildName) {
  const { rows } = await client.query(
    'SELECT is_parent, children_names FROM students WHERE id = $1',
    [studentId],
  );
  const student = rows[0];
  if (!student) throw new HttpError(401, 'Account no longer exists.');

  if (!student.is_parent) {
    if (requestedChildName) {
      throw new HttpError(400, 'Only parent accounts can book for a child.');
    }
    return null;
  }

  const children = normalizeChildrenNames(student.children_names);
  if (!children.length) {
    throw new HttpError(
      400,
      'Add at least one child on your profile before booking as a parent.',
    );
  }
  const name = String(requestedChildName || '').trim();
  if (!name) {
    throw new HttpError(400, 'Select which child this lesson is for.');
  }
  const match = children.find((c) => c.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new HttpError(400, 'That child is not on your profile.');
  }
  return match;
}

function serializePendingInvite(row) {
  return {
    id: row.id,
    slotId: row.slot_id,
    lessonDate: fmtDate(row.lesson_date),
    weekday: row.weekday,
    startTime: fmtTime(row.start_time),
    durationMin: row.duration_min,
    createdAt: row.created_at,
    childName: row.child_name || null,
    teacher: { id: row.teacher_id, name: row.teacher_name },
    student: {
      id: row.student_id,
      name: row.student_name,
      email: row.student_email,
    },
  };
}

const lookupQuerySchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254),
});

// Teacher: see whether an email belongs to a student, and list children if it's a parent.
invitesRouter.get(
  '/lookup',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { email } = lookupQuerySchema.parse({ email: req.query.email });
    const normalizedEmail = email.toLowerCase();

    const { rows: studentRows } = await query(
      `SELECT id, email, full_name, is_parent, children_names
         FROM students WHERE lower(email) = $1`,
      [normalizedEmail],
    );
    const student = studentRows[0];
    if (!student) {
      throw new HttpError(404, 'No student with that email was found.');
    }

    const { rows: teacherRows } = await query('SELECT email FROM teachers WHERE id = $1', [
      req.user.id,
    ]);
    if (teacherRows[0] && teacherRows[0].email.toLowerCase() === student.email.toLowerCase()) {
      throw new HttpError(400, 'You cannot schedule a lesson for yourself.');
    }

    const isParent = student.is_parent === true;
    res.json({
      student: {
        id: student.id,
        name: student.full_name,
        email: student.email,
        isParent,
        childrenNames: isParent ? normalizeChildrenNames(student.children_names) : [],
      },
    });
  }),
);

// Teacher: schedule an open slot for a student by email (pending until they accept).
invitesRouter.post(
  '/',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { slotId, lessonDate, email, childName: requestedChildName } = createSchema.parse(
      req.body,
    );
    const normalizedEmail = email.trim().toLowerCase();

    if (lessonDate < todayISO()) {
      throw new HttpError(400, 'That date is in the past.');
    }

    const { rows: studentRows } = await query(
      `SELECT id, email, full_name, is_parent, children_names
         FROM students WHERE lower(email) = $1`,
      [normalizedEmail],
    );
    const student = studentRows[0];
    if (!student) {
      throw new HttpError(404, 'No student with that email was found.');
    }

    const { rows: teacherRows } = await query('SELECT email FROM teachers WHERE id = $1', [
      req.user.id,
    ]);
    if (teacherRows[0] && teacherRows[0].email.toLowerCase() === student.email.toLowerCase()) {
      throw new HttpError(400, 'You cannot schedule a lesson for yourself.');
    }

    let childName = null;
    if (student.is_parent === true) {
      const children = normalizeChildrenNames(student.children_names);
      if (!children.length) {
        throw new HttpError(400, 'This parent has no children on their profile.');
      }
      const requested = String(requestedChildName || '').trim();
      if (!requested) {
        throw new HttpError(400, 'Select which child this lesson is for.');
      }
      const match = children.find((c) => c.toLowerCase() === requested.toLowerCase());
      if (!match) {
        throw new HttpError(400, 'That child is not on this parent’s profile.');
      }
      childName = match;
    } else if (requestedChildName) {
      throw new HttpError(400, 'Only parent accounts can be scheduled for a child.');
    }

    const invite = await withTransaction(async (client) => {
      const slot = await loadSlotForUpdate(client, slotId);
      if (slot.teacher_id !== req.user.id) {
        throw new HttpError(403, 'That lesson time is not on your schedule.');
      }
      await assertSlotOpenOnDate(client, slot, lessonDate, { bookerStudentId: student.id });

      const { rows } = await client.query(
        `INSERT INTO lesson_invites (slot_id, student_id, lesson_date, child_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [slotId, student.id, lessonDate, childName],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'This time is already being held for a student.');
        }
        throw err;
      });
      return { row: rows[0], slot };
    });

    res.status(201).json({
      invite: {
        id: invite.row.id,
        slotId,
        lessonDate,
        status: invite.row.status,
        childName,
        student: { id: student.id, name: student.full_name, email: student.email },
      },
    });
  }),
);

// Teacher: pending invites for a week (so they can retract a held slot).
invitesRouter.get(
  '/',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const weekParam = req.query.week;
    let params = [req.user.id];
    let dateFilter = '';
    if (isValidDateStr(weekParam)) {
      const monday = getMonday(weekParam);
      const sunday = dateForWeekday(monday, 0);
      dateFilter = 'AND li.lesson_date BETWEEN $2 AND $3';
      params = [req.user.id, monday, sunday];
    } else {
      dateFilter = 'AND li.lesson_date >= $2';
      params = [req.user.id, todayISO()];
    }

    const { rows } = await query(
      `SELECT li.id, li.slot_id, li.lesson_date, li.status, li.created_at, li.child_name,
              s.weekday, s.start_time, s.duration_min,
              t.id AS teacher_id, t.full_name AS teacher_name,
              st.id AS student_id, st.full_name AS student_name, st.email AS student_email
         FROM lesson_invites li
         JOIN slots s ON s.id = li.slot_id
         JOIN teachers t ON t.id = s.teacher_id
         JOIN students st ON st.id = li.student_id
        WHERE s.teacher_id = $1 AND li.status = 'pending' ${dateFilter}
        ORDER BY li.lesson_date, s.start_time`,
      params,
    );

    res.json({ invites: rows.map(serializePendingInvite) });
  }),
);

// Student: pending invites for My Lessons.
invitesRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookerStudentId = await resolveBookerStudentId(req.user);

    const { rows: studentRows } = await query(
      'SELECT is_parent, children_names FROM students WHERE id = $1',
      [bookerStudentId],
    );
    const student = studentRows[0];
    if (!student) throw new HttpError(401, 'Account no longer exists.');

    const { rows } = await query(
      `SELECT li.id, li.slot_id, li.lesson_date, li.status, li.created_at, li.child_name,
              s.weekday, s.start_time, s.duration_min,
              t.id AS teacher_id, t.full_name AS teacher_name,
              st.id AS student_id, st.full_name AS student_name, st.email AS student_email
         FROM lesson_invites li
         JOIN slots s ON s.id = li.slot_id
         JOIN teachers t ON t.id = s.teacher_id
         JOIN students st ON st.id = li.student_id
        WHERE li.student_id = $1 AND li.status = 'pending' AND li.lesson_date >= $2
        ORDER BY li.lesson_date, s.start_time`,
      [bookerStudentId, todayISO()],
    );

    res.json({
      isParent: student.is_parent === true,
      childrenNames: normalizeChildrenNames(student.children_names),
      invites: rows.map(serializePendingInvite),
    });
  }),
);

invitesRouter.post(
  '/:id/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid invite.');
    const { childName: requestedChildName, paymentPartnerId: requestedPartnerId } =
      acceptSchema.parse(req.body || {});
    const bookerStudentId = await resolveBookerStudentId(req.user);

    const result = await withTransaction(async (client) => {
      const { rows: peekRows } = await client.query(
        `SELECT slot_id, student_id, status, lesson_date FROM lesson_invites WHERE id = $1`,
        [id],
      );
      const peek = peekRows[0];
      if (!peek || peek.status !== 'pending') {
        throw new HttpError(404, 'That scheduled lesson is no longer waiting for you.');
      }
      if (peek.student_id !== bookerStudentId) {
        throw new HttpError(403, 'That scheduled lesson is not for your account.');
      }

      const slot = await loadSlotForUpdate(client, peek.slot_id);
      const { rows: inviteRows } = await client.query(
        `SELECT * FROM lesson_invites WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const invite = inviteRows[0];
      if (!invite || invite.status !== 'pending') {
        throw new HttpError(404, 'That scheduled lesson is no longer waiting for you.');
      }

      const lessonDate = fmtDate(invite.lesson_date);
      await assertSlotOpenOnDate(client, slot, lessonDate, {
        bookerStudentId,
        ignoreInviteId: invite.id,
      });

      const childName = await resolveChildName(
        client,
        bookerStudentId,
        invite.child_name || requestedChildName,
      );
      const paymentPartnerId = await resolvePaymentPartnerId(
        bookerStudentId,
        requestedPartnerId,
        (text, params) => client.query(text, params),
        childName,
      );

      const { rows: bookingRows } = await client.query(
        `INSERT INTO bookings (slot_id, student_id, lesson_date, child_name, payment_partner_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [invite.slot_id, bookerStudentId, lessonDate, childName, paymentPartnerId],
      ).catch((err) => {
        if (err?.code === '23505') {
          throw new HttpError(409, 'That time was just booked. Please choose another.');
        }
        throw err;
      });

      await client.query(
        `UPDATE lesson_invites
            SET status = 'accepted', decided_at = now()
          WHERE id = $1`,
        [id],
      );

      return { booking: bookingRows[0], slot, childName, paymentPartnerId, lessonDate };
    });

    const [{ rows: studentRows }, { rows: teacherRows }] = await Promise.all([
      query('SELECT full_name, email, receive_emails FROM students WHERE id = $1', [
        bookerStudentId,
      ]),
      query('SELECT full_name FROM teachers WHERE id = $1', [result.slot.teacher_id]),
    ]);
    await sendBookingConfirmation({
      student: studentRows[0],
      teacher: teacherRows[0],
      slot: result.slot,
      lessonDate: result.lessonDate,
      childName: result.childName,
    });

    res.json({
      booking: {
        id: result.booking.id,
        slotId: result.slot.id,
        lessonDate: result.lessonDate,
        status: result.booking.status,
        childName: result.childName,
        paymentPartnerId: result.paymentPartnerId,
      },
    });
  }),
);

invitesRouter.post(
  '/:id/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid invite.');
    const bookerStudentId = await resolveBookerStudentId(req.user);

    const { rows } = await query(
      `UPDATE lesson_invites li
          SET status = 'declined', decided_at = now()
         FROM slots s
        WHERE li.id = $1
          AND li.slot_id = s.id
          AND li.student_id = $2
          AND li.status = 'pending'
        RETURNING li.id`,
      [id, bookerStudentId],
    );
    if (!rows[0]) {
      throw new HttpError(404, 'That scheduled lesson is no longer waiting for you.');
    }
    res.json({ ok: true });
  }),
);

// Teacher retracts a pending invite so the slot reopens.
invitesRouter.delete(
  '/:id',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid invite.');

    const { rows } = await query(
      `UPDATE lesson_invites li
          SET status = 'cancelled', decided_at = now()
         FROM slots s
        WHERE li.id = $1
          AND li.slot_id = s.id
          AND s.teacher_id = $2
          AND li.status = 'pending'
        RETURNING li.id`,
      [id, req.user.id],
    );
    if (!rows[0]) {
      throw new HttpError(404, 'That scheduled lesson is no longer pending.');
    }
    res.json({ ok: true });
  }),
);
