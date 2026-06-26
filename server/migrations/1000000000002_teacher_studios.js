/* Teachers can belong to multiple studios via a junction table. */

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'teacher_studios'
      ) THEN
        CREATE TABLE teacher_studios (
          teacher_id integer NOT NULL REFERENCES teachers ON DELETE CASCADE,
          studio_id integer NOT NULL REFERENCES studios ON DELETE CASCADE,
          created_at timestamptz DEFAULT now() NOT NULL,
          PRIMARY KEY (teacher_id, studio_id)
        );
        CREATE INDEX teacher_studios_studio_id_index ON teacher_studios (studio_id);

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'studio_id'
        ) THEN
          INSERT INTO teacher_studios (teacher_id, studio_id)
          SELECT id, studio_id FROM teachers WHERE studio_id IS NOT NULL
          ON CONFLICT DO NOTHING;

          DROP INDEX IF EXISTS teachers_studio_id_index;
          ALTER TABLE teachers DROP COLUMN studio_id;
        END IF;
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'teacher_studios'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'studio_id'
        ) THEN
          ALTER TABLE teachers ADD COLUMN studio_id integer REFERENCES studios ON DELETE RESTRICT;

          UPDATE teachers t
             SET studio_id = (
               SELECT ts.studio_id FROM teacher_studios ts
                WHERE ts.teacher_id = t.id
                ORDER BY ts.studio_id LIMIT 1
             );

          ALTER TABLE teachers ALTER COLUMN studio_id SET NOT NULL;
          CREATE INDEX teachers_studio_id_index ON teachers (studio_id);
        END IF;

        DROP TABLE teacher_studios;
      END IF;
    END $$;
  `);
};
