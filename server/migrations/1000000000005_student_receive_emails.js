/* Student opt-in/out for transactional emails. */

export const up = (pgm) => {
  pgm.addColumn('students', {
    receive_emails: { type: 'boolean', notNull: true, default: true },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('students', 'receive_emails');
};
