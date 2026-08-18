/* Per-child partner codes for parent accounts.
 *
 * Sharing a child's code links the two students only for that child's lessons.
 * Unscoped student_partners rows keep the previous full-account sharing behavior.
 */

export const up = (pgm) => {
  pgm.createTable('child_partner_codes', {
    id: 'id',
    student_id: {
      type: 'integer',
      notNull: true,
      references: 'students',
      onDelete: 'CASCADE',
    },
    child_name: { type: 'text', notNull: true },
    partner_code: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('child_partner_codes', 'child_partner_codes_unique_child', {
    unique: ['student_id', 'child_name'],
  });
  pgm.addConstraint('child_partner_codes', 'child_partner_codes_code_unique', {
    unique: ['partner_code'],
  });
  pgm.createIndex('child_partner_codes', 'student_id');

  pgm.addColumns('student_partners', {
    scoped_owner_id: {
      type: 'integer',
      references: 'students',
      onDelete: 'CASCADE',
    },
    scoped_child_name: { type: 'text' },
  });
  pgm.addConstraint(
    'student_partners',
    'student_partners_scope_pair',
    `CHECK (
      (scoped_owner_id IS NULL AND scoped_child_name IS NULL)
      OR (scoped_owner_id IS NOT NULL AND scoped_child_name IS NOT NULL)
    )`,
  );
  pgm.addConstraint(
    'student_partners',
    'student_partners_scope_owner',
    `CHECK (
      scoped_owner_id IS NULL
      OR scoped_owner_id = student_a_id
      OR scoped_owner_id = student_b_id
    )`,
  );

  pgm.dropConstraint('student_partners', 'student_partners_unique_pair');
  pgm.sql(`
    CREATE UNIQUE INDEX student_partners_unscoped_unique
      ON student_partners (student_a_id, student_b_id)
      WHERE scoped_child_name IS NULL;
    CREATE UNIQUE INDEX student_partners_scoped_unique
      ON student_partners (student_a_id, student_b_id, scoped_child_name)
      WHERE scoped_child_name IS NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM student_partners a
     USING student_partners b
     WHERE a.id > b.id
       AND a.student_a_id = b.student_a_id
       AND a.student_b_id = b.student_b_id;
    DROP INDEX IF EXISTS student_partners_unscoped_unique;
    DROP INDEX IF EXISTS student_partners_scoped_unique;
  `);
  pgm.addConstraint('student_partners', 'student_partners_unique_pair', {
    unique: ['student_a_id', 'student_b_id'],
  });
  pgm.dropConstraint('student_partners', 'student_partners_scope_owner');
  pgm.dropConstraint('student_partners', 'student_partners_scope_pair');
  pgm.dropColumns('student_partners', ['scoped_owner_id', 'scoped_child_name']);
  pgm.dropTable('child_partner_codes');
};
