import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

export const studiosRouter = Router();

function mapStudio(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    instructorCount: Number(row.instructor_count ?? 0),
  };
}

function mapTeacher(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    bio: row.bio,
    defaultPriceCents: row.default_price_cents,
    defaultDurationMin: row.default_duration_min,
    activeSlots: Number(row.active_slots),
  };
}

studiosRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.description,
              COUNT(DISTINCT ts.teacher_id) AS instructor_count
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
        GROUP BY s.id
        ORDER BY s.name`,
    );
    res.json({ studios: rows.map(mapStudio) });
  }),
);

studiosRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const { rows: studioRows } = await query(
      `SELECT s.id, s.name, s.slug, s.description,
              COUNT(DISTINCT ts.teacher_id) AS instructor_count
         FROM studios s
         LEFT JOIN teacher_studios ts ON ts.studio_id = s.id
        WHERE s.slug = $1
        GROUP BY s.id`,
      [req.params.slug],
    );
    const studio = studioRows[0];
    if (!studio) throw new HttpError(404, 'Studio not found.');

    const { rows: teachers } = await query(
      `SELECT t.id, t.full_name, t.bio, t.default_price_cents, t.default_duration_min,
              COUNT(sl.id) FILTER (WHERE sl.active) AS active_slots
         FROM teachers t
         JOIN teacher_studios ts ON ts.teacher_id = t.id
         LEFT JOIN slots sl ON sl.teacher_id = t.id
        WHERE ts.studio_id = $1
        GROUP BY t.id
        ORDER BY t.full_name`,
      [studio.id],
    );

    res.json({
      studio: mapStudio(studio),
      teachers: teachers.map(mapTeacher),
    });
  }),
);
