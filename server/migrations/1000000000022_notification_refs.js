/** Ties a notification to the lesson it describes, so undoing a cancellation can retract it. */

export const up = (pgm) => {
  pgm.addColumn('notifications', {
    ref: { type: 'text' },
  });
  pgm.createIndex('notifications', 'ref', { where: 'ref IS NOT NULL' });
};

export const down = (pgm) => {
  pgm.dropIndex('notifications', 'ref');
  pgm.dropColumn('notifications', 'ref');
};
