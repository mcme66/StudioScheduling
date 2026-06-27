import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { getMonday, dateForWeekday, isValidDateStr, todayISO } from '../utils/week.js';
import { getTeacherStudios, teacherListedAtStudio } from '../utils/teacherStudios.js';
import { sanitizeRichText } from '../utils/sanitizeHtml.js';

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
    res.json({ teacher: mapTeacherProfile(rows[0]) });
  }),
);

teachersRouter.get(
  '/me/bookings',
  requireRole('teacher'),
  asyncHandler(async (req, res) => {
    const weekParam = req.query.week;
    let bookingsParams = [req.user.id];
    let weekFilter = '';
    if (isValidDateStr(weekParam)) {
      const monday = getMonday(weekParam);
      const sunday = dateForWeekday(monday, 0);
      weekFilter = 'AND b.lesson_date BETWEEN $2 AND $3';
      bookingsParams = [req.user.id, monday, sunday];
    }

    const { rows: bookings } = await query(
      `SELECT b.id, b.lesson_date, b.created_at, b.status, b.paid,
              s.weekday, s.start_time, s.duration_min, s.price_cents,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN students st ON st.id = b.student_id
        WHERE s.teacher_id = $1 AND b.status = 'booked' ${weekFilter}
          AND NOT EXISTS (
            SELECT 1 FROM recurring_assignments ra
             WHERE ra.slot_id = b.slot_id
               AND ra.student_id = b.student_id
               AND ra.status IN ('pending', 'approved')
          )
        ORDER BY b.lesson_date, s.start_time`,
      bookingsParams,
    );

    const { rows: recurring } = await query(
      `SELECT ra.id, s.id AS slot_id, s.weekday, s.start_time, s.duration_min,
              st.full_name AS student_name, st.email AS student_email, st.phone AS student_phone
         FROM recurring_assignments ra
         JOIN slots s ON s.id = ra.slot_id
         JOIN students st ON st.id = ra.student_id
        WHERE s.teacher_id = $1 AND ra.status = 'approved'
        ORDER BY s.weekday, s.start_time`,
      [req.user.id],
    );

    const { rows: teacherRows } = await query(
      'SELECT track_payments FROM teachers WHERE id = $1',
      [req.user.id],
    );
    const trackPayments = teacherRows[0]?.track_payments === true;

    res.json({
      trackPayments,
      bookings: bookings.map((b) => ({
        id: b.id,
        lessonDate: fmtDate(b.lesson_date),
        createdAt: b.created_at,
        weekday: b.weekday,
        startTime: fmtTime(b.start_time),
        durationMin: b.duration_min,
        priceCents: b.price_cents,
        paid: b.paid === true,
        student: { name: b.student_name, email: b.student_email, phone: b.student_phone },
      })),
      recurring: recurring.map((r) => ({
        id: r.id,
        slotId: r.slot_id,
        weekday: r.weekday,
        startTime: fmtTime(r.start_time),
        durationMin: r.duration_min,
        student: { name: r.student_name, email: r.student_email, phone: r.student_phone },
      })),
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

    const { rows: slots } = await query(
      `SELECT * FROM slots WHERE teacher_id = $1 AND active = true ORDER BY weekday, start_time`,
      [teacherId],
    );
    const slotIds = slots.map((s) => s.id);

    let approved = [];
    let booked = [];
    let pending = [];
    let myPending = [];
    if (slotIds.length) {
      const sunday = dateForWeekday(monday, 0);
      const [approvedRes, bookedRes, pendingRes] = await Promise.all([
        query(
          `SELECT ra.slot_id, ra.student_id, st.full_name
             FROM recurring_assignments ra JOIN students st ON st.id = ra.student_id
            WHERE ra.status = 'approved' AND ra.slot_id = ANY($1::int[])`,
          [slotIds],
        ),
        query(
          `SELECT b.slot_id, b.lesson_date, b.student_id
             FROM bookings b
            WHERE b.status = 'booked' AND b.slot_id = ANY($1::int[])
              AND b.lesson_date BETWEEN $2 AND $3`,
          [slotIds, monday, sunday],
        ),
        query(
          `SELECT ra.slot_id, ra.student_id, st.full_name
             FROM recurring_assignments ra JOIN students st ON st.id = ra.student_id
            WHERE ra.status = 'pending' AND ra.slot_id = ANY($1::int[])`,
          [slotIds],
        ),
      ]);
      approved = approvedRes.rows;
      booked = bookedRes.rows;
      pending = pendingRes.rows;
      if (req.user?.role === 'student') {
        const { rows } = await query(
          `SELECT slot_id FROM recurring_assignments
            WHERE status = 'pending' AND student_id = $1 AND slot_id = ANY($2::int[])`,
          [req.user.id, slotIds],
        );
        myPending = rows;
      }
    }

    const approvedBySlot = new Map(approved.map((r) => [r.slot_id, r]));
    const bookedBySlot = new Map(booked.map((r) => [r.slot_id, r]));
    const pendingBySlot = new Map(pending.map((r) => [r.slot_id, r]));
    const pendingSet = new Set(myPending.map((r) => r.slot_id));
    const meId = req.user?.role === 'student' ? req.user.id : null;

    const result = slots.map((s) => {
      const lessonDate = dateForWeekday(monday, s.weekday);
      const rec = approvedBySlot.get(s.id);
      const bk = bookedBySlot.get(s.id);
      const pend = pendingBySlot.get(s.id);
      let status = 'open';
      let mine = false;
      if (rec) {
        status = 'recurring';
        mine = meId != null && rec.student_id === meId;
      } else if (bk) {
        status = 'booked';
        mine = meId != null && bk.student_id === meId;
      } else if (pend) {
        status = 'pending';
        mine = meId != null && pend.student_id === meId;
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
        recurringPendingMine: pendingSet.has(s.id),
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
