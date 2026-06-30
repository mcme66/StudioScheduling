import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { env } from '../env.js';
import { sendPasswordReset } from '../services/email.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} from '../middleware/auth.js';

export const authRouter = Router();

const ROLE_TABLE = { student: 'students', teacher: 'teachers' };

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
        }
      : {}),
  };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
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
        `INSERT INTO teachers (email, password_hash, full_name, phone, bio, default_price_cents, default_duration_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
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
      const result = await query(
        `INSERT INTO students (email, password_hash, full_name, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [data.email, passwordHash, data.fullName, data.phone || null],
      ).catch(rethrowDuplicate);
      row = result.rows[0];
    }

    const user = publicUser(row, data.role);
    setAuthCookie(res, signToken({ id: user.id, role: user.role, email: user.email }));
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const table = ROLE_TABLE[data.role];
    const { rows } = await query(`SELECT * FROM ${table} WHERE email = $1`, [data.email]);
    const row = rows[0];
    if (!row || !(await bcrypt.compare(data.password, row.password_hash))) {
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const user = publicUser(row, data.role);
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
    const table = ROLE_TABLE[data.role];
    const { rows } = await query(`SELECT id, email, full_name FROM ${table} WHERE email = $1`, [data.email]);
    const row = rows[0];

    if (row) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + env.passwordResetExpiresHours * 60 * 60 * 1000);

      await query(
        `UPDATE ${table}
            SET password_reset_token_hash = $1, password_reset_expires_at = $2
          WHERE id = $3`,
        [tokenHash, expiresAt.toISOString(), row.id],
      );

      await sendPasswordReset({
        email: row.email,
        fullName: row.full_name,
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
    const table = ROLE_TABLE[data.role];
    const tokenHash = hashResetToken(data.token);

    const { rows } = await query(
      `SELECT id FROM ${table}
        WHERE password_reset_token_hash = $1
          AND password_reset_expires_at > now()`,
      [tokenHash],
    );
    const row = rows[0];
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

    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const table = ROLE_TABLE[req.user.role];
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
