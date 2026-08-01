/**
 * Google Calendar URL + ICS builders for lesson emails.
 * Uses floating local datetimes (same convention as the app's lesson times).
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseLocal(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const [h, mi] = String(timeStr).slice(0, 5).split(':').map(Number);
  return { y, mo, d, h, mi };
}

function addMinutes(parts, mins) {
  const dt = new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, 0, 0);
  dt.setMinutes(dt.getMinutes() + Number(mins || 0));
  return {
    y: dt.getFullYear(),
    mo: dt.getMonth() + 1,
    d: dt.getDate(),
    h: dt.getHours(),
    mi: dt.getMinutes(),
    s: dt.getSeconds(),
  };
}

function compact(parts) {
  return (
    `${parts.y}${pad(parts.mo)}${pad(parts.d)}` +
    `T${pad(parts.h)}${pad(parts.mi)}${pad(parts.s || 0)}`
  );
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildLessonEvent({
  teacherName,
  childName = null,
  lessonDate,
  startTime,
  durationMin,
  manageUrl = '',
}) {
  const title = childName
    ? `${childName} — lesson with ${teacherName}`
    : `Lesson with ${teacherName}`;
  const description = manageUrl
    ? `Lesson booking.\nManage your lessons: ${manageUrl}`
    : 'Lesson booking.';
  const start = parseLocal(lessonDate, startTime);
  const end = addMinutes(start, durationMin);
  return { title, description, start, end, lessonDate };
}

export function googleCalendarUrl(event) {
  const dates = `${compact(event.start)}/${compact(event.end)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    details: event.description || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs(event) {
  const now = new Date();
  const stamp = compact({
    y: now.getFullYear(),
    mo: now.getMonth() + 1,
    d: now.getDate(),
    h: now.getHours(),
    mi: now.getMinutes(),
    s: now.getSeconds(),
  });
  const uid = `lesson-${compact(event.start)}@lesson-scheduling`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lesson Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${compact(event.start)}`,
    `DTEND:${compact(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
