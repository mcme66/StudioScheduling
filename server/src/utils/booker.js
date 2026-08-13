import { query } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { allocatePartnerCode } from './partners.js';

/**
 * Ensure a teacher who can book as a student has a students row with the same
 * email (creating or refreshing it). Returns the student id.
 */
export async function ensureLinkedStudentForTeacher(teacherId) {
  const { rows: teacherRows } = await query('SELECT * FROM teachers WHERE id = $1', [teacherId]);
  const teacher = teacherRows[0];
  if (!teacher) throw new HttpError(401, 'Account no longer exists.');

  const { rows: existing } = await query('SELECT id FROM students WHERE email = $1', [
    teacher.email,
  ]);
  if (existing[0]) {
    await query(
      `UPDATE students
          SET password_hash = $1, full_name = $2, phone = $3
        WHERE id = $4`,
      [teacher.password_hash, teacher.full_name, teacher.phone, existing[0].id],
    );
    return existing[0].id;
  }

  const partnerCode = await allocatePartnerCode();
  const { rows: created } = await query(
    `INSERT INTO students (email, password_hash, full_name, phone, partner_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [teacher.email, teacher.password_hash, teacher.full_name, teacher.phone, partnerCode],
  );
  return created[0].id;
}

/**
 * Resolve the students.id used for bookings / my-lessons for the current user.
 * Teachers must have can_book_as_student enabled.
 */
export async function resolveBookerStudentId(user) {
  if (!user) throw new HttpError(401, 'Authentication required.');

  if (user.role === 'student') return user.id;

  if (user.role === 'teacher') {
    const { rows } = await query(
      'SELECT id, email, can_book_as_student FROM teachers WHERE id = $1',
      [user.id],
    );
    const teacher = rows[0];
    if (!teacher) throw new HttpError(401, 'Account no longer exists.');
    if (!teacher.can_book_as_student) {
      throw new HttpError(403, 'Enable “Student as well?” on your profile to book lessons.');
    }
    return ensureLinkedStudentForTeacher(teacher.id);
  }

  throw new HttpError(403, 'Only students can book lessons.');
}

export async function tryResolveBookerStudentId(user) {
  if (!user) return null;
  try {
    return await resolveBookerStudentId(user);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 401)) return null;
    throw err;
  }
}
