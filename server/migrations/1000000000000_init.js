/* Initial schema for the Lesson Scheduling app. */

export const up = (pgm) => {
  // --- studios ---------------------------------------------------------------
  pgm.createTable('studios', {
    id: 'id',
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true, unique: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- teachers --------------------------------------------------------------
  pgm.createTable('teachers', {
    id: 'id',
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    bio: { type: 'text' },
    additional_info: { type: 'text' },
    teaching_policies: { type: 'text' },
    default_price_cents: { type: 'integer', notNull: true, default: 7400 },
    default_duration_min: { type: 'integer', notNull: true, default: 45 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- teacher_studios (instructors may teach at multiple studios) ----------
  pgm.createTable('teacher_studios', {
    teacher_id: {
      type: 'integer',
      notNull: true,
      references: 'teachers',
      onDelete: 'CASCADE',
    },
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('teacher_studios', 'teacher_studios_pkey', { primaryKey: ['teacher_id', 'studio_id'] });
  pgm.createIndex('teacher_studios', 'studio_id');

  // --- students --------------------------------------------------------------
  pgm.createTable('students', {
    id: 'id',
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    receive_emails: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- slots (a teacher's weekly recurring availability template) -----------
  pgm.createTable('slots', {
    id: 'id',
    teacher_id: {
      type: 'integer',
      notNull: true,
      references: 'teachers',
      onDelete: 'CASCADE',
    },
    weekday: { type: 'smallint', notNull: true }, // 0 = Sunday ... 6 = Saturday
    start_time: { type: 'time', notNull: true },
    duration_min: { type: 'integer', notNull: true, default: 45 },
    price_cents: { type: 'integer', notNull: true, default: 7400 },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('slots', 'slots_weekday_range', 'CHECK (weekday BETWEEN 0 AND 6)');
  pgm.addConstraint('slots', 'slots_unique_teacher_weekday_time', {
    unique: ['teacher_id', 'weekday', 'start_time'],
  });
  pgm.createIndex('slots', 'teacher_id');

  // --- recurring_assignments (the "weekly spot" feature) --------------------
  pgm.createTable('recurring_assignments', {
    id: 'id',
    slot_id: { type: 'integer', notNull: true, references: 'slots', onDelete: 'CASCADE' },
    student_id: { type: 'integer', notNull: true, references: 'students', onDelete: 'CASCADE' },
    status: { type: 'text', notNull: true, default: 'pending' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    decided_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(
    'recurring_assignments',
    'recurring_status_valid',
    "CHECK (status IN ('pending', 'approved', 'declined'))",
  );
  // At most one approved (weekly) student per slot.
  pgm.createIndex('recurring_assignments', ['slot_id'], {
    unique: true,
    name: 'recurring_one_approved_per_slot',
    where: "status = 'approved'",
  });
  // At most one pending weekly-spot request per slot.
  pgm.createIndex('recurring_assignments', ['slot_id'], {
    unique: true,
    name: 'recurring_one_pending_per_slot',
    where: "status = 'pending'",
  });

  // --- bookings (one-off lessons for a specific week) -----------------------
  pgm.createTable('bookings', {
    id: 'id',
    slot_id: { type: 'integer', notNull: true, references: 'slots', onDelete: 'CASCADE' },
    student_id: { type: 'integer', notNull: true, references: 'students', onDelete: 'CASCADE' },
    lesson_date: { type: 'date', notNull: true },
    status: { type: 'text', notNull: true, default: 'booked' },
    reminder_sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    cancelled_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(
    'bookings',
    'bookings_status_valid',
    "CHECK (status IN ('booked', 'cancelled'))",
  );
  // Only one active booking per slot per date (allows rebooking after a cancel).
  pgm.createIndex('bookings', ['slot_id', 'lesson_date'], {
    unique: true,
    name: 'bookings_one_active_per_slot_date',
    where: "status = 'booked'",
  });
  pgm.createIndex('bookings', 'student_id');
  pgm.createIndex('bookings', 'lesson_date');
};

export const down = (pgm) => {
  pgm.dropTable('bookings');
  pgm.dropTable('recurring_assignments');
  pgm.dropTable('slots');
  pgm.dropTable('teacher_studios');
  pgm.dropTable('students');
  pgm.dropTable('teachers');
  pgm.dropTable('studios');
};
