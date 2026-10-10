/** Studio-student floor fee uses the higher of a percent and a flat amount. */

export const up = (pgm) => {
  pgm.addColumns('studios', {
    studio_student_floor_fee_percent: { type: 'numeric(6, 2)', notNull: true, default: 0 },
  });
  pgm.addConstraint('studios', 'studios_studio_student_floor_fee_percent_check', {
    check: 'studio_student_floor_fee_percent >= 0 AND studio_student_floor_fee_percent <= 100',
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('studios', 'studios_studio_student_floor_fee_percent_check');
  pgm.dropColumns('studios', ['studio_student_floor_fee_percent']);
};
