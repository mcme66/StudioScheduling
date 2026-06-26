import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';

// Creates a demo studio, teacher + student and a handful of slots. Safe to run more
// than once (uses ON CONFLICT). Run with: npm run seed
async function seed() {
  const teacherPass = await bcrypt.hash('password123', 12);
  const studentPass = await bcrypt.hash('password123', 12);

  const { rows: studioRows } = await query(
    `INSERT INTO studios (name, slug, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING id`,
    [
      'Island Style Dance Studio',
      'island-style-dance-studio',
      'Private dance lessons in a welcoming island-style studio. Book one-off sessions or request a weekly spot.',
    ],
  );
  const studioId = studioRows[0].id;

  const { rows: teacherRows } = await query(
    `INSERT INTO teachers (email, password_hash, full_name, phone, bio, default_price_cents, default_duration_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [
      'allen@example.com',
      teacherPass,
      'Allen',
      '801-513-0401',
      'Private dance lessons. 45-minute sessions.',
      7400,
      45,
    ],
  );
  const teacherId = teacherRows[0].id;

  await query(
    `INSERT INTO teacher_studios (teacher_id, studio_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [teacherId, studioId],
  );

  await query(
    `INSERT INTO students (email, password_hash, full_name, phone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    ['student@example.com', studentPass, 'Jane Student', '555-0100'],
  );

  // A few weekly slots (weekday 1=Mon .. 5=Fri).
  const slots = [
    [1, '16:00'],
    [1, '17:00'],
    [3, '16:00'],
    [3, '17:00'],
    [5, '15:00'],
  ];
  for (const [weekday, startTime] of slots) {
    await query(
      `INSERT INTO slots (teacher_id, weekday, start_time, duration_min, price_cents)
       VALUES ($1, $2, $3, 45, 7400)
       ON CONFLICT (teacher_id, weekday, start_time) DO NOTHING`,
      [teacherId, weekday, startTime],
    );
  }

  console.log('Seed complete.');
  console.log('  Studio: Island Style Dance Studio');
  console.log('  Teacher login: allen@example.com / password123');
  console.log('  Student login: student@example.com / password123');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
