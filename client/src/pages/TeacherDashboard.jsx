import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import SharePanel from '../components/SharePanel.jsx';
import PaidToggle from '../components/PaidToggle.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';
import AddToCalendar from '../components/AddToCalendar.jsx';
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

function weekdaySortIndex(weekday) {
  const i = DISPLAY_ORDER.indexOf(weekday);
  return i === -1 ? 99 : i;
}

function exceptionKind(exceptions, slotId, date) {
  return exceptions.find((e) => e.slotId === slotId && e.date === date)?.kind || null;
}

/** Merge weekly spots and one-off bookings, ordered Monday → Sunday then by time. */
function mergeWeekLessons(data, weekStart) {
  const { bookings = [], recurring = [], exceptions = [] } = data || {};
  const items = [
    ...recurring.map((r) => {
      const date = r.lessonDate || dateForWeekday(weekStart, r.weekday);
      return {
        key: `rec-${r.id}`,
        kind: 'recurring',
        weekday: r.weekday,
        date,
        startTime: r.startTime,
        durationMin: r.durationMin,
        exception: exceptionKind(exceptions, r.slotId, date),
        student: r.student,
        paymentPartner: r.paymentPartner,
        paid: r.paid,
        partnerPaid: r.partnerPaid,
        source: r,
      };
    }),
    ...bookings.map((b) => ({
      key: `bk-${b.id}`,
      kind: 'booking',
      weekday: b.weekday,
      date: b.lessonDate,
      startTime: b.startTime,
      durationMin: b.durationMin,
      exception: null,
      student: b.student,
      paymentPartner: b.paymentPartner,
      paid: b.paid,
      partnerPaid: b.partnerPaid,
      source: b,
    })),
  ];
  items.sort((a, b) => {
    const day = weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday);
    if (day) return day;
    return a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key);
  });
  return items;
}

function groupLessonsByDay(items) {
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || last.weekday !== item.weekday) {
      groups.push({ weekday: item.weekday, date: item.date, items: [item] });
    } else {
      last.items.push(item);
    }
  }
  return groups;
}

