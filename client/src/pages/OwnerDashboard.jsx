import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import ClassScheduleGrid from '../components/ClassScheduleGrid.jsx';
import RangePicker from '../components/RangePicker.jsx';
import { WEEKDAYS, fmtDate, fmtPrice, fromTwelveHour, toTwelveHour } from '../lib/format.js';
import {
  initialAnchor,
  lastMonthAnchor,
  rangeBounds,
  shiftAnchor,
  thisMonthAnchor,
} from '../lib/lessonRange.js';

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

function classStartTime(form) {
  return fromTwelveHour(form.startHour, form.startMinute, form.startPeriod);
}

function minuteChoices(current) {
  if (current && !MINUTES.includes(current)) return [...MINUTES, current].sort();
  return MINUTES;
}

export default function OwnerDashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });

  const [studioForm, setStudioForm] = useState({
    name: '',
    description: '',
    floorFeePercent: '0',
    floorFeeFlat: '0',
  });
  const [roomForm, setRoomForm] = useState({ name: '', description: '' });
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [classForm, setClassForm] = useState(emptyClassForm);
  const [editingClassId, setEditingClassId] = useState(null);
  const [error, setError] = useState('');
  const [rangeMode, setRangeMode] = useState('month');
  const [rangeAnchor, setRangeAnchor] = useState(() => initialAnchor('month'));
  const coachRange = useMemo(
    () => rangeBounds(rangeMode, rangeAnchor),
    [rangeMode, rangeAnchor],
  );
  const thisMonth = thisMonthAnchor();
  const lastMonth = lastMonthAnchor();
  const floorFeesQuery = useQuery({
    queryKey: ['owner-floor-fees', coachRange.from, coachRange.to],
    queryFn: () =>
      api(
        `/owner/floor-fees?from=${encodeURIComponent(coachRange.from)}&to=${encodeURIComponent(coachRange.to)}`,
      ),
    enabled: !!studioQuery.data,
  });
  const rangePresets = [
    {
      id: 'this-month',
      label: 'This month',
      active: rangeMode === 'month' && rangeAnchor === thisMonth,
      onClick: () => {
        setRangeMode('month');
        setRangeAnchor(thisMonth);
      },
    },
    {
      id: 'last-month',
      label: 'Last month',
      active: rangeMode === 'month' && rangeAnchor === lastMonth,
      onClick: () => {
        setRangeMode('month');
        setRangeAnchor(lastMonth);
      },
    },
  ];

  useEffect(() => {
    if (studioQuery.data?.studio) {
      setStudioForm({
        name: studioQuery.data.studio.name || '',
        description: studioQuery.data.studio.description || '',
        floorFeePercent: String(studioQuery.data.studio.floorFeePercent ?? 0),
        floorFeeFlat: String(((studioQuery.data.studio.floorFeeFlatCents ?? 0) / 100).toFixed(2)).replace(/\.00$/, ''),
      });
    }
  }, [studioQuery.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    const slug = studioQuery.data?.studio?.slug;
    if (slug) queryClient.invalidateQueries({ queryKey: ['studio', slug] });
    queryClient.invalidateQueries({ queryKey: ['owner-floor-fees'] });
  };

  const saveStudio = useMutation({
    mutationFn: () =>
      api('/owner/studio', {
        method: 'PATCH',
        body: {
          name: studioForm.name,
          description: studioForm.description,
          floorFeePercent: Number(studioForm.floorFeePercent || 0),
          floorFeeFlatCents: Math.round(Number(studioForm.floorFeeFlat || 0) * 100),
        },
      }),
    onSuccess: () => {
      toast('Studio details saved.');
      setError('');
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const saveRoom = useMutation({
    mutationFn: () => {
      const body = { name: roomForm.name, description: roomForm.description };
      if (editingRoomId) {
        return api(`/owner/rooms/${editingRoomId}`, { method: 'PATCH', body });
      }
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
      if (editingRoomId) {
        setEditingRoomId(null);
        setRoomForm({ name: '', description: '' });
      }
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const saveClass = useMutation({
    mutationFn: () => {
      const body = {
        name: classForm.name,
        weekdays: classForm.weekdays.map(Number),
        startTime: classStartTime(classForm),
        durationMin: Number(classForm.durationMin),
        roomId: classForm.roomId ? Number(classForm.roomId) : null,
        teacherId: classForm.teacherId ? Number(classForm.teacherId) : null,
        description: classForm.description,
      };
      if (editingClassId) {
        return api(`/owner/classes/${editingClassId}`, { method: 'PATCH', body });
      }
      return api('/owner/classes', { method: 'POST', body });
    },
    onSuccess: () => {
      toast(editingClassId ? 'Class updated.' : 'Class added.');
      setClassForm(emptyClassForm);
      setEditingClassId(null);
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const deleteClass = useMutation({
    mutationFn: (id) => api(`/owner/classes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Class removed.');
      if (editingClassId) {
        setEditingClassId(null);
        setClassForm(emptyClassForm);
      }
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

  const data = studioQuery.data;
  const rooms = data?.rooms || [];
  const classes = data?.classSchedules || [];
  const teachers = data?.teachers || [];

  return (
    <div className="container">
      <h1 className="page-title">{data?.studio?.name || 'Your studio'}</h1>
      <p className="page-sub">
        Manage rooms and the weekly class timetable students and teachers see on the studio page.
      </p>

      {studioQuery.isLoading && <div className="loading">Loading studio…</div>}
      {studioQuery.isError && <p className="error-text">{studioQuery.error.message}</p>}

      {data && (
        <>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              saveStudio.mutate();
            }}
          >
            <div className="section-title">Studio details</div>
            <div className="field">
              <label htmlFor="owner-studio-name">Name</label>
              <input
                id="owner-studio-name"
                value={studioForm.name}
                onChange={(e) => setStudioForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="owner-studio-description">Description</label>
              <textarea
                id="owner-studio-description"
                rows={3}
                value={studioForm.description}
                onChange={(e) => setStudioForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="section-title" style={{ marginTop: '0.5rem' }}>
              Expected floor fees
            </div>
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.85rem' }}>
              Each lesson is charged the higher of these two amounts, using the coach&apos;s lesson
              price.
            </p>
            <div className="row" style={{ gap: '0.75rem' }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="owner-floor-percent">Percent of lesson (%)</label>
                <input
                  id="owner-floor-percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={studioForm.floorFeePercent}
                  onChange={(e) => setStudioForm((f) => ({ ...f, floorFeePercent: e.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="owner-floor-flat">Flat fee ($)</label>
                <input
                  id="owner-floor-flat"
                  type="number"
                  min="0"
                  step="0.01"
                  value={studioForm.floorFeeFlat}
                  onChange={(e) => setStudioForm((f) => ({ ...f, floorFeeFlat: e.target.value }))}
                />
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={saveStudio.isPending}>
              {saveStudio.isPending ? 'Saving…' : 'Save studio'}
            </button>
          </form>

          <div className="card" style={{ marginTop: '1.25rem' }}>
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => startEditRoom(room)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (window.confirm(`Remove ${room.name}? Classes in this room keep their times but lose the room.`)) {
                        deleteRoom.mutate(room.id);
                      }
                    }}
                    disabled={deleteRoom.isPending}
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

          <div className="card" style={{ marginTop: '1.25rem' }}>
            <div className="section-title">Class schedule</div>
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
              Published weekly timetable. Students and teachers can view it; they cannot enroll yet.
            </p>
            <ClassScheduleGrid
              classes={classes}
              emptyText="No classes yet. Add a weekly class below."
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

            <form
              className="owner-class-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!classForm.weekdays.length) {
                  toast('Pick at least one day.');
                  return;
                }
                saveClass.mutate();
              }}
            >
              <div className="section-title" style={{ marginTop: '1.1rem' }}>
                {editingClassId ? 'Edit class' : 'Add a class'}
              </div>
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
                <label id="owner-class-days-label" htmlFor="owner-class-days">
                  Day(s)
                </label>
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
                      const weekdays = has
                        ? f.weekdays.filter((d) => d !== value)
                        : [...f.weekdays, value];
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
                    <option key={wd} value={wd}>
                      {WEEKDAYS[wd]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label" id="owner-class-time-label">
                    Start time
                  </span>
                  <div className="time-ampm" role="group" aria-labelledby="owner-class-time-label">
                    <select
                      id="owner-class-hour"
                      aria-label="Hour"
                      value={classForm.startHour}
                      onChange={(e) => setClassForm((f) => ({ ...f, startHour: e.target.value }))}
                    >
                      {HOURS_12.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <select
                      id="owner-class-minute"
                      aria-label="Minutes"
                      value={classForm.startMinute}
                      onChange={(e) => setClassForm((f) => ({ ...f, startMinute: e.target.value }))}
                    >
                      {minuteChoices(classForm.startMinute).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
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
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
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

          <div className="card" style={{ marginTop: '1.25rem' }}>
            <div className="section-title">Coaches</div>
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
              Choose a week or month, then open a coach to see the lessons they taught in that
              timeframe. Floor fees use the same range.
            </p>
            <RangePicker
              mode={rangeMode}
              label={coachRange.label}
              presets={rangePresets}
              onModeChange={(next) => {
                setRangeMode(next);
                setRangeAnchor(initialAnchor(next));
              }}
              onPrev={() => setRangeAnchor((a) => shiftAnchor(rangeMode, a, -1))}
              onNext={() => setRangeAnchor((a) => shiftAnchor(rangeMode, a, 1))}
            />
            {teachers.length === 0 ? (
              <p className="muted" style={{ fontSize: '14px', marginTop: '0.9rem' }}>
                No coaches are listed at this studio yet.
              </p>
            ) : (
              <div style={{ marginTop: '0.5rem' }}>
                {teachers.map((t) => (
                  <Link
                    key={t.id}
                    className="list-row list-row-link"
                    to={`/owner/coaches/${t.id}?range=${rangeMode}&from=${coachRange.from}&to=${coachRange.to}`}
                  >
                    <div className="grow">
                      {t.fullName}
                      {t.bio && <div className="contact">{t.bio}</div>}
                    </div>
                    <span className={`pill ${t.isActive ? 'pill-open' : ''}`}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: '1.25rem' }}>
            <div className="section-title">Expected floor fees · {coachRange.label}</div>
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
              {data.studio.floorFeePercent || data.studio.floorFeeFlatCents
                ? `Each lesson uses the higher of ${Number(data.studio.floorFeePercent)}% of the coach’s price or ${fmtPrice(data.studio.floorFeeFlatCents)}.`
                : 'Set a percent and/or flat fee in studio details to calculate expected floor fees.'}
            </p>
            {floorFeesQuery.isLoading && <div className="loading">Calculating…</div>}
            {floorFeesQuery.isError && (
              <p className="error-text">{floorFeesQuery.error.message}</p>
            )}
            {floorFeesQuery.data && (
              <>
                <table className="fee-table">
                  <thead>
                    <tr>
                      <th>Coach</th>
                      <th className="num">Lessons</th>
                      <th className="num">Expected fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {floorFeesQuery.data.coaches.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.fullName}
                          {!c.isActive && <span className="contact"> Inactive</span>}
                        </td>
                        <td className="num">{c.lessonCount}</td>
                        <td className="num">{fmtPrice(c.floorFeeCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Studio total</td>
                      <td className="num">
                        {floorFeesQuery.data.coaches.reduce((n, c) => n + c.lessonCount, 0)}
                      </td>
                      <td className="num">{fmtPrice(floorFeesQuery.data.studioTotalCents)}</td>
                    </tr>
                  </tfoot>
                </table>

                {floorFeesQuery.data.weeks.length > 1 && (
                  <div className="fee-weeks">
                    <div className="section-title" style={{ marginTop: '1.1rem' }}>
                      Weeks in this range
                    </div>
                    {floorFeesQuery.data.weeks.map((week) => (
                      <div className="fee-week" key={`${week.from}-${week.to}`}>
                        <div className="fee-week-label">
                          {fmtDate(week.from, { month: 'short', day: 'numeric' })} –{' '}
                          {fmtDate(week.to, { month: 'short', day: 'numeric' })}
                          <span className="muted" style={{ marginLeft: '0.5rem' }}>
                            {fmtPrice(week.totalCents)}
                          </span>
                        </div>
                        {week.coaches.length === 0 ? (
                          <p className="muted" style={{ fontSize: '13px' }}>
                            No lessons this week.
                          </p>
                        ) : (
                          week.coaches.map((c) => (
                            <div className="list-row" key={c.id}>
                              <div className="grow">
                                {teachers.find((t) => t.id === c.id)?.fullName || 'Coach'}
                              </div>
                              <span className="muted" style={{ fontSize: '13px' }}>
                                {c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}
                              </span>
                              <strong>{fmtPrice(c.floorFeeCents)}</strong>
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
