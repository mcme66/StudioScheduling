/** URL slug from a studio name, plus a unique variant against existing rows. */

export function slugifyName(name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'studio';
}

export async function uniqueStudioSlug(client, name) {
  const base = slugifyName(name);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await client.query('SELECT 1 FROM studios WHERE slug = $1', [slug]);
    if (!rows[0]) return slug;
  }
  throw new Error('Could not create a unique studio URL.');
}
