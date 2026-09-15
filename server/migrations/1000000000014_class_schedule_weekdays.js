/** Allow a class to meet on more than one weekday. */

export const up = (pgm) => {
  pgm.addColumns('class_schedules', {
    weekdays: { type: 'smallint[]', notNull: true, default: pgm.func('ARRAY[]::smallint[]') },
  });
  pgm.sql('UPDATE class_schedules SET weekdays = ARRAY[weekday]::smallint[]');
  pgm.dropConstraint('class_schedules', 'class_schedules_weekday_check');
  pgm.dropColumns('class_schedules', ['weekday']);
  pgm.addConstraint('class_schedules', 'class_schedules_weekdays_check', {
    check: `array_length(weekdays, 1) BETWEEN 1 AND 7
            AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]`,
  });
};

export const down = (pgm) => {
  pgm.addColumns('class_schedules', {
    weekday: { type: 'smallint', notNull: true, default: 1 },
  });
  pgm.sql('UPDATE class_schedules SET weekday = weekdays[1]');
  pgm.dropConstraint('class_schedules', 'class_schedules_weekdays_check');
  pgm.dropColumns('class_schedules', ['weekdays']);
  pgm.addConstraint('class_schedules', 'class_schedules_weekday_check', {
    check: 'weekday >= 0 AND weekday <= 6',
  });
};
