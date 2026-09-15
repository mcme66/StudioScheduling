import { useMemo, useState } from 'react';
import ClassScheduleGrid from './ClassScheduleGrid.jsx';

export default function StudioRoomsSchedule({
  rooms = [],
  classes = [],
  scheduleTitle = 'Class schedule',
  scheduleDescription,
}) {
  const hasManyRooms = rooms.length > 1;
  const [roomId, setRoomId] = useState('');
  const selectedId = hasManyRooms
    ? rooms.some((r) => String(r.id) === roomId)
      ? roomId
      : String(rooms[0].id)
    : '';

  const visibleClasses = useMemo(() => {
    if (!hasManyRooms) return classes;
    return classes.filter((c) => String(c.roomId) === selectedId);
  }, [classes, hasManyRooms, selectedId]);

  if (!rooms.length && !classes.length) return null;

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      {rooms.length > 0 && (
        <>
          <div className="section-title">Rooms</div>
          {hasManyRooms ? (
            <div className="field room-filter">
              <select
                id="studio-room-filter"
                aria-label="Room"
                value={selectedId}
                onChange={(e) => setRoomId(e.target.value)}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p
              className="muted"
              style={{ fontSize: '14px', marginBottom: classes.length ? '0.85rem' : 0 }}
            >
              {rooms[0].name}
            </p>
          )}
        </>
      )}
      {classes.length > 0 && (
        <>
          <div className="section-title">{scheduleTitle}</div>
          {scheduleDescription ? (
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.75rem' }}>
              {scheduleDescription}
            </p>
          ) : null}
          <ClassScheduleGrid
            classes={visibleClasses}
            emptyText="No classes in this room."
            hideRoomName={rooms.length > 0}
          />
        </>
      )}
    </div>
  );
}
