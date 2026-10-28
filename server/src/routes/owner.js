import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import {
  assignCoachTier,
  createCoachTier,
  deleteCoachTier,
  listCoachTiers,
  moveCoachTier,
  updateCoachTier,
} from '../utils/coachTiers.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { addDays, addWeeks, getMonday, isValidDateStr, todayISO, weekdayOf } from '../utils/week.js';
import {
  listTaughtLessons,
  expectedFloorFeeCents,
  weeksOverlappingRange,
  loadStudioStudentIdSet,
  listRecentStudioStudents,
  recentStudentRange,
  studentHasLessonAtStudio,
} from '../utils/taughtLessons.js';
import {
  listRooms,
  listClassSchedules,
  mapRoom,
  mapClassSchedule,
  roomBelongsToStudio,
  teacherBelongsToStudio,
  roomHasOverlap,
  normalizeWeekdays,
  fmtTime,
} from '../utils/classSchedules.js';
import {
  applyCancellationRequest,
  countPendingCancellationRequests,
  dismissCancellationRequest,
  fillCancellationRequest,
  listStudioCancellationRequests,
} from '../services/coachManagement.js';

export const ownerRouter = Router();

ownerRouter.use(requireRole('studio_owner'));

function shiftMonth(dateStr, delta) {
  const [y, m] = dateStr.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const ny = Math.floor(index / 12);
  const nm = index % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
}

function dashboardWindow(preset) {
  const today = todayISO();
  if (preset === '7d') return { from: addDays(today, -6), to: today, bucket: 'day', preset };
  if (preset === '7w') {
    return { from: addWeeks(getMonday(today), -6), to: today, bucket: 'week', preset };
  }
  if (preset === '7m') return { from: shiftMonth(today, -6), to: today, bucket: 'month', preset };
  return { from: `${today.slice(0, 4)}-01-01`, to: today, bucket: 'month', preset };
}

function bucketKey(date, bucket) {
  if (bucket === 'day') return date;
  if (bucket === 'week') return getMonday(date);
  return date.slice(0, 7);
}

function seriesKeys(from, to, bucket) {
  if (bucket === 'day') {
    const keys = [];
    for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  if (bucket === 'week') return weeksOverlappingRange(from, to).map((w) => w.monday);
  const keys = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const end = to.slice(0, 7);
  while (cursor.slice(0, 7) <= end) {
    keys.push(cursor.slice(0, 7));
    cursor = shiftMonth(cursor, 1);
  }
  return keys;
}

function seriesLabel(key, bucket, today) {
  if (bucket === 'month') {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    const opts = { month: 'short', timeZone: 'UTC' };
    if (String(y) !== today.slice(0, 4)) opts.year = '2-digit';
    return d.toLocaleDateString('en-US', opts);
  }
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const dashboardQuerySchema = z.object({
  preset: z.enum(['7d', '7w', '7m', 'ytd']).default('7d'),
});

const coachPresetSchema = z.enum(['today', 'week', 'month', 'ytd']);

/** Ranges end today so upcoming lessons stay out of coach totals. */
function coachWindow(preset) {
  const today = todayISO();
  if (preset === 'today') return { from: today, to: today, preset };
  if (preset === 'week') return { from: getMonday(today), to: today, preset };
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today, preset };
  return { from: `${today.slice(0, 4)}-01-01`, to: today, preset: 'ytd' };
}

/** How far back "last lesson" looks. Period totals still use coachWindow. */
function coachHistoryFrom(today) {
  return `${Number(today.slice(0, 4)) - 5}-01-01`;
}

async function loadFloorFeeRates(studioId) {
  const { rows } = await query(
    `SELECT floor_fee_percent, floor_fee_flat_cents,
            studio_student_floor_fee_percent, studio_student_floor_fee_cents
       FROM studios WHERE id = $1`,
    [studioId],
  );
  const studio = rows[0];
  if (!studio) throw new HttpError(404, 'Studio not found.');
  return {
    percent: Number(studio.floor_fee_percent) || 0,
    flat: Number(studio.floor_fee_flat_cents) || 0,
    studioStudentPercent: Number(studio.studio_student_floor_fee_percent) || 0,
    studioStudentFlat: Number(studio.studio_student_floor_fee_cents) || 0,
  };
}

function feeForLesson(lesson, studioStudentIds, rates) {
  const member = studioStudentIds.has(lesson.studentId);
  return expectedFloorFeeCents(
    lesson.priceCents,
    member ? rates.studioStudentPercent : rates.percent,
    member ? rates.studioStudentFlat : rates.flat,
  );
}

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
});

const studioSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().or(z.literal('')),
  floorFeePercent: z.number().min(0).max(100).optional(),
  floorFeeFlatCents: z.number().int().min(0).max(10_000_000).optional(),
  studioStudentFloorFeePercent: z.number().min(0).max(100).optional(),
  studioStudentFloorFeeCents: z.number().int().min(0).max(10_000_000).optional(),
});

const tierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().or(z.literal('')),
});

const tierPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional().or(z.literal('')),
});

const roomSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().or(z.literal('')),
});

const roomPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional().or(z.literal('')),
});

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day.')
  .max(7)
  .transform((days) => normalizeWeekdays(days))
  .refine((days) => days.length >= 1, 'Pick at least one day.');

const classSchema = z.object({
  name: z.string().min(1).max(120),
  weekdays: weekdaysSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM.'),
  durationMin: z.number().int().min(5).max(240),
  roomId: z.number().int().positive().nullable().optional(),
  teacherId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).optional().or(z.literal('')),
});

const classPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  weekdays: weekdaysSchema.optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM.').optional(),
  durationMin: z.number().int().min(5).max(240).optional(),
  roomId: z.number().int().positive().nullable().optional(),
  teacherId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).optional().or(z.literal('')),
});

async function ownerStudioId(userId) {
  const { rows } = await query('SELECT studio_id FROM studio_owners WHERE id = $1', [userId]);
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists.');
  return rows[0].studio_id;
}

async function loadStudioPayload(studioId) {
  const { rows: studioRows } = await query(
    `SELECT id, name, slug, description, floor_fee_percent, floor_fee_flat_cents,
            studio_student_floor_fee_percent, studio_student_floor_fee_cents
       FROM studios WHERE id = $1`,
    [studioId],
  );
  const studio = studioRows[0];
  if (!studio) throw new HttpError(404, 'Studio not found.');

  const { rows: teachers } = await query(
    `SELECT t.id, t.full_name, t.bio, t.is_active, ts.owner_managed,
            ct.id AS tier_id, ct.name AS tier_name
       FROM teachers t
       JOIN teacher_studios ts ON ts.teacher_id = t.id
       LEFT JOIN coach_tiers ct ON ct.id = ts.tier_id
      WHERE ts.studio_id = $1
      ORDER BY ct.sort_order NULLS LAST, ct.id NULLS LAST, t.full_name`,
    [studioId],
  );

  const [rooms, classSchedules, tiers] = await Promise.all([
    listRooms(studioId),
    listClassSchedules(studioId),
    listCoachTiers(studioId),
  ]);

  return {
    studio: {
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
      description: studio.description || null,
      floorFeePercent: Number(studio.floor_fee_percent) || 0,
      floorFeeFlatCents: Number(studio.floor_fee_flat_cents) || 0,
      studioStudentFloorFeePercent: Number(studio.studio_student_floor_fee_percent) || 0,
      studioStudentFloorFeeCents: Number(studio.studio_student_floor_fee_cents) || 0,
    },
    rooms,
    classSchedules,
    tiers,
    teachers: teachers.map((t) => ({
      id: t.id,
      fullName: t.full_name,
      bio: t.bio || null,
      isActive: t.is_active === true,
      ownerManaged: t.owner_managed === true,
      tierId: t.tier_id || null,
      tierName: t.tier_name || null,
    })),
    pendingCancellationCount: await countPendingCancellationRequests(studioId),
  };
}

async function assertClassRoomTeacher(studioId, roomId, teacherId) {
  if (roomId != null) {
    if (!(await roomBelongsToStudio(roomId, studioId))) {
      throw new HttpError(400, 'That room does not belong to this studio.');
    }
  }
  if (teacherId != null) {
    if (!(await teacherBelongsToStudio(teacherId, studioId))) {
      throw new HttpError(400, 'That instructor is not listed at this studio.');
    }
  }
}

