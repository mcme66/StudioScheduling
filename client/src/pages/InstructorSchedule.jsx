import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import ScheduleInfoPanel from '../components/ScheduleInfoPanel.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';
import AddToCalendar from '../components/AddToCalendar.jsx';
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
  MAX_WEEKS_AHEAD,
} from '../lib/format.js';

function partnersForLesson(partners, childName) {
  const eligible = (partners || []).filter(
    (p) =>
      !p.scopedChildName ||
      (childName && p.scopedChildName.toLowerCase() === childName.toLowerCase()),
  );
  const seen = new Set();
  return eligible.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

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
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [selectedChild, setSelectedChild] = useState(null);
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [selectedPaymentPartnerId, setSelectedPaymentPartnerId] = useState(undefined);
  const [calendarTarget, setCalendarTarget] = useState(null);
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

  const canBook =
    user?.role === 'student' || (user?.role === 'teacher' && user?.canBookAsStudent === true);
  const profileQuery = useQuery({
    queryKey: ['student-profile'],
    queryFn: () => api('/students/me'),
    enabled: !!canBook,
  });
  const isParent = profileQuery.data?.student?.isParent === true;
  const childrenNames = (profileQuery.data?.student?.childrenNames || []).filter(Boolean);
  const partnersQuery = useQuery({
    queryKey: ['my-partners'],
    queryFn: () => api('/students/me/partners'),
    enabled: !!canBook,
  });
  const partners = partnersQuery.data?.partners || [];

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
    mutationFn: async ({ slot, recurring, childName, paymentPartnerId }) => {
      await api('/bookings', {
        method: 'POST',
        body: {
          slotId: slot.id,
          lessonDate: slot.lessonDate,
          ...(childName ? { childName } : {}),
          ...(paymentPartnerId ? { paymentPartnerId } : {}),
        },
      });
      if (recurring) {
        await api('/recurring', {
          method: 'POST',
          body: {
            slotId: slot.id,
            ...(childName ? { childName } : {}),
            ...(paymentPartnerId ? { paymentPartnerId } : {}),
            lessonDate: slot.lessonDate,
          },
        });
      }
    },
    onSuccess: (_d, { slot, recurring, childName }) => {
      toast(recurring ? 'Booked! Weekly spot requested.' : 'Lesson booked!');
      setCalendarTarget({
        teacherName: data?.teacher?.fullName || 'your instructor',
        childName: childName || null,
        lessonDate: slot.lessonDate,
        startTime: slot.startTime,
        durationMin: slot.durationMin,
        subtitle: `${fmtDate(slot.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeRange(slot.startTime, slot.durationMin)}`,
      });
      setSelected(null);
      setWantsRecurring(false);
      setSelectedChild(null);
      setSelectedPaymentPartnerId(undefined);
      setChildPickerOpen(false);
      setPartnerPickerOpen(false);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast(err.message);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const submitBooking = (childName, paymentPartnerId) => {
    bookMutation.mutate({
      slot: selected,
      recurring: wantsRecurring,
      childName,
      paymentPartnerId: paymentPartnerId || null,
    });
  };

  const startBooking = () => {
    if (!selected) return;
    if (isParent) {
      if (!childrenNames.length) {
        toast('Add your children on your profile before booking.');
        navigate('/profile');
        return;
      }
      if (!selectedChild) {
        setChildPickerOpen(true);
        return;
      }
    }
    if (partnersForLesson(partners, isParent ? selectedChild : null).length &&
      selectedPaymentPartnerId === undefined
    ) {
      setPartnerPickerOpen(true);
      return;
    }
    submitBooking(isParent ? selectedChild : null, selectedPaymentPartnerId ?? null);
  };

  const confirmChildBooking = (childName) => {
    setSelectedChild(childName);
    setChildPickerOpen(false);
    if (partnersForLesson(partners, childName).length) {
      setPartnerPickerOpen(true);
      return;
    }
    submitBooking(childName, null);
  };

  const confirmPartnerBooking = (partnerId) => {
    setSelectedPaymentPartnerId(partnerId);
    setPartnerPickerOpen(false);
    submitBooking(isParent ? selectedChild : null, partnerId);
  };

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
    if (!user) {
      navigate('/student/login', { state: { from: location } });
      return;
    }
    if (user.role === 'teacher' && user.id === Number(teacherId)) {
      toast('You cannot book a lesson on your own schedule.');
      return;
    }
    if (!canBook) {
      if (user.role === 'teacher') {
        toast('Turn on “Student as well?” in your profile to book lessons.');
        navigate('/profile');
        return;
      }
      navigate('/student/login', { state: { from: location } });
      return;
    }
    setSelected(slot);
    setWantsRecurring(false);
    setSelectedChild(null);
    setSelectedPaymentPartnerId(undefined);
    setChildPickerOpen(false);
    setPartnerPickerOpen(false);
  };

  const partnerSlotName = (slot) =>
    slot.bookedByPartner?.childName || slot.bookedByPartner?.name || '';

  const statusLabel = (slot, past) => {
    if (past) return 'Already passed';
    if (slot.mine && slot.status === 'recurring') return 'Your weekly spot';
    if (slot.mine && slot.status === 'booked') return 'Booked by you';
    if (slot.mine && slot.status === 'pending') return 'Weekly spot pending';
    if (slot.bookedByPartner) {
      const who = partnerSlotName(slot);
      if (slot.status === 'recurring') return `Weekly · ${who}`;
      if (slot.status === 'booked') return `Booked by ${who}`;
      if (slot.status === 'pending') return `Pending · ${who}`;
    }
    if (slot.status === 'recurring') return 'Weekly · reserved';
    if (slot.status === 'booked') return 'Booked';
    if (slot.status === 'pending') return 'Pending';
    if (slot.status === 'unavailable') return 'Unavailable';
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

      {!canBook && !isOwner && (
        <div className="card" style={{ marginBottom: '1.25rem', fontSize: '14px' }}>
          Browse open times below.{' '}
          {user?.role === 'teacher' ? (
            <>
              <Link to="/profile">Turn on “Student as well?”</Link> on your profile to book a
              lesson with another instructor.
            </>
          ) : (
            <>
              <Link to="/student/login" state={{ from: location }}>
                Log in as a student
              </Link>{' '}
              to book a lesson.
            </>
          )}
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
              const past = isSlotPast(slot.lessonDate, slot.startTime);
              const taken = slot.status !== 'open';
              const disabled = taken || past;
              const cls = ['slot-card'];
              if (past) cls.push('past');
              else if (slot.mine) cls.push('mine');
              else if (slot.bookedByPartner) cls.push('partner');
              else if (taken) cls.push('taken');
              if (!past && slot.status === 'pending') cls.push('pending');
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
                    <div className="slot-time">
                      {fmtTimeRange(slot.startTime, slot.durationMin)}
                      {slot.oneOff && <span className="slot-oneoff-tag">Temporary</span>}
                    </div>
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
                            : slot.bookedByPartner
                              ? 'var(--partner)'
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
          {isParent && selectedChild && (
            <p className="muted" style={{ fontSize: '13px', marginBottom: '0.75rem' }}>
              Registering: <strong>{selectedChild}</strong>
            </p>
          )}

          {selected.oneOff ? (
            <div className="recurring-locked" role="note">
              <span className="recurring-locked-icon" aria-hidden="true">🔒</span>
              <span>
                Weekly time slots cannot be requested for this lessons slot because this is a
                temporary slot.
              </span>
            </div>
          ) : (
            <div className={`recurring-toggle${wantsRecurring ? ' active' : ''}`}>
              <div className="recurring-toggle-row" onClick={() => setWantsRecurring((v) => !v)}>
                <div className="recurring-toggle-label">
                  <strong>Make this a weekly spot</strong>
                  <span>Weekly from this week forward</span>
                </div>
                <button
                  type="button"
                  className={`switch${wantsRecurring ? ' on' : ''}`}
                  aria-pressed={wantsRecurring}
                  aria-label="Toggle weekly spot"
                />
              </div>
            </div>
          )}

          <div className="row" style={{ gap: '0.6rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSelected(null);
                setSelectedChild(null);
                setSelectedPaymentPartnerId(undefined);
              }}
              disabled={bookMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary grow"
              style={{ flex: 1 }}
              onClick={startBooking}
              disabled={bookMutation.isPending}
            >
              {bookMutation.isPending
                ? 'Booking…'
                : isParent && !selectedChild
                  ? 'Choose child & book'
                  : partners.length && selectedPaymentPartnerId === undefined
                    ? 'Choose partner & book'
                    : isParent && selectedChild
                      ? `Book for ${selectedChild}`
                      : `Book ${fmtTime(selected.startTime)}`}
            </button>
          </div>
        </div>
      )}

      {childPickerOpen && (
        <Modal
          title="Who is this lesson for?"
          subtitle="Select the child you want to register for this lesson."
          onClose={() => !bookMutation.isPending && setChildPickerOpen(false)}
        >
          {childrenNames.map((name) => (
            <ModalOption
              key={name}
              label={name}
              description="Register this child for the lesson"
              disabled={bookMutation.isPending}
              onClick={() => confirmChildBooking(name)}
            />
          ))}
          <ModalOption
            label="Cancel"
            description="Go back without booking"
            disabled={bookMutation.isPending}
            onClick={() => setChildPickerOpen(false)}
          />
        </Modal>
      )}

      {partnerPickerOpen && (
        <Modal
          title="Split payment with a partner?"
          subtitle={
            selectedChild
              ? `Only partners linked to ${selectedChild} can see this lesson. This chooses who can mark their half as paid.`
              : 'Your partners can still see this lesson. This only chooses who can mark their half as paid.'
          }
          onClose={() => !bookMutation.isPending && setPartnerPickerOpen(false)}
        >
          {partnersForLesson(partners, isParent ? selectedChild : null).map((p) => (
            <ModalOption
              key={p.linkId || p.id}
              label={p.fullName}
              description="This partner can mark their half as paid"
              disabled={bookMutation.isPending}
              onClick={() => confirmPartnerBooking(p.id)}
            />
          ))}
          <ModalOption
            label="Just me"
            description="Only you mark this lesson as paid"
            disabled={bookMutation.isPending}
            onClick={() => confirmPartnerBooking(null)}
          />
          <ModalOption
            label="Cancel"
            description="Go back without booking"
            disabled={bookMutation.isPending}
            onClick={() => setPartnerPickerOpen(false)}
          />
        </Modal>
      )}

      {calendarTarget && (
        <AddToCalendar
          teacherName={calendarTarget.teacherName}
          childName={calendarTarget.childName}
          lessonDate={calendarTarget.lessonDate}
          startTime={calendarTarget.startTime}
          durationMin={calendarTarget.durationMin}
          subtitle={calendarTarget.subtitle}
          onClose={() => setCalendarTarget(null)}
        />
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
