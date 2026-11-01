import cron from 'node-cron';
import { query } from '../db.js';

const READ_RETENTION_DAYS = 15;
const UNREAD_RETENTION_DAYS = 45;

const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const fmtDate = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

function formatTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(dateStr) {
  const d = new Date(`${fmtDate(dateStr)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function lessonWhen({ lessonDate, startTime }) {
  const time = startTime ? ` at ${formatTime(startTime)}` : '';
  return lessonDate ? `${formatDate(lessonDate)}${time}` : time.trim();
}

function weeklyWhen({ weekday, startTime, startsOn }) {
  const day = WEEKDAY_PLURAL[weekday] || 'Weekly';
  const starting = startsOn ? `, starting ${formatDate(startsOn)}` : '';
  return `${day} at ${formatTime(startTime)}${starting}`;
}

function personLabel(studentName, childName) {
  const name = studentName || 'A student';
  return childName ? `${childName} (${name})` : name;
}

async function nameOf(table, id) {
  if (!id) return null;
  const { rows } = await query(`SELECT full_name FROM ${table} WHERE id = $1`, [id]);
  return rows[0]?.full_name || null;
}

const studentName = (id) => nameOf('students', id);
const teacherName = (id) => nameOf('teachers', id);

/**
 * Insert notifications. Best-effort: failures are logged and never thrown,
 * so a notification problem can't break the action that triggered it.
 */
export async function notifyMany(items) {
  const list = (items || []).filter((n) => n && n.role && n.id && n.title);
  if (!list.length) return;
  try {
    const values = [];
    const params = [];
    list.forEach((n, i) => {
      const o = i * 7;
      values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`);
      params.push(n.role, n.id, n.kind, n.title, n.body || null, n.link || null, n.ref || null);
    });
    await query(
      `INSERT INTO notifications (recipient_role, recipient_id, kind, title, body, link, ref)
       VALUES ${values.join(', ')}`,
      params,
    );
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

export function notify(item) {
  return notifyMany([item]);
}

/** Refs tie a cancellation notification to the lesson, so an undo can retract it. */
export const bookingRef = (bookingId) => `booking:${bookingId}`;
export const weekRef = (assignmentId, date) => `week:${assignmentId}:${fmtDate(date)}`;

/** Read notifications expire 15 days after being read; unread ones 45 days after creation. */
export async function pruneNotifications() {
  const { rowCount } = await query(
    `DELETE FROM notifications
      WHERE (read_at IS NOT NULL AND read_at < now() - make_interval(days => $1))
         OR (read_at IS NULL AND created_at < now() - make_interval(days => $2))`,
    [READ_RETENTION_DAYS, UNREAD_RETENTION_DAYS],
  );
  if (rowCount) console.log(`Notification cleanup: removed ${rowCount} notification(s).`);
  return rowCount;
}

export function startNotificationCleanupJob() {
  const run = () =>
    pruneNotifications().catch((err) => console.error('Notification cleanup failed:', err.message));
  run();
  cron.schedule('0 3 * * *', run);
  console.log('Notification cleanup job scheduled (daily).');
}

async function safely(fn) {
  try {
    await fn();
  } catch (err) {
    console.error('Failed to build notification:', err.message);
  }
}

// --- Studio owners ---------------------------------------------------------

export function notifyOwnerCoachJoined({ studioId, teacherId }) {
  return safely(async () => {
    const { rows: owners } = await query('SELECT id FROM studio_owners WHERE studio_id = $1', [studioId]);
    if (!owners.length) return;
    const coach = (await teacherName(teacherId)) || 'A new coach';
    await notifyMany(
      owners.map((o) => ({
        role: 'studio_owner',
        id: o.id,
        kind: 'coach_joined',
        title: 'New coach at your studio',
        body: `${coach} joined your studio.`,
        link: '/owner',
      })),
    );
  });
}

// --- Coaches ---------------------------------------------------------------

export function notifyCoachLessonBooked({ teacherId, studentId, childName, lessonDate, startTime }) {
  return safely(async () => {
    const who = personLabel(await studentName(studentId), childName);
    await notify({
      role: 'teacher',
      id: teacherId,
      kind: 'lesson_booked',
      title: 'New lesson booked',
      body: `${who} booked ${lessonWhen({ lessonDate, startTime })}.`,
      link: '/teacher',
    });
  });
}

