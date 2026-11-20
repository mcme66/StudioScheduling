/** Studio preference: show a "Managed" label next to managed coaches in listings. */

export const up = (pgm) => {
  pgm.addColumn('studios', {
    show_managed_label: { type: 'boolean', notNull: true, default: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('studios', 'show_managed_label');
};
