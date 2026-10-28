/** Studio-defined coach tiers. A studio may have up to five, enforced in the API. */

export const up = (pgm) => {
  pgm.createTable('coach_tiers', {
    id: 'id',
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('coach_tiers', 'studio_id');
  pgm.sql(`
    CREATE UNIQUE INDEX coach_tiers_studio_name_lower_key
      ON coach_tiers (studio_id, lower(btrim(name)))
  `);

  pgm.addColumn('teacher_studios', {
    tier_id: {
      type: 'integer',
      references: 'coach_tiers',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('teacher_studios', 'tier_id');
};

export const down = (pgm) => {
  pgm.dropColumn('teacher_studios', 'tier_id');
  pgm.dropTable('coach_tiers');
};
