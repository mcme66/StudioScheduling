/* Allow a new weekly series at the same weekday/time after an earlier series
 * has ended. Uniqueness for overlapping weekly templates is enforced in the
 * API instead of a single blanket unique index.
 */

export const up = (pgm) => {
  pgm.dropIndex('slots', ['teacher_id', 'weekday', 'start_time'], {
    name: 'slots_unique_recurring',
  });
};

export const down = (pgm) => {
  pgm.createIndex('slots', ['teacher_id', 'weekday', 'start_time'], {
    unique: true,
    where: 'one_off_date IS NULL',
    name: 'slots_unique_recurring',
  });
};
