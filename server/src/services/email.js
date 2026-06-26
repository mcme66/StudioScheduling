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