ownerRouter.get(
  '/studio',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    res.json(await loadStudioPayload(studioId));
  }),
);

ownerRouter.patch(
  '/teachers/:teacherId/managed',
  asyncHandler(async (req, res) => {
    const teacherId = Number(req.params.teacherId);
    const { managed } = z.object({ managed: z.boolean() }).parse(req.body);
    if (!Number.isInteger(teacherId) || teacherId <= 0) {
      throw new HttpError(400, 'Invalid coach.');
    }
    const studioId = await ownerStudioId(req.user.id);
    const { rowCount } = await query(
      `UPDATE teacher_studios
          SET owner_managed = $1
        WHERE teacher_id = $2 AND studio_id = $3`,
      [managed, teacherId, studioId],
    );
    if (!rowCount) throw new HttpError(404, 'That coach is not at your studio.');
    res.json({ ok: true, ownerManaged: managed });
  }),
);

ownerRouter.patch(
  '/teachers/:teacherId/tier',
  asyncHandler(async (req, res) => {
    const teacherId = Number(req.params.teacherId);
    const { tierId } = z
      .object({ tierId: z.number().int().positive().nullable() })
      .parse(req.body);
    if (!Number.isInteger(teacherId) || teacherId <= 0) {
      throw new HttpError(400, 'Invalid coach.');
    }
    const studioId = await ownerStudioId(req.user.id);
    res.json(await assignCoachTier(studioId, teacherId, tierId));
  }),
);

ownerRouter.post(
  '/tiers',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const data = tierSchema.parse(req.body);
    const tier = await createCoachTier(studioId, data);
    res.status(201).json({ tier });
  }),
);

ownerRouter.patch(
  '/tiers/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const tierId = Number(req.params.id);
    if (!Number.isInteger(tierId) || tierId <= 0) throw new HttpError(400, 'Invalid tier.');
    const data = tierPatchSchema.parse(req.body);
    res.json({ tier: await updateCoachTier(studioId, tierId, data) });
  }),
);

ownerRouter.delete(
  '/tiers/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const tierId = Number(req.params.id);
    if (!Number.isInteger(tierId) || tierId <= 0) throw new HttpError(400, 'Invalid tier.');
    await deleteCoachTier(studioId, tierId);
    res.json({ ok: true });
  }),
);

ownerRouter.post(
  '/tiers/:id/move',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const tierId = Number(req.params.id);
    const { direction } = z.object({ direction: z.enum(['up', 'down']) }).parse(req.body);
    if (!Number.isInteger(tierId) || tierId <= 0) throw new HttpError(400, 'Invalid tier.');
    await moveCoachTier(studioId, tierId, direction);
    res.json({ ok: true });
  }),
);

ownerRouter.get(
  '/cancellation-requests',
  asyncHandler(async (req, res) => {
    res.json({ requests: await listStudioCancellationRequests(req.user.id) });
  }),
);

ownerRouter.post(
  '/cancellation-requests/:id/apply',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid request.');
    res.json(await applyCancellationRequest(req.user.id, id));
  }),
);

ownerRouter.post(
  '/cancellation-requests/:id/dismiss',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid request.');
    res.json(await dismissCancellationRequest(req.user.id, id));
  }),
);

ownerRouter.post(
  '/cancellation-requests/:id/fill',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { teacherId } = z.object({ teacherId: z.number().int().positive() }).parse(req.body);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid request.');
    res.json(await fillCancellationRequest(req.user.id, id, teacherId));
  }),
);

const lessonsRangeSchema = z.object({
  from: z.string().refine(isValidDateStr, 'from must be YYYY-MM-DD.'),
  to: z.string().refine(isValidDateStr, 'to must be YYYY-MM-DD.'),
});

const teacherLessonsQuerySchema = z
  .object({
    preset: coachPresetSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.preset) return;
    if (!val.from || !isValidDateStr(val.from)) {
      ctx.addIssue({ code: 'custom', message: 'from must be YYYY-MM-DD.', path: ['from'] });
    }
    if (!val.to || !isValidDateStr(val.to)) {
      ctx.addIssue({ code: 'custom', message: 'to must be YYYY-MM-DD.', path: ['to'] });
    }
  });

