import { query } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { expectedFloorFeeCents } from './taughtLessons.js';

export async function loadFloorFeeRates(studioId, run = query) {
  const [{ rows }, { rows: exemptRows }] = await Promise.all([
    run(
      `SELECT floor_fee_percent, floor_fee_flat_cents,
              studio_student_floor_fee_percent, studio_student_floor_fee_cents
         FROM studios WHERE id = $1`,
      [studioId],
    ),
    run(
      'SELECT teacher_id FROM teacher_studios WHERE studio_id = $1 AND floor_fee_exempt = true',
      [studioId],
    ),
  ]);
  const studio = rows[0];
  if (!studio) throw new HttpError(404, 'Studio not found.');
  return {
    percent: Number(studio.floor_fee_percent) || 0,
    flat: Number(studio.floor_fee_flat_cents) || 0,
    studioStudentPercent: Number(studio.studio_student_floor_fee_percent) || 0,
    studioStudentFlat: Number(studio.studio_student_floor_fee_cents) || 0,
    exemptTeacherIds: new Set(exemptRows.map((r) => r.teacher_id)),
  };
}

/** Floor fee for one lesson; studio students use the reduced pair of rates. Exempt coaches pay none. */
export function feeForLesson(lesson, studioStudentIds, rates) {
  if (rates.exemptTeacherIds?.has(lesson.teacherId)) return 0;
  const member = studioStudentIds.has(lesson.studentId);
  return expectedFloorFeeCents(
    lesson.priceCents,
    member ? rates.studioStudentPercent : rates.percent,
    member ? rates.studioStudentFlat : rates.flat,
  );
}
