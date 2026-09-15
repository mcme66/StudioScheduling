/** Studio owners (1:1 with a studio), rooms, and published weekly class schedules. */

export const up = (pgm) => {
  pgm.createTable('studio_owners', {
    id: 'id',
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    studio_id: {
      type: 'integer',
      notNull: true,
      unique: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    password_reset_token_hash: { type: 'text' },
    password_reset_expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('rooms', {
    id: 'id',
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('rooms', 'rooms_studio_id_name_key', {
    unique: ['studio_id', 'name'],
  });
  pgm.createIndex('rooms', 'studio_id');

  pgm.createTable('class_schedules', {
    id: 'id',
    studio_id: {
      type: 'integer',
      notNull: true,
      references: 'studios',
      onDelete: 'CASCADE',
    },
    room_id: {
      type: 'integer',
      references: 'rooms',
      onDelete: 'SET NULL',
    },
    teacher_id: {
      type: 'integer',
      references: 'teachers',
      onDelete: 'SET NULL',
    },
    name: { type: 'text', notNull: true },
    weekday: { type: 'smallint', notNull: true },
    start_time: { type: 'time', notNull: true },
    duration_min: { type: 'integer', notNull: true, default: 60 },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('class_schedules', 'class_schedules_weekday_check', {
    check: 'weekday >= 0 AND weekday <= 6',
  });
  pgm.addConstraint('class_schedules', 'class_schedules_duration_check', {
    check: 'duration_min > 0',
  });
  pgm.createIndex('class_schedules', 'studio_id');
  pgm.createIndex('class_schedules', 'room_id');
};

export const down = (pgm) => {
  pgm.dropTable('class_schedules');
  pgm.dropTable('rooms');
  pgm.dropTable('studio_owners');
};
