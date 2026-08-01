/* New teacher accounts should not appear on studio listings until they
 * opt in via the Active toggle on their profile.
 */

export const up = (pgm) => {
  pgm.alterColumn('teachers', 'is_active', {
    default: false,
  });
};

export const down = (pgm) => {
  pgm.alterColumn('teachers', 'is_active', {
    default: true,
  });
};
