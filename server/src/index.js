import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './env.js';
import { pool } from './db.js';
import { attachUser } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { teachersRouter } from './routes/teachers.js';
import { slotsRouter } from './routes/slots.js';
import { bookingsRouter } from './routes/bookings.js';
import { recurringRouter } from './routes/recurring.js';
import { studiosRouter } from './routes/studios.js';
import { studentsRouter } from './routes/students.js';
import { startReminderJob } from './services/reminders.js';
import { startTeacherDailyScheduleJob } from './services/teacherDailySchedule.js';

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/studios', studiosRouter);
app.use('/api/teachers', teachersRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/students', studentsRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Lesson Scheduling API listening on port ${env.port} (${env.nodeEnv})`);
  startReminderJob();
  startTeacherDailyScheduleJob();
});