export function notifyCoachWeeklyRequested({ teacherId, studentId, childName, weekday, startTime, startsOn }) {
  return safely(async () => {
    const who = personLabel(await studentName(studentId), childName);
    await notify({
      role: 'teacher',
      id: teacherId,
      kind: 'weekly_requested',
      title: 'Weekly spot requested',
      body: `${who} requested ${weeklyWhen({ weekday, startTime, startsOn })}.`,
      link: '/teacher',
    });
  });
}

/** scope: 'lesson' (one-off), 'week' (one week of a weekly spot), 'weekly' (whole spot), 'request' (pending request withdrawn). */
export function notifyCoachStudentCancelled({
  teacherId,
  studentId,
  childName,
  scope,
  lessonDate,
  weekday,
  startTime,
  ref = null,
}) {
  return safely(async () => {
    const who = personLabel(await studentName(studentId), childName);
    let title = 'Lesson cancelled';
    let body;
    if (scope === 'weekly') {
      title = 'Weekly spot ended';
      body = `${who} ended their weekly spot (${weeklyWhen({ weekday, startTime })}).`;
    } else if (scope === 'request') {
      title = 'Weekly request withdrawn';
      body = `${who} withdrew their weekly spot request (${weeklyWhen({ weekday, startTime })}).`;
    } else if (scope === 'week') {
      body = `${who} cancelled their weekly lesson on ${lessonWhen({ lessonDate, startTime })}.`;
    } else {
      body = `${who} cancelled their lesson on ${lessonWhen({ lessonDate, startTime })}.`;
    }
    await notify({
      role: 'teacher',
      id: teacherId,
      kind: 'student_cancelled',
      title,
      body,
      link: '/teacher',
      ref,
    });
  });
}

export function notifyCoachHeldDeclined({ teacherId, studentId, childName, lessonDate, startTime }) {
  return safely(async () => {
    const who = personLabel(await studentName(studentId), childName);
    await notify({
      role: 'teacher',
      id: teacherId,
      kind: 'held_declined',
      title: 'Held lesson declined',
      body: `${who} declined the lesson you held on ${lessonWhen({ lessonDate, startTime })}.`,
      link: '/teacher',
    });
  });
}

/** lessons: [{ studentId, childName, lessonDate, series? }] moved onto the substitute's schedule. */
export function notifyCoachLessonsAdded({ teacherId, fromTeacherId, lessons, weekday, startTime }) {
  return safely(async () => {
    const list = (lessons || []).filter((l) => l?.studentId);
    if (!list.length) return;
    const fromCoach = (await teacherName(fromTeacherId)) || 'another coach';
    const items = [];
    for (const l of list) {
      const who = personLabel(await studentName(l.studentId), l.childName);
      const when = l.series
        ? weeklyWhen({ weekday, startTime, startsOn: l.lessonDate })
        : lessonWhen({ lessonDate: l.lessonDate, startTime });
      items.push({
        role: 'teacher',
        id: teacherId,
        kind: 'lesson_added',
        title: l.series ? 'Weekly lesson added to your schedule' : 'Lesson added to your schedule',
        body: `The studio moved ${who}'s lesson from ${fromCoach} to you: ${when}.`,
        link: '/teacher',
      });
    }
    await notifyMany(items);
  });
}

const REQUEST_OUTCOMES = {
  applied: { title: 'Cancellation approved', verb: 'approved your cancellation request' },
  filled: { title: 'Lesson covered', verb: 'covered your lesson with' },
  dismissed: { title: 'Cancellation request declined', verb: 'kept this lesson on your schedule' },
};

