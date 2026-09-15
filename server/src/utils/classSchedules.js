import { query } from '../db.js';

export function fmtTime(t) {
  return typeof t === 'string' ? t.slice(0, 5) : t;
}

export function mapRoom(row) {
  return {
    id: row.id,
    studioId: row.studio_id,
    name: row.name,
    description: row.description || null,
  };
}

export function normalizeWeekdays(days) {
  const unique = [...new Set((days || []).map(Number).filter((d) => d >= 0 && d <= 6))];
  unique.sort((a, b) => a - b);
  return unique;
}

export function mapClassSchedule(row) {
  const weekdays = normalizeWeekdays(row.weekdays);
  return {
    id: row.id,
    studioId: row.studio_id,
    roomId: row.room_id || null,
    roomName: row.room_name || null,
    teacherId: row.teacher_id || null,
    teacherName: row.teacher_name || null,
    name: row.name,
    weekdays,
    startTime: fmtTime(row.start_time),
    durationMin: row.duration_min,
    description: row.description || null,
  };
}

export async function listRooms(studioId) {
  const { rows } = await query(
    `SELECT id, studio_id, name, description
       FROM rooms
      WHERE studio_id = $1
      ORDER BY name`,
    [studioId],
  );
  return rows.map(mapRoom);
}

export async function listClassSchedules(studioId) {
  const { rows } = await query(
    `SELECT cs.id, cs.studio_id, cs.room_id, cs.teacher_id, cs.name,
            cs.weekdays, cs.start_time, cs.duration_min, cs.description,
            r.name AS room_name, t.full_name AS teacher_name
       FROM class_schedules cs
       LEFT JOIN rooms r ON r.id = cs.room_id
       LEFT JOIN teachers t ON t.id = cs.teacher_id
      WHERE cs.studio_id = $1
      ORDER BY cs.start_time, cs.name`,
    [studioId],
  );
  return rows.map(mapClassSchedule);
}

export async function roomBelongsToStudio(roomId, studioId) {
  const { rows } = await query('SELECT id FROM rooms WHERE id = $1 AND studio_id = $2', [
    roomId,
    studioId,
  ]);
  return Boolean(rows[0]);
}

export async function teacherBelongsToStudio(teacherId, studioId) {
  const { rows } = await query(
    `SELECT 1 FROM teacher_studios WHERE teacher_id = $1 AND studio_id = $2`,
    [teacherId, studioId],
  );
  return Boolean(rows[0]);
}

/**
 * True if another class in the same room on any shared weekday overlaps the given window.
 * Classes without a room are not checked against each other.
 */
export async function roomHasOverlap({
  studioId,
  roomId,
  weekdays,
  startTime,
  durationMin,
  excludeId = null,
}) {
  if (!roomId) return false;
  const days = normalizeWeekdays(weekdays);
  if (!days.length) return false;
  const { rows } = await query(
    `SELECT id FROM class_schedules
      WHERE studio_id = $1
        AND room_id = $2
        AND weekdays && $3::smallint[]
        AND ($4::int IS NULL OR id <> $4)
        AND start_time < ($5::time + make_interval(mins => $6))
        AND (start_time + make_interval(mins => duration_min)) > $5::time`,
    [studioId, roomId, days, excludeId, startTime, durationMin],
  );
  return Boolean(rows[0]);
}
