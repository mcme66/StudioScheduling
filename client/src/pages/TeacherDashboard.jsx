import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import SharePanel from '../components/SharePanel.jsx';
import PaidToggle from '../components/PaidToggle.jsx';
import {
  WEEKDAYS,
  fmtTime,
  fmtTimeRange,
  fmtDate,
  getMonday,
  addWeeks,
  weekRangeLabel,
  todayISO,
} from '../lib/format.js';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

export default function TeacherDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const baseMonday = getMonday(todayISO());
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = addWeeks(baseMonday, weekOffset);

  const slotsQuery = useQuery({ queryKey: ['slots'], queryFn: () => api('/slots') });
  const scheduleQuery = useQuery({
    queryKey: ['teacher-schedule', user.id, weekStart],
    queryFn: () => api(`/teachers/${user.id}/schedule?week=${weekStart}`),
    refetchInterval: 20000,
  });
  const bookingsQuery = useQuery({
    queryKey: ['teacher-bookings', weekStart],
    queryFn: () => api(`/teachers/me/bookings?week=${weekStart}`),
    refetchInterval: 20000,
  });
  const pendingQuery = useQuery({
    queryKey: ['pending'],
    queryFn: () => api('/recurring/pending'),
    refetchInterval: 20000,
  });
  const myStudiosQuery = useQuery({
    queryKey: ['my-studios'],
    queryFn: () => api('/teachers/me/studios'),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['slots'] });
    queryClient.invalidateQueries({ queryKey: ['teacher-schedule'] });
    queryClient.invalidateQueries({ queryKey: ['teacher-bookings'] });
    queryClient.invalidateQueries({ queryKey: ['pending'] });
  };

  const addSlot = useMutation({
    mutationFn: ({ weekday, startTime }) =>
      api('/slots', { method: 'POST', body: { weekday, startTime } }),
    onSuccess: () => {
      toast('Time added.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const removeSlot = useMutation({
    mutationFn: (id) => api(`/slots/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Time removed.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const cancelBooking = useMutation({
    mutationFn: (id) => api(`/bookings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Booking cancelled.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const paidMutation = useMutation({
    mutationFn: ({ id, paid }) => api(`/bookings/${id}/paid`, { method: 'PATCH', body: { paid } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teacher-bookings'] }),
    onError: (err) => toast(err.message),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }) => api(`/recurring/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_d, { action }) => {
      toast(action === 'approve' ? 'Weekly spot approved.' : 'Request declined.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const slotsByDay = useMemo(() => {
    const map = new Map(DISPLAY_ORDER.map((d) => [d, []]));
    for (const s of slotsQuery.data?.slots || []) {
      map.get(s.weekday)?.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [slotsQuery.data]);

  const openSlots = (scheduleQuery.data?.slots || []).filter((s) => s.status === 'open');

  return (
    <div className="container">
      <h1 className="page-title">Your schedule</h1>
      <p className="page-sub">Add weekly lesson times, manage bookings, and approve weekly spots.</p>

      {/* Week navigation for bookings/share */}
      <div className="week-nav">
        <button
          type="button"
          className="week-nav-btn"
          onClick={() => setWeekOffset((o) => o - 1)}
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="week-nav-text">
          Week of <strong>{weekRangeLabel(weekStart)}</strong>
        </span>
        <button
          type="button"
          className="week-nav-btn"
          onClick={() => setWeekOffset((o) => o + 1)}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {/* Pending weekly-spot requests */}
      {pendingQuery.data?.pending?.length > 0 && (
        <div className="card" style={{ borderColor: '#f0c090', borderWidth: 2 }}>
          <div className="section-title">⏳ Weekly spot requests</div>
          {pendingQuery.data.pending.map((p) => (
            <div className="list-row" key={p.id}>
              <div className="when">
                <div className="d">{WEEKDAYS[p.weekday]}</div>
                <div>
                  {fmtTimeRange(p.startTime, p.durationMin)}
                  {p.firstLessonDate && (
                    <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                      First lesson {fmtDate(p.firstLessonDate, { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>
              <div className="grow">
                {p.student.name}
                <div className="contact">{p.student.email}{p.student.phone ? ` · ${p.student.phone}` : ''}</div>
              </div>
              <div className="row" style={{ gap: '0.4rem' }}>
                <button
                  type="button"
                  className="btn btn-green btn-sm"
                  onClick={() => decide.mutate({ id: p.id, action: 'approve' })}
                  disabled={decide.isPending}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => decide.mutate({ id: p.id, action: 'decline' })}
                  disabled={decide.isPending}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bookings this week */}
      <div className="card">
        <div className="section-title">Bookings · week of {weekRangeLabel(weekStart)}</div>
        {bookingsQuery.isLoading && <div className="loading">Loading…</div>}
        {bookingsQuery.data && (
          <BookingsList
            data={bookingsQuery.data}
            trackPayments={bookingsQuery.data.trackPayments}
            onCancel={(id) => {
              if (window.confirm('Cancel this booking? The slot will reopen.')) cancelBooking.mutate(id);
            }}
            onPaidChange={(id, paid) => paidMutation.mutate({ id, paid })}
            cancelPending={cancelBooking.isPending}
            paidPending={paidMutation.isPending}
          />
        )}
      </div>

      {/* Slot management grid */}
      <div className="card">
        <div className="section-title">Weekly lesson times</div>
        <div className="day-grid">
          {DISPLAY_ORDER.map((wd) => {
            const slots = slotsByDay.get(wd) || [];
            const used = new Set(slots.map((s) => s.startTime));
            const available = TIME_OPTIONS.filter((t) => !used.has(t));
            return (
              <div className="day-col" key={wd}>
                <div className="day-col-head">{SHORT[wd]}</div>
                {slots.length === 0 && (
                  <span className="muted" style={{ fontSize: '11px' }}>
                    None
                  </span>
                )}
                {slots.map((s) => (
                  <div className="slot-chip" key={s.id}>
                    <span className="t">{fmtTime(s.startTime)}</span>
                    <button
                      type="button"
                      className="chip-x"
                      title="Remove time"
                      onClick={() => removeSlot.mutate(s.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {available.length > 0 && (
                  <div className="time-add">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addSlot.mutate({ weekday: wd, startTime: e.target.value });
                      }}
                    >
                      <option value="">+ Add time</option>
                      {available.map((t) => (
                        <option key={t} value={t}>
                          {fmtTime(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SharePanel
        teacherId={user.id}
        studios={myStudiosQuery.data?.studios || []}
        openSlots={openSlots}
        weekLabel={weekRangeLabel(weekStart)}
      />

    </div>
  );
}

function BookingsList({ data, trackPayments, onCancel, onPaidChange, cancelPending, paidPending }) {
  const { bookings, recurring } = data;
  if (!bookings.length && !recurring.length) {
    return <p className="muted" style={{ fontSize: '14px' }}>No bookings for this week yet.</p>;
  }
  return (
    <>
      {recurring.map((r) => (
        <div className="list-row" key={`rec-${r.id}`}>
          <div className="when">
            <div className="d">Every {WEEKDAYS[r.weekday]}</div>
            <div>{fmtTimeRange(r.startTime, r.durationMin)}</div>
          </div>
          <div className="grow">
            {r.student.name}
            <div className="contact">{r.student.email}{r.student.phone ? ` · ${r.student.phone}` : ''}</div>
          </div>
          <span className="pill pill-taken">Weekly</span>
        </div>
      ))}
      {bookings.map((b) => (
        <div className="list-row" key={b.id}>
          <div className="when">
            <div className="d">{fmtDate(b.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div>{fmtTimeRange(b.startTime, b.durationMin)}</div>
          </div>
          <div className="grow">
            {b.student.name}
            <div className="contact">{b.student.email}{b.student.phone ? ` · ${b.student.phone}` : ''}</div>
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            {trackPayments && (
              <PaidToggle
                paid={b.paid}
                disabled={paidPending}
                onChange={(paid) => onPaidChange(b.id, paid)}
              />
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onCancel(b.id)}
              disabled={cancelPending}
            >
              Cancel
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
