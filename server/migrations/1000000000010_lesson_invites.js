/** Teacher-scheduled lesson invites that a student must accept. */

export const up = (pgm) => {
  pgm.createTable('lesson_invites', {
    id: 'id',
    slot_id: {
      type: 'integer',
      notNull: true,
      references: 'slots',
      onDelete: 'CASCADE',
    },
    student_id: {
      type: 'integer',
      notNull: true,
      references: 'students',
      onDelete: 'CASCADE',
    },
    lesson_date: { type: 'date', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    decided_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(
    'lesson_invites',
    'lesson_invites_status_valid',
    "CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))",
  );
  pgm.createIndex('lesson_invites', ['slot_id', 'lesson_date'], {
    unique: true,
    name: 'lesson_invites_one_pending_per_slot_date',
    where: "status = 'pending'",
  });
  pgm.createIndex('lesson_invites', 'student_id');
  pgm.createIndex('lesson_invites', ['lesson_date'], {
    name: 'lesson_invites_pending_date',
    where: "status = 'pending'",
  });
};

export const down = (pgm) => {
  pgm.dropTable('lesson_invites');
};
