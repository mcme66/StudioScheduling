import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { env } from '../env.js';
import { sendPasswordReset } from '../services/email.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} from '../middleware/auth.js';
import { allocatePartnerCode } from '../utils/partners.js';
import { uniqueStudioSlug } from '../utils/slug.js';

export const authRouter = Router();

const ROLE_TABLE = { student: 'students', teacher: 'teachers', studio_owner: 'studio_owners' };

const STUDIO_OWNER_ADD_CODE = 'StudioCoreRox';

const registerSchema = z.object({
  role: z.enum(['student', 'teacher']),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  fullName: z.string().min(1, 'Name is required.').max(120),
  phone: z.string().max(40).optional().or(z.literal('')),
  bio: z.string().max(1000).optional(),
  defaultPriceCents: z.number().int().min(0).optional(),
  defaultDurationMin: z.number().int().min(5).max(240).optional(),
  studioId: z.number().int().positive().optional(),
});

const loginSchema = z.object({
  role: z.enum(['student', 'teacher']),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  role: z.enum(['student', 'teacher']),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
});

const resetPasswordSchema = z.object({
  role: z.enum(['student', 'teacher']),
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const ownerRegisterSchema = z
  .object({
    addCode: z.string().min(1, 'Add code is required.'),
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    fullName: z.string().min(1, 'Name is required.').max(120),
    phone: z.string().max(40).optional().or(z.literal('')),
    studioId: z.number().int().positive().nullable().optional(),
    studioName: z.string().max(120).optional().or(z.literal('')),
    studioDescription: z.string().max(2000).optional().or(z.literal('')),
  })
  .refine((data) => Boolean(data.studioId) !== Boolean(String(data.studioName || '').trim()), {
    message: 'Choose an existing studio or enter a new studio name.',
  });

function addCodeMatches(input) {
  const expected = Buffer.from(STUDIO_OWNER_ADD_CODE, 'utf8');
  const given = Buffer.from(String(input || '').trim(), 'utf8');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

async function emailTaken(email) {
  const [owners, teachers, students] = await Promise.all([
    query('SELECT 1 FROM studio_owners WHERE email = $1', [email]),
    query('SELECT 1 FROM teachers WHERE email = $1', [email]),
    query('SELECT 1 FROM students WHERE email = $1', [email]),
  ]);
  return Boolean(owners.rows[0] || teachers.rows[0] || students.rows[0]);
}

async function emailTakenByOwner(email) {
  const { rows } = await query('SELECT 1 FROM studio_owners WHERE email = $1', [email]);
  return Boolean(rows[0]);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(row, role) {
  return {
    id: row.id,
    role,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || null,
    ...(role === 'teacher'
      ? {
          bio: row.bio || null,
          defaultPriceCents: row.default_price_cents,
          defaultDurationMin: row.default_duration_min,
          canBookAsStudent: row.can_book_as_student === true,
        }
      : {}),
    ...(role === 'studio_owner'
      ? {
          studioId: row.studio_id,
          studioSlug: row.studio_slug || null,
          studioName: row.studio_name || null,
        }
      : {}),
  };
}

async function findTeacherOrOwnerByEmail(email) {
  const { rows: teachers } = await query('SELECT * FROM teachers WHERE email = $1', [email]);
  if (teachers[0]) return { row: teachers[0], role: 'teacher', table: 'teachers' };

  const { rows: owners } = await query(
    `SELECT so.*, s.name AS studio_name, s.slug AS studio_slug
       FROM studio_owners so
       JOIN studios s ON s.id = so.studio_id
      WHERE so.email = $1`,
    [email],
  );
  if (owners[0]) return { row: owners[0], role: 'studio_owner', table: 'studio_owners' };

  return null;
}

async function loadStudioOwnerById(id) {
  const { rows } = await query(
    `SELECT so.*, s.name AS studio_name, s.slug AS studio_slug
       FROM studio_owners so
       JOIN studios s ON s.id = so.studio_id
      WHERE so.id = $1`,
    [id],
  );
  return rows[0] || null;
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    if (await emailTakenByOwner(data.email)) {
      throw new HttpError(409, 'An account with that email already exists.');
    }
    const passwordHash = await bcrypt.hash(data.password, 12);

    let row;
    if (data.role === 'teacher') {
      let studioId = data.studioId;
      if (!studioId) {
        const { rows: studios } = await query('SELECT id FROM studios ORDER BY id LIMIT 1');
        if (!studios[0]) throw new HttpError(400, 'No studio is available for registration.');
        studioId = studios[0].id;
      } else {
        const { rows: studios } = await query('SELECT id FROM studios WHERE id = $1', [studioId]);
        if (!studios[0]) throw new HttpError(400, 'Invalid studio.');
      }

      const result = await query(
        `INSERT INTO teachers (
           email, password_hash, full_name, phone, bio,
           default_price_cents, default_duration_min, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)
         RETURNING *`,
        [
          data.email,
          passwordHash,
          data.fullName,
          data.phone || null,
          data.bio || null,
          data.defaultPriceCents ?? 7400,
          data.defaultDurationMin ?? 45,
        ],
      ).catch(rethrowDuplicate);
      row = result.rows[0];
      await query(
        `INSERT INTO teacher_studios (teacher_id, studio_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [row.id, studioId],
      );
    } else {
      const partnerCode = await allocatePartnerCode();
      const result = await query(
        `INSERT INTO students (email, password_hash, full_name, phone, partner_code)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.email, passwordHash, data.fullName, data.phone || null, partnerCode],
      ).catch(rethrowDuplicate);
      row = result.rows[0];
    }

    const user = publicUser(row, data.role);
    setAuthCookie(res, signToken({ id: user.id, role: user.role, email: user.email }));
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/register-owner',
  asyncHandler(async (req, res) => {
    const data = ownerRegisterSchema.parse(req.body);
    if (!addCodeMatches(data.addCode)) {
      throw new HttpError(403, 'That add code is not valid.');
    }
    if (await emailTaken(data.email)) {
      throw new HttpError(409, 'An account with that email already exists.');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const studioName = String(data.studioName || '').trim();

    const owner = await withTransaction(async (client) => {
      let studioId = data.studioId || null;

      if (studioId) {
        const { rows: studios } = await client.query(
          'SELECT id FROM studios WHERE id = $1 FOR UPDATE',
          [studioId],
        );
        if (!studios[0]) throw new HttpError(400, 'That studio was not found.');
        const { rows: taken } = await client.query(
          'SELECT 1 FROM studio_owners WHERE studio_id = $1',
          [studioId],
        );
        if (taken[0]) throw new HttpError(409, 'That studio already has an owner.');
      } else {
        let slug;
        try {
          slug = await uniqueStudioSlug(client, studioName);
        } catch {
          throw new HttpError(400, 'Could not create a unique studio URL.');
        }
        const { rows: created } = await client.query(
          `INSERT INTO studios (name, slug, description)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [studioName, slug, data.studioDescription?.trim() || null],
        );
        studioId = created[0].id;
      }

      const { rows } = await client.query(
        `INSERT INTO studio_owners (email, password_hash, full_name, phone, studio_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.email, passwordHash, data.fullName.trim(), data.phone || null, studioId],
      ).catch((err) => {
        if (err?.constraint === 'studio_owners_studio_id_key') {
          throw new HttpError(409, 'That studio already has an owner.');
        }
        rethrowDuplicate(err);
      });

      return rows[0];
    });

    const row = await loadStudioOwnerById(owner.id);
    const user = publicUser(row, 'studio_owner');
    setAuthCookie(res, signToken({ id: user.id, role: user.role, email: user.email }));
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);

    let match;
    if (data.role === 'teacher') {
      match = await findTeacherOrOwnerByEmail(data.email);
    } else {
      const table = ROLE_TABLE[data.role];
      const { rows } = await query(`SELECT * FROM ${table} WHERE email = $1`, [data.email]);
      if (rows[0]) match = { row: rows[0], role: data.role, table };
    }

    if (!match || !(await bcrypt.compare(data.password, match.row.password_hash))) {
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const user = publicUser(match.row, match.role);
    setAuthCookie(res, signToken({ id: user.id, role: user.role, email: user.email }));
    res.json({ user });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const data = forgotPasswordSchema.parse(req.body);

    let found;
    if (data.role === 'teacher') {
      found = await findTeacherOrOwnerByEmail(data.email);
    } else {
      const table = ROLE_TABLE[data.role];
      const { rows } = await query(`SELECT id, email, full_name FROM ${table} WHERE email = $1`, [
        data.email,
      ]);
      if (rows[0]) found = { row: rows[0], table, role: data.role };
    }

    if (found) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + env.passwordResetExpiresHours * 60 * 60 * 1000);

      await query(
        `UPDATE ${found.table}
            SET password_reset_token_hash = $1, password_reset_expires_at = $2
          WHERE id = $3`,
        [tokenHash, expiresAt.toISOString(), found.row.id],
      );

      await sendPasswordReset({
        email: found.row.email,
        fullName: found.row.full_name,
        role: data.role,
        token,
      });
    }

    res.json({ message: 'If an account exists for that email, we sent a reset link.' });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const data = resetPasswordSchema.parse(req.body);
    const tokenHash = hashResetToken(data.token);

    const tables =
      data.role === 'teacher' ? ['teachers', 'studio_owners'] : [ROLE_TABLE[data.role]];

    let row;
    let table;
    for (const candidate of tables) {
      const { rows } = await query(
        `SELECT id FROM ${candidate}
          WHERE password_reset_token_hash = $1
            AND password_reset_expires_at > now()`,
        [tokenHash],
      );
      if (rows[0]) {
        row = rows[0];
        table = candidate;
        break;
      }
    }
    if (!row) {
      throw new HttpError(400, 'This reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    await query(
      `UPDATE ${table}
          SET password_hash = $1,
              password_reset_token_hash = NULL,
              password_reset_expires_at = NULL
        WHERE id = $2`,
      [passwordHash, row.id],
    );

    // Keep the linked student login in sync when a teacher resets their password.
    if (table === 'teachers') {
      await query(
        `UPDATE students s
            SET password_hash = $1
           FROM teachers t
          WHERE t.id = $2
            AND t.can_book_as_student = true
            AND s.email = t.email`,
        [passwordHash, row.id],
      );
    }

    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role === 'studio_owner') {
      const row = await loadStudioOwnerById(req.user.id);
      if (!row) throw new HttpError(401, 'Account no longer exists.');
      return res.json({ user: publicUser(row, 'studio_owner') });
    }
    const table = ROLE_TABLE[req.user.role];
    if (!table) throw new HttpError(401, 'Account no longer exists.');
    const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.user.id]);
    if (!rows[0]) {
      throw new HttpError(401, 'Account no longer exists.');
    }
    res.json({ user: publicUser(rows[0], req.user.role) });
  }),
);

function rethrowDuplicate(err) {
  if (err?.code === '23505') {
    throw new HttpError(409, 'An account with that email already exists.');
  }
  throw err;
}
