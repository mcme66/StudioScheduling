import crypto from 'node:crypto';
import { query } from '../db.js';
import { HttpError } from '../middleware/error.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
export const MAX_PARTNERS = 20;

export function generatePartnerCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function normalizePartnerCode(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Allocate a code that is not already used. `run` is query or client.query. */
export async function allocatePartnerCode(run = query) {
  for (let i = 0; i < 16; i++) {
    const code = generatePartnerCode();
    const { rows: studentRows } = await run(
      'SELECT 1 FROM students WHERE partner_code = $1 LIMIT 1',
      [code],
    );
    if (studentRows[0]) continue;
    const { rows: childRows } = await run(
      'SELECT 1 FROM child_partner_codes WHERE partner_code = $1 LIMIT 1',
      [code],
    );
    if (!childRows[0]) return code;
  }
  throw new HttpError(500, 'Could not generate a partner code.');
}

export function orderedPair(id1, id2) {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

export async function partnerLinksFor(studentId, run = query) {
  const { rows } = await run(
    `SELECT id,
            CASE WHEN student_a_id = $1 THEN student_b_id ELSE student_a_id END AS partner_id,
            scoped_owner_id, scoped_child_name
       FROM student_partners
      WHERE student_a_id = $1 OR student_b_id = $1`,
    [studentId],
  );
  return rows.map((r) => ({
    linkId: r.id,
    partnerId: r.partner_id,
    scopedOwnerId: r.scoped_owner_id,
    scopedChildName: r.scoped_child_name || null,
  }));
}

export async function partnerIdsFor(studentId, run = query) {
  const links = await partnerLinksFor(studentId, run);
  return [...new Set(links.map((l) => l.partnerId))];
}

/** Whether a partner link lets `viewerId` see this lesson. Own lessons always pass. */
export function partnerCoversLesson(links, viewerId, lessonStudentId, lessonChildName) {
  if (lessonStudentId === viewerId) return true;
  const child = lessonChildName || null;
  return links.some((l) => {
    if (l.partnerId !== lessonStudentId) return false;
    if (!l.scopedChildName) return true;
    return child != null && l.scopedChildName.toLowerCase() === child.toLowerCase();
  });
}

export async function listPartners(studentId, run = query) {
  const { rows } = await run(
    `SELECT sp.id AS link_id, s.id, s.full_name, sp.scoped_child_name
       FROM student_partners sp
       JOIN students s
         ON s.id = CASE WHEN sp.student_a_id = $1 THEN sp.student_b_id ELSE sp.student_a_id END
      WHERE sp.student_a_id = $1 OR sp.student_b_id = $1
      ORDER BY s.full_name, sp.scoped_child_name NULLS FIRST`,
    [studentId],
  );
  return rows.map((r) => ({
    id: r.id,
    linkId: r.link_id,
    fullName: r.full_name,
    scopedChildName: r.scoped_child_name || null,
  }));
}

export async function partnerCount(studentId, run = query) {
  const { rows } = await run(
    `SELECT COUNT(*)::int AS n
       FROM student_partners
      WHERE student_a_id = $1 OR student_b_id = $1`,
    [studentId],
  );
  return rows[0]?.n || 0;
}

export async function listChildPartnerCodes(studentId, run = query) {
  const { rows } = await run(
    `SELECT child_name, partner_code
       FROM child_partner_codes
      WHERE student_id = $1
      ORDER BY child_name`,
    [studentId],
  );
  return rows.map((r) => ({
    childName: r.child_name,
    partnerCode: r.partner_code,
  }));
}

/**
 * Ensure a parent has one partner code per child, and drop codes/links for
 * children that were removed. `childrenNames` should already be normalized.
 */
export async function syncChildPartnerCodes(studentId, childrenNames, run = query) {
  const names = Array.isArray(childrenNames)
    ? childrenNames.map((n) => String(n ?? '').trim()).filter(Boolean)
    : [];
  const { rows: existing } = await run(
    `SELECT id, child_name FROM child_partner_codes WHERE student_id = $1`,
    [studentId],
  );
  const existingByKey = new Map(existing.map((r) => [r.child_name.toLowerCase(), r]));
  const keepKeys = new Set(names.map((n) => n.toLowerCase()));

  for (const name of names) {
    const row = existingByKey.get(name.toLowerCase());
    if (!row) {
      const code = await allocatePartnerCode(run);
      await run(
        `INSERT INTO child_partner_codes (student_id, child_name, partner_code)
         VALUES ($1, $2, $3)`,
        [studentId, name, code],
      );
      continue;
    }
    if (row.child_name !== name) {
      await run('UPDATE child_partner_codes SET child_name = $1 WHERE id = $2', [name, row.id]);
      await run(
        `UPDATE student_partners
            SET scoped_child_name = $1
          WHERE scoped_owner_id = $2 AND lower(scoped_child_name) = lower($3)`,
        [name, studentId, row.child_name],
      );
    }
  }

  for (const row of existing) {
    if (keepKeys.has(row.child_name.toLowerCase())) continue;
    await run('DELETE FROM child_partner_codes WHERE id = $1', [row.id]);
    await run(
      `DELETE FROM student_partners
        WHERE scoped_owner_id = $1 AND lower(scoped_child_name) = lower($2)`,
      [studentId, row.child_name],
    );
  }
}

/**
 * Validate optional paymentPartnerId against the booker's partners.
 * When `childName` is set (parent booking), scoped partners for other children
 * are not eligible.
 */
export async function resolvePaymentPartnerId(
  studentId,
  requestedId,
  run = query,
  childName = null,
) {
  if (requestedId == null || requestedId === '') return null;
  const id = Number(requestedId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Invalid payment partner.');
  }
  if (id === studentId) {
    throw new HttpError(400, 'You cannot split payment with yourself.');
  }
  const links = await partnerLinksFor(studentId, run);
  const child = childName || null;
  const ok = links.some((l) => {
    if (l.partnerId !== id) return false;
    if (!l.scopedChildName) return true;
    return child != null && l.scopedChildName.toLowerCase() === child.toLowerCase();
  });
  if (!ok) {
    throw new HttpError(400, 'That student is not one of your partners.');
  }
  return id;
}

export function paymentPartnerPayload(id, name) {
  if (!id || !name) return null;
  return { id, name };
}