ownerRouter.get(
  '/coaches',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const preset = coachPresetSchema.default('week').parse(req.query.preset);
    const window = coachWindow(preset);
    const historyFrom = coachHistoryFrom(window.to);
    const payload = await loadStudioPayload(studioId);
    const rates = {
      percent: payload.studio.floorFeePercent,
      flat: payload.studio.floorFeeFlatCents,
      studioStudentPercent: payload.studio.studioStudentFloorFeePercent,
      studioStudentFlat: payload.studio.studioStudentFloorFeeCents,
    };
    const [lessons, studioStudentIds] = await Promise.all([
      listTaughtLessons({
        studioId,
        from: historyFrom < window.from ? historyFrom : window.from,
        to: window.to,
      }),
      loadStudioStudentIdSet(studioId),
    ]);

    const coaches = new Map(
      payload.teachers.map((t) => [
        t.id,
        {
          id: t.id,
          fullName: t.fullName,
          isActive: t.isActive,
          ownerManaged: t.ownerManaged === true,
          tierId: t.tierId || null,
          tierName: t.tierName || null,
          lessonCount: 0,
          floorFeeCents: 0,
          lastLessonDate: null,
        },
      ]),
    );

    for (const lesson of lessons) {
      const coach = coaches.get(lesson.teacherId);
      if (!coach) continue;
      if (!coach.lastLessonDate || lesson.lessonDate > coach.lastLessonDate) {
        coach.lastLessonDate = lesson.lessonDate;
      }
      if (lesson.lessonDate < window.from) continue;
      coach.lessonCount += 1;
      coach.floorFeeCents += feeForLesson(lesson, studioStudentIds, rates);
    }

    res.json({
      preset: window.preset,
      from: window.from,
      to: window.to,
      coaches: [...coaches.values()],
    });
  }),
);

ownerRouter.get(
  '/teachers/:teacherId/lessons',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const teacherId = Number(req.params.teacherId);
    if (!Number.isInteger(teacherId) || teacherId < 1) {
      throw new HttpError(400, 'Invalid instructor.');
    }
    if (!(await teacherBelongsToStudio(teacherId, studioId))) {
      throw new HttpError(404, 'That instructor is not listed at this studio.');
    }

    const parsed = teacherLessonsQuerySchema.parse(req.query);
    let from;
    let to;
    let preset = null;
    if (parsed.preset) {
      const window = coachWindow(parsed.preset);
      from = window.from;
      to = window.to;
      preset = window.preset;
    } else {
      from = parsed.from;
      to = parsed.to;
      if (from > to) {
        throw new HttpError(400, 'Start date must be on or before the end date.');
      }
      const fromMs = Date.parse(`${from}T12:00:00Z`);
      const toMs = Date.parse(`${to}T12:00:00Z`);
      if (toMs - fromMs > 40 * 24 * 60 * 60 * 1000) {
        throw new HttpError(400, 'Choose a week or a single month.');
      }
    }

    const { rows: teacherRows } = await query(
      'SELECT id, full_name, is_active FROM teachers WHERE id = $1',
      [teacherId],
    );
    const teacher = teacherRows[0];
    if (!teacher) throw new HttpError(404, 'Instructor not found.');

    const [lessons, studioStudentIds, rates] = await Promise.all([
      listTaughtLessons({ studioId, teacherId, from, to }),
      loadStudioStudentIdSet(studioId),
      loadFloorFeeRates(studioId),
    ]);
    let floorFeeCents = 0;
    const mapped = lessons.map((r) => {
      const fee = feeForLesson(r, studioStudentIds, rates);
      floorFeeCents += fee;
      return {
        lessonDate: r.lessonDate,
        weekday: weekdayOf(r.lessonDate),
        startTime: r.startTime,
        durationMin: r.durationMin,
        priceCents: r.priceCents,
        floorFeeCents: fee,
        kind: r.kind,
        student: {
          name: r.studentName,
          childName: r.childName,
        },
        paymentPartner: r.paymentPartnerName ? { name: r.paymentPartnerName } : null,
      };
    });

    res.json({
      teacher: {
        id: teacher.id,
        fullName: teacher.full_name,
        isActive: teacher.is_active === true,
      },
      preset,
      from,
      to,
      lessonCount: mapped.length,
      floorFeeCents,
      lessons: mapped,
    });
  }),
);

