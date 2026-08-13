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
    const { rows } = await run('SELECT 1 FROM students WHERE partner_code = $1 LIMIT 1', [code]);
    if (!rows[0]) return code;
  }
  throw new HttpError(500, 'Could not generate a partner code.');
}

export function orderedPair(id1, id2) {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

export async function partnerIdsFor(studentId, run = query) {
  const { rows } = await run(
    `SELECT CASE WHEN student_a_id = $1 THEN student_b_id ELSE student_a_id END AS partner_id
       FROM student_partners
      WHERE student_a_id = $1 OR student_b_id = $1`,
    [studentId],
  );
  return rows.map((r) => r.partner_id);
}

export async function listPartners(studentId, run = query) {
  const { rows } = await run(
    `SELECT s.id, s.full_name
       FROM student_partners sp
       JOIN students s
         ON s.id = CASE WHEN sp.student_a_id = $1 THEN sp.student_b_id ELSE sp.student_a_id END
      WHERE sp.student_a_id = $1 OR sp.student_b_id = $1
      ORDER BY s.full_name`,
    [studentId],
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
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

/** Validate optional paymentPartnerId against the booker's current partners. */
export async function resolvePaymentPartnerId(studentId, requestedId, run = query) {
  if (requestedId == null || requestedId === '') return null;
  const id = Number(requestedId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Invalid payment partner.');
  }
  if (id === studentId) {
    throw new HttpError(400, 'You cannot split payment with yourself.');
  }
  const ids = await partnerIdsFor(studentId, run);
  if (!ids.includes(id)) {
    throw new HttpError(400, 'That student is not one of your partners.');
  }
  return id;
}

export function paymentPartnerPayload(id, name) {
  if (!id || !name) return null;
  return { id, name };
}
