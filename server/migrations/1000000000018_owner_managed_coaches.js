/** Studio owners can manage a coach's schedule and receive cancellation requests. */

export const up = (pgm) => {
  pgm.addColumn('teacher_studios', {
    owner_managed: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createTable('cancellation_requests', {
    id: 'id',
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    teacher_id: {
      type: 'integer',
      notNull: true,
      references: 'teachers',
      onDelete: 'CASCADE',
    },
    slot_id: {
      type: 'integer',
      references: 'slots',
      onDelete: 'SET NULL',
    },
    lesson_date: { type: 'date' },
    weekday: { type: 'smallint', notNull: true },
    start_time: { type: 'time', notNull: true },
    duration_min: { type: 'integer', notNull: true },
    price_cents: { type: 'integer', notNull: true },
    action: { type: 'text', notNull: true },
    booking_id: {
      type: 'integer',
      references: 'bookings',
      onDelete: 'SET NULL',
    },
    recurring_assignment_id: {
      type: 'integer',
      references: 'recurring_assignments',
      onDelete: 'SET NULL',
    },
    invite_id: {
      type: 'integer',
      references: 'lesson_invites',
      onDelete: 'SET NULL',
    },
    from_date: { type: 'date' },
    student_id: {
      type: 'integer',
      references: 'students',
      onDelete: 'SET NULL',
    },
    child_name: { type: 'text' },
    payment_partner_id: {
      type: 'integer',
      references: 'students',
      onDelete: 'SET NULL',
    },
    occupant_label: { type: 'text', notNull: true },
    occupant_detail: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending' },
    filled_teacher_id: {
      type: 'integer',
      references: 'teachers',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'cancellation_requests',
    'cancellation_requests_action_valid',
    "CHECK (action IN ('booking_cancel', 'week_skip', 'week_block', 'recurring_remove', 'slot_delete', 'series_end', 'invite_cancel'))",
  );
  pgm.addConstraint(
    'cancellation_requests',
    'cancellation_requests_status_valid',
    "CHECK (status IN ('pending', 'applied', 'filled', 'dismissed'))",
  );
  pgm.addConstraint(
    'cancellation_requests',
    'cancellation_requests_weekday_check',
    'CHECK (weekday >= 0 AND weekday <= 6)',
  );

  pgm.sql(`
    CREATE UNIQUE INDEX cancellation_requests_one_pending
      ON cancellation_requests (
        teacher_id,
        slot_id,
        action,
        (COALESCE(lesson_date, DATE '1970-01-01'))
      )
      WHERE status = 'pending'
  `);
  pgm.createIndex('cancellation_requests', 'studio_id');
  pgm.createIndex('cancellation_requests', 'teacher_id');
};

export const down = (pgm) => {
  pgm.dropTable('cancellation_requests');
  pgm.dropColumn('teacher_studios', 'owner_managed');
};
