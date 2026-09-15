import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { isValidDateStr, weekdayOf } from '../utils/week.js';
import {
  listTaughtLessons,
  expectedFloorFeeCents,
  weeksOverlappingRange,
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

export const ownerRouter = Router();

ownerRouter.use(requireRole('studio_owner'));

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
});

const studioSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().or(z.literal('')),
  floorFeePercent: z.number().min(0).max(100).optional(),
  floorFeeFlatCents: z.number().int().min(0).max(10_000_000).optional(),
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
    `SELECT id, name, slug, description, floor_fee_percent, floor_fee_flat_cents
       FROM studios WHERE id = $1`,
    [studioId],
  );
  const studio = studioRows[0];
  if (!studio) throw new HttpError(404, 'Studio not found.');

  const { rows: teachers } = await query(
    `SELECT t.id, t.full_name, t.bio, t.is_active
       FROM teachers t
       JOIN teacher_studios ts ON ts.teacher_id = t.id
      WHERE ts.studio_id = $1
      ORDER BY t.full_name`,
    [studioId],
  );

  const [rooms, classSchedules] = await Promise.all([
    listRooms(studioId),
    listClassSchedules(studioId),
  ]);

  return {
    studio: {
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
      description: studio.description || null,
      floorFeePercent: Number(studio.floor_fee_percent) || 0,
      floorFeeFlatCents: Number(studio.floor_fee_flat_cents) || 0,
    },
    rooms,
    classSchedules,
    teachers: teachers.map((t) => ({
      id: t.id,
      fullName: t.full_name,
      bio: t.bio || null,
      isActive: t.is_active === true,
    })),
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

const lessonsRangeSchema = z.object({
  from: z.string().refine(isValidDateStr, 'from must be YYYY-MM-DD.'),
  to: z.string().refine(isValidDateStr, 'to must be YYYY-MM-DD.'),
});

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

    const { from, to } = lessonsRangeSchema.parse(req.query);
    if (from > to) {
      throw new HttpError(400, 'Start date must be on or before the end date.');
    }
    const fromMs = Date.parse(`${from}T12:00:00Z`);
    const toMs = Date.parse(`${to}T12:00:00Z`);
    if (toMs - fromMs > 40 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, 'Choose a week or a single month.');
    }

    const { rows: teacherRows } = await query(
      'SELECT id, full_name, is_active FROM teachers WHERE id = $1',
      [teacherId],
    );
    const teacher = teacherRows[0];
    if (!teacher) throw new HttpError(404, 'Instructor not found.');

    const lessons = await listTaughtLessons({ studioId, teacherId, from, to });

    res.json({
      teacher: {
        id: teacher.id,
        fullName: teacher.full_name,
        isActive: teacher.is_active === true,
      },
      from,
      to,
      lessons: lessons.map((r) => ({
        lessonDate: r.lessonDate,
        weekday: weekdayOf(r.lessonDate),
        startTime: r.startTime,
        durationMin: r.durationMin,
        priceCents: r.priceCents,
        kind: r.kind,
        student: {
          name: r.studentName,
          childName: r.childName,
        },
        paymentPartner: r.paymentPartnerName ? { name: r.paymentPartnerName } : null,
      })),
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
    const lessons = await listTaughtLessons({ studioId, from, to });

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
      const fee = expectedFloorFeeCents(lesson.priceCents, percent, flatCents);
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
