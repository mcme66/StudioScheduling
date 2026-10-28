import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

export const MAX_COACH_TIERS = 5;

export function mapCoachTier(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    sortOrder: row.sort_order,
  };
}

export async function listCoachTiers(studioId) {
  const { rows } = await query(
    `SELECT id, name, description, sort_order
       FROM coach_tiers
      WHERE studio_id = $1
      ORDER BY sort_order, id`,
    [studioId],
  );
  return rows.map(mapCoachTier);
}

async function assertUniqueName(client, studioId, name, exceptId = null) {
  const { rows } = await client.query(
    `SELECT 1
       FROM coach_tiers
      WHERE studio_id = $1
        AND lower(btrim(name)) = lower($2)
        AND ($3::int IS NULL OR id <> $3)`,
    [studioId, name, exceptId],
  );
  if (rows[0]) throw new HttpError(400, 'A tier with that name already exists.');
}

export async function createCoachTier(studioId, { name, description }) {
  const cleanName = name.trim();
  if (!cleanName) throw new HttpError(400, 'Give the tier a name.');
  return withTransaction(async (client) => {
    await client.query('SELECT id FROM studios WHERE id = $1 FOR UPDATE', [studioId]);
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM coach_tiers WHERE studio_id = $1',
      [studioId],
    );
    if (countRows[0].n >= MAX_COACH_TIERS) {
      throw new HttpError(400, 'A studio can have up to 5 tiers.');
    }
    await assertUniqueName(client, studioId, cleanName);
    const { rows } = await client.query(
      `INSERT INTO coach_tiers (studio_id, name, description, sort_order)
       VALUES (
         $1, $2, $3,
         (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM coach_tiers WHERE studio_id = $1)
       )
       RETURNING id, name, description, sort_order`,
      [studioId, cleanName, description?.trim() || null],
    );
    return mapCoachTier(rows[0]);
  });
}

export async function updateCoachTier(studioId, tierId, { name, description }) {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      'SELECT id FROM coach_tiers WHERE id = $1 AND studio_id = $2 FOR UPDATE',
      [tierId, studioId],
    );
    if (!existing[0]) throw new HttpError(404, 'Tier not found.');

    const sets = [];
    const values = [];
    let i = 1;
    if (name !== undefined) {
      const cleanName = name.trim();
      if (!cleanName) throw new HttpError(400, 'Give the tier a name.');
      await assertUniqueName(client, studioId, cleanName, tierId);
      sets.push(`name = $${i++}`);
      values.push(cleanName);
    }
    if (description !== undefined) {
      sets.push(`description = $${i++}`);
      values.push(description?.trim() || null);
    }
    if (!sets.length) {
      const { rows } = await client.query(
        'SELECT id, name, description, sort_order FROM coach_tiers WHERE id = $1',
        [tierId],
      );
      return mapCoachTier(rows[0]);
    }
    values.push(tierId);
    const { rows } = await client.query(
      `UPDATE coach_tiers SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, name, description, sort_order`,
      values,
    );
    return mapCoachTier(rows[0]);
  });
}

export async function deleteCoachTier(studioId, tierId) {
  const { rows } = await query(
    'DELETE FROM coach_tiers WHERE id = $1 AND studio_id = $2 RETURNING id',
    [tierId, studioId],
  );
  if (!rows[0]) throw new HttpError(404, 'Tier not found.');
}

export async function moveCoachTier(studioId, tierId, direction) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM coach_tiers WHERE studio_id = $1 ORDER BY sort_order, id FOR UPDATE`,
      [studioId],
    );
    const index = rows.findIndex((row) => row.id === tierId);
    if (index < 0) throw new HttpError(404, 'Tier not found.');
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rows.length) return;
    const order = rows.map((row) => row.id);
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    for (let i = 0; i < order.length; i += 1) {
      await client.query('UPDATE coach_tiers SET sort_order = $1 WHERE id = $2', [i, order[i]]);
    }
  });
}

export async function assignCoachTier(studioId, teacherId, tierId) {
  if (tierId != null) {
    const { rows } = await query(
      'SELECT id FROM coach_tiers WHERE id = $1 AND studio_id = $2',
      [tierId, studioId],
    );
    if (!rows[0]) throw new HttpError(400, 'That tier is not at this studio.');
  }
  const { rowCount } = await query(
    `UPDATE teacher_studios
        SET tier_id = $1
      WHERE teacher_id = $2 AND studio_id = $3`,
    [tierId, teacherId, studioId],
  );
  if (!rowCount) throw new HttpError(404, 'That coach is not at your studio.');
  return { tierId: tierId ?? null };
}