ownerRouter.patch(
  '/studio',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const data = studioSchema.parse(req.body);
    const sets = [];
    const values = [];
    let i = 1;
    if (data.name !== undefined) {
      sets.push(`name = $${i++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push(`description = $${i++}`);
      values.push(data.description || null);
    }
    if (data.floorFeePercent !== undefined) {
      sets.push(`floor_fee_percent = $${i++}`);
      values.push(data.floorFeePercent);
    }
    if (data.floorFeeFlatCents !== undefined) {
      sets.push(`floor_fee_flat_cents = $${i++}`);
      values.push(data.floorFeeFlatCents);
    }
    if (data.studioStudentFloorFeePercent !== undefined) {
      sets.push(`studio_student_floor_fee_percent = $${i++}`);
      values.push(data.studioStudentFloorFeePercent);
    }
    if (data.studioStudentFloorFeeCents !== undefined) {
      sets.push(`studio_student_floor_fee_cents = $${i++}`);
      values.push(data.studioStudentFloorFeeCents);
    }
    if (sets.length) {
      values.push(studioId);
      await query(`UPDATE studios SET ${sets.join(', ')} WHERE id = $${i}`, values);
    }
    res.json(await loadStudioPayload(studioId));
  }),
);

ownerRouter.get(
  '/floor-fees',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const { from, to } = lessonsRangeSchema.parse(req.query);
    if (from > to) {
      throw new HttpError(400, 'Start date must be on or before the end date.');
    }
    const fromMs = Date.parse(`${from}T12:00:00Z`);
    const toMs = Date.parse(`${to}T12:00:00Z`);
    if (toMs - fromMs > 40 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, 'Choose a week or a single month.');
    }

    const payload = await loadStudioPayload(studioId);
    const percent = payload.studio.floorFeePercent;
    const flatCents = payload.studio.floorFeeFlatCents;
    const studioStudentPercent = payload.studio.studioStudentFloorFeePercent;
    const studioStudentFlatCents = payload.studio.studioStudentFloorFeeCents;
    const lessons = await listTaughtLessons({ studioId, from, to });
    const studioStudentIds = await loadStudioStudentIdSet(studioId);

    const byTeacher = new Map(
      payload.teachers.map((t) => [
        t.id,
        {
          id: t.id,
          fullName: t.fullName,
          isActive: t.isActive,
          lessonCount: 0,
          revenueCents: 0,
          floorFeeCents: 0,
        },
      ]),
    );

    const weekBuckets = weeksOverlappingRange(from, to).map((w) => ({
      from: w.from,
      to: w.to,
      monday: w.monday,
      coaches: new Map(
        payload.teachers.map((t) => [t.id, { id: t.id, lessonCount: 0, floorFeeCents: 0 }]),
      ),
      totalCents: 0,
    }));

    for (const lesson of lessons) {
      const fee = studioStudentIds.has(lesson.studentId)
        ? expectedFloorFeeCents(lesson.priceCents, studioStudentPercent, studioStudentFlatCents)
        : expectedFloorFeeCents(lesson.priceCents, percent, flatCents);
      const coach = byTeacher.get(lesson.teacherId);
      if (coach) {
        coach.lessonCount += 1;
        coach.revenueCents += lesson.priceCents;
        coach.floorFeeCents += fee;
      }
      const week = weekBuckets.find((w) => lesson.lessonDate >= w.from && lesson.lessonDate <= w.to);
      if (week) {
        const row = week.coaches.get(lesson.teacherId);
        if (row) {
          row.lessonCount += 1;
          row.floorFeeCents += fee;
        }
        week.totalCents += fee;
      }
    }

    const coaches = [...byTeacher.values()];
    res.json({
      from,
      to,
      percent,
      flatCents,
      studioStudentFloorFeePercent: studioStudentPercent,
      studioStudentFloorFeeCents: studioStudentFlatCents,
      studioTotalCents: coaches.reduce((sum, c) => sum + c.floorFeeCents, 0),
      coaches,
      weeks: weekBuckets.map((w) => ({
        from: w.from,
        to: w.to,
        monday: w.monday,
        totalCents: w.totalCents,
        coaches: [...w.coaches.values()].filter((c) => c.lessonCount > 0),
      })),
    });
  }),
);

ownerRouter.get(
  '/recent-students',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const students = await listRecentStudioStudents(studioId);
    res.json({ students });
  }),
);

const attendanceSchema = z.object({
  attends: z.boolean(),
});

ownerRouter.patch(
  '/students/:studentId/attendance',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId < 1) {
      throw new HttpError(400, 'Invalid student.');
    }
    const { attends } = attendanceSchema.parse(req.body);
    if (!(await studentHasLessonAtStudio(studioId, studentId))) {
      throw new HttpError(400, 'That student has not taken a lesson at this studio.');
    }

    if (attends) {
      await query(
        `INSERT INTO studio_student_marks (studio_id, student_id)
         VALUES ($1, $2)
         ON CONFLICT (studio_id, student_id) DO NOTHING`,
        [studioId, studentId],
      );
    } else {
      await query(
        'DELETE FROM studio_student_marks WHERE studio_id = $1 AND student_id = $2',
        [studioId, studentId],
      );
    }

    const { rows } = await query(
      `SELECT home_studio_id = $1 AS selected_by_student,
              EXISTS (
                SELECT 1 FROM studio_student_marks m
                 WHERE m.studio_id = $1 AND m.student_id = $2
              ) AS marked_by_owner
         FROM students
        WHERE id = $2`,
      [studioId, studentId],
    );
    if (!rows[0]) throw new HttpError(404, 'Student not found.');
    const selectedByStudent = rows[0].selected_by_student === true;
    const markedByOwner = rows[0].marked_by_owner === true;
    res.json({
      studentId,
      markedByOwner,
      selectedByStudent,
      reducedFeeApplies: selectedByStudent || markedByOwner,
    });
  }),
);

ownerRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const { preset } = dashboardQuerySchema.parse(req.query);
    const window = dashboardWindow(preset);
    const payload = await loadStudioPayload(studioId);
    const lessons = await listTaughtLessons({ studioId, from: window.from, to: window.to });
    const studioStudentIds = await loadStudioStudentIdSet(studioId);
    const rates = {
      percent: payload.studio.floorFeePercent,
      flat: payload.studio.floorFeeFlatCents,
      memberPercent: payload.studio.studioStudentFloorFeePercent,
      memberFlat: payload.studio.studioStudentFloorFeeCents,
    };

    const keys = seriesKeys(window.from, window.to, window.bucket);
    const seriesMap = new Map(
      keys.map((key) => [
        key,
        { key, label: seriesLabel(key, window.bucket, window.to), lessons: 0, floorFeeCents: 0, studioStudentLessons: 0 },
      ]),
    );

    let floorFeeCents = 0;
    let revenueCents = 0;
    let studioStudentLessons = 0;
    const students = new Set();
    const coaches = new Set();

    for (const lesson of lessons) {
      const isMember = studioStudentIds.has(lesson.studentId);
      const fee = isMember
        ? expectedFloorFeeCents(lesson.priceCents, rates.memberPercent, rates.memberFlat)
        : expectedFloorFeeCents(lesson.priceCents, rates.percent, rates.flat);
      floorFeeCents += fee;
      revenueCents += lesson.priceCents;
      if (isMember) studioStudentLessons += 1;
      students.add(lesson.studentId);
      coaches.add(lesson.teacherId);
      const point = seriesMap.get(bucketKey(lesson.lessonDate, window.bucket));
      if (point) {
        point.lessons += 1;
        point.floorFeeCents += fee;
        if (isMember) point.studioStudentLessons += 1;
      }
    }

    res.json({
      preset,
      from: window.from,
      to: window.to,
      bucket: window.bucket,
      lessons: lessons.length,
      uniqueStudents: students.size,
      studioStudentLessons,
      guestLessons: lessons.length - studioStudentLessons,
      floorFeeCents,
      revenueCents,
      coachesTeaching: coaches.size,
      series: [...seriesMap.values()],
    });
  }),
);

ownerRouter.get(
  '/studio-students',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const { rows } = await query(
      `SELECT s.id, s.full_name, s.email, s.phone,
              s.home_studio_id = $1 AS selected_by_student,
              EXISTS (
                SELECT 1 FROM studio_student_marks m
                 WHERE m.studio_id = $1 AND m.student_id = s.id
              ) AS marked_by_owner
         FROM students s
        WHERE s.home_studio_id = $1
           OR EXISTS (
             SELECT 1 FROM studio_student_marks m
              WHERE m.studio_id = $1 AND m.student_id = s.id
           )
        ORDER BY s.full_name`,
      [studioId],
    );
    const { from, to } = recentStudentRange();
    const lessons = await listTaughtLessons({ studioId, from, to });
    const latest = new Map();
    for (const lesson of lessons) {
      const prev = latest.get(lesson.studentId);
      if (!prev || lesson.lessonDate > prev.lessonDate) latest.set(lesson.studentId, lesson);
    }
    res.json({
      students: rows.map((r) => {
        const last = latest.get(r.id);
        return {
          studentId: r.id,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone || null,
          selectedByStudent: r.selected_by_student === true,
          markedByOwner: r.marked_by_owner === true,
          lastLessonDate: last?.lessonDate || null,
          childName: last?.childName || null,
        };
      }),
    });
  }),
);

ownerRouter.post(
  '/students/:studentId/deactivate',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId < 1) {
      throw new HttpError(400, 'Invalid student.');
    }
    const { rows } = await query(
      `SELECT home_studio_id = $1 AS selected_by_student,
              EXISTS (
                SELECT 1 FROM studio_student_marks m
                 WHERE m.studio_id = $1 AND m.student_id = $2
              ) AS marked_by_owner
         FROM students
        WHERE id = $2`,
      [studioId, studentId],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Student not found.');
    if (row.selected_by_student !== true && row.marked_by_owner !== true) {
      throw new HttpError(400, 'That person is not a student of this studio.');
    }
    await query(
      'DELETE FROM studio_student_marks WHERE studio_id = $1 AND student_id = $2',
      [studioId, studentId],
    );
    if (row.selected_by_student === true) {
      await query(
        'UPDATE students SET home_studio_id = NULL WHERE id = $1 AND home_studio_id = $2',
        [studentId, studioId],
      );
    }
    res.json({ studentId, active: false });
  }),
);

ownerRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const sets = [];
    const values = [];
    let i = 1;
    if (data.fullName !== undefined) {
      sets.push(`full_name = $${i++}`);
      values.push(data.fullName);
    }
    if (data.phone !== undefined) {
      sets.push(`phone = $${i++}`);
      values.push(data.phone || null);
    }
    if (!sets.length) {
      const { rows } = await query('SELECT * FROM studio_owners WHERE id = $1', [req.user.id]);
      return res.json({ owner: mapOwner(rows[0]) });
    }
    values.push(req.user.id);
    const { rows } = await query(
      `UPDATE studio_owners SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    res.json({ owner: mapOwner(rows[0]) });
  }),
);

