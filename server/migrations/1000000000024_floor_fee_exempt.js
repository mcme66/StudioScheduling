/** Studio-controlled: coaches whose lessons carry no floor fee at this studio. */

export const up = (pgm) => {
  pgm.addColumn('teacher_studios', {
    floor_fee_exempt: { type: 'boolean', notNull: true, default: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('teacher_studios', 'floor_fee_exempt');
};
