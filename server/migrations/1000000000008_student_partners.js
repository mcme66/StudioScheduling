/* Student partnerships: a shareable partner code, a many-to-many join table,
 * and per-lesson payment-split fields (booker paid vs selected partner paid).
 */

export const up = (pgm) => {
  pgm.addColumns('students', {
    partner_code: { type: 'text' },
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION tmp_gen_partner_code() RETURNS text AS $$
    DECLARE
      chars text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
      result text := '';
      i int;
    BEGIN
      FOR i IN 1..8 LOOP
        result := result || substr(chars, 1 + (floor(random() * length(chars)))::int, 1);
      END LOOP;
      RETURN result;
    END;
    $$ LANGUAGE plpgsql;

    UPDATE students SET partner_code = tmp_gen_partner_code() WHERE partner_code IS NULL;

    DO $$
    DECLARE
      dup text;
    BEGIN
      LOOP
        SELECT partner_code INTO dup
          FROM students
         GROUP BY partner_code
        HAVING COUNT(*) > 1
         LIMIT 1;
        EXIT WHEN NOT FOUND;
        UPDATE students
           SET partner_code = tmp_gen_partner_code()
         WHERE id IN (
           SELECT id FROM students WHERE partner_code = dup OFFSET 1
         );
      END LOOP;
    END $$;

    DROP FUNCTION tmp_gen_partner_code();
  `);

  pgm.alterColumn('students', 'partner_code', { notNull: true });
  pgm.addConstraint('students', 'students_partner_code_unique', {
    unique: ['partner_code'],
  });

  pgm.createTable('student_partners', {
    id: 'id',
    student_a_id: {
      type: 'integer',
      notNull: true,
      references: 'students',
      onDelete: 'CASCADE',
    },
    student_b_id: {
      type: 'integer',
      notNull: true,
      references: 'students',
      onDelete: 'CASCADE',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'student_partners',
    'student_partners_ordered',
    'CHECK (student_a_id < student_b_id)',
  );
  pgm.addConstraint('student_partners', 'student_partners_unique_pair', {
    unique: ['student_a_id', 'student_b_id'],
  });
  pgm.createIndex('student_partners', 'student_a_id');
  pgm.createIndex('student_partners', 'student_b_id');

  pgm.addColumns('bookings', {
    payment_partner_id: {
      type: 'integer',
      references: 'students',
      onDelete: 'SET NULL',
    },
    partner_paid: { type: 'boolean', notNull: true, default: false },
  });
  pgm.createIndex('bookings', 'payment_partner_id');

  pgm.addColumns('recurring_assignments', {
    payment_partner_id: {
      type: 'integer',
      references: 'students',
      onDelete: 'SET NULL',
    },
    starts_on: { type: 'date' },
  });
  pgm.createIndex('recurring_assignments', 'payment_partner_id');

  pgm.sql(`
    UPDATE recurring_assignments ra
       SET starts_on = COALESCE(
         (
           SELECT MIN(b.lesson_date)
             FROM bookings b
            WHERE b.slot_id = ra.slot_id
              AND b.student_id = ra.student_id
              AND b.status = 'booked'
         ),
         (ra.requested_at AT TIME ZONE 'UTC')::date
       )
     WHERE starts_on IS NULL;
  `);
  pgm.alterColumn('recurring_assignments', 'starts_on', { notNull: true });

  pgm.addColumns('recurring_lesson_payments', {
    partner_paid: { type: 'boolean', notNull: true, default: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('recurring_lesson_payments', ['partner_paid']);
  pgm.dropColumns('recurring_assignments', ['payment_partner_id', 'starts_on']);
  pgm.dropColumns('bookings', ['payment_partner_id', 'partner_paid']);
  pgm.dropTable('student_partners');
  pgm.dropConstraint('students', 'students_partner_code_unique');
  pgm.dropColumns('students', ['partner_code']);
};
