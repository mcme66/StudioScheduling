/* Add studios and link teachers to a studio (for existing databases). */

export const up = (pgm) => {
  // Skip when the init migration already created studios (fresh installs).
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'studios'
      ) THEN
        CREATE TABLE studios (
          id serial PRIMARY KEY,
          name text NOT NULL,
          slug text UNIQUE NOT NULL,
          description text,
          created_at timestamptz DEFAULT now() NOT NULL
        );

        ALTER TABLE teachers
          ADD COLUMN studio_id integer REFERENCES studios ON DELETE RESTRICT;

        INSERT INTO studios (name, slug, description)
        VALUES (
          'Island Style Dance Studio',
          'island-style-dance-studio',
          'Private dance lessons in a welcoming island-style studio. Book one-off sessions or request a weekly spot.'
        )
        ON CONFLICT (slug) DO NOTHING;

        UPDATE teachers
           SET studio_id = (SELECT id FROM studios WHERE slug = 'island-style-dance-studio' LIMIT 1)
         WHERE studio_id IS NULL;

        ALTER TABLE teachers ALTER COLUMN studio_id SET NOT NULL;
        CREATE INDEX teachers_studio_id_index ON teachers (studio_id);
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'studio_id'
      ) THEN
        DROP INDEX IF EXISTS teachers_studio_id_index;
        ALTER TABLE teachers DROP COLUMN studio_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'studios'
      ) THEN
        DROP TABLE studios;
      END IF;
    END $$;
  `);
};
