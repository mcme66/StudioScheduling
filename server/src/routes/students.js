import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { resolveBookerStudentId } from '../utils/booker.js';

export const studentsRouter = Router();

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
  receiveEmails: z.boolean().optional(),
  isParent: z.boolean().optional(),
  childrenNames: z.array(z.string().max(120)).max(20).optional(),
});

/** Trim, drop blanks, de-dupe (case-insensitive) while preserving first spelling. */
export function normalizeChildrenNames(names) {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function mapStudent(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || null,
    receiveEmails: row.receive_emails !== false,
    isParent: row.is_parent === true,
    childrenNames: Array.isArray(row.children_names) ? row.children_names : [],
  };
}

studentsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Students, or teachers with “Student as well?” enabled (linked student row).
    const studentId = await resolveBookerStudentId(req.user);
    const { rows } = await query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists.');
    res.json({ student: mapStudent(rows[0]) });
  }),
);

studentsRouter.patch(
  '/me',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(data.fullName);
    }
    if (data.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(data.phone === '' ? null : data.phone);
    }
    if (data.receiveEmails !== undefined) {
      fields.push(`receive_emails = $${idx++}`);
      values.push(data.receiveEmails);
    }
    if (data.isParent !== undefined) {
      fields.push(`is_parent = $${idx++}`);
      values.push(data.isParent);
      // Turning parent mode off clears the children list.
      if (!data.isParent && data.childrenNames === undefined) {
        fields.push(`children_names = $${idx++}`);
        values.push([]);
      }
    }
    if (data.childrenNames !== undefined) {
      fields.push(`children_names = $${idx++}`);
      values.push(normalizeChildrenNames(data.childrenNames));
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    values.push(req.user.id);
    const { rows } = await query(
      `UPDATE students SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    res.json({ student: mapStudent(rows[0]) });
  }),
);
