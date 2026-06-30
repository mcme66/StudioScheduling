import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import SharePanel from '../components/SharePanel.jsx';
import PaidToggle from '../components/PaidToggle.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';
import {
  WEEKDAYS,
  fmtTime,
  fmtTimeRange,
  fmtDate,
  getMonday,
  addWeeks,
  dateForWeekday,
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
  const [dialog, setDialog] = useState(null);

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

  const skipRecurring = useMutation({
    mutationFn: ({ id, date }) => api(`/recurring/${id}/skip`, { method: 'POST', body: { date } }),
    onSuccess: () => {
      toast('Cancelled for that week. The slot has reopened.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const removeRecurring = useMutation({
    mutationFn: (id) => api(`/recurring/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Removed from the weekly slot.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const blockSlot = useMutation({
    mutationFn: ({ slotId, date }) => api(`/slots/${slotId}/block`, { method: 'POST', body: { date } }),
    onSuccess: () => {
      toast('Slot marked unavailable for that week.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const dialogBusy =
    cancelBooking.isPending ||
    skipRecurring.isPending ||
    removeRecurring.isPending ||
    blockSlot.isPending ||
    removeSlot.isPending;

  const paidMutation = useMutation({
    mutationFn: ({ id, paid }) => api(`/bookings/${id}/paid`, { method: 'PATCH', body: { paid } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teacher-bookings'] }),
    onError: (err) => toast(err.message),
  });

  const recurringPaidMutation = useMutation({
    mutationFn: ({ id, date, paid }) =>
      api(`/recurring/${id}/paid`, { method: 'PATCH', body: { date, paid } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-bookings'] });
    },
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
            weekStart={weekStart}
            trackPayments={bookingsQuery.data.trackPayments}
            onManageBooking={(b) => setDialog({ type: 'booking', booking: b })}
            onManageRecurring={(r) => setDialog({ type: 'recurring', recurring: r })}
            onPaidChange={(id, paid) => paidMutation.mutate({ id, paid })}
            onRecurringPaidChange={({ id, date, paid }) =>
              recurringPaidMutation.mutate({ id, date, paid })
            }
            paidPending={paidMutation.isPending || recurringPaidMutation.isPending}
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
                      onClick={() => setDialog({ type: 'deleteSlot', slot: s })}
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

      {dialog?.type === 'recurring' && (
        <Modal
          title={`Cancel ${dialog.recurring.student.name}'s lesson`}
          subtitle={`${WEEKDAYS[dialog.recurring.weekday]} ${fmtTimeRange(
            dialog.recurring.startTime,
            dialog.recurring.durationMin,
          )} · week of ${weekRangeLabel(weekStart)}`}
          onClose={() => setDialog(null)}
        >
          <ModalOption
            label="Cancel this week only"
            description="The student skips this week; the slot reopens for others."
            disabled={dialogBusy}
            onClick={() => {
              skipRecurring.mutate({
                id: dialog.recurring.id,
                date: dateForWeekday(weekStart, dialog.recurring.weekday),
              });
              setDialog(null);
            }}
          />
          <ModalOption
            label="Cancel the slot this week"
            description="Mark this time unavailable this week; nobody can book it."
            disabled={dialogBusy}
            onClick={() => {
              blockSlot.mutate({
                slotId: dialog.recurring.slotId,
                date: dateForWeekday(weekStart, dialog.recurring.weekday),
              });
              setDialog(null);
            }}
          />
          <ModalOption
            label="Remove from weekly slot"
            description="Ends this weekly spot for good and frees the time every week."
            danger
            disabled={dialogBusy}
            onClick={() => {
              removeRecurring.mutate(dialog.recurring.id);
              setDialog(null);
            }}
          />
        </Modal>
      )}

      {dialog?.type === 'booking' && (
        <Modal
          title={`Cancel ${dialog.booking.student.name}'s lesson`}
          subtitle={`${fmtDate(dialog.booking.lessonDate, { weekday: 'long', month: 'short', day: 'numeric' })} · ${fmtTimeRange(
            dialog.booking.startTime,
            dialog.booking.durationMin,
          )}`}
          onClose={() => setDialog(null)}
        >
          <ModalOption
            label="Cancel this lesson"
            description="Cancels the booking; the slot reopens for others."
            disabled={dialogBusy}
            onClick={() => {
              cancelBooking.mutate(dialog.booking.id);
              setDialog(null);
            }}
          />
          <ModalOption
            label="Cancel the slot this week"
            description="Mark this time unavailable this week; nobody can book it."
            disabled={dialogBusy}
            onClick={() => {
              blockSlot.mutate({
                slotId: dialog.booking.slotId,
                date: dialog.booking.lessonDate,
              });
              setDialog(null);
            }}
          />
        </Modal>
      )}

      {dialog?.type === 'deleteSlot' && (
        <Modal
          title="Remove this time permanently?"
          subtitle={`${SHORT[dialog.slot.weekday]} ${fmtTime(dialog.slot.startTime)} — this cancels all of its lessons and weekly spots.`}
          onClose={() => setDialog(null)}
        >
          <ModalOption
            label="Delete permanently"
            description="The time is removed from your weekly schedule for good."
            danger
            disabled={dialogBusy}
            onClick={() => {
              removeSlot.mutate(dialog.slot.id);
              setDialog(null);
            }}
          />
          <ModalOption
            label="Keep it"
            description="Close without changing anything."
            disabled={dialogBusy}
            onClick={() => setDialog(null)}
          />
        </Modal>
      )}

    </div>
  );
}

function BookingsList({
  data,
  weekStart,
  trackPayments,
  onManageBooking,
  onManageRecurring,
  onPaidChange,
  onRecurringPaidChange,
  paidPending,
}) {
  const { bookings, recurring, exceptions = [] } = data;
  if (!bookings.length && !recurring.length) {
    return <p className="muted" style={{ fontSize: '14px' }}>No bookings for this week yet.</p>;
  }
  const exceptionFor = (slotId, date) =>
    exceptions.find((e) => e.slotId === slotId && e.date === date)?.kind || null;
  return (
    <>
      {recurring.map((r) => {
        const date = dateForWeekday(weekStart, r.weekday);
        const exception = exceptionFor(r.slotId, date);
        return (
          <div className="list-row" key={`rec-${r.id}`}>
            <div className="when">
              <div className="d">Every {WEEKDAYS[r.weekday]}</div>
              <div>{fmtTimeRange(r.startTime, r.durationMin)}</div>
            </div>
            <div className="grow">
              {r.student.name}
              <div className="contact">{r.student.email}{r.student.phone ? ` · ${r.student.phone}` : ''}</div>
            </div>
            {exception === 'blocked' ? (
              <span className="pill pill-warn">Unavailable this week</span>
            ) : exception === 'skipped' ? (
              <span className="pill pill-warn">Cancelled this week</span>
            ) : (
              <div className="row" style={{ gap: '0.4rem' }}>
                <span className="pill pill-taken">Weekly</span>
                {trackPayments && (
                  <PaidToggle
                    paid={r.paid === true}
                    disabled={paidPending}
                    onChange={(paid) =>
                      onRecurringPaidChange({
                        id: r.id,
                        date: r.lessonDate || dateForWeekday(weekStart, r.weekday),
                        paid,
                      })
                    }
                  />
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onManageRecurring(r)}
                >
                  Cancel…
                </button>
              </div>
            )}
          </div>
        );
      })}
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
              onClick={() => onManageBooking(b)}
            >
              Cancel…
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
