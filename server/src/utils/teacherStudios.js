import { query } from '../db.js';

export function mapStudioRow(row) {
  return { id: row.id, name: row.name, slug: row.slug };
}

export async function getTeacherStudios(teacherId) {
  const { rows } = await query(
    `SELECT s.id, s.name, s.slug
       FROM studios s
       JOIN teacher_studios ts ON ts.studio_id = s.id
      WHERE ts.teacher_id = $1
      ORDER BY s.name`,
    [teacherId],
  );
  return rows.map(mapStudioRow);
}

export async function teacherListedAtStudio(teacherId, studioSlug) {
  const { rows } = await query(
    `SELECT s.id, s.name, s.slug
       FROM studios s
       JOIN teacher_studios ts ON ts.studio_id = s.id
      WHERE ts.teacher_id = $1 AND s.slug = $2`,
    [teacherId, studioSlug],
  );
  return rows[0] ? mapStudioRow(rows[0]) : null;
}
