import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import ScheduleInfoPanel from '../components/ScheduleInfoPanel.jsx';
import {
  WEEKDAYS,
  fmtTime,
  fmtTimeRange,
  fmtPrice,
  fmtDate,
  getMonday,
  addWeeks,
  weekRangeLabel,
  todayISO,
  isSlotPast,
  isSlotBookable,
} from '../lib/format.js';

const MAX_WEEKS_AHEAD = 2;
// Display order: Mon..Sun.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function InstructorSchedule() {
  const { teacherId, slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [weekOffset, setWeekOffset] = useState(0);
  const [userPickedWeek, setUserPickedWeek] = useState(false);
  const [selected, setSelected] = useState(null); // slot object
  const [wantsRecurring, setWantsRecurring] = useState(false);
  const confirmRef = useRef(null);

  const baseMonday = getMonday(todayISO());
  const weekStart = addWeeks(baseMonday, weekOffset);

  const queryKey = ['schedule', teacherId, slug, weekStart];
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      api(`/teachers/${teacherId}/schedule?week=${weekStart}&studio=${encodeURIComponent(slug)}`),
    refetchInterval: 15000,
  });

  // If the current week has no bookable slots left, jump ahead to the next week.
  useEffect(() => {
    if (userPickedWeek || isLoading || !data?.slots?.length) return;
    const hasBookable = data.slots.some(isSlotBookable);
    if (!hasBookable && weekOffset < MAX_WEEKS_AHEAD) {
      setWeekOffset((o) => o + 1);
      setSelected(null);
    }
  }, [data, isLoading, weekOffset, userPickedWeek]);

  useEffect(() => {
    if (selected && confirmRef.current) {
      confirmRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selected]);

  const bookMutation = useMutation({
    mutationFn: async ({ slot, recurring }) => {
      await api('/bookings', {
        method: 'POST',
        body: { slotId: slot.id, lessonDate: slot.lessonDate },
      });
      if (recurring) {
        await api('/recurring', { method: 'POST', body: { slotId: slot.id } });
      }
    },
    onSuccess: (_d, { recurring }) => {
      toast(recurring ? 'Booked! Weekly spot requested.' : 'Lesson booked!');
      setSelected(null);
      setWantsRecurring(false);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast(err.message);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const slot of data?.slots || []) {
      if (!byDay.has(slot.weekday)) byDay.set(slot.weekday, []);
      byDay.get(slot.weekday).push(slot);
    }
    return DISPLAY_ORDER.filter((wd) => byDay.has(wd)).map((wd) => ({
      weekday: wd,
      slots: byDay.get(wd).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
  }, [data]);

  const selectSlot = (slot) => {
    if (!isSlotBookable(slot)) return;
    if (!user || user.role !== 'student') {
      navigate('/student/login', { state: { from: location } });
      return;
    }
    setSelected(slot);
    setWantsRecurring(false);
  };

  const statusLabel = (slot, past) => {
    if (past) return 'Already passed';
    if (slot.mine && slot.status === 'recurring') return 'Your weekly spot';
    if (slot.mine && slot.status === 'booked') return 'Booked by you';
    if (slot.mine && slot.status === 'pending') return 'Weekly spot pending';
    if (slot.status === 'recurring') return 'Weekly · reserved';
    if (slot.status === 'booked') return 'Booked';
    if (slot.status === 'pending') return 'Pending';
    return '';
  };

  const isOwner = user?.role === 'teacher' && user.id === Number(teacherId);

  return (
    <div className="container schedule-page">
      <Link to={`/studios/${slug}`} className="muted" style={{ fontSize: '13px' }}>
        ← {data?.teacher?.studio?.name || 'Back to studio'}
      </Link>
      <h1 className="page-title" style={{ marginTop: '0.5rem' }}>
        {data?.teacher?.fullName || 'Schedule'}
      </h1>
      {data?.teacher?.bio && <p className="page-sub">{data.teacher.bio}</p>}

      {(!user || user.role !== 'student') && !isOwner && (
        <div className="card" style={{ marginBottom: '1.25rem', fontSize: '14px' }}>
          Browse open times below.{' '}
          <Link to="/student/login" state={{ from: location }}>
            Log in as a student
          </Link>{' '}
          to book a lesson.
        </div>
      )}

      <div className="schedule-layout">
        <aside className="schedule-side">
          <ScheduleInfoPanel
            title="Additional Information"
            field="additionalInfo"
            html={data?.teacher?.additionalInfo}
            editable={isOwner}
            onSaved={() => queryClient.invalidateQueries({ queryKey })}
          />
        </aside>

        <div className="schedule-main">
          <div className="week-nav">
        <button
          type="button"
          className="week-nav-btn"
          onClick={() => {
            setUserPickedWeek(true);
            setWeekOffset((o) => Math.max(0, o - 1));
            setSelected(null);
          }}
          disabled={weekOffset === 0}
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
          onClick={() => {
            setUserPickedWeek(true);
            setWeekOffset((o) => Math.min(MAX_WEEKS_AHEAD, o + 1));
            setSelected(null);
          }}
          disabled={weekOffset === MAX_WEEKS_AHEAD}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {isLoading && <div className="loading">Loading schedule…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && grouped.length === 0 && (
        <div className="card center muted">No lessons scheduled for this week.</div>
      )}

      {grouped.map(({ weekday, slots }) => (
        <section className="day-group" key={weekday}>
          <div className="day-group-head">
            <span className="day-group-name">{WEEKDAYS[weekday]}</span>
            <span className="day-group-sep"> - </span>
            <span className="day-group-date">
              {fmtDate(slots[0].lessonDate, { month: 'long', day: 'numeric' })}
            </span>
          </div>
          <div className="day-group-slots">
            {slots.map((slot) => {
              const past = slot.status === 'open' && isSlotPast(slot.lessonDate, slot.startTime);
              const taken = slot.status !== 'open';
              const disabled = taken || past;
              const cls = ['slot-card'];
              if (slot.mine) cls.push('mine');
              else if (past) cls.push('past');
              else if (taken) cls.push('taken');
              if (slot.status === 'pending') cls.push('pending');
              if (selected?.id === slot.id) cls.push('selected');
              return (
                <div
                  key={slot.id}
                  className={cls.join(' ')}
                  onClick={() => selectSlot(slot)}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                      e.preventDefault();
                      selectSlot(slot);
                    }
                  }}
                >
                  <div className="slot-dot" />
                  <div className="slot-info">
                    <div className="slot-time">{fmtTimeRange(slot.startTime, slot.durationMin)}</div>
                    <div className="slot-meta">
                      {slot.durationMin} min · {fmtPrice(slot.priceCents)}
                    </div>
                  </div>
                  {(taken || past) && (
                    <span
                      className={`slot-status${slot.status === 'pending' ? ' slot-status-pending' : ''}${past ? ' slot-status-past' : ''}`}
                      style={{
                        color: past
                          ? '#8a8578'
                          : slot.mine
                            ? 'var(--green)'
                            : slot.status === 'pending'
                              ? '#a05a00'
                              : 'var(--muted)',
                      }}
                    >
                      {statusLabel(slot, past)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {selected && (
        <div className="card confirm-lesson" ref={confirmRef}>
          <div className="section-title">Confirm your lesson</div>
          <p style={{ fontSize: '14px', marginBottom: '0.75rem' }}>
            <strong>{WEEKDAYS[selected.weekday]}</strong>, {fmtDate(selected.lessonDate)} ·{' '}
            {fmtTimeRange(selected.startTime, selected.durationMin)}
          </p>

          <div className={`recurring-toggle${wantsRecurring ? ' active' : ''}`}>
            <div className="recurring-toggle-row" onClick={() => setWantsRecurring((v) => !v)}>
              <div className="recurring-toggle-label">
                <strong>Make this a weekly spot</strong>
                <span>Request this same time every week</span>
              </div>
              <button
                type="button"
                className={`switch${wantsRecurring ? ' on' : ''}`}
                aria-pressed={wantsRecurring}
                aria-label="Toggle weekly spot"
              />
            </div>
          </div>

          <div className="row" style={{ gap: '0.6rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelected(null)}
              disabled={bookMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary grow"
              style={{ flex: 1 }}
              onClick={() => bookMutation.mutate({ slot: selected, recurring: wantsRecurring })}
              disabled={bookMutation.isPending}
            >
              {bookMutation.isPending
                ? 'Booking…'
                : `Book ${fmtTime(selected.startTime)}`}
            </button>
          </div>
        </div>
      )}
        </div>

        <aside className="schedule-side">
          <ScheduleInfoPanel
            title="Teaching Policies"
            field="teachingPolicies"
            html={data?.teacher?.teachingPolicies}
            editable={isOwner}
            onSaved={() => queryClient.invalidateQueries({ queryKey })}
          />
        </aside>
      </div>
    </div>
  );
}
