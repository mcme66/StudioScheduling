import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
  receiveEmails: z.boolean().optional(),
});

function mapStudent(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || null,
    receiveEmails: row.receive_emails !== false,
  };
}

studentsRouter.get(
  '/me',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM students WHERE id = $1', [req.user.id]);
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
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    values.push(req.user.id);
    const { rows } = await query(
      `UPDATE students SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    res.json({ student: mapStudent(rows[0]) });
  }),
);
