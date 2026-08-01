import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { todayISO, getMonday, dateForWeekday, addWeeks, addDays, weekdayOf } from './utils/week.js';

/**
 * Demo data for local testing. Safe to re-run.
 * Run: npm run seed
 *
 * Note: weekly slots no longer have a DB unique on (teacher, weekday, start_time)
 * (series can succeed one another), so inserts use NOT EXISTS instead of ON CONFLICT.
 */
async function upsertStudio({ name, slug, description }) {
  const { rows } = await query(
    `INSERT INTO studios (name, slug, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING id`,
    [name, slug, description],
  );
  return rows[0].id;
}

async function upsertTeacher({
  email,
  passwordHash,
  fullName,
  phone,
  bio,
  defaultPriceCents = 7400,
  defaultDurationMin = 45,
  trackPayments = false,
  isActive = true,
}) {
  const { rows } = await query(
    `INSERT INTO teachers (
       email, password_hash, full_name, phone, bio,
       default_price_cents, default_duration_min, track_payments, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       bio = EXCLUDED.bio,
       default_price_cents = EXCLUDED.default_price_cents,
       default_duration_min = EXCLUDED.default_duration_min,
       track_payments = EXCLUDED.track_payments,
       is_active = EXCLUDED.is_active
     RETURNING id`,
    [
      email,
      passwordHash,
      fullName,
      phone,
      bio,
      defaultPriceCents,
      defaultDurationMin,
      trackPayments,
      isActive,
    ],
  );
  return rows[0].id;
}

async function upsertStudent({
  email,
  passwordHash,
  fullName,
  phone,
  isParent = false,
  childrenNames = [],
}) {
  const { rows } = await query(
    `INSERT INTO students (
       email, password_hash, full_name, phone, is_parent, children_names
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       is_parent = EXCLUDED.is_parent,
       children_names = EXCLUDED.children_names
     RETURNING id`,
    [email, passwordHash, fullName, phone, isParent, childrenNames],
  );
  return rows[0].id;
}

