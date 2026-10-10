/** Studio the student attends, owner attendance marks, and the reduced floor fee. */

export const up = (pgm) => {
  pgm.addColumns('studios', {
    studio_student_floor_fee_cents: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('studios', 'studios_studio_student_floor_fee_cents_check', {
    check: 'studio_student_floor_fee_cents >= 0',
  });

  pgm.addColumns('students', {
    home_studio_id: {
      type: 'integer',
      references: 'studios',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('students', 'home_studio_id');

  pgm.createTable('studio_student_marks', {
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    student_id: {
      type: 'integer',
      notNull: true,
      references: 'students',
      onDelete: 'CASCADE',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('studio_student_marks', 'studio_student_marks_pkey', {
    primaryKey: ['studio_id', 'student_id'],
  });
  pgm.createIndex('studio_student_marks', 'student_id');
};

export const down = (pgm) => {
  pgm.dropTable('studio_student_marks');
  pgm.dropIndex('students', 'home_studio_id');
  pgm.dropColumns('students', ['home_studio_id']);
  pgm.dropConstraint('studios', 'studios_studio_student_floor_fee_cents_check');
  pgm.dropColumns('studios', ['studio_student_floor_fee_cents']);
};
