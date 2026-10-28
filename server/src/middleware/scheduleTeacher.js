import { query } from '../db.js';
import { HttpError } from './error.js';

/**
 * Teacher id whose schedule this request may read or edit.
 * Studio owners must pass ?teacherId= for a coach they currently manage.
 */
export async function resolveScheduleTeacherId(req) {
  if (!req.user) throw new HttpError(401, 'Authentication required.');
  if (req.user.role === 'teacher') return req.user.id;
  if (req.user.role === 'studio_owner') {
    const teacherId = Number(req.query.teacherId);
    if (!Number.isInteger(teacherId) || teacherId <= 0) {
      throw new HttpError(400, 'Choose a managed coach.');
    }
    const { rows } = await query(
      `SELECT ts.owner_managed
         FROM teacher_studios ts
         JOIN studio_owners so ON so.studio_id = ts.studio_id
        WHERE ts.teacher_id = $1 AND so.id = $2`,
      [teacherId, req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'That coach is not at your studio.');
    if (rows[0].owner_managed !== true) {
      throw new HttpError(403, 'Turn on Manage before editing this coach’s schedule.');
    }
    return teacherId;
  }
  throw new HttpError(403, 'You do not have access to this resource.');
}

export function requireScheduleTeacher(req, res, next) {
  resolveScheduleTeacherId(req)
    .then((id) => {
      req.scheduleTeacherId = id;
      next();
    })
    .catch(next);
}

/** True when this caller may act as the teacher who owns `teacherId`. */
export async function isScheduleTeacher(req, teacherId) {
  if (!req.user || teacherId == null) return false;
  if (req.user.role === 'teacher') return req.user.id === teacherId;
  if (req.user.role !== 'studio_owner') return false;
  const managedId = await resolveScheduleTeacherId(req);
  return managedId === teacherId;
}
