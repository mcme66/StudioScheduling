export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function addMinsToTime(t, mins) {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

export function fmtTimeRange(start, durationMin) {
  return `${fmtTime(start)} – ${fmtTime(addMinsToTime(start, durationMin))}`;
}

export function fmtPrice(cents) {
  if (cents == null) return '';
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function fmtDate(dateStr, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', opts);
}

// --- Week math (mirrors the server, Monday-anchored) -----------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function parse(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}
function iso(date) {
  return date.toISOString().slice(0, 10);
}

function localISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return localISO(new Date());
}

export function getMonday(dateStr) {
  const d = parse(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return iso(new Date(d.getTime() + diff * DAY_MS));
}

export function addWeeks(mondayStr, weeks) {
  return iso(new Date(parse(mondayStr).getTime() + weeks * 7 * DAY_MS));
}

export function weekRangeLabel(mondayStr) {
  const monday = parse(mondayStr);
  const friday = new Date(monday.getTime() + 4 * DAY_MS);
  const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(monday)} – ${f(friday)}`;
}

export function dateForWeekday(mondayStr, weekday) {
  const monday = parse(mondayStr);
  const offset = weekday === 0 ? 6 : weekday - 1;
  return iso(new Date(monday.getTime() + offset * DAY_MS));
}

/**
 * The next `count` dates (YYYY-MM-DD) matching `weekday`, starting from
 * `fromISO` (today by default). Includes today if it falls on `weekday`.
 */
export function upcomingWeekdayDates(weekday, count, fromISO = todayISO()) {
  const start = parse(fromISO);
  const startDay = start.getUTCDay();
  let delta = (weekday - startDay + 7) % 7;
  const dates = [];
  for (let i = 0; i < count; i++) {
    dates.push(iso(new Date(start.getTime() + (delta + i * 7) * DAY_MS)));
  }
  return dates;
}

/** True when a lesson's start date/time is now or in the past (local time). */
export function isSlotPast(lessonDate, startTime) {
  if (!lessonDate || !startTime) return false;
  const [h, m] = startTime.split(':').map(Number);
  const slotStart = new Date(`${lessonDate}T00:00:00`);
  slotStart.setHours(h, m, 0, 0);
  return slotStart.getTime() <= Date.now();
}

export function isSlotBookable(slot) {
  return slot.status === 'open' && !isSlotPast(slot.lessonDate, slot.startTime);
}

/** Last bookable date (Sunday of the week 2 weeks ahead). */
export function maxBookableDate() {
  const monday = addWeeks(getMonday(todayISO()), 2);
  return dateForWeekday(monday, 0);
}

/** All bookable dates from `fromISO` through max bookable date (inclusive). */
export function bookableDates(fromISO = todayISO()) {
  const out = [];
  const end = parse(maxBookableDate());
  const cur = parse(fromISO);
  while (cur.getTime() <= end.getTime()) {
    out.push(iso(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
