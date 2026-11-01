import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

export const notificationsRouter = Router();

const LIST_LIMIT = 30;

/** Teachers who also book lessons get student notifications on their linked students row. */
async function linkedStudentId(user) {
  if (user.role !== 'teacher') return null;
  const { rows } = await query(
    `SELECT s.id
       FROM teachers t
       JOIN students s ON s.email = t.email
      WHERE t.id = $1 AND t.can_book_as_student = true`,
    [user.id],
  );
  return rows[0]?.id ?? null;
}

async function recipientFilter(user, offset = 0) {
  const studentId = await linkedStudentId(user);
  return {
    sql: `((recipient_role = $${offset + 1} AND recipient_id = $${offset + 2})
           OR (recipient_role = 'student' AND recipient_id = $${offset + 3}::int))`,
    params: [user.role, user.id, studentId],
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.created_at,
    read: row.read_at != null,
  };
}

notificationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filter = await recipientFilter(req.user);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT id, kind, title, body, link, created_at, read_at
           FROM notifications
          WHERE ${filter.sql}
          ORDER BY created_at DESC, id DESC
          LIMIT ${LIST_LIMIT}`,
        filter.params,
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE ${filter.sql} AND read_at IS NULL`,
        filter.params,
      ),
    ]);
    res.json({ items: rows.map(mapNotification), unreadCount: countRows[0]?.n ?? 0 });
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filter = await recipientFilter(req.user);
    await query(
      `UPDATE notifications SET read_at = now() WHERE ${filter.sql} AND read_at IS NULL`,
      filter.params,
    );
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid notification.');
    const filter = await recipientFilter(req.user, 1);
    const { rows } = await query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND ${filter.sql}
        RETURNING id`,
      [id, ...filter.params],
    );
    if (!rows[0]) throw new HttpError(404, 'Notification not found.');
    res.json({ ok: true });
  }),
);
