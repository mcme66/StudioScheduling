import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import ClassScheduleGrid from '../ClassScheduleGrid.jsx';
import { WEEKDAYS, fromTwelveHour, toTwelveHour } from '../../lib/format.js';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = ['00', '15', '30', '45'];

const emptyClassForm = {
  name: '',
  weekdays: ['1'],
  startHour: '4',
  startMinute: '00',
  startPeriod: 'PM',
  durationMin: '60',
  roomId: '',
  teacherId: '',
  description: '',
};

function minuteChoices(current) {
  if (current && !MINUTES.includes(current)) return [...MINUTES, current].sort();
  return MINUTES;
}

export default function ScheduleTab({ data }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rooms = data.rooms || [];
  const classes = data.classSchedules || [];
  const teachers = data.teachers || [];
  const [roomForm, setRoomForm] = useState({ name: '', description: '' });
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [classForm, setClassForm] = useState(emptyClassForm);
  const [editingClassId, setEditingClassId] = useState(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    const slug = data.studio?.slug;
    if (slug) queryClient.invalidateQueries({ queryKey: ['studio', slug] });
  };

  const saveRoom = useMutation({
    mutationFn: () => {
      const body = { name: roomForm.name, description: roomForm.description };
      if (editingRoomId) return api(`/owner/rooms/${editingRoomId}`, { method: 'PATCH', body });
      return api('/owner/rooms', { method: 'POST', body });
    },
    onSuccess: () => {
      toast(editingRoomId ? 'Room updated.' : 'Room added.');
      setRoomForm({ name: '', description: '' });
      setEditingRoomId(null);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const deleteRoom = useMutation({
    mutationFn: (id) => api(`/owner/rooms/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Room removed.');
      setEditingRoomId(null);
      setRoomForm({ name: '', description: '' });
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const saveClass = useMutation({
    mutationFn: () => {
      const body = {
        name: classForm.name,
        weekdays: classForm.weekdays.map(Number),
        startTime: fromTwelveHour(classForm.startHour, classForm.startMinute, classForm.startPeriod),
        durationMin: Number(classForm.durationMin),
        roomId: classForm.roomId ? Number(classForm.roomId) : null,
        teacherId: classForm.teacherId ? Number(classForm.teacherId) : null,
        description: classForm.description,
      };
      if (editingClassId) return api(`/owner/classes/${editingClassId}`, { method: 'PATCH', body });
      return api('/owner/classes', { method: 'POST', body });
    },
    onSuccess: () => {
      toast(editingClassId ? 'Class updated.' : 'Class added.');
      setEditingClassId(null);
      setClassForm(emptyClassForm);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const deleteClass = useMutation({
    mutationFn: (id) => api(`/owner/classes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Class removed.');
      setEditingClassId(null);
      setClassForm(emptyClassForm);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const startEditRoom = (room) => {
    setEditingRoomId(room.id);
    setRoomForm({ name: room.name, description: room.description || '' });
  };

  const startEditClass = (c) => {
    const time = toTwelveHour(c.startTime);
    const days = Array.isArray(c.weekdays) && c.weekdays.length ? c.weekdays : [c.weekday];
    setEditingClassId(c.id);
    setClassForm({
      name: c.name,
      weekdays: days.map(String),
      startHour: time.hour,
      startMinute: time.minute,
      startPeriod: time.period,
      durationMin: String(c.durationMin),
      roomId: c.roomId ? String(c.roomId) : '',
      teacherId: c.teacherId ? String(c.teacherId) : '',
      description: c.description || '',
    });
  };

  return (
    <>
      <div className="owner-grid cols-2">
        <div className="card">
          <div className="section-title">Rooms</div>
          {rooms.length === 0 ? (
            <p className="muted" style={{ fontSize: '14px', marginBottom: '0.75rem' }}>
              No rooms yet. Add at least one so you can place classes.
            </p>
          ) : (
            rooms.map((room) => (
              <div className="list-row" key={room.id}>
                <div className="grow">
                  {room.name}
                  {room.description && <div className="contact">{room.description}</div>}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEditRoom(room)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={deleteRoom.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${room.name}? Classes in this room keep their times but lose the room.`)) {
                      deleteRoom.mutate(room.id);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
          <form
            className="owner-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveRoom.mutate();
            }}
          >
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="owner-room-name">{editingRoomId ? 'Edit room' : 'Add a room'}</label>
              <input
                id="owner-room-name"
                value={roomForm.name}
                onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Room name"
                required
              />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="owner-room-desc">Description (optional)</label>
              <input
                id="owner-room-desc"
                value={roomForm.description}
                onChange={(e) => setRoomForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Mirrored, sprung floor"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saveRoom.isPending}>
              {saveRoom.isPending ? 'Saving…' : editingRoomId ? 'Update room' : 'Add room'}
            </button>
            {editingRoomId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditingRoomId(null);
                  setRoomForm({ name: '', description: '' });
                }}
              >
                Cancel
              </button>
            )}
          </form>
        </div>

        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!classForm.weekdays.length) {
              toast('Pick at least one day.');
              return;
            }
            saveClass.mutate();
          }}
        >
          <div className="section-title">{editingClassId ? 'Edit class' : 'Add a class'}</div>
          <div className="field">
            <label htmlFor="owner-class-name">Class name</label>
            <input
              id="owner-class-name"
              value={classForm.name}
              onChange={(e) => setClassForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label id="owner-class-days-label" htmlFor="owner-class-days">Day(s)</label>
            <select
              id="owner-class-days"
              className="day-picklist"
              multiple
              size={7}
              value={classForm.weekdays}
              aria-labelledby="owner-class-days-label"
              onMouseDown={(e) => {
                if (e.target.tagName !== 'OPTION') return;
                e.preventDefault();
                const value = e.target.value;
                setClassForm((f) => {
                  const has = f.weekdays.includes(value);
                  const weekdays = has ? f.weekdays.filter((d) => d !== value) : [...f.weekdays, value];
                  return { ...f, weekdays };
                });
              }}
              onChange={(e) => {
                const weekdays = Array.from(e.target.selectedOptions, (o) => o.value);
                setClassForm((f) => ({ ...f, weekdays }));
              }}
              required
            >
              {DISPLAY_ORDER.map((wd) => (
                <option key={wd} value={wd}>{WEEKDAYS[wd]}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: '0.75rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label" id="owner-class-time-label">Start time</span>
              <div className="time-ampm" role="group" aria-labelledby="owner-class-time-label">
                <select
                  id="owner-class-hour"
                  aria-label="Hour"
                  value={classForm.startHour}
                  onChange={(e) => setClassForm((f) => ({ ...f, startHour: e.target.value }))}
                >
                  {HOURS_12.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select
                  id="owner-class-minute"
                  aria-label="Minutes"
                  value={classForm.startMinute}
                  onChange={(e) => setClassForm((f) => ({ ...f, startMinute: e.target.value }))}
                >
                  {minuteChoices(classForm.startMinute).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  id="owner-class-period"
                  aria-label="AM or PM"
                  value={classForm.startPeriod}
                  onChange={(e) => setClassForm((f) => ({ ...f, startPeriod: e.target.value }))}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="owner-class-duration">Length (min)</label>
              <input
                id="owner-class-duration"
                type="number"
                min="5"
                max="240"
                value={classForm.durationMin}
                onChange={(e) => setClassForm((f) => ({ ...f, durationMin: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="row" style={{ gap: '0.75rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="owner-class-room">Room</label>
              <select
                id="owner-class-room"
                value={classForm.roomId}
                onChange={(e) => setClassForm((f) => ({ ...f, roomId: e.target.value }))}
              >
                <option value="">None</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="owner-class-teacher">Instructor (optional)</label>
              <select
                id="owner-class-teacher"
                value={classForm.teacherId}
                onChange={(e) => setClassForm((f) => ({ ...f, teacherId: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fullName}
                    {t.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="owner-class-desc">Notes (optional)</label>
            <input
              id="owner-class-desc"
              value={classForm.description}
              onChange={(e) => setClassForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="row" style={{ gap: '0.75rem' }}>
            <button type="submit" className="btn btn-primary" disabled={saveClass.isPending}>
              {saveClass.isPending ? 'Saving…' : editingClassId ? 'Update class' : 'Add class'}
            </button>
            {editingClassId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditingClassId(null);
                  setClassForm(emptyClassForm);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="section-title">Weekly timetable</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
          Published weekly timetable. Students and teachers can view it; they cannot enroll yet.
        </p>
        <ClassScheduleGrid
          classes={classes}
          emptyText="No classes yet. Add a weekly class above."
          renderActions={(c) => (
            <>
              <button type="button" className="chip-x" aria-label={`Edit ${c.name}`} onClick={() => startEditClass(c)}>
                ✎
              </button>
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${c.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${c.name}?`)) deleteClass.mutate(c.id);
                }}
              >
                ×
              </button>
            </>
          )}
        />
      </div>
    </>
  );
}
