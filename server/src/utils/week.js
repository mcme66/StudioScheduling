// Date helpers operate on `YYYY-MM-DD` strings using UTC noon to avoid
// timezone / DST edge cases. weekday: 0 = Sunday ... 6 = Saturday.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return d;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr) {
  return parseDate(dateStr).getUTCDay();
}

/** Monday (as YYYY-MM-DD) of the week containing `dateStr`. */
export function getMonday(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return toISODate(new Date(d.getTime() + diff * DAY_MS));
}

/** Concrete date (YYYY-MM-DD) for a given weekday within a Monday-anchored week. */
export function dateForWeekday(mondayStr, weekday) {
  const monday = parseDate(mondayStr);
  const offset = weekday === 0 ? 6 : weekday - 1; // Mon=0 ... Sun=6
  return toISODate(new Date(monday.getTime() + offset * DAY_MS));
}

export function todayISO() {
  return toISODate(new Date());
}

export function isValidDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