/** Tells a managed coach how the studio resolved their cancellation request. */
export function notifyCoachRequestResolved({
  teacherId,
  outcome,
  actionLabel,
  occupantLabel,
  lessonDate,
  weekday,
  startTime,
  series,
  substituteTeacherId = null,
}) {
  return safely(async () => {
    const o = REQUEST_OUTCOMES[outcome];
    if (!o) return;
    const when = lessonDate && !series
      ? lessonWhen({ lessonDate, startTime })
      : weeklyWhen({ weekday, startTime, startsOn: lessonDate });
    const verb = outcome === 'filled'
      ? `${o.verb} ${(await teacherName(substituteTeacherId)) || 'another coach'}`
      : o.verb;
    const who = occupantLabel && occupantLabel !== 'Empty' ? `${occupantLabel}, ` : '';
    await notify({
      role: 'teacher',
      id: teacherId,
      kind: `request_${outcome}`,
      title: o.title,
      body: `The studio ${verb}: ${actionLabel} (${who}${when}).`,
      link: '/teacher',
    });
  });
}

// --- Students --------------------------------------------------------------

export function notifyStudentWeeklyApproved({ studentId, teacherId, childName, weekday, startTime, startsOn }) {
  return safely(async () => {
    const coach = (await teacherName(teacherId)) || 'Your coach';
    const forLine = childName ? ` for ${childName}` : '';
    await notify({
      role: 'student',
      id: studentId,
      kind: 'weekly_approved',
      title: 'Weekly spot accepted',
      body: `${coach} accepted your weekly spot${forLine}: ${weeklyWhen({ weekday, startTime, startsOn })}.`,
      link: '/my-lessons',
    });
  });
}

export function notifyStudentWeeklyOneTime({ studentId, teacherId, childName, lessonDate, startTime }) {
  return safely(async () => {
    const coach = (await teacherName(teacherId)) || 'Your coach';
    const forLine = childName ? ` for ${childName}` : '';
    await notify({
      role: 'student',
      id: studentId,
      kind: 'weekly_one_time',
      title: 'One lesson booked',
      body: `${coach} booked one lesson${forLine} on ${lessonWhen({ lessonDate, startTime })} instead of the weekly spot.`,
      link: '/my-lessons',
    });
  });
}

/**
 * students: [{ studentId, childName }]. reason: 'declined' (coach said no), 'taken' (another
 * student got the time), or 'closed' (the time was removed from the schedule).
 */
export function notifyStudentsWeeklyDeclined({ students, teacherId, weekday, startTime, reason, byStudio = false }) {
  return safely(async () => {
    const list = (students || []).filter((s) => s?.studentId);
    if (!list.length) return;
    const coach = (await teacherName(teacherId)) || 'Your coach';
    const actor = byStudio ? 'The studio' : coach;
    const when = weeklyWhen({ weekday, startTime });
    await notifyMany(
      list.map(({ studentId, childName }) => {
        const forLine = childName ? ` for ${childName}` : '';
        let body = `${actor} declined your weekly spot request${forLine} (${when}).`;
        if (reason === 'taken') {
          body = `${coach} gave this weekly time to another student, so your request${forLine} (${when}) was declined.`;
        } else if (reason === 'closed') {
          body = `${actor} removed this weekly time, so your request${forLine} (${when}) was closed.`;
        }
        return {
          role: 'student',
          id: studentId,
          kind: 'weekly_declined',
          title: 'Weekly request declined',
          body,
          link: '/my-lessons',
        };
      }),
    );
  });
}

export function notifyStudentLessonHeld({ studentId, teacherId, childName, lessonDate, startTime }) {
  return safely(async () => {
    const coach = (await teacherName(teacherId)) || 'Your coach';
    const forLine = childName ? ` for ${childName}` : '';
    await notify({
      role: 'student',
      id: studentId,
      kind: 'lesson_held',
      title: 'Lesson held for you',
      body: `${coach} is holding ${lessonWhen({ lessonDate, startTime })}${forLine}. Accept or decline it on My Lessons.`,
      link: '/my-lessons',
    });
  });
}

/** students: [{ studentId, childName, lessonDate }] whose held (not yet accepted) lesson was withdrawn. */
export function notifyStudentsHeldCancelled({ students, teacherId, startTime, byStudio = false }) {
  return safely(async () => {
    const list = (students || []).filter((s) => s?.studentId);
    if (!list.length) return;
    const coach = (await teacherName(teacherId)) || 'Your coach';
    const actor = byStudio ? 'The studio' : coach;
    await notifyMany(
      list.map(({ studentId, childName, lessonDate }) => ({
        role: 'student',
        id: studentId,
        kind: 'held_cancelled',
        title: 'Held lesson cancelled',
        body: `${actor} cancelled the lesson held for you${childName ? ` (${childName})` : ''} on ${lessonWhen({ lessonDate, startTime })}.`,
        link: '/my-lessons',
      })),
    );
  });
}