/** Child name on the lesson when present; parent contact underneath. */
function StudentLessonInfo({ student, paymentPartner }) {
  const lessonName = student.childName || student.name;
  const contactParts = [];
  if (student.childName) contactParts.push(`Parent: ${student.name}`);
  if (paymentPartner?.name) contactParts.push(`Partner: ${paymentPartner.name}`);
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

function firstName(full) {
  const trimmed = String(full || '').trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

function PartnershipPaidStatus({ bookerName, partnerName, paid, partnerPaid }) {
  return (
    <div className="partner-paid-status">
      <span>
        {firstName(bookerName)}: {paid ? 'Paid' : 'Unpaid'}
      </span>
      <span>
        {firstName(partnerName)}: {partnerPaid ? 'Paid' : 'Unpaid'}
      </span>
    </div>
  );
}

function lessonPersonName(student) {
  return student.childName || student.name;
}

function teacherLessonCalendarTarget(student, lessonDate, startTime, durationMin) {
  const title = student.childName
    ? `${student.childName} — lesson`
    : `Lesson with ${student.name}`;
  return {
    teacherName: student.name,
    childName: student.childName,
    title,
    lessonDate,
    startTime,
    durationMin,
    manageUrl: `${window.location.origin}/teacher`,
    subtitle: `${fmtDate(lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeRange(startTime, durationMin)}`,
  };
}

function LessonRow({
  item,
  whenLabel,
  trackPayments,
  onPaidChange,
  paidPending,
  onAddToCalendar,
  onManage,
  past = false,
  upNext = false,
}) {
  const rowClass = ['list-row'];
  if (past) rowClass.push('is-past');
  if (upNext) rowClass.push('is-next');
  return (
    <div className={rowClass.join(' ')}>
      <div className="when">
        <div className="d">{whenLabel}</div>
        <div>{fmtTimeRange(item.startTime, item.durationMin)}</div>
      </div>
      <StudentLessonInfo student={item.student} paymentPartner={item.paymentPartner} />
      {item.exception === 'blocked' ? (
        <span className="pill pill-warn">Unavailable this week</span>
      ) : item.exception === 'skipped' ? (
        <span className="pill pill-warn">Cancelled this week</span>
      ) : (
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {upNext && <span className="pill pill-taken">Up next</span>}
          {trackPayments && item.paymentPartner && (
            <PartnershipPaidStatus
              bookerName={item.student.name}
              partnerName={item.paymentPartner.name}
              paid={item.paid === true}
              partnerPaid={item.partnerPaid === true}
            />
          )}
          {trackPayments && (
            <PaidToggle
              paid={
                item.paymentPartner
                  ? item.paid === true && item.partnerPaid === true
                  : item.paid === true
              }
              disabled={paidPending}
              onChange={onPaidChange}
            />
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              onAddToCalendar(
                teacherLessonCalendarTarget(
                  item.student,
                  item.date,
                  item.startTime,
                  item.durationMin,
                ),
              )
            }
          >
            Calendar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onManage}>
            Cancel…
          </button>
        </div>
      )}
    </div>
  );
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
  const [calendarTarget, setCalendarTarget] = useState(null);

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
  const todayBookingsQuery = useQuery({
    queryKey: ['teacher-bookings', baseMonday],
    queryFn: () => api(`/teachers/me/bookings?week=${baseMonday}`),
    refetchInterval: 20000,
  });
  const pendingQuery = useQuery({
    queryKey: ['pending'],
    queryFn: () => api('/recurring/pending'),
    refetchInterval: 20000,
  });
  const invitesQuery = useQuery({
    queryKey: ['teacher-invites', weekStart],
    queryFn: () => api(`/invites?week=${weekStart}`),
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
    queryClient.invalidateQueries({ queryKey: ['teacher-invites'] });
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

  const lookupStudent = useMutation({
    mutationFn: (email) => api(`/invites/lookup?email=${encodeURIComponent(email)}`),
    onError: (err) => {
      setDialog((d) =>
        d?.type === 'scheduleStudent'
          ? { ...d, error: err.message, student: null, childName: '' }
          : d,
      );
    },
  });

  const scheduleInvite = useMutation({
    mutationFn: ({ slotId, lessonDate, email, childName }) =>
      api('/invites', {
        method: 'POST',
        body: { slotId, lessonDate, email, childName: childName || null },
      }),
    onSuccess: () => {
      toast('Scheduled. They will see it on My Lessons.');
      invalidateAll();
      setDialog(null);
    },
    onError: (err) => {
      setDialog((d) => (d?.type === 'scheduleStudent' ? { ...d, error: err.message } : d));
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (id) => api(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Invite cancelled. The time is open again.');
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
    removeSlot.isPending ||
    scheduleInvite.isPending ||
    lookupStudent.isPending ||
    cancelInvite.isPending;

  const slotsByDay = useMemo(() => {
    const map = new Map(DISPLAY_ORDER.map((d) => [d, []]));
    for (const s of slotsQuery.data?.slots || []) {
      map.get(s.weekday)?.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [slotsQuery.data]);

  const openSlots = (scheduleQuery.data?.slots || []).filter((s) => s.status === 'open');
  const openUpcoming = openSlots.filter((s) => !isSlotPast(s.lessonDate, s.startTime));

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
              <StudentLessonInfo student={p.student} paymentPartner={p.paymentPartner} />
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

      <div className="dashboard-split">
        <div className="card today-card">
          <div className="section-title">
            Today&apos;s Schedule ·{' '}
            {fmtDate(todayISO(), { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {todayBookingsQuery.isLoading && <div className="loading">Loading…</div>}
          {todayBookingsQuery.data && (
            <TodaySchedule
              data={todayBookingsQuery.data}
              weekStart={baseMonday}
              trackPayments={todayBookingsQuery.data.trackPayments}
              onManageBooking={(b) => setDialog({ type: 'booking', booking: b })}
              onManageRecurring={(r) =>
                setDialog({ type: 'recurring', recurring: r, weekStart: baseMonday })
              }
              onPaidChange={(id, paid) => paidMutation.mutate({ id, paid })}
              onRecurringPaidChange={({ id, date, paid }) =>
                recurringPaidMutation.mutate({ id, date, paid })
              }
              paidPending={paidMutation.isPending || recurringPaidMutation.isPending}
              onAddToCalendar={setCalendarTarget}
            />
          )}
        </div>
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
              onAddToCalendar={setCalendarTarget}
            />
          )}
        </div>
      </div>

      <div className="dashboard-split times-split">
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

        <div className="card open-times-card">
          <div className="section-title">Open times · week of {weekRangeLabel(weekStart)}</div>
          {scheduleQuery.isLoading && <div className="loading">Loading…</div>}
          {scheduleQuery.data && (
            <OpenTimesList
              slots={openSlots}
              pendingInvites={invitesQuery.data?.invites || []}
              onSchedule={(slot) =>
                setDialog({
                  type: 'scheduleStudent',
                  slot,
                  email: '',
                  error: '',
                  student: null,
                  childName: '',
                })
              }
              onCancelInvite={(id) => cancelInvite.mutate(id)}
              cancelPending={cancelInvite.isPending}
            />
          )}
        </div>
      </div>

      <SharePanel
        teacherId={user.id}
        studios={myStudiosQuery.data?.studios || []}
        openSlots={openUpcoming}
        weekLabel={weekRangeLabel(weekStart)}
      />

      {dialog?.type === 'recurring' && (
        <Modal
          title={`Cancel ${lessonPersonName(dialog.recurring.student)}'s lesson`}
          subtitle={`${WEEKDAYS[dialog.recurring.weekday]} ${fmtTimeRange(
            dialog.recurring.startTime,
            dialog.recurring.durationMin,
          )} · week of ${weekRangeLabel(dialog.weekStart || weekStart)}`}
          onClose={() => setDialog(null)}
        >
          <ModalOption
            label="Cancel this week only"
            description="The student skips this week; the slot reopens for others."
            disabled={dialogBusy}
            onClick={() => {
              skipRecurring.mutate({
                id: dialog.recurring.id,
                date: dateForWeekday(dialog.weekStart || weekStart, dialog.recurring.weekday),
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
                date: dateForWeekday(dialog.weekStart || weekStart, dialog.recurring.weekday),
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

      {dialog?.type === 'scheduleStudent' && (
        <Modal
          title="Schedule for student"
          subtitle={`${WEEKDAYS[dialog.slot.weekday]} ${fmtTimeRange(
            dialog.slot.startTime,
            dialog.slot.durationMin,
          )} · ${fmtDate(dialog.slot.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })}`}
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(dialog.email || '').trim();
              if (!email) {
                setDialog((d) => ({ ...d, error: 'Enter a student email address.' }));
                return;
              }
              if (!dialog.student) {
                lookupStudent.mutate(email, {
                  onSuccess: (data) => {
                    const student = data.student;
                    if (student.isParent) {
                      const children = student.childrenNames || [];
                      if (!children.length) {
                        setDialog((d) =>
                          d?.type === 'scheduleStudent'
                            ? {
                                ...d,
                                student: null,
                                childName: '',
                                error: 'This parent has no children on their profile.',
                              }
                            : d,
                        );
                        return;
                      }
                      setDialog((d) =>
                        d?.type === 'scheduleStudent'
                          ? {
                              ...d,
                              student,
                              childName: children.length === 1 ? children[0] : '',
                              error: '',
                            }
                          : d,
                      );
                      return;
                    }
                    scheduleInvite.mutate({
                      slotId: dialog.slot.id,
                      lessonDate: dialog.slot.lessonDate,
                      email,
                    });
                  },
                });
                return;
              }
              if (dialog.student.isParent && !String(dialog.childName || '').trim()) {
                setDialog((d) => ({ ...d, error: 'Select which child this lesson is for.' }));
                return;
              }
              scheduleInvite.mutate({
                slotId: dialog.slot.id,
                lessonDate: dialog.slot.lessonDate,
                email,
                childName: dialog.student.isParent ? dialog.childName : null,
              });
            }}
          >
            <div className="field">
              <label htmlFor="schedule-student-email">Student email</label>
              <input
                id="schedule-student-email"
                type="email"
                autoComplete="off"
                required
                value={dialog.email}
                onChange={(e) =>
                  setDialog((d) => ({
                    ...d,
                    email: e.target.value,
                    error: '',
                    student: null,
                    childName: '',
                  }))
                }
              />
            </div>
            {dialog.student?.isParent && (
              <>
                <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '13px' }}>
                  {dialog.student.name} is a parent. Choose which child this lesson is for.
                </p>
                <div className="field">
                  <label htmlFor="schedule-student-child">Child</label>
                  <select
                    id="schedule-student-child"
                    required
                    value={dialog.childName}
                    onChange={(e) =>
                      setDialog((d) => ({ ...d, childName: e.target.value, error: '' }))
                    }
                  >
                    <option value="">Select a child</option>
                    {(dialog.student.childrenNames || []).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {dialog.error && <p className="error-text">{dialog.error}</p>}
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={dialogBusy}
            >
              {lookupStudent.isPending
                ? 'Looking up…'
                : scheduleInvite.isPending
                  ? 'Scheduling…'
                  : dialog.student?.isParent
                    ? 'Schedule lesson'
                    : 'Continue'}
            </button>
          </form>
        </Modal>
      )}

      {calendarTarget && (
        <AddToCalendar
          teacherName={calendarTarget.teacherName}
          childName={calendarTarget.childName}
          title={calendarTarget.title}
          lessonDate={calendarTarget.lessonDate}
          startTime={calendarTarget.startTime}
          durationMin={calendarTarget.durationMin}
          manageUrl={calendarTarget.manageUrl}
          subtitle={calendarTarget.subtitle}
          onClose={() => setCalendarTarget(null)}
        />
      )}

    </div>
  );
}

function lessonPaidHandler(item, weekStart, onPaidChange, onRecurringPaidChange) {
  return (paid) => {
    if (item.kind === 'recurring') {
      onRecurringPaidChange({
        id: item.source.id,
        date: item.source.lessonDate || dateForWeekday(weekStart, item.source.weekday),
        paid,
      });
    } else {
      onPaidChange(item.source.id, paid);
    }
  };
}

function lessonManageHandler(item, onManageBooking, onManageRecurring) {
  return () => {
    if (item.kind === 'recurring') onManageRecurring(item.source);
    else onManageBooking(item.source);
  };
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
  onAddToCalendar,
}) {
  const items = mergeWeekLessons(data, weekStart);
  if (!items.length) {
    return <p className="muted" style={{ fontSize: '14px' }}>No bookings for this week yet.</p>;
  }
  const groups = groupLessonsByDay(items);
  return (
    <>
      {groups.map((group) => (
        <div className="bookings-day" key={group.weekday}>
          <div className="bookings-day-head">
            <span className="bookings-day-date">{WEEKDAYS[group.weekday]}</span>
            {' · '}
            {fmtDate(group.date, { month: 'short', day: 'numeric' })}
          </div>
          {group.items.map((item) => (
            <LessonRow
              key={item.key}
              item={item}
              whenLabel={item.kind === 'recurring' ? 'Weekly' : 'One-time'}
              trackPayments={trackPayments}
              onPaidChange={lessonPaidHandler(item, weekStart, onPaidChange, onRecurringPaidChange)}
              paidPending={paidPending}
              onAddToCalendar={onAddToCalendar}
              onManage={lessonManageHandler(item, onManageBooking, onManageRecurring)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function TodaySchedule({
  data,
  weekStart,
  trackPayments,
  onManageBooking,
  onManageRecurring,
  onPaidChange,
  onRecurringPaidChange,
  paidPending,
  onAddToCalendar,
}) {
  const today = todayISO();
  const items = mergeWeekLessons(data, weekStart).filter((item) => item.date === today);
  if (!items.length) {
    return <p className="muted" style={{ fontSize: '14px' }}>No lessons scheduled for today.</p>;
  }
  const nextKey = items.find((item) => !item.exception && !isSlotPast(item.date, item.startTime))?.key;
  return (
    <>
      {items.map((item) => (
        <LessonRow
          key={item.key}
          item={item}
          whenLabel={item.kind === 'recurring' ? 'Weekly' : 'One-time'}
          trackPayments={trackPayments}
          onPaidChange={lessonPaidHandler(item, weekStart, onPaidChange, onRecurringPaidChange)}
          paidPending={paidPending}
          onAddToCalendar={onAddToCalendar}
          onManage={lessonManageHandler(item, onManageBooking, onManageRecurring)}
          past={!item.exception && isSlotPast(item.date, item.startTime)}
          upNext={item.key === nextKey}
        />
      ))}
    </>
  );
}

function OpenTimesList({ slots, pendingInvites, onSchedule, onCancelInvite, cancelPending }) {
  const groups = [];
  const sorted = [...slots].sort(
    (a, b) =>
      weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday) ||
      a.startTime.localeCompare(b.startTime),
  );
  for (const slot of sorted) {
    const last = groups[groups.length - 1];
    if (!last || last.weekday !== slot.weekday) {
      groups.push({ weekday: slot.weekday, date: slot.lessonDate, slots: [slot] });
    } else {
      last.slots.push(slot);
    }
  }

  const waiting = [...pendingInvites].sort(
    (a, b) =>
      weekdaySortIndex(a.weekday) - weekdaySortIndex(b.weekday) ||
      a.startTime.localeCompare(b.startTime) ||
      a.lessonDate.localeCompare(b.lessonDate),
  );

  if (!groups.length && !waiting.length) {
    return (
      <p className="muted open-times-empty">No open times left this week.</p>
    );
  }

  return (
    <>
      {waiting.length > 0 && (
        <div className="bookings-day" style={{ marginBottom: groups.length ? '0.85rem' : 0 }}>
          <div className="bookings-day-head">Waiting for student</div>
          {waiting.map((inv) => (
            <div className="open-time-row" key={inv.id}>
              <div className="when">
                <div className="d">
                  {WEEKDAYS[inv.weekday]} · {fmtDate(inv.lessonDate, { month: 'short', day: 'numeric' })}
                </div>
                <div>{fmtTimeRange(inv.startTime, inv.durationMin)}</div>
              </div>
              <StudentLessonInfo student={{ ...inv.student, childName: inv.childName }} />
              <div className="open-time-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={cancelPending}
                  onClick={() => onCancelInvite(inv.id)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {groups.map((group) => (
        <div className="bookings-day" key={group.weekday}>
          <div className="bookings-day-head">
            <span className="bookings-day-date">{WEEKDAYS[group.weekday]}</span>
            {' · '}
            {fmtDate(group.date, { month: 'short', day: 'numeric' })}
          </div>
          {group.slots.map((slot) => {
            const past = isSlotPast(slot.lessonDate, slot.startTime);
            return (
              <div className={`open-time-row${past ? ' is-past' : ''}`} key={slot.id}>
                <div className="when">
                  <div className="d">{slot.oneOff ? 'One-time' : 'Weekly slot'}</div>
                  <div>{fmtTimeRange(slot.startTime, slot.durationMin)}</div>
                </div>
                <div className="open-time-actions">
                  {past ? (
                    <span className="muted">Passed</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-green btn-sm"
                      onClick={() => onSchedule(slot)}
                    >
                      Schedule for student
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
