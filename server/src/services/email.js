import nodemailer from 'nodemailer';
import { env, isEmailConfigured } from '../env.js';
import { buildIcs, buildLessonEvent, googleCalendarUrl } from '../utils/calendar.js';

let transporter = null;

if (isEmailConfigured) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  });
}

const profileUrl = () => `${env.clientUrl}/profile`;

export function studentWantsEmail(student) {
  return student?.receive_emails !== false;
}

export function teacherWantsEmail(teacher) {
  return teacher?.receive_emails !== false;
}

function emailFooterText() {
  return ['', `Unsubscribe from emails: ${profileUrl()}`].join('\n');
}

function emailFooterHtml() {
  return `<p style="margin-top:1.5em;font-size:13px;color:#666;"><a href="${profileUrl()}">Unsubscribe from emails</a></p>`;
}

/**
 * Send an email. When SMTP is not configured, the message is logged to the
 * console instead so local/dev environments work without a mail server.
 */
export async function sendEmail({ to, subject, text, html, attachments }) {
  if (!transporter) {
    console.log('\n--- EMAIL (SMTP not configured, logging only) ---');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    if (attachments?.length) {
      console.log(`Attachments: ${attachments.map((a) => a.filename).join(', ')}`);
    }
    console.log('--- END EMAIL ---\n');
    return;
  }
  try {
    await transporter.sendMail({
      from: env.smtp.from,
      to,
      subject,
      text,
      html,
      attachments,
    });
  } catch (err) {
    // Never let an email failure break a booking flow.
    console.error('Failed to send email:', err.message);
  }
}

