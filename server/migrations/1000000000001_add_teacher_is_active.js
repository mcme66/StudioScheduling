/* Add is_active flag to teachers (controls listing on the public studio page). */

export const up = (pgm) => {
  pgm.addColumn('teachers', {
    is_active: { type: 'boolean', notNull: true, default: true },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('teachers', 'is_active');
};
