import nodemailer from 'nodemailer';
import { env, isEmailConfigured } from '../env.js';

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
export async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.log('\n--- EMAIL (SMTP not configured, logging only) ---');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('--- END EMAIL ---\n');
    return;
  }
  try {
    await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
  } catch (err) {
    // Never let an email failure break a booking flow.
    console.error('Failed to send email:', err.message);
  }
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export async function sendBookingConfirmation({ student, teacher, slot, lessonDate }) {
  if (!studentWantsEmail(student)) return;

  const subject = `Lesson confirmed: ${lessonDate} at ${formatTime(slot.start_time)}`;
  const body = [
    `Hi ${student.full_name},`,
    '',
    `Your lesson with ${teacher.full_name} is confirmed.`,
    `Date: ${lessonDate}`,
    `Time: ${formatTime(slot.start_time)} (${slot.duration_min} min)`,
    '',
    `Manage your lessons: ${env.clientUrl}/my-lessons`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>Your lesson with ${teacher.full_name} is confirmed.</p>`,
    `<p><strong>Date:</strong> ${lessonDate}<br>`,
    `<strong>Time:</strong> ${formatTime(slot.start_time)} (${slot.duration_min} min)</p>`,
    `<p><a href="${env.clientUrl}/my-lessons">Manage your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: student.email, subject, text, html });
}

export async function sendRecurringApproved({ student, teacher, slot }) {
  if (!studentWantsEmail(student)) return;

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const subject = 'Your weekly lesson spot is confirmed';
  const body = [
    `Hi ${student.full_name},`,
    '',
    `${teacher.full_name} approved your weekly spot:`,
    `Every ${weekdays[slot.weekday]} at ${formatTime(slot.start_time)} (${slot.duration_min} min).`,
    '',
    `This time is now yours each week. View it any time: ${env.clientUrl}/my-lessons`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>${teacher.full_name} approved your weekly spot:</p>`,
    `<p>Every ${weekdays[slot.weekday]} at ${formatTime(slot.start_time)} (${slot.duration_min} min).</p>`,
    `<p>This time is now yours each week. <a href="${env.clientUrl}/my-lessons">View your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: student.email, subject, text, html });
}

export async function sendReminder({ student, teacher, slot, lessonDate }) {
  if (!studentWantsEmail(student)) return;

  const subject = `Reminder: lesson on ${lessonDate} at ${formatTime(slot.start_time)}`;
  const body = [
    `Hi ${student.full_name},`,
    '',
    `This is a reminder of your upcoming lesson with ${teacher.full_name}.`,
    `Date: ${lessonDate}`,
    `Time: ${formatTime(slot.start_time)} (${slot.duration_min} min)`,
    '',
    `Need to cancel? ${env.clientUrl}/my-lessons`,
  ].join('\n');
  const text = body + emailFooterText();
  const html = [
    `<p>Hi ${student.full_name},</p>`,
    `<p>This is a reminder of your upcoming lesson with ${teacher.full_name}.</p>`,
    `<p><strong>Date:</strong> ${lessonDate}<br>`,
    `<strong>Time:</strong> ${formatTime(slot.start_time)} (${slot.duration_min} min)</p>`,
    `<p><a href="${env.clientUrl}/my-lessons">Manage your lessons</a></p>`,
    emailFooterHtml(),
  ].join('');
  await sendEmail({ to: student.email, subject, text, html });
}

export async function sendPasswordReset({ email, fullName, role, token }) {
  const resetUrl = `${env.clientUrl}/${role}/reset-password?token=${token}`;
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
