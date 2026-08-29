/** Child name on teacher-scheduled lesson invites. */

export const up = (pgm) => {
  pgm.addColumns('lesson_invites', {
    child_name: { type: 'text' },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('lesson_invites', ['child_name']);
};