function mapOwner(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || null,
    studioId: row.studio_id,
  };
}

ownerRouter.post(
  '/rooms',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const data = roomSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO rooms (studio_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, studio_id, name, description`,
      [studioId, data.name.trim(), data.description || null],
    );
    res.status(201).json({ room: mapRoom(rows[0]) });
  }),
);

ownerRouter.patch(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const roomId = Number(req.params.id);
    if (!(await roomBelongsToStudio(roomId, studioId))) {
      throw new HttpError(404, 'Room not found.');
    }
    const data = roomPatchSchema.parse(req.body);
    const sets = [];
    const values = [];
    let i = 1;
    if (data.name !== undefined) {
      sets.push(`name = $${i++}`);
      values.push(data.name.trim());
    }
    if (data.description !== undefined) {
      sets.push(`description = $${i++}`);
      values.push(data.description || null);
    }
    if (!sets.length) {
      const { rows } = await query(
        'SELECT id, studio_id, name, description FROM rooms WHERE id = $1',
        [roomId],
      );
      return res.json({ room: mapRoom(rows[0]) });
    }
    values.push(roomId);
    const { rows } = await query(
      `UPDATE rooms SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, studio_id, name, description`,
      values,
    );
    res.json({ room: mapRoom(rows[0]) });
  }),
);

ownerRouter.delete(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const roomId = Number(req.params.id);
    const { rows } = await query('DELETE FROM rooms WHERE id = $1 AND studio_id = $2 RETURNING id', [
      roomId,
      studioId,
    ]);
    if (!rows[0]) throw new HttpError(404, 'Room not found.');
    res.json({ ok: true });
  }),
);

ownerRouter.post(
  '/classes',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const data = classSchema.parse(req.body);
    const roomId = data.roomId ?? null;
    const teacherId = data.teacherId ?? null;
    await assertClassRoomTeacher(studioId, roomId, teacherId);

    if (
      await roomHasOverlap({
        studioId,
        roomId,
        weekdays: data.weekdays,
        startTime: data.startTime,
        durationMin: data.durationMin,
      })
    ) {
      throw new HttpError(409, 'That room already has a class overlapping this time.');
    }

    const { rows } = await query(
      `INSERT INTO class_schedules (
         studio_id, room_id, teacher_id, name, weekdays, start_time, duration_min, description
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        studioId,
        roomId,
        teacherId,
        data.name.trim(),
        data.weekdays,
        data.startTime,
        data.durationMin,
        data.description || null,
      ],
    );
    const { rows: full } = await query(
      `SELECT cs.id, cs.studio_id, cs.room_id, cs.teacher_id, cs.name,
              cs.weekdays, cs.start_time, cs.duration_min, cs.description,
              r.name AS room_name, t.full_name AS teacher_name
         FROM class_schedules cs
         LEFT JOIN rooms r ON r.id = cs.room_id
         LEFT JOIN teachers t ON t.id = cs.teacher_id
        WHERE cs.id = $1`,
      [rows[0].id],
    );
    res.status(201).json({ classSchedule: mapClassSchedule(full[0]) });
  }),
);

