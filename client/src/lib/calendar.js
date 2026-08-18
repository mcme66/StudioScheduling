/** Build Google Calendar + .ics links for a single lesson occurrence. */

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseLocal(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = String(timeStr).slice(0, 5).split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

/** Compact local datetime: YYYYMMDDTHHmmss (floating / local, no Z). */
function compactLocal(date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * @param {{ teacherName: string, childName?: string|null, lessonDate: string, startTime: string, durationMin: number, manageUrl?: string, title?: string }} input
 */
export function buildLessonEvent({
  teacherName,
  childName = null,
  lessonDate,
  startTime,
  durationMin,
  manageUrl = '',
  title: titleOverride,
}) {
  const title =
    titleOverride ||
    (childName ? `${childName} — lesson with ${teacherName}` : `Lesson with ${teacherName}`);
  const description = manageUrl
    ? `Lesson booking.\nManage your lessons: ${manageUrl}`
    : 'Lesson booking.';
  const start = parseLocal(lessonDate, startTime);
  const end = new Date(start.getTime() + Number(durationMin || 0) * 60 * 1000);
  return {
    title,
    description,
    start,
    end,
    lessonDate,
    startTime,
    durationMin,
  };
}

export function googleCalendarUrl(event) {
  const dates = `${compactLocal(event.start)}/${compactLocal(event.end)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    details: event.description || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs(event) {
  const uid = `lesson-${compactLocal(event.start)}-${Math.random().toString(36).slice(2, 10)}@lessons`;
  const stamp = compactLocal(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lesson Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${compactLocal(event.start)}`,
    `DTEND:${compactLocal(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadIcs(event, filename = 'lesson.ics') {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function openGoogleCalendar(event) {
  window.open(googleCalendarUrl(event), '_blank', 'noopener,noreferrer');
}
