/* Parent accounts: a student account can be marked as a parent and list
 * children by name. Bookings and weekly spots store which child the lesson
 * is for so teachers see the child's name with the parent's contact info.
 */

export const up = (pgm) => {
  pgm.addColumns('students', {
    is_parent: { type: 'boolean', notNull: true, default: false },
    children_names: { type: 'text[]', notNull: true, default: '{}' },
  });

  pgm.addColumns('bookings', {
    child_name: { type: 'text' },
  });

  pgm.addColumns('recurring_assignments', {
    child_name: { type: 'text' },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('recurring_assignments', ['child_name']);
  pgm.dropColumns('bookings', ['child_name']);
  pgm.dropColumns('students', ['is_parent', 'children_names']);
};
