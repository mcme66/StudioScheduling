/**
 * Lesson payments: coaches mark past lessons complete (creating student charges),
 * students report payments, and the studio settles floor fees / payouts with coaches.
 */

export const up = (pgm) => {
  pgm.addColumn('teachers', {
    track_payments_since: { type: 'date' },
  });

  // Managed coaches always track payments.
  pgm.sql(`
    UPDATE teachers
       SET track_payments = true
     WHERE id IN (SELECT teacher_id FROM teacher_studios WHERE owner_managed = true);
    UPDATE teachers
       SET track_payments_since = CURRENT_DATE
     WHERE track_payments = true AND track_payments_since IS NULL;
  `);

  pgm.createTable('studio_settlements', {
    id: 'id',
    studio_id: { type: 'integer', notNull: true, references: 'studios', onDelete: 'CASCADE' },
    teacher_id: { type: 'integer', notNull: true, references: 'teachers', onDelete: 'CASCADE' },
    direction: { type: 'text', notNull: true },
    amount_cents: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'studio_settlements',
    'studio_settlements_direction_valid',
    "CHECK (direction IN ('coach_to_studio', 'studio_to_coach'))",
  );
  pgm.createIndex('studio_settlements', ['studio_id', 'teacher_id']);

  pgm.createTable('lesson_completions', {
    id: 'id',
    studio_id: { type: 'integer', notNull: true, references: 'studios', onDelete: 'CASCADE' },
    teacher_id: { type: 'integer', notNull: true, references: 'teachers', onDelete: 'CASCADE' },
    slot_id: { type: 'integer', references: 'slots', onDelete: 'SET NULL' },
    booking_id: { type: 'integer', references: 'bookings', onDelete: 'SET NULL' },
    recurring_assignment_id: {
      type: 'integer',
      references: 'recurring_assignments',
      onDelete: 'SET NULL',
    },
    student_id: { type: 'integer', notNull: true, references: 'students', onDelete: 'CASCADE' },
    payment_partner_id: { type: 'integer', references: 'students', onDelete: 'SET NULL' },
    child_name: { type: 'text' },
    lesson_date: { type: 'date', notNull: true },
    start_time: { type: 'time', notNull: true },
    duration_min: { type: 'integer', notNull: true },
    price_cents: { type: 'integer', notNull: true },
    floor_fee_cents: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'text', notNull: true },
    completed_by_role: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'lesson_completions',
    'lesson_completions_status_valid',
    "CHECK (status IN ('charged', 'skipped'))",
  );
  pgm.addConstraint(
    'lesson_completions',
    'lesson_completions_source',
    'CHECK (booking_id IS NULL OR recurring_assignment_id IS NULL)',
  );
  pgm.createIndex('lesson_completions', 'booking_id', {
    unique: true,
    name: 'lesson_completions_one_per_booking',
    where: 'booking_id IS NOT NULL',
  });
  pgm.createIndex('lesson_completions', ['recurring_assignment_id', 'lesson_date'], {
    unique: true,
    name: 'lesson_completions_one_per_weekly_date',
    where: 'recurring_assignment_id IS NOT NULL',
  });
  pgm.createIndex('lesson_completions', ['teacher_id', 'lesson_date']);

  pgm.createTable('student_charges', {
    id: 'id',
    lesson_completion_id: {
      type: 'integer',
      notNull: true,
      references: 'lesson_completions',
      onDelete: 'CASCADE',
    },
    student_id: { type: 'integer', notNull: true, references: 'students', onDelete: 'CASCADE' },
    amount_cents: { type: 'integer', notNull: true },
    floor_fee_cents: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'due' },
    method: { type: 'text' },
    reported_at: { type: 'timestamptz' },
    paid_at: { type: 'timestamptz' },
    collected_by: { type: 'text' },
    settlement_id: { type: 'integer', references: 'studio_settlements', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'student_charges',
    'student_charges_status_valid',
    "CHECK (status IN ('due', 'reported', 'paid'))",
  );
  pgm.addConstraint(
    'student_charges',
    'student_charges_method_valid',
    "CHECK (method IS NULL OR method IN ('cash', 'venmo', 'card'))",
  );
  pgm.addConstraint(
    'student_charges',
    'student_charges_collected_by_valid',
    "CHECK (collected_by IS NULL OR collected_by IN ('coach', 'studio'))",
  );
  pgm.createIndex('student_charges', 'lesson_completion_id');
  pgm.createIndex('student_charges', ['student_id', 'status']);
  pgm.createIndex('student_charges', 'settlement_id');
};

export const down = (pgm) => {
  pgm.dropTable('student_charges');
  pgm.dropTable('lesson_completions');
  pgm.dropTable('studio_settlements');
  pgm.dropColumn('teachers', 'track_payments_since');
};
