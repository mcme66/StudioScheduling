/** Per-child calendar colors, plus one color for students who are not parents. */

export const up = (pgm) => {
  pgm.addColumns('students', {
    lesson_color: { type: 'text' },
    child_colors: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('students', ['lesson_color', 'child_colors']);
};
