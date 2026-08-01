/* Weekly slot series bounds.
 *
 * A recurring slot (one_off_date IS NULL) may optionally start and/or end on
 * specific dates. Null means unbounded (legacy "forever" behavior).
 * One-off slots leave both columns null and continue to use one_off_date.
 */

export const up = (pgm) => {
  pgm.addColumns('slots', {
    series_start_date: { type: 'date' },
    series_end_date: { type: 'date' },
  });

  pgm.addConstraint(
    'slots',
    'slots_series_bounds_order',
    'CHECK (series_start_date IS NULL OR series_end_date IS NULL OR series_start_date <= series_end_date)',
  );

  // One-off slots must not carry series bounds.
  pgm.addConstraint(
    'slots',
    'slots_one_off_no_series_bounds',
    'CHECK (one_off_date IS NULL OR (series_start_date IS NULL AND series_end_date IS NULL))',
  );
};

export const down = (pgm) => {
  pgm.dropConstraint('slots', 'slots_one_off_no_series_bounds');
  pgm.dropConstraint('slots', 'slots_series_bounds_order');
  pgm.dropColumns('slots', ['series_start_date', 'series_end_date']);
};