function lessonCalendarPayload({ teacher, slot, lessonDate, childName }) {
  const manageUrl = `${env.clientUrl}/my-lessons`;
  const event = buildLessonEvent({
    teacherName: teacher.full_name,
    childName,
    lessonDate,
    startTime: slot.start_time,
    durationMin: slot.duration_min,
    manageUrl,
  });
  const googleUrl = googleCalendarUrl(event);
  const ics = buildIcs(event);
  return { manageUrl, googleUrl, ics, event };
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export async function sendBookingConfirmation({ student, teacher, slot, lessonDate, childName }) {
  if (!studentWantsEmail(student)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const { manageUrl, googleUrl, ics } = lessonCalendarPayload({
    teacher,
    slot,
    lessonDate,
    childName,
  });
  const subject = `Lesson confirmed: ${lessonDate} at ${formatTime(slot.start_time)}`;
  const body = [
    `Hi ${student.full_name},`,
    '',
    `Your lesson${forLine} with ${teacher.full_name} is confirmed.`,
    `Date: ${lessonDate}`,
    `Time: ${formatTime(slot.start_time)} (${slot.duration_min} min)`,
    '',
    `Add to Google Calendar: ${googleUrl}`,
    '(A calendar invite file is also attached for Apple Calendar, Outlook, and others.)',
    '',
    `Manage your lessons: ${manageUrl}`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>Your lesson${forLine} with ${teacher.full_name} is confirmed.</p>`,
    `<p><strong>Date:</strong> ${lessonDate}<br>`,
    `<strong>Time:</strong> ${formatTime(slot.start_time)} (${slot.duration_min} min)</p>`,
    `<p><a href="${googleUrl}">Add to Google Calendar</a><br>`,
    `<span style="font-size:13px;color:#666;">A .ics attachment is included for Apple Calendar, Outlook, and others.</span></p>`,
    `<p><a href="${manageUrl}">Manage your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({
    to: student.email,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `lesson-${lessonDate}.ics`,
        content: ics,
        contentType: 'text/calendar; charset=utf-8',
      },
    ],
  });
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weeklyWhen(slot) {
  return `Every ${WEEKDAY_NAMES[slot.weekday]} at ${formatTime(slot.start_time)} (${slot.duration_min} min)`;
}

export async function sendRecurringApproved({ student, teacher, slot, childName, startsOn }) {
  if (!studentWantsEmail(student)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const startLine = startsOn ? ` Starting ${startsOn}.` : '';
  const subject = 'Your weekly lesson spot is confirmed';
  const body = [
    `Hi ${student.full_name},`,
    '',
    `${teacher.full_name} accepted your weekly spot${forLine}:`,
    `${weeklyWhen(slot)}.${startLine}`,
    '',
    `This time is now yours each week. View it any time: ${env.clientUrl}/my-lessons`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>${teacher.full_name} accepted your weekly spot${forLine}:</p>`,
    `<p>${weeklyWhen(slot)}.${startLine}</p>`,
    `<p>This time is now yours each week. <a href="${env.clientUrl}/my-lessons">View your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: student.email, subject, text, html });
}

export async function sendWeeklySpotRequested({ teacher, student, slot, lessonDate, childName }) {
  if (!teacherWantsEmail(teacher)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const who = childName ? `${childName} (${student.full_name})` : student.full_name;
  const subject = `Weekly spot request from ${who}`;
  const scheduleUrl = `${env.clientUrl}/teacher`;
  const body = [
    `Hi ${teacher.full_name},`,
    '',
    `${student.full_name} requested a weekly spot${forLine}.`,
    `${weeklyWhen(slot)}, starting ${lessonDate}.`,
    '',
    'Nothing is booked yet. On your schedule you can accept every week, book this date only, or decline.',
    scheduleUrl,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${teacher.full_name},</p>`,
    `<p>${student.full_name} requested a weekly spot${forLine}.</p>`,
    `<p>${weeklyWhen(slot)}, starting ${lessonDate}.</p>`,
    `<p>Nothing is booked yet. On your schedule you can accept every week, book this date only, or decline.</p>`,
    `<p><a href="${scheduleUrl}">Open your schedule</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: teacher.email, subject, text, html });
}

export async function sendWeeklySpotDeclined({ student, teacher, slot, lessonDate, childName }) {
  if (!studentWantsEmail(student)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const subject = 'Weekly spot request declined';
  const body = [
    `Hi ${student.full_name},`,
    '',
    `${teacher.full_name} declined your weekly spot request${forLine}.`,
    `${weeklyWhen(slot)}, starting ${lessonDate}.`,
    '',
    'No lesson was booked. You can choose another time:',
    `${env.clientUrl}/my-lessons`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>${teacher.full_name} declined your weekly spot request${forLine}.</p>`,
    `<p>${weeklyWhen(slot)}, starting ${lessonDate}.</p>`,
    `<p>No lesson was booked. <a href="${env.clientUrl}/my-lessons">View your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: student.email, subject, text, html });
}

export async function sendWeeklySpotOneTime({ student, teacher, slot, lessonDate, childName }) {
  if (!studentWantsEmail(student)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const { manageUrl, googleUrl, ics } = lessonCalendarPayload({
    teacher,
    slot,
    lessonDate,
    childName,
  });
  const subject = `Single lesson confirmed: ${lessonDate} at ${formatTime(slot.start_time)}`;
  const body = [
    `Hi ${student.full_name},`,
    '',
    `${teacher.full_name} booked one lesson${forLine} instead of the weekly spot.`,
    `Date: ${lessonDate}`,
    `Time: ${formatTime(slot.start_time)} (${slot.duration_min} min)`,
    '',
    'The other weeks of this time are not reserved.',
    '',
    `Add to Google Calendar: ${googleUrl}`,
    '(A calendar invite file is also attached for Apple Calendar, Outlook, and others.)',
    '',
    `Manage your lessons: ${manageUrl}`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>${teacher.full_name} booked one lesson${forLine} instead of the weekly spot.</p>`,
    `<p><strong>Date:</strong> ${lessonDate}<br>`,
    `<strong>Time:</strong> ${formatTime(slot.start_time)} (${slot.duration_min} min)</p>`,
    `<p>The other weeks of this time are not reserved.</p>`,
    `<p><a href="${googleUrl}">Add to Google Calendar</a><br>`,
    `<span style="font-size:13px;color:#666;">A .ics attachment is included for Apple Calendar, Outlook, and others.</span></p>`,
    `<p><a href="${manageUrl}">Manage your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({
    to: student.email,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `lesson-${lessonDate}.ics`,
        content: ics,
        contentType: 'text/calendar; charset=utf-8',
      },
    ],
  });
}

export async function sendReminder({ student, teacher, slot, lessonDate, childName }) {
  if (!studentWantsEmail(student)) return;

  const forLine = childName ? ` for ${childName}` : '';
  const { manageUrl, googleUrl, ics } = lessonCalendarPayload({
    teacher,
    slot,
    lessonDate,
    childName,
  });
  const subject = `Reminder: lesson on ${lessonDate} at ${formatTime(slot.start_time)}`;
  const body = [
    `Hi ${student.full_name},`,
    '',
    `This is a reminder of your upcoming lesson${forLine} with ${teacher.full_name}.`,
    `Date: ${lessonDate}`,
    `Time: ${formatTime(slot.start_time)} (${slot.duration_min} min)`,
    '',
    `Add to Google Calendar: ${googleUrl}`,
    '(A calendar invite file is also attached for Apple Calendar, Outlook, and others.)',
    '',
    `Need to cancel? ${manageUrl}`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>This is a reminder of your upcoming lesson${forLine} with ${teacher.full_name}.</p>`,
    `<p><strong>Date:</strong> ${lessonDate}<br>`,
    `<strong>Time:</strong> ${formatTime(slot.start_time)} (${slot.duration_min} min)</p>`,
    `<p><a href="${googleUrl}">Add to Google Calendar</a><br>`,
    `<span style="font-size:13px;color:#666;">A .ics attachment is included for Apple Calendar, Outlook, and others.</span></p>`,
    `<p><a href="${manageUrl}">Manage your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({
    to: student.email,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `lesson-${lessonDate}.ics`,
        content: ics,
        contentType: 'text/calendar; charset=utf-8',
      },
    ],
  });
}

export async function sendPasswordReset({ email, fullName, token }) {
  const resetUrl = `${env.clientUrl}/reset-password?token=${token}`;
  const expiresLabel = env.passwordResetExpiresHours === 1
    ? '1 hour'
    : `${env.passwordResetExpiresHours} hours`;
  const subject = 'Reset your password';
  const text = [
    `Hi ${fullName},`,
    '',
    'We received a request to reset your password.',
    `Reset your password: ${resetUrl}`,
    '',
    'If you did not request this, you can ignore this email.',
    `This link expires in ${expiresLabel}.`,
  ].join('\n');
  const html = [
    `<p>Hi ${fullName},</p>`,
    '<p>We received a request to reset your password.</p>',
    `<p><a href="${resetUrl}">Reset your password</a></p>`,
    '<p>If you did not request this, you can ignore this email.</p>',
    `<p style="font-size:13px;color:#666;">This link expires in ${expiresLabel}.</p>`,
  ].join('');
  await sendEmail({ to: email, subject, text, html });
}

function formatLessonDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatLessonLines(lessons, { html }) {
  if (!lessons.length) {
    return html ? '<p>No lessons scheduled for today.</p>' : 'No lessons scheduled for today.';
  }
  if (html) {
    const items = lessons.map(
      (l) => `<li><strong>${formatTime(l.start_time)}</strong> (${l.duration_min} min) — ${l.student_name}</li>`,
    );
    return `<ul>${items.join('')}</ul>`;
  }
  return lessons
    .map((l) => `  ${formatTime(l.start_time)} (${l.duration_min} min) — ${l.student_name}`)
    .join('\n');
}

export async function sendTeacherDailySchedule({ teacher, lessons, lessonDate }) {
  if (!teacherWantsEmail(teacher)) return;
  // Never send an empty digest: only email on days with lessons.
  if (!lessons || lessons.length === 0) return;

  const dateLabel = formatLessonDate(lessonDate);
  const subject = `Your schedule for ${dateLabel}`;
  const lessonText = formatLessonLines(lessons, { html: false });
  const lessonHtml = formatLessonLines(lessons, { html: true });
  const text = [
    `Hi ${teacher.full_name},`,
    '',
    `Here is your teaching schedule for ${dateLabel}:`,
    '',
    lessonText,
    '',
    `View your dashboard: ${env.clientUrl}/teacher`,
  ].join('\n') + emailFooterText();
  const html = [
    `<p>Hi ${teacher.full_name},</p>`,
    `<p>Here is your teaching schedule for <strong>${dateLabel}</strong>:</p>`,
    lessonHtml,
    `<p><a href="${env.clientUrl}/teacher">View your dashboard</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: teacher.email, subject, text, html });
}
