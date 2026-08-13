import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import {
  getMonday,
  dateForWeekday,
  isValidDateStr,
  todayISO,
  isDateInSeries,
} from '../utils/week.js';
import { getTeacherStudios, teacherListedAtStudio } from '../utils/teacherStudios.js';
import { sanitizeRichText } from '../utils/sanitizeHtml.js';
import { ensureLinkedStudentForTeacher, tryResolveBookerStudentId } from '../utils/booker.js';
import { partnerIdsFor } from '../utils/partners.js';

export const teachersRouter = Router();

const fmtTime = (t) => (typeof t === 'string' ? t.slice(0, 5) : t);
const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

// --- Teacher's own profile + bookings (must come before "/:id") ------------

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
  bio: z.string().max(1000).optional().or(z.literal('')),
  defaultPriceCents: z.number().int().min(0).optional(),
  defaultDurationMin: z.number().int().min(5).max(240).optional(),
  additionalInfo: z.string().max(15000).optional().or(z.literal('')),
  teachingPolicies: z.string().max(15000).optional().or(z.literal('')),
  trackPayments: z.boolean().optional(),
  receiveEmails: z.boolean().optional(),
  isActive: z.boolean().optional(),
  canBookAsStudent: z.boolean().optional(),
});

function mapTeacherProfile(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || null,
    bio: row.bio || null,
    defaultPriceCents: row.default_price_cents,
    defaultDurationMin: row.default_duration_min,
    additionalInfo: row.additional_info || null,
    teachingPolicies: row.teaching_policies || null,
    trackPayments: row.track_payments === true,
    receiveEmails: row.receive_emails !== false,
    isActive: row.is_active !== false,
    canBookAsStudent: row.can_book_as_student === true,
  };
}

const studioSchema = z.object({
  studioId: z.number().int().positive(),
});

teachersRouter.get(
  '/me',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM teachers WHERE id = $1', [req.user.id]);
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists.');
    res.json({ teacher: mapTeacherProfile(rows[0]) });
  }),
);

teachersRouter.get(
  '/me/studios',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const studios = await getTeacherStudios(req.user.id);
    res.json({ studios });
  }),
);

teachersRouter.put(
  '/me/studios',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const { studioId } = studioSchema.parse(req.body);

    const { rows: existing } = await query('SELECT id FROM studios WHERE id = $1', [studioId]);
    if (!existing[0]) {
      throw new HttpError(400, 'Invalid studio.');
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM teacher_studios WHERE teacher_id = $1', [req.user.id]);
      await client.query(
        'INSERT INTO teacher_studios (teacher_id, studio_id) VALUES ($1, $2)',
        [req.user.id, studioId],
      );
    });

    const studios = await getTeacherStudios(req.user.id);
    res.json({ studios });
  }),
);

