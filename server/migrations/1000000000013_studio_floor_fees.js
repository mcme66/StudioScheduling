/** Percent-of-price vs flat floor fee on studios. */

export const up = (pgm) => {
  pgm.addColumns('studios', {
    floor_fee_percent: { type: 'numeric(6, 2)', notNull: true, default: 0 },
    floor_fee_flat_cents: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('studios', 'studios_floor_fee_percent_check', {
    check: 'floor_fee_percent >= 0 AND floor_fee_percent <= 100',
  });
  pgm.addConstraint('studios', 'studios_floor_fee_flat_cents_check', {
    check: 'floor_fee_flat_cents >= 0',
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('studios', 'studios_floor_fee_flat_cents_check');
  pgm.dropConstraint('studios', 'studios_floor_fee_percent_check');
  pgm.dropColumns('studios', ['floor_fee_percent', 'floor_fee_flat_cents']);
};
