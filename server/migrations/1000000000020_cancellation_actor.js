/** Who cancelled a lesson, so student and coach cancellations can be undone. */

export const up = (pgm) => {
  pgm.addColumn('bookings', {
    cancelled_by: { type: 'text' },
  });
  pgm.addConstraint(
    'bookings',
    'bookings_cancelled_by_valid',
    "CHECK (cancelled_by IS NULL OR cancelled_by IN ('student', 'teacher', 'studio', 'closed'))",
  );

  pgm.addColumn('slot_exceptions', {
    cancelled_by: { type: 'text' },
  });
  pgm.addConstraint(
    'slot_exceptions',
    'slot_exceptions_cancelled_by_valid',
    "CHECK (cancelled_by IS NULL OR cancelled_by IN ('student', 'teacher', 'studio', 'closed'))",
  );
};

export const down = (pgm) => {
  pgm.dropConstraint('slot_exceptions', 'slot_exceptions_cancelled_by_valid');
  pgm.dropColumn('slot_exceptions', 'cancelled_by');
  pgm.dropConstraint('bookings', 'bookings_cancelled_by_valid');
  pgm.dropColumn('bookings', 'cancelled_by');
};
