import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { resolveBookerStudentId } from '../utils/booker.js';
import {
  allocatePartnerCode,
  listChildPartnerCodes,
  listPartners,
  MAX_PARTNERS,
  normalizePartnerCode,
  orderedPair,
  partnerCount,
  syncChildPartnerCodes,
} from '../utils/partners.js';

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
    const student = rows[0];
    if (data.isParent !== undefined || data.childrenNames !== undefined) {
      await syncChildPartnerCodes(
        student.id,
        student.is_parent ? student.children_names : [],
      );
    }
    res.json({ student: mapStudent(student) });
  }),
);

const addPartnerSchema = z.object({
  code: z.string().min(1).max(32),
});

async function partnersPayload(studentId) {
  const { rows } = await query(
    'SELECT partner_code, is_parent, children_names FROM students WHERE id = $1',
    [studentId],
  );
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists.');
  const isParent = rows[0].is_parent === true;
  if (isParent) {
    await syncChildPartnerCodes(studentId, rows[0].children_names);
  }
  return {
    isParent,
    partnerCode: isParent ? null : rows[0].partner_code,
    childPartnerCodes: isParent ? await listChildPartnerCodes(studentId) : [],
    partners: await listPartners(studentId),
  };
}

studentsRouter.get(
  '/me/partners',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    res.json(await partnersPayload(studentId));
  }),
);

studentsRouter.post(
  '/me/partners',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const code = normalizePartnerCode(addPartnerSchema.parse(req.body).code);
    if (code.length !== 8) {
      throw new HttpError(400, 'Enter a valid 8-character partner code.');
    }

    const { rows: mine } = await query(
      'SELECT partner_code, is_parent FROM students WHERE id = $1',
      [studentId],
    );
    if (!mine[0]) throw new HttpError(401, 'Account no longer exists.');
    if (mine[0].partner_code === code) {
      throw new HttpError(400, 'That is your own partner code.');
    }
    const { rows: ownChildCode } = await query(
      'SELECT 1 FROM child_partner_codes WHERE student_id = $1 AND partner_code = $2',
      [studentId, code],
    );
    if (ownChildCode[0]) {
      throw new HttpError(400, 'That is your own partner code.');
    }

    const { rows: childCodeRows } = await query(
      'SELECT student_id, child_name FROM child_partner_codes WHERE partner_code = $1',
      [code],
    );

    let otherId;
    let scopedOwnerId = null;
    let scopedChildName = null;
    if (childCodeRows[0]) {
      otherId = childCodeRows[0].student_id;
      scopedOwnerId = childCodeRows[0].student_id;
      scopedChildName = childCodeRows[0].child_name;
    } else {
      const { rows: otherRows } = await query(
        'SELECT id, is_parent FROM students WHERE partner_code = $1',
        [code],
      );
      const other = otherRows[0];
      if (!other) throw new HttpError(404, 'No student has that partner code.');
      if (other.is_parent) {
        throw new HttpError(
          400,
          'Use a child’s partner code to share that child’s lessons.',
        );
      }
      otherId = other.id;
    }

    const [a, b] = orderedPair(studentId, otherId);
    const { rows: existing } = scopedChildName
      ? await query(
          `SELECT id FROM student_partners
            WHERE student_a_id = $1 AND student_b_id = $2 AND scoped_child_name = $3`,
          [a, b, scopedChildName],
        )
      : await query(
          `SELECT id FROM student_partners
            WHERE student_a_id = $1 AND student_b_id = $2 AND scoped_child_name IS NULL`,
          [a, b],
        );
    if (existing[0]) {
      throw new HttpError(409, 'You are already partners with this student.');
    }

    const myCount = await partnerCount(studentId);
    const theirCount = await partnerCount(otherId);
    if (myCount >= MAX_PARTNERS || theirCount >= MAX_PARTNERS) {
      throw new HttpError(400, `You can have at most ${MAX_PARTNERS} partners.`);
    }

    await query(
      `INSERT INTO student_partners
         (student_a_id, student_b_id, scoped_owner_id, scoped_child_name)
       VALUES ($1, $2, $3, $4)`,
      [a, b, scopedOwnerId, scopedChildName],
    );
    res.status(201).json(await partnersPayload(studentId));
  }),
);

studentsRouter.delete(
  '/me/partners/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const linkId = Number(req.params.id);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      throw new HttpError(400, 'Invalid partner.');
    }
    const { rows } = await query(
      `DELETE FROM student_partners
        WHERE id = $1 AND (student_a_id = $2 OR student_b_id = $2)
      RETURNING id`,
      [linkId, studentId],
    );
    if (!rows[0]) throw new HttpError(404, 'That partner is not on your list.');
    res.json(await partnersPayload(studentId));
  }),
);

const regenSchema = z.object({
  childName: z.string().min(1).max(120).optional(),
});

studentsRouter.post(
  '/me/partner-code/regenerate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = await resolveBookerStudentId(req.user);
    const { childName } = regenSchema.parse(req.body || {});
    const { rows } = await query(
      'SELECT is_parent, children_names FROM students WHERE id = $1',
      [studentId],
    );
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists.');

    if (childName) {
      if (!rows[0].is_parent) {
        throw new HttpError(400, 'Only parent accounts have per-child partner codes.');
      }
      const children = normalizeChildrenNames(rows[0].children_names);
      const match = children.find((c) => c.toLowerCase() === childName.trim().toLowerCase());
      if (!match) throw new HttpError(404, 'That child is not on your profile.');
      const code = await allocatePartnerCode();
      const { rows: updated } = await query(
        `UPDATE child_partner_codes
            SET partner_code = $1
          WHERE student_id = $2 AND lower(child_name) = lower($3)
        RETURNING id`,
        [code, studentId, match],
      );
      if (!updated[0]) {
        await syncChildPartnerCodes(studentId, children);
        await query(
          `UPDATE child_partner_codes
              SET partner_code = $1
            WHERE student_id = $2 AND lower(child_name) = lower($3)`,
          [code, studentId, match],
        );
      }
      res.json(await partnersPayload(studentId));
      return;
    }

    if (rows[0].is_parent) {
      throw new HttpError(400, 'Parent accounts share a partner code per child.');
    }
    const code = await allocatePartnerCode();
    await query('UPDATE students SET partner_code = $1 WHERE id = $2', [code, studentId]);
    res.json(await partnersPayload(studentId));
  }),
);
