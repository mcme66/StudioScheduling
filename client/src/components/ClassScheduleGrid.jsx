import { fmtTimeRange } from '../lib/format.js';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ClassScheduleGrid({
  classes = [],
  emptyText = 'No classes published yet.',
  renderActions,
  hideRoomName = false,
}) {
  if (!classes.length) {
    return (
      <p className="muted" style={{ fontSize: '14px' }}>
        {emptyText}
      </p>
    );
  }

  const byDay = new Map(DISPLAY_ORDER.map((d) => [d, []]));
  for (const c of classes) {
    const days = Array.isArray(c.weekdays) && c.weekdays.length ? c.weekdays : [c.weekday];
    for (const wd of days) {
      byDay.get(wd)?.push(c);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
  }

  return (
    <div className="day-grid class-schedule-grid">
      {DISPLAY_ORDER.map((wd) => {
        const items = byDay.get(wd) || [];
        return (
          <div className="day-col" key={wd}>
            <div className="day-col-head">{SHORT[wd]}</div>
            {items.length === 0 && (
              <span className="muted" style={{ fontSize: '11px' }}>
                None
              </span>
            )}
            {items.map((c) => (
              <div className="slot-chip class-chip" key={`${c.id}-${wd}`}>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="class-chip-meta">
                    {fmtTimeRange(c.startTime, c.durationMin)}
                    {!hideRoomName && c.roomName ? ` · ${c.roomName}` : ''}
                    {c.teacherName ? ` · ${c.teacherName}` : ''}
                  </div>
                </div>
                {renderActions ? <div className="class-chip-actions">{renderActions(c)}</div> : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
