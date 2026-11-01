/** One-way in-app notifications shown in the header bell. */

export const up = (pgm) => {
  pgm.createTable('notifications', {
    id: 'id',
    recipient_role: { type: 'text', notNull: true },
    recipient_id: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    body: { type: 'text' },
    link: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    read_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'notifications',
    'notifications_recipient_role_valid',
    "CHECK (recipient_role IN ('student', 'teacher', 'studio_owner'))",
  );
  pgm.createIndex('notifications', ['recipient_role', 'recipient_id', { name: 'created_at', sort: 'DESC' }]);
};

export const down = (pgm) => {
  pgm.dropTable('notifications');
};
