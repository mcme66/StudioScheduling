/* Add one-off (single-week) support to slots.
 *
 * A slot with `one_off_date = NULL` is a recurring weekly template (default).
 * A slot with `one_off_date` set is only available on that specific date
 * (a "this week only" lesson time). The recurring uniqueness constraint is
 * replaced by two partial unique indexes so recurring and one-off slots do not
 * collide with each other.
 */

export const up = (pgm) => {
  pgm.addColumn('slots', {
    one_off_date: { type: 'date' },
  });

  // A one-off date must fall on the slot's weekday (EXTRACT(DOW) uses 0=Sun..6=Sat).
  pgm.addConstraint(
    'slots',
    'slots_one_off_weekday_match',
    'CHECK (one_off_date IS NULL OR EXTRACT(DOW FROM one_off_date) = weekday)',
  );

  // Replace the blanket unique(teacher, weekday, start_time) with scoped indexes.
  pgm.dropConstraint('slots', 'slots_unique_teacher_weekday_time');

  pgm.createIndex('slots', ['teacher_id', 'weekday', 'start_time'], {
    unique: true,
    where: 'one_off_date IS NULL',
    name: 'slots_unique_recurring',
  });

  pgm.createIndex('slots', ['teacher_id', 'start_time', 'one_off_date'], {
    unique: true,
    where: 'one_off_date IS NOT NULL',
    name: 'slots_unique_one_off',
  });
};

export const down = (pgm) => {
  pgm.dropIndex('slots', ['teacher_id', 'start_time', 'one_off_date'], {
    name: 'slots_unique_one_off',
  });
  pgm.dropIndex('slots', ['teacher_id', 'weekday', 'start_time'], {
    name: 'slots_unique_recurring',
  });
  pgm.addConstraint('slots', 'slots_unique_teacher_weekday_time', {
    unique: ['teacher_id', 'weekday', 'start_time'],
  });
  pgm.dropConstraint('slots', 'slots_one_off_weekday_match');
  pgm.dropColumn('slots', 'one_off_date');
};
