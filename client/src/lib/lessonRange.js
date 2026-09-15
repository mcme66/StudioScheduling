import {
  addMonths,
  addWeeks,
  getMonday,
  monthEnd,
  monthLabel,
  monthStart,
  todayISO,
  weekEndSunday,
  weekSpanLabel,
} from './format.js';

export function initialAnchor(mode) {
  const today = todayISO();
  return mode === 'month' ? monthStart(today) : getMonday(today);
}

export function shiftAnchor(mode, anchor, delta) {
  return mode === 'month' ? addMonths(anchor, delta) : addWeeks(anchor, delta);
}

export function rangeBounds(mode, anchor) {
  if (mode === 'month') {
    return { from: anchor, to: monthEnd(anchor), label: monthLabel(anchor) };
  }
  return { from: anchor, to: weekEndSunday(anchor), label: weekSpanLabel(anchor) };
}

export function thisMonthAnchor() {
  return monthStart(todayISO());
}

export function lastMonthAnchor() {
  return addMonths(thisMonthAnchor(), -1);
}
