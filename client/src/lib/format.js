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

export function todayISO() {
  return iso(new Date());
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