async function linkTeacherStudio(teacherId, studioId) {
  await query(
    `INSERT INTO teacher_studios (teacher_id, studio_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [teacherId, studioId],
  );
}

/** Ensure a weekly (non one-off) slot exists; returns its id. */
async function ensureWeeklySlot({
  teacherId,
  weekday,
  startTime,
  durationMin = 45,
  priceCents = 7400,
  seriesStartDate = null,
  seriesEndDate = null,
}) {
  const { rows: existing } = await query(
    `SELECT id FROM slots
      WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3
        AND one_off_date IS NULL
        AND series_start_date IS NOT DISTINCT FROM $4::date
        AND series_end_date IS NOT DISTINCT FROM $5::date
      LIMIT 1`,
    [teacherId, weekday, startTime, seriesStartDate, seriesEndDate],
  );
  if (existing[0]) return existing[0].id;

  // Prefer reusing any open-ended forever slot at this time if we're seeding forever.
  if (!seriesStartDate && !seriesEndDate) {
    const { rows: forever } = await query(
      `SELECT id FROM slots
        WHERE teacher_id = $1 AND weekday = $2 AND start_time = $3
          AND one_off_date IS NULL
          AND series_start_date IS NULL AND series_end_date IS NULL
        LIMIT 1`,
      [teacherId, weekday, startTime],
    );
    if (forever[0]) return forever[0].id;
  }

  const { rows } = await query(
    `INSERT INTO slots (
       teacher_id, weekday, start_time, duration_min, price_cents,
       one_off_date, series_start_date, series_end_date
     )
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
     RETURNING id`,
    [teacherId, weekday, startTime, durationMin, priceCents, seriesStartDate, seriesEndDate],
  );
  return rows[0].id;
}

async function ensureOneOffSlot({
  teacherId,
  weekday,
  startTime,
  oneOffDate,
  durationMin = 45,
  priceCents = 7400,
}) {
  const { rows: existing } = await query(
    `SELECT id FROM slots
      WHERE teacher_id = $1 AND start_time = $2 AND one_off_date = $3::date
      LIMIT 1`,
    [teacherId, startTime, oneOffDate],
  );
  if (existing[0]) return existing[0].id;

  const { rows } = await query(
    `INSERT INTO slots (
       teacher_id, weekday, start_time, duration_min, price_cents, one_off_date
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [teacherId, weekday, startTime, durationMin, priceCents, oneOffDate],
  );
  return rows[0].id;
}

async function ensureBooking({ slotId, studentId, lessonDate, childName = null }) {
  const { rows: existing } = await query(
    `SELECT id FROM bookings
      WHERE slot_id = $1 AND lesson_date = $2 AND status = 'booked'
      LIMIT 1`,
    [slotId, lessonDate],
  );
  if (existing[0]) return existing[0].id;

  const { rows } = await query(
    `INSERT INTO bookings (slot_id, student_id, lesson_date, child_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [slotId, studentId, lessonDate, childName],
  );
  return rows[0].id;
}

async function ensureRecurring({ slotId, studentId, status = 'pending', childName = null }) {
  const { rows: existing } = await query(
    `SELECT id FROM recurring_assignments
      WHERE slot_id = $1 AND student_id = $2 AND status = $3
      LIMIT 1`,
    [slotId, studentId, status],
  );
  if (existing[0]) return existing[0].id;

  // Clear conflicting pending/approved for this slot if we're seeding a specific state.
  if (status === 'approved' || status === 'pending') {
    await query(
      `UPDATE recurring_assignments
          SET status = 'cancelled', decided_at = now()
        WHERE slot_id = $1 AND status IN ('pending', 'approved') AND student_id <> $2`,
      [slotId, studentId],
    );
  }

  const { rows } = await query(
    `INSERT INTO recurring_assignments (slot_id, student_id, status, child_name, decided_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'pending' THEN NULL ELSE now() END)
     RETURNING id`,
    [slotId, studentId, status, childName],
  );
  return rows[0].id;
}

async function seed() {
  const passwordHash = await bcrypt.hash('password123', 12);
  const today = todayISO();
  const thisMonday = getMonday(today);
  const nextMonday = addWeeks(thisMonday, 1);

  const islandId = await upsertStudio({
    name: 'Island Style Dance Studio',
    slug: 'island-style-dance-studio',
    description:
      'Private dance lessons in a welcoming island-style studio. Book one-off sessions or request a weekly spot.',
  });
  const rhythmId = await upsertStudio({
    name: 'Rhythm Room',
    slug: 'rhythm-room',
    description: 'A second studio for testing multi-studio browsing and teacher listing.',
  });

  const allenId = await upsertTeacher({
    email: 'allen@example.com',
    passwordHash,
    fullName: 'Allen',
    phone: '801-513-0401',
    bio: 'Private dance lessons. 45-minute sessions.',
    defaultPriceCents: 7400,
    defaultDurationMin: 45,
    trackPayments: true,
  });
  const mariaId = await upsertTeacher({
    email: 'maria@example.com',
    passwordHash,
    fullName: 'Maria Chen',
    phone: '555-0200',
    bio: 'Ballet and contemporary. Beginner-friendly.',
    defaultPriceCents: 6500,
    defaultDurationMin: 45,
    trackPayments: false,
  });
  const inactiveId = await upsertTeacher({
    email: 'hidden@example.com',
    passwordHash,
    fullName: 'Hidden Instructor',
    phone: null,
    bio: 'Inactive listing for testing the Active toggle.',
    isActive: false,
  });

  await linkTeacherStudio(allenId, islandId);
  await linkTeacherStudio(mariaId, rhythmId);
  await linkTeacherStudio(inactiveId, islandId);

  const janeId = await upsertStudent({
    email: 'student@example.com',
    passwordHash,
    fullName: 'Jane Student',
    phone: '555-0100',
  });
  const parentId = await upsertStudent({
    email: 'parent@example.com',
    passwordHash,
    fullName: 'Sam Metler',
    phone: '555-0142',
    isParent: true,
    childrenNames: ['Alina Metler', 'Ian Metler'],
  });
  const alexId = await upsertStudent({
    email: 'alex@example.com',
    passwordHash,
    fullName: 'Alex Rivera',
    phone: '555-0188',
  });

  // Allen: forever weekly template slots
  const foreverSlots = [
    [1, '16:00'],
    [1, '17:00'],
    [2, '16:30'],
    [3, '16:00'],
    [3, '17:00'],
    [5, '15:00'],
    [5, '16:00'],
  ];
  const allenForever = {};
  for (const [weekday, startTime] of foreverSlots) {
    const id = await ensureWeeklySlot({
      teacherId: allenId,
      weekday,
      startTime,
      seriesStartDate: null,
      seriesEndDate: null,
    });
    allenForever[`${weekday}-${startTime}`] = id;
  }

  // Allen: finite 6-week series starting next week's Wednesday
  const seriesStart = dateForWeekday(nextMonday, 3); // Wed
  const seriesEnd = addDays(seriesStart, 5 * 7);
  const finiteWedId = await ensureWeeklySlot({
    teacherId: allenId,
    weekday: 3,
    startTime: '18:00',
    seriesStartDate: seriesStart,
    seriesEndDate: seriesEnd,
  });

  // Allen: one-time slot later this week or next week (pick a future weekday)
  let oneOffDate = dateForWeekday(thisMonday, 4); // Thu
  if (oneOffDate < today) oneOffDate = dateForWeekday(nextMonday, 4);
  const oneOffId = await ensureOneOffSlot({
    teacherId: allenId,
    weekday: weekdayOf(oneOffDate),
    startTime: '14:00',
    oneOffDate,
  });

  // Maria at Rhythm Room
  for (const [weekday, startTime] of [
    [1, '15:00'],
    [1, '16:00'],
    [4, '17:00'],
    [6, '10:00'],
  ]) {
    await ensureWeeklySlot({
      teacherId: mariaId,
      weekday,
      startTime,
      durationMin: 45,
      priceCents: 6500,
    });
  }

  // Bookings / weekly spots for testing dashboards
  const mon1600 = allenForever['1-16:00'];
  const wed1600 = allenForever['3-16:00'];
  const fri1500 = allenForever['5-15:00'];

  // Jane holds Friday 3pm as an approved weekly spot
  if (fri1500) {
    await ensureRecurring({
      slotId: fri1500,
      studentId: janeId,
      status: 'approved',
    });
  }

  // Parent books Alina into next week's Monday 4pm (one-off booking on forever slot)
  const nextMonLesson = dateForWeekday(nextMonday, 1);
  if (mon1600 && nextMonLesson >= today) {
    await ensureBooking({
      slotId: mon1600,
      studentId: parentId,
      lessonDate: nextMonLesson,
      childName: 'Alina Metler',
    });
  }

  // Alex has a pending weekly request on Wednesday 4pm
  if (wed1600) {
    await ensureRecurring({
      slotId: wed1600,
      studentId: alexId,
      status: 'pending',
    });
    // Also book Alex's first lesson this/next Wed if still open
    let wedLesson = dateForWeekday(thisMonday, 3);
    if (wedLesson < today) wedLesson = dateForWeekday(nextMonday, 3);
    await ensureBooking({
      slotId: wed1600,
      studentId: alexId,
      lessonDate: wedLesson,
    });
  }

  // One-off temporary slot booking for Jane
  if (oneOffId && oneOffDate >= today) {
    await ensureBooking({
      slotId: oneOffId,
      studentId: janeId,
      lessonDate: oneOffDate,
    });
  }

  // Parent books Ian on the finite Wednesday 6pm series (first occurrence)
  if (finiteWedId && seriesStart >= today) {
    await ensureBooking({
      slotId: finiteWedId,
      studentId: parentId,
      lessonDate: seriesStart,
      childName: 'Ian Metler',
    });
  }

  console.log('Seed complete.\n');
  console.log('Studios');
  console.log('  • Island Style Dance Studio  /studios/island-style-dance-studio');
  console.log('  • Rhythm Room               /studios/rhythm-room');
  console.log('\nTeachers (password: password123)');
  console.log('  • allen@example.com   Allen          Island Style (payments on)');
  console.log('  • maria@example.com   Maria Chen     Rhythm Room');
  console.log('  • hidden@example.com  Hidden         inactive listing');
  console.log('\nStudents (password: password123)');
  console.log('  • student@example.com  Jane Student   regular student + weekly Fri 3pm');
  console.log('  • parent@example.com   Sam Metler     parent (Alina, Ian)');
  console.log('  • alex@example.com     Alex Rivera    pending weekly Wed 4pm');
  console.log('\nAlso seeded: forever slots, a 6-week Wed 6pm series, a one-time Thu slot,');
  console.log('parent child bookings, and a pending weekly request for the teacher dashboard.');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