ownerRouter.patch(
  '/classes/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const classId = Number(req.params.id);
    const { rows: existingRows } = await query(
      `SELECT * FROM class_schedules WHERE id = $1 AND studio_id = $2`,
      [classId, studioId],
    );
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Class not found.');

    const data = classPatchSchema.parse(req.body);
    const name = data.name !== undefined ? data.name.trim() : existing.name;
    const weekdays =
      data.weekdays !== undefined ? data.weekdays : normalizeWeekdays(existing.weekdays);
    const startTime =
      data.startTime !== undefined ? data.startTime : fmtTime(existing.start_time);
    const durationMin = data.durationMin !== undefined ? data.durationMin : existing.duration_min;
    const roomId = data.roomId !== undefined ? data.roomId : existing.room_id;
    const teacherId = data.teacherId !== undefined ? data.teacherId : existing.teacher_id;
    const description =
      data.description !== undefined ? data.description || null : existing.description;

    await assertClassRoomTeacher(studioId, roomId, teacherId);

    if (
      await roomHasOverlap({
        studioId,
        roomId,
        weekdays,
        startTime,
        durationMin,
        excludeId: classId,
      })
    ) {
      throw new HttpError(409, 'That room already has a class overlapping this time.');
    }

    await query(
      `UPDATE class_schedules
          SET name = $1, weekdays = $2, start_time = $3, duration_min = $4,
              room_id = $5, teacher_id = $6, description = $7
        WHERE id = $8`,
      [name, weekdays, startTime, durationMin, roomId, teacherId, description, classId],
    );

    const { rows: full } = await query(
      `SELECT cs.id, cs.studio_id, cs.room_id, cs.teacher_id, cs.name,
              cs.weekdays, cs.start_time, cs.duration_min, cs.description,
              r.name AS room_name, t.full_name AS teacher_name
         FROM class_schedules cs
         LEFT JOIN rooms r ON r.id = cs.room_id
         LEFT JOIN teachers t ON t.id = cs.teacher_id
        WHERE cs.id = $1`,
      [classId],
    );
    res.json({ classSchedule: mapClassSchedule(full[0]) });
  }),
);

ownerRouter.delete(
  '/classes/:id',
  asyncHandler(async (req, res) => {
    const studioId = await ownerStudioId(req.user.id);
    const classId = Number(req.params.id);
    const { rows } = await query(
      'DELETE FROM class_schedules WHERE id = $1 AND studio_id = $2 RETURNING id',
      [classId, studioId],
    );
    if (!rows[0]) throw new HttpError(404, 'Class not found.');
    res.json({ ok: true });
  }),
);
