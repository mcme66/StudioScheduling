/* Rich text content shown on the instructor booking page. */

export const up = (pgm) => {
  pgm.addColumn('teachers', {
    additional_info: { type: 'text' },
    teaching_policies: { type: 'text' },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('teachers', 'additional_info');
  pgm.dropColumn('teachers', 'teaching_policies');
};
