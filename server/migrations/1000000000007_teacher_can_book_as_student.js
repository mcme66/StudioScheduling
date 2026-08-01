/* Teachers may optionally book lessons on other instructors' schedules.
 * When enabled, a matching students row is created/used for booking FKs.
 */

export const up = (pgm) => {
  pgm.addColumns('teachers', {
    can_book_as_student: { type: 'boolean', notNull: true, default: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('teachers', ['can_book_as_student']);
};
