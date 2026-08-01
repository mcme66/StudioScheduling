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
  isSlotPast,
} from '../lib/format.js';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Child name on the lesson when present; parent contact underneath. */
function StudentLessonInfo({ student }) {
  const lessonName = student.childName || student.name;
  const contactParts = [];
  if (student.childName) contactParts.push(`Parent: ${student.name}`);
  if (student.email) contactParts.push(student.email);
  if (student.phone) contactParts.push(student.phone);
  return (
    <div className="grow">
      {lessonName}
      {contactParts.length > 0 && (
        <div className="contact">{contactParts.join(' · ')}</div>
      )}
    </div>
  );
}

function lessonPersonName(student) {
  return student.childName || student.name;
}

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

  const slotsQuery = useQuery({
    queryKey: ['slots', weekStart],
    queryFn: () => api(`/slots?week=${weekStart}`),
  });
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

  const createSlot = useMutation({
    mutationFn: (body) => api('/slots', { method: 'POST', body }),
    onSuccess: (_d, body) => {
      toast(body.date ? 'One-time lesson added.' : 'Weekly lesson time added.');
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

  const endSeries = useMutation({
    mutationFn: ({ slotId, fromDate }) =>
      api(`/slots/${slotId}/end-series`, { method: 'POST', body: { fromDate } }),
    onSuccess: () => {
      toast('Removed this week and all future times.');
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
      toast('Time removed for this week only.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const unblockSlot = useMutation({
    mutationFn: ({ slotId, date }) =>
      api(`/slots/${slotId}/exceptions`, { method: 'DELETE', body: { date } }),
    onSuccess: () => {
      toast('Time restored for this week.');
      invalidateAll();
    },
    onError: (err) => toast(err.message),
  });

  const dialogBusy =
    cancelBooking.isPending ||
    skipRecurring.isPending ||
    removeRecurring.isPending ||
    blockSlot.isPending ||
    unblockSlot.isPending ||
    createSlot.isPending ||
    endSeries.isPending ||
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
      <p className="page-sub">
        Manage lesson times for the week you&apos;re viewing, bookings, and weekly spot requests.
      </p>

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
              <StudentLessonInfo student={p.student} />
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
        <div className="section-title">Lesson times</div>
        <p className="muted" style={{ fontSize: '12px', marginTop: '-4px', marginBottom: '10px' }}>
          Week of {weekRangeLabel(weekStart)}. Add one-time or weekly times for this week; weekly
          series can run for a set number of weeks, until a date, or forever.
        </p>
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
                {slots.map((s) => {
                  let tag = null;
                  if (s.oneOffDate) tag = 'one-time';
                  else if (s.blockedThisWeek) tag = 'off';
                  else if (s.seriesEndDate) {
                    tag = `to ${fmtDate(s.seriesEndDate, { month: 'short', day: 'numeric' })}`;
                  }
                  const cls = s.oneOffDate
                    ? 'slot-chip slot-chip-oneoff'
                    : s.blockedThisWeek
                      ? 'slot-chip slot-chip-blocked'
                      : 'slot-chip';
                  return (
                    <div className={cls} key={s.id}>
                      <span className="t">
                        {fmtTime(s.startTime)}
                        {tag && <em className="chip-tag">{tag}</em>}
                      </span>
                      <button
                        type="button"
                        className="chip-x"
                        title="Manage time"
                        onClick={() => setDialog({ type: 'deleteSlot', slot: s })}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {available.length > 0 && (
                  <div className="time-add">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setDialog({
                            type: 'addSlot',
                            weekday: wd,
                            startTime: e.target.value,
                            step: 'kind',
                            weekCount: '4',
                            untilDate: '',
                          });
                        }
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
          title={`Cancel ${lessonPersonName(dialog.recurring.student)}'s lesson`}
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
          title={`Cancel ${lessonPersonName(dialog.booking.student)}'s lesson`}
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

      {dialog?.type === 'addSlot' && (
        <AddSlotDialog
          dialog={dialog}
          setDialog={setDialog}
          weekStart={weekStart}
          dialogBusy={dialogBusy}
          onCreate={(body) => {
            createSlot.mutate(body);
            setDialog(null);
          }}
        />
      )}

      {dialog?.type === 'deleteSlot' && (
        <DeleteSlotDialog
          slot={dialog.slot}
          weekStart={weekStart}
          dialogBusy={dialogBusy}
          onClose={() => setDialog(null)}
          onRemoveOneOff={() => {
            removeSlot.mutate(dialog.slot.id);
            setDialog(null);
          }}
          onBlock={() => {
            blockSlot.mutate({
              slotId: dialog.slot.id,
              date: dateForWeekday(weekStart, dialog.slot.weekday),
            });
            setDialog(null);
          }}
          onEndSeries={() => {
            endSeries.mutate({
              slotId: dialog.slot.id,
              fromDate: dateForWeekday(weekStart, dialog.slot.weekday),
            });
            setDialog(null);
          }}
          onUnblock={() => {
            unblockSlot.mutate({
              slotId: dialog.slot.id,
              date: dateForWeekday(weekStart, dialog.slot.weekday),
            });
            setDialog(null);
          }}
        />
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
            <StudentLessonInfo student={r.student} />
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
          <StudentLessonInfo student={b.student} />
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

function AddSlotDialog({ dialog, setDialog, weekStart, dialogBusy, onCreate }) {
  const date = dateForWeekday(weekStart, dialog.weekday);
  const past = isSlotPast(date, dialog.startTime);
  const title = `Add ${SHORT[dialog.weekday]} ${fmtTime(dialog.startTime)}`;
  const subtitle = `Week of ${weekRangeLabel(weekStart)}`;

  if (dialog.step === 'weeklyDuration') {
    return (
      <Modal title="How many weeks?" subtitle={subtitle} onClose={() => setDialog(null)}>
        <ModalOption
          label="Number of weeks"
          description="Schedule this weekly time for a fixed number of weeks from this week."
          disabled={dialogBusy}
          onClick={() => setDialog((d) => ({ ...d, step: 'weeklyCount' }))}
        />
        <ModalOption
          label="Until date"
          description="Schedule weekly lessons through a chosen end date."
          disabled={dialogBusy}
          onClick={() => setDialog((d) => ({ ...d, step: 'weeklyUntil' }))}
        />
        <ModalOption
          label="Forever"
          description="Keep this time available every week going forward."
          disabled={dialogBusy}
          onClick={() =>
            onCreate({
              weekday: dialog.weekday,
              startTime: dialog.startTime,
              seriesMode: 'forever',
              anchorDate: date,
            })
          }
        />
        <ModalOption
          label="Back"
          description="Choose one-time or weekly again."
          disabled={dialogBusy}
          onClick={() => setDialog((d) => ({ ...d, step: 'kind' }))}
        />
      </Modal>
    );
  }

  if (dialog.step === 'weeklyCount') {
    const count = Number(dialog.weekCount);
    const valid = Number.isInteger(count) && count >= 1 && count <= 104;
    return (
      <Modal title="Number of weeks" subtitle={subtitle} onClose={() => setDialog(null)}>
        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="week-count">Weeks to schedule</label>
          <input
            id="week-count"
            type="number"
            min={1}
            max={104}
            value={dialog.weekCount}
            onChange={(e) => setDialog((d) => ({ ...d, weekCount: e.target.value }))}
          />
          <p className="muted" style={{ fontSize: '12px', marginTop: '0.35rem' }}>
            Starts from {fmtDate(date)} in the week you&apos;re viewing
            {past ? ' (or the next future occurrence if that time has passed)' : ''}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginBottom: '0.5rem' }}
          disabled={dialogBusy || !valid}
          onClick={() =>
            onCreate({
              weekday: dialog.weekday,
              startTime: dialog.startTime,
              seriesMode: 'count',
              weekCount: count,
              anchorDate: date,
            })
          }
        >
          Add for {valid ? count : '…'} week{count === 1 ? '' : 's'}
        </button>
        <ModalOption
          label="Back"
          description="Choose another weekly duration option."
          disabled={dialogBusy}
          onClick={() => setDialog((d) => ({ ...d, step: 'weeklyDuration' }))}
        />
      </Modal>
    );
  }

  if (dialog.step === 'weeklyUntil') {
    const untilOk = !!dialog.untilDate && dialog.untilDate >= date;
    return (
      <Modal title="Until date" subtitle={subtitle} onClose={() => setDialog(null)}>
        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="until-date">Schedule weekly through</label>
          <input
            id="until-date"
            type="date"
            value={dialog.untilDate}
            min={date}
            onChange={(e) => setDialog((d) => ({ ...d, untilDate: e.target.value }))}
          />
          <p className="muted" style={{ fontSize: '12px', marginTop: '0.35rem' }}>
            Last lesson will be the last {SHORT[dialog.weekday]} on or before this date.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginBottom: '0.5rem' }}
          disabled={dialogBusy || !untilOk}
          onClick={() =>
            onCreate({
              weekday: dialog.weekday,
              startTime: dialog.startTime,
              seriesMode: 'until',
              untilDate: dialog.untilDate,
              anchorDate: date,
            })
          }
        >
          Add weekly series
        </button>
        <ModalOption
          label="Back"
          description="Choose another weekly duration option."
          disabled={dialogBusy}
          onClick={() => setDialog((d) => ({ ...d, step: 'weeklyDuration' }))}
        />
      </Modal>
    );
  }

  // step === 'kind'
  return (
    <Modal title={title} subtitle={subtitle} onClose={() => setDialog(null)}>
      <ModalOption
        label="One-time slot"
        description={
          past
            ? 'Not allowed — that time has already passed.'
            : `Adds this time only for ${fmtDate(date)}.`
        }
        disabled={dialogBusy || past}
        onClick={() =>
          onCreate({
            weekday: dialog.weekday,
            startTime: dialog.startTime,
            date,
          })
        }
      />
      <ModalOption
        label="Weekly slot"
        description="Adds this time for this day each week, for a duration you choose next."
        disabled={dialogBusy}
        onClick={() => setDialog((d) => ({ ...d, step: 'weeklyDuration' }))}
      />
      <ModalOption
        label="Cancel"
        description="Close without adding anything."
        disabled={dialogBusy}
        onClick={() => setDialog(null)}
      />
    </Modal>
  );
}

function DeleteSlotDialog({
  slot,
  weekStart,
  dialogBusy,
  onClose,
  onRemoveOneOff,
  onBlock,
  onEndSeries,
  onUnblock,
}) {
  const date = dateForWeekday(weekStart, slot.weekday);
  const past = date < todayISO();

  if (slot.oneOffDate) {
    return (
      <Modal
        title="Remove this one-time lesson?"
        subtitle={`${SHORT[slot.weekday]} ${fmtTime(slot.startTime)} · ${fmtDate(date)}`}
        onClose={onClose}
      >
        <ModalOption
          label="Delete this slot"
          description="Removes this one-time lesson time and cancels any lesson on it."
          danger
          disabled={dialogBusy}
          onClick={onRemoveOneOff}
        />
        <ModalOption
          label="Keep it"
          description="Close without changing anything."
          disabled={dialogBusy}
          onClick={onClose}
        />
      </Modal>
    );
  }

  if (slot.blockedThisWeek) {
    return (
      <Modal
        title="This time is removed for this week"
        subtitle={`${SHORT[slot.weekday]} ${fmtTime(slot.startTime)} · week of ${weekRangeLabel(weekStart)}`}
        onClose={onClose}
      >
        <ModalOption
          label="Restore this week"
          description="Makes this time available again for this week."
          disabled={dialogBusy}
          onClick={onUnblock}
        />
        <ModalOption
          label="Delete this week and all future"
          description="Ends the series from this week forward. Past weeks stay in history."
          danger
          disabled={dialogBusy}
          onClick={onEndSeries}
        />
        <ModalOption
          label="Keep it"
          description="Close without changing anything."
          disabled={dialogBusy}
          onClick={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="Remove this time?"
      subtitle={`${SHORT[slot.weekday]} ${fmtTime(slot.startTime)} · week of ${weekRangeLabel(weekStart)}`}
      onClose={onClose}
    >
      <ModalOption
        label="Delete this week only"
        description={
          past
            ? 'That day has already passed this week.'
            : `Removes it only for the week of ${weekRangeLabel(weekStart)} and cancels anyone booked that week.`
        }
        disabled={dialogBusy || past}
        onClick={onBlock}
      />
      <ModalOption
        label="Delete this week and all future"
        description="Ends the series from this week forward. Past weeks and past bookings stay intact."
        danger
        disabled={dialogBusy}
        onClick={onEndSeries}
      />
      <ModalOption
        label="Keep it"
        description="Close without changing anything."
        disabled={dialogBusy}
        onClick={onClose}
      />
    </Modal>
  );
}