/**
 * Retracts the original cancellation notifications (by ref) and tells the other side the lesson
 * is back on. undoneBy: 'student', 'teacher', or 'studio'.
 */
export function notifyCancellationUndone({
  refs,
  undoneBy,
  studentId,
  childName,
  teacherId,
  lessonDate,
  startTime,
}) {
  return safely(async () => {
    const list = (refs || []).filter(Boolean);
    if (list.length) {
      await query('DELETE FROM notifications WHERE ref = ANY($1::text[])', [list]);
    }
    const when = lessonWhen({ lessonDate, startTime });
    if (undoneBy === 'student') {
      const who = personLabel(await studentName(studentId), childName);
      await notify({
        role: 'teacher',
        id: teacherId,
        kind: 'cancellation_undone',
        title: 'Lesson back on',
        body: `${who} undid their cancellation. Their lesson on ${when} is back on.`,
        link: '/teacher',
      });
      return;
    }
    const actor = undoneBy === 'studio' ? 'The studio' : (await teacherName(teacherId)) || 'Your coach';
    const forLine = childName ? ` for ${childName}` : '';
    await notify({
      role: 'student',
      id: studentId,
      kind: 'cancellation_undone',
      title: 'Lesson back on',
      body: `${actor} undid the cancellation. Your lesson${forLine} on ${when} is back on.`,
      link: '/my-lessons',
    });
  });
}

/**
 * students: [{ studentId, childName, lessonDate?, ref? }] (a per-student lessonDate overrides the shared one).
 * scope: 'lesson' | 'week' | 'weekly'. byStudio: the studio (owner) cancelled rather than the coach.
 */
export function notifyStudentsLessonCancelled({
  students,
  teacherId,
  scope,
  lessonDate,
  weekday,
  startTime,
  byStudio = false,
}) {
  return safely(async () => {
    const seen = new Set();
    const unique = (students || []).filter((s) => {
      if (!s?.studentId) return false;
      const key = `${s.studentId}:${s.childName || ''}:${fmtDate(s.lessonDate) || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) return;

    const coach = (await teacherName(teacherId)) || 'your coach';
    const actor = byStudio ? 'The studio' : coach;
    const withCoach = byStudio ? ` with ${coach}` : '';
    await notifyMany(
      unique.map(({ studentId, childName, lessonDate: ownDate, ref }) => {
        const forLine = childName ? ` for ${childName}` : '';
        const date = ownDate || lessonDate;
        const body =
          scope === 'weekly'
            ? `${actor} ended your weekly spot${forLine}${withCoach} (${weeklyWhen({ weekday, startTime })}).`
            : `${actor} cancelled your lesson${forLine}${withCoach} on ${lessonWhen({ lessonDate: date, startTime })}.`;
        return {
          role: 'student',
          id: studentId,
          kind: 'lesson_cancelled',
          title: scope === 'weekly' ? 'Weekly spot ended' : 'Lesson cancelled',
          body,
          link: '/my-lessons',
          ref,
        };
      }),
    );
  });
}

export function notifyStudentCoachFilled({
  studentId,
  childName,
  fromTeacherId,
  toTeacherId,
  series,
  lessonDate,
  weekday,
  startTime,
}) {
  return safely(async () => {
    if (!studentId) return;
    const [fromCoach, toCoach] = await Promise.all([teacherName(fromTeacherId), teacherName(toTeacherId)]);
    const forLine = childName ? ` for ${childName}` : '';
    const when = series
      ? weeklyWhen({ weekday, startTime, startsOn: lessonDate })
      : lessonWhen({ lessonDate, startTime });
    await notify({
      role: 'student',
      id: studentId,
      kind: 'coach_filled',
      title: series ? 'Your weekly lesson has a new coach' : 'Your lesson has a new coach',
      body: `${toCoach || 'A new coach'} will teach your lesson${forLine} instead of ${fromCoach || 'your coach'}: ${when}.`,
      link: '/my-lessons',
    });
  });
}
