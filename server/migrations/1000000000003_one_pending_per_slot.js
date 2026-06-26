/* At most one pending weekly-spot request per slot (any student). */

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'recurring_one_pending_per_slot'
      ) THEN
        -- Keep only the earliest pending request per slot before adding the constraint.
        DELETE FROM recurring_assignments ra
         WHERE ra.status = 'pending'
           AND ra.id NOT IN (
             SELECT MIN(id) FROM recurring_assignments
              WHERE status = 'pending'
              GROUP BY slot_id
           );

        DROP INDEX IF EXISTS recurring_one_pending_per_student_slot;
        CREATE UNIQUE INDEX recurring_one_pending_per_slot
          ON recurring_assignments (slot_id)
          WHERE status = 'pending';
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS recurring_one_pending_per_slot;
    CREATE UNIQUE INDEX IF NOT EXISTS recurring_one_pending_per_student_slot
      ON recurring_assignments (slot_id, student_id)
      WHERE status = 'pending';
  `);
};