teachersRouter.patch(
  '/me',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const map = {
      fullName: 'full_name',
      phone: 'phone',
      bio: 'bio',
      defaultPriceCents: 'default_price_cents',
      defaultDurationMin: 'default_duration_min',
      additionalInfo: 'additional_info',
      teachingPolicies: 'teaching_policies',
      trackPayments: 'track_payments',
      receiveEmails: 'receive_emails',
      isActive: 'is_active',
      canBookAsStudent: 'can_book_as_student',
    };
    const richTextKeys = new Set(['additionalInfo', 'teachingPolicies']);
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        let val = data[key] === '' ? null : data[key];
        if (richTextKeys.has(key) && val != null) {
          val = sanitizeRichText(val);
        }
        values.push(val);
      }
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    values.push(req.user.id);
    const { rows } = await query(
      `UPDATE teachers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    const teacher = rows[0];
    if (teacher.can_book_as_student) {
      await ensureLinkedStudentForTeacher(teacher.id);
    } else if (
      data.fullName !== undefined ||
      data.phone !== undefined
    ) {
      // Keep an existing linked student profile roughly in sync even if booking is off.
      await query(
        `UPDATE students s
            SET full_name = t.full_name, phone = t.phone
           FROM teachers t
          WHERE t.id = $1 AND s.email = t.email`,
        [teacher.id],
      );
    }
    res.json({ teacher: mapTeacherProfile(teacher) });
  }),
);

teachersRouter.get(
  '/me/bookings',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const weekParam = req.query.week;
    let bookingsParams = [req.user.id];
    let weekFilter = '';
    let weekRange = null;
    if (isValidDateStr(weekParam)) {
      const monday = getMonday(weekParam);
      const sunday = dateForWeekday(monday, 0);
      weekFilter = 'AND b.lesson_date BETWEEN $2 AND $3';
      bookingsParams = [req.user.id, monday, sunday];
      weekRange = { monday, sunday };
    }

    const { rows: bookings } = await query(
      `SELECT b.id, b.lesson_date, b.created_at, b.status, b.paid, b.partner_paid, b.slot_id, b.child_name,
              b.payment_partner_id, pp.full_name AS payment_partner_name,
              s.weekday, s.start_time, s.duration_min, s.price_cents,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN students st ON st.id = b.student_id
         LEFT JOIN students pp ON pp.id = b.payment_partner_id
        WHERE s.teacher_id = $1 AND b.status = 'booked' ${weekFilter}
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = b.slot_id
               AND ra.student_id = b.student_id
               AND ra.status IN ('pending', 'approved')
               AND ra.starts_on <= b.lesson_date
          )
        ORDER BY b.lesson_date, s.start_time`,
      bookingsParams,
    );

    // Per-week exceptions (skipped / blocked) for the requested week, so the
    // dashboard can label weekly rows that are already cancelled this week.
    let exceptions = [];
    if (weekRange) {
      const { rows: excRows } = await query(
        `SELECT se.slot_id, se.exception_date, se.kind
           FROM slot_exceptions se
           JOIN slots s ON s.id = se.slot_id
          WHERE s.teacher_id = $1 AND se.exception_date BETWEEN $2 AND $3`,
        [req.user.id, weekRange.monday, weekRange.sunday],
      );
      exceptions = excRows.map((e) => ({
        slotId: e.slot_id,
        date: fmtDate(e.exception_date),
        kind: e.kind,
      }));
    }

    const { rows: recurring } = await query(
      `SELECT ra.id, ra.child_name, ra.payment_partner_id, ra.starts_on, pp.full_name AS payment_partner_name,
              s.id AS slot_id, s.weekday, s.start_time, s.duration_min,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN students st ON st.id = ra.student_id
         LEFT JOIN students pp ON pp.id = ra.payment_partner_id
        WHERE s.teacher_id = $1 AND ra.status = 'approved'
        ORDER BY s.weekday, s.start_time`,
      [req.user.id],
    );

    let recurringPayments = new Map();
    if (weekRange && recurring.length) {
      const recurringIds = recurring.map((r) => r.id);
      const { rows: payRows } = await query(
        `SELECT recurring_assignment_id, lesson_date, paid, partner_paid
           FROM recurring_lesson_payments
          WHERE recurring_assignment_id = ANY($1::int[])
            AND lesson_date BETWEEN $2 AND $3`,
        [recurringIds, weekRange.monday, weekRange.sunday],
      );
      for (const p of payRows) {
        recurringPayments.set(`${p.recurring_assignment_id}:${fmtDate(p.lesson_date)}`, {
          paid: p.paid === true,
          partnerPaid: p.partner_paid === true,
        });
      }
    }

    const { rows: teacherRows } = await query(
      'SELECT track_payments FROM teachers WHERE id = $1',
      [req.user.id],
    );
    const trackPayments = teacherRows[0]?.track_payments === true;

    res.json({
      trackPayments,
      exceptions,
      bookings: bookings.map((b) => ({
        id: b.id,
        slotId: b.slot_id,
        lessonDate: fmtDate(b.lesson_date),
        createdAt: b.created_at,
        weekday: b.weekday,
        startTime: fmtTime(b.start_time),
        durationMin: b.duration_min,
        priceCents: b.price_cents,
        paid: b.paid === true,
        partnerPaid: b.partner_paid === true,
        paymentPartner: b.payment_partner_name ? { name: b.payment_partner_name } : null,
        student: {
          name: b.student_name,
          email: b.student_email,
          phone: b.student_phone,
          childName: b.child_name || null,
        },
      })),
      recurring: recurring.flatMap((r) => {
        const lessonDate = weekRange ? dateForWeekday(weekRange.monday, r.weekday) : null;
        const startsOn = r.starts_on ? fmtDate(r.starts_on) : null;
        if (lessonDate && startsOn && lessonDate < startsOn) return [];
        const pay = lessonDate
          ? recurringPayments.get(`${r.id}:${lessonDate}`)
          : null;
        return [{
          id: r.id,
          slotId: r.slot_id,
          weekday: r.weekday,
          startTime: fmtTime(r.start_time),
          durationMin: r.duration_min,
          lessonDate,
          paid: pay?.paid === true,
          partnerPaid: pay?.partnerPaid === true,
          paymentPartner: r.payment_partner_name ? { name: r.payment_partner_name } : null,
          student: {
            name: r.student_name,
            email: r.student_email,
            phone: r.student_phone,
            childName: r.child_name || null,
          },
        }];
      }),
    });
  }),
);

// --- Student-facing browsing ------------------------------------------------

teachersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const studioId = req.query.studioId ? Number(req.query.studioId) : null;
    const params = [];
    let filter = '';
    if (studioId) {
      filter = 'WHERE ts.studio_id = $1';
      params.push(studioId);
    }

    const { rows } = await query(
      `SELECT t.id, t.full_name, t.bio, t.default_price_cents, t.default_duration_min,
              COUNT(s.id) FILTER (WHERE s.active) AS active_slots,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', st.id, 'name', st.name, 'slug', st.slug))
                  FILTER (WHERE st.id IS NOT NULL),
                '[]'
              ) AS studios
         FROM teachers t
         JOIN teacher_studios ts ON ts.teacher_id = t.id
         JOIN studios st ON st.id = ts.studio_id
         LEFT JOIN slots s ON s.teacher_id = t.id
        ${filter}
        GROUP BY t.id
        ORDER BY t.full_name`,
      params,
    );
    res.json({
      teachers: rows.map((t) => ({
        id: t.id,
        fullName: t.full_name,
        bio: t.bio,
        defaultPriceCents: t.default_price_cents,
        defaultDurationMin: t.default_duration_min,
        activeSlots: Number(t.active_slots),
        studios: t.studios,
      })),
    });
  }),
);

teachersRouter.get(
  '/:id/schedule',
  asyncHandler(async (req, res) => {
    const teacherId = Number(req.params.id);
    const weekParam = isValidDateStr(req.query.week) ? req.query.week : todayISO();
    const studioSlug = typeof req.query.studio === 'string' ? req.query.studio : null;
    const monday = getMonday(weekParam);

    const { rows: teacherRows } = await query(
      `SELECT id, full_name, bio, additional_info, teaching_policies
         FROM teachers WHERE id = $1`,
      [teacherId],
    );
    if (!teacherRows[0]) throw new HttpError(404, 'Instructor not found.');

    const teacher = teacherRows[0];
    const studios = await getTeacherStudios(teacherId);
    if (!studios.length) {
      throw new HttpError(404, 'This instructor is not listed at any studio.');
    }

    let studioContext = null;
    if (studioSlug) {
      studioContext = await teacherListedAtStudio(teacherId, studioSlug);
      if (!studioContext) {
        throw new HttpError(404, 'This instructor is not listed at that studio.');
      }
    }

    const sunday = dateForWeekday(monday, 0);
    const { rows: slotRows } = await query(
      `SELECT * FROM slots
         WHERE teacher_id = $1 AND active = true
           AND (
             (one_off_date IS NOT NULL AND one_off_date BETWEEN $2 AND $3)
             OR (
               one_off_date IS NULL
               AND (series_start_date IS NULL OR series_start_date <= $3)
               AND (series_end_date IS NULL OR series_end_date >= $2)
             )
           )
         ORDER BY weekday, start_time`,
      [teacherId, monday, sunday],
    );
    const slots = slotRows.filter((s) => {
      if (s.one_off_date != null) return true;
      const lessonDate = dateForWeekday(monday, s.weekday);
      return isDateInSeries(
        lessonDate,
        s.series_start_date ? fmtDate(s.series_start_date) : null,
        s.series_end_date ? fmtDate(s.series_end_date) : null,
      );
    });
    const slotIds = slots.map((s) => s.id);

    let approved = [];
    let booked = [];
    let pending = [];
    let myPending = [];
    let exceptions = [];
    const meId = await tryResolveBookerStudentId(req.user);
    const partnerIdSet = new Set(meId ? await partnerIdsFor(meId) : []);
    if (slotIds.length) {
      const [approvedRes, bookedRes, pendingRes, exceptionsRes] = await Promise.all([
        query(
          `SELECT ra.slot_id, ra.student_id, ra.child_name, ra.starts_on, st.full_name
             FROM recurring_assignments ra JOIN students st ON st.id = ra.student_id
            WHERE ra.status = 'approved' AND ra.slot_id = ANY($1::int[])`,
          [slotIds],
        ),
        query(
          `SELECT b.slot_id, b.lesson_date, b.student_id, b.child_name, st.full_name
             FROM bookings b
             JOIN students st ON st.id = b.student_id
            WHERE b.status = 'booked' AND b.slot_id = ANY($1::int[])
              AND b.lesson_date BETWEEN $2 AND $3`,
          [slotIds, monday, sunday],
        ),
        query(
          `SELECT ra.slot_id, ra.student_id, ra.child_name, ra.starts_on, st.full_name
             FROM recurring_assignments ra JOIN students st ON st.id = ra.student_id
            WHERE ra.status = 'pending' AND ra.slot_id = ANY($1::int[])`,
          [slotIds],
        ),
        query(
          `SELECT slot_id, exception_date, kind FROM slot_exceptions
            WHERE slot_id = ANY($1::int[]) AND exception_date BETWEEN $2 AND $3`,
          [slotIds, monday, sunday],
        ),
      ]);
      approved = approvedRes.rows;
      booked = bookedRes.rows;
      pending = pendingRes.rows;
      exceptions = exceptionsRes.rows;
      if (meId) {
        const { rows } = await query(
          `SELECT slot_id, starts_on FROM recurring_assignments
            WHERE status = 'pending' AND student_id = $1 AND slot_id = ANY($2::int[])`,
          [meId, slotIds],
        );
        myPending = rows;
      }
    }

    const approvedBySlot = new Map(approved.map((r) => [r.slot_id, r]));
    const bookedBySlot = new Map(booked.map((r) => [r.slot_id, r]));
    const pendingBySlot = new Map(pending.map((r) => [r.slot_id, r]));
    // Exceptions are date-specific; key by slot since the grid shows one date
    // (the slot's weekday) per week.
    const exceptionBySlot = new Map(exceptions.map((e) => [e.slot_id, e.kind]));

    const partnerLabel = (row) => {
      if (!row || !meId || row.student_id === meId) return null;
      if (!partnerIdSet.has(row.student_id)) return null;
      return {
        name: row.full_name,
        childName: row.child_name || null,
      };
    };

    const assignmentCovers = (row, lessonDate) => {
      if (!row) return false;
      if (!row.starts_on) return true;
      return fmtDate(row.starts_on) <= lessonDate;
    };

    const result = slots.map((s) => {
      const lessonDate = dateForWeekday(monday, s.weekday);
      const exceptionKind = exceptionBySlot.get(s.id);
      const rec = assignmentCovers(approvedBySlot.get(s.id), lessonDate)
        ? approvedBySlot.get(s.id)
        : null;
      const bk = bookedBySlot.get(s.id);
      const pend = assignmentCovers(pendingBySlot.get(s.id), lessonDate)
        ? pendingBySlot.get(s.id)
        : null;
      let status = 'open';
      let mine = false;
      let bookedByPartner = null;
      if (exceptionKind === 'blocked') {
        // Teacher made this week unavailable; nobody can book.
        status = 'unavailable';
      } else if (exceptionKind === 'skipped') {
        // Weekly holder is away this week; the slot reopens unless someone
        // already booked the freed date.
        if (bk) {
          status = 'booked';
          mine = meId != null && bk.student_id === meId;
          bookedByPartner = partnerLabel(bk);
        }
      } else if (rec) {
        status = 'recurring';
        mine = meId != null && rec.student_id === meId;
        bookedByPartner = partnerLabel(rec);
      } else if (bk) {
        status = 'booked';
        mine = meId != null && bk.student_id === meId;
        bookedByPartner = partnerLabel(bk);
      } else if (pend) {
        status = 'pending';
        mine = meId != null && pend.student_id === meId;
        bookedByPartner = partnerLabel(pend);
      }
      return {
        id: s.id,
        weekday: s.weekday,
        startTime: fmtTime(s.start_time),
        durationMin: s.duration_min,
        priceCents: s.price_cents,
        lessonDate,
        status,
        mine,
        bookedByPartner,
        oneOff: s.one_off_date != null,
        recurringPendingMine: myPending.some(
          (p) => p.slot_id === s.id && assignmentCovers(p, lessonDate),
        ),
      };
    });

    res.json({
      teacher: {
        id: teacher.id,
        fullName: teacher.full_name,
        bio: teacher.bio,
        additionalInfo: teacher.additional_info || null,
        teachingPolicies: teacher.teaching_policies || null,
        studio: studioContext,
        studios,
      },
      weekStart: monday,
      slots: result,
    });
  }),
);
