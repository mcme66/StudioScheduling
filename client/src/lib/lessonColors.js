/** Shared calendar colors. Dark enough for white text on a lesson block. */
export const LESSON_COLOR_PALETTE = [
  '#2d6a4f',
  '#c8401a',
  '#2a4a7a',
  '#6b3a6b',
  '#8a6a12',
  '#1f6f6a',
  '#9c3d55',
  '#3d4f66',
];

export const LESSON_COLOR_NAMES = {
  '#2d6a4f': 'Green',
  '#c8401a': 'Red',
  '#2a4a7a': 'Blue',
  '#6b3a6b': 'Purple',
  '#8a6a12': 'Gold',
  '#1f6f6a': 'Teal',
  '#9c3d55': 'Pink',
  '#3d4f66': 'Gray',
};

export const DEFAULT_LESSON_COLOR = LESSON_COLOR_PALETTE[0];

/** Lessons shared by a partner. Outside the palette so it never matches a child. */
export const PARTNER_LESSON_COLOR = '#6f6a60';

/** Color saved for a child, matched case-insensitively by name. */
export function colorForChild(childrenColors, childName) {
  const key = String(childName || '').trim().toLowerCase();
  if (!key || !childrenColors) return null;
  const match = Object.entries(childrenColors).find(([name]) => name.trim().toLowerCase() === key);
  return match && isHexColor(match[1]) ? match[1] : null;
}

export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function nextPaletteColor(used) {
  const taken = new Set((used || []).map((c) => String(c || '').toLowerCase()));
  return LESSON_COLOR_PALETTE.find((c) => !taken.has(c)) || LESSON_COLOR_PALETTE[taken.size % LESSON_COLOR_PALETTE.length];
}

/** Keep a blank row at the end so another child can be added. */
export function withTrailingChild(rows) {
  const filled = [];
  for (const row of rows) {
    filled.push({ name: row.name ?? '', color: isHexColor(row.color) ? row.color : DEFAULT_LESSON_COLOR });
  }
  while (filled.length && !filled[filled.length - 1].name.trim()) filled.pop();
  const lastFilled = filled.reduce((acc, row, i) => (row.name.trim() ? i : acc), -1);
  const kept = filled.slice(0, Math.max(lastFilled + 1, 0));
  kept.push({ name: '', color: nextPaletteColor(kept.map((row) => row.color)) });
  return kept;
}
