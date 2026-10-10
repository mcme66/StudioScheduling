import { WEEKDAYS, fmtTime, fmtTimeRange, dateForWeekday, weekSpanLabel, todayISO } from '../lib/format.js';

const PX_PER_HOUR = 72;
const MIN_HOURS_SHOWN = 6;
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function minutesOf(time) {
  const [h, m] = String(time || '0:0').slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Fit the grid to the week's lessons, with an hour of padding on each side. */
function hourRange(events) {
  if (!events.length) return { start: 12, end: 12 + MIN_HOURS_SHOWN };
  let first = 24 * 60;
  let last = 0;
  for (const ev of events) {
    const startMin = minutesOf(ev.startTime);
    first = Math.min(first, startMin);
    last = Math.max(last, startMin + (Number(ev.durationMin) || 45));
  }
  let start = Math.max(0, Math.floor(first / 60) - 1);
  let end = Math.min(24, Math.ceil(last / 60) + 1);
  while (end - start < MIN_HOURS_SHOWN && (end < 24 || start > 0)) {
    if (end < 24) end += 1;
    if (end - start < MIN_HOURS_SHOWN && start > 0) start -= 1;
  }
  return { start, end };
}

/** Side-by-side columns for lessons that overlap on the same day. */
function placeEvents(events, dayStartHour) {
  const sorted = [...events].sort(
    (a, b) =>
      minutesOf(a.startTime) - minutesOf(b.startTime) ||
      String(a.teacher).localeCompare(String(b.teacher)),
  );
  const columns = [];
  const placed = sorted.map((ev) => {
    const startMin = minutesOf(ev.startTime);
    const endMin = startMin + (Number(ev.durationMin) || 45);
    let col = 0;
    while (columns[col] > startMin) col += 1;
    columns[col] = endMin;
    return { ...ev, col, startMin, endMin };
  });
  const colCount = Math.max(1, columns.length);
  return placed.map((ev) => ({
    ...ev,
    top: ((ev.startMin - dayStartHour * 60) / 60) * PX_PER_HOUR,
    height: Math.max(34, ((ev.endMin - ev.startMin) / 60) * PX_PER_HOUR - 4),
    left: `calc(${(ev.col / colCount) * 100}% + 2px)`,
    width: `calc(${100 / colCount}% - 4px)`,
  }));
}

/**
 * events: { id, date, startTime, durationMin, teacher, childName?, color,
 *           variant?: 'pending' | 'cancelled', note? }
 */
export default function WeekCalendar({
  weekStart,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  events,
  legend,
}) {
  const today = todayISO();
  const { start, end } = hourRange(events);
  const height = (end - start) * PX_PER_HOUR;
  const hours = [];
  for (let h = start; h < end; h += 1) {
    hours.push(h);
  }

  return (
    <section className="card week-cal" aria-label="Week of lessons">
      <div className="section-title">Lesson calendar</div>
      <div className="week-nav">
        <button
          type="button"
          className="week-nav-btn"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="week-nav-text">
          Week of <strong>{weekSpanLabel(weekStart)}</strong>
        </span>
        <button
          type="button"
          className="week-nav-btn"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {legend?.length > 0 && (
        <div className="cal-legend" aria-label="Lesson colors">
          {legend.map((item) => (
            <span className="cal-legend-item" key={item.label}>
              <i style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
      )}

      {events.length === 0 && (
        <p className="muted week-cal-empty-week">No lessons this week.</p>
      )}

      <div className="week-cal-scroll">
        <div className="week-cal-board">
          <div className="week-cal-hours" aria-hidden="true">
            <div className="week-cal-day-head week-cal-corner" />
            {hours.map((h) => (
              <div className="week-cal-hour" key={h} style={{ height: PX_PER_HOUR }}>
                {fmtTime(`${String(h).padStart(2, '0')}:00`)}
              </div>
            ))}
          </div>
          <div className="week-cal-days">
            {DISPLAY_ORDER.map((weekday) => {
              const date = dateForWeekday(weekStart, weekday);
              const dayEvents = placeEvents(
                events.filter((ev) => ev.date === date),
                start,
              );
              return (
                <section
                  className={`week-cal-day${date === today ? ' is-today' : ''}${date < today ? ' is-past' : ''}`}
                  key={date}
                  aria-label={WEEKDAYS[weekday]}
                >
                  <header className="week-cal-day-head">
                    <span>{WEEKDAYS[weekday].slice(0, 3)}</span>
                    <strong>{Number(date.slice(8))}</strong>
                  </header>
                  <div
                    className="week-cal-col"
                    style={{ height, '--hour-px': `${PX_PER_HOUR}px` }}
                  >
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className={`week-cal-event${ev.variant ? ` is-${ev.variant}` : ''}`}
                        style={{
                          top: ev.top,
                          height: ev.height,
                          left: ev.left,
                          width: ev.width,
                          '--event-color': ev.color,
                        }}
                        title={[
                          ev.note,
                          fmtTimeRange(ev.startTime, ev.durationMin),
                          ev.teacher,
                          ev.childName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        <strong>{fmtTimeRange(ev.startTime, ev.durationMin)}</strong>
                        <span>
                          {ev.childName ? `${ev.childName} · ${ev.teacher}` : ev.teacher}
                        </span>
                        {ev.note && <em>{ev.note}</em>}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
