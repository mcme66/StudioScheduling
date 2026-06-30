import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env explicitly so it works no matter where the process is
// launched from (root scripts, the server folder, etc.). In Docker there is no
// .env file and real environment variables are used instead.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:8080',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'Lesson Scheduling <no-reply@example.com>',
  },
  reminderLeadHours: Number(process.env.REMINDER_LEAD_HOURS) || 24,
  passwordResetExpiresHours: Number(process.env.PASSWORD_RESET_EXPIRES_HOURS) || 1,
  teacherDailyScheduleTimezone: process.env.TEACHER_DAILY_SCHEDULE_TIMEZONE || 'America/Denver',
};

export const isEmailConfigured = Boolean(env.smtp.host && env.smtp.user);
