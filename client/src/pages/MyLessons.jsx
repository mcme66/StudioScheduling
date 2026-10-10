import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import PaidToggle from '../components/PaidToggle.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';
import AddToCalendar from '../components/AddToCalendar.jsx';
import WeekCalendar from '../components/WeekCalendar.jsx';
import {
  WEEKDAYS,
  fmtTimeRange,
  fmtDate,
  upcomingWeekdayDates,
  todayISO,
  getMonday,
  addWeeks,
  dateForWeekday,
} from '../lib/format.js';
import {
  DEFAULT_LESSON_COLOR,
  PARTNER_LESSON_COLOR,
  colorForChild,
  isHexColor,
} from '../lib/lessonColors.js';

const UPCOMING_WEEKS = 6;
const CALENDAR_WEEKS_AHEAD = 8;

/** Every lesson, weekly occurrence, request, and invite that falls in one week. */
function buildWeekEvents({ data, invites, weekStart, colorFor }) {
  const weekEnd = dateForWeekday(weekStart, 0);
  const inWeek = (date) => date >= weekStart && date <= weekEnd;
  const events = [];

  for (const b of [...(data?.upcoming || []), ...(data?.past || [])]) {
    if (!inWeek(b.lessonDate)) continue;
    events.push({
      id: `b-${b.id}`,
      date: b.lessonDate,
      startTime: b.startTime,
      durationMin: b.durationMin,
      teacher: b.teacher.name,
      childName: b.childName,
      color: colorFor(b),
      note: b.isPartner ? `Partner · ${b.partnerName || ''}`.trim() : null,
    });
  }

  for (const r of data?.recurring || []) {
    const date = dateForWeekday(weekStart, r.weekday);
    if (r.startsOn && date < r.startsOn) continue;
    if (r.seriesStartDate && date < r.seriesStartDate) continue;
    if (r.seriesEndDate && date > r.seriesEndDate) continue;
    const kind = (r.exceptions || []).find((e) => e.date === date)?.kind || null;
    events.push({
      id: `r-${r.id}-${date}`,
      date,
      startTime: r.startTime,
      durationMin: r.durationMin,
      teacher: r.teacher.name,
      childName: r.childName,
      color: colorFor(r),
      variant: kind ? 'cancelled' : undefined,
      note: kind === 'blocked'
        ? 'Cancelled by teacher'
        : kind === 'skipped'
          ? 'Cancelled'
          : r.isPartner
            ? `Partner · ${r.partnerName || ''}`.trim()
            : null,
    });
  }

  for (const p of data?.pending || []) {
    const date = dateForWeekday(weekStart, p.weekday);
    if (p.startsOn && date < p.startsOn) continue;
    if (date < todayISO()) continue;
    events.push({
      id: `p-${p.id}-${date}`,
      date,
      startTime: p.startTime,
      durationMin: p.durationMin,
      teacher: p.teacher.name,
      childName: p.childName,
      color: colorFor(p),
      variant: 'pending',
      note: 'Pending',
    });
  }

  for (const inv of invites || []) {
    if (!inWeek(inv.lessonDate)) continue;
    events.push({
      id: `i-${inv.id}`,
      date: inv.lessonDate,
      startTime: inv.startTime,
      durationMin: inv.durationMin,
      teacher: inv.teacher.name,
      childName: inv.childName,
      color: colorFor(inv),
      variant: 'pending',
      note: 'Needs your answer',
    });
  }

  return events;
}

function upcomingOccurrences(r) {
  const from = r.startsOn && r.startsOn > todayISO() ? r.startsOn : todayISO();
  return upcomingWeekdayDates(r.weekday, UPCOMING_WEEKS, from).filter(
    (date) =>
      (!r.seriesStartDate || date >= r.seriesStartDate) &&
      (!r.seriesEndDate || date <= r.seriesEndDate),
  );
}

function lessonContact(item) {
  const bits = [item.teacher.name];
  if (item.childName) bits.push(`For ${item.childName}`);
  if (item.isPartner && item.partnerName) {
    bits.push(item.childName ? item.partnerName : `Booked by ${item.partnerName}`);
  }
  return bits.join(' · ');
}

function sameChild(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export default function MyLessons() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [calendarTarget, setCalendarTarget] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = addWeeks(getMonday(todayISO()), weekOffset);

  const profileQuery = useQuery({
    queryKey: ['student-profile'],
    queryFn: () => api('/students/me'),
  });
  const profile = profileQuery.data?.student;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-lessons'],
    queryFn: () => api('/bookings/me'),
    refetchInterval: 20000,
  });
  const invitesQuery = useQuery({
    queryKey: ['my-invites'],
    queryFn: () => api('/invites/me'),
    refetchInterval: 20000,
  });
  const [inviteChild, setInviteChild] = useState({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['my-lessons'] });
    queryClient.invalidateQueries({ queryKey: ['my-invites'] });
  };

  const cancelMutation = useMutation({
    mutationFn: (id) => api(`/bookings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Lesson cancelled.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const skipWeek = useMutation({
    mutationFn: ({ id, date }) => api(`/recurring/${id}/skip`, { method: 'POST', body: { date } }),
    onSuccess: () => {
      toast('Lesson cancelled for that week.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const leaveRecurring = useMutation({
    mutationFn: (id) => api(`/recurring/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Removed from the weekly slot.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const cancelRequest = useMutation({
    mutationFn: (id) => api(`/recurring/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Weekly request cancelled. The time is open again.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const acceptInvite = useMutation({
    mutationFn: ({ id, childName }) =>
      api(`/invites/${id}/accept`, { method: 'POST', body: { childName: childName || null } }),
    onSuccess: () => {
      toast('Lesson added to your schedule.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const declineInvite = useMutation({
    mutationFn: (id) => api(`/invites/${id}/decline`, { method: 'POST' }),
    onSuccess: () => {
      toast('Scheduled lesson declined.');
      invalidate();
    },
    onError: (err) => toast(err.message),
  });

  const paidMutation = useMutation({
    mutationFn: ({ id, paid }) => api(`/bookings/${id}/paid`, { method: 'PATCH', body: { paid } }),
    onSuccess: () => invalidate(),
    onError: (err) => toast(err.message),
  });

  const recurringPaidMutation = useMutation({
    mutationFn: ({ id, date, paid }) =>
      api(`/recurring/${id}/paid`, { method: 'PATCH', body: { date, paid } }),
    onSuccess: () => invalidate(),
    onError: (err) => toast(err.message),
  });

  const children = invitesQuery.data?.isParent ? invitesQuery.data.childrenNames || [] : [];
  const showChildTabs = children.length > 0;
  const activeChild = showChildTabs
    ? children.find((name) => sameChild(name, params.get('child'))) || null
    : null;
  const forChild = (item) => !activeChild || sameChild(item.childName, activeChild);

  const weeklySpots = (data?.recurring || [])
    .map((r) => ({ ...r, occurrences: upcomingOccurrences(r) }))
    .filter((r) => r.occurrences.length > 0)
    .filter(forChild);
  const upcoming = (data?.upcoming || []).filter(forChild);
  const past = (data?.past || []).filter(forChild);
  const invites = (invitesQuery.data?.invites || []).filter(forChild);
  const pendingRequests = (data?.pending || []).filter(forChild);

  const ownColor = isHexColor(profile?.lessonColor) ? profile.lessonColor : DEFAULT_LESSON_COLOR;
  const childrenColors = profile?.childrenColors;
  const colorFor = (item) => {
    if (item.isPartner) return PARTNER_LESSON_COLOR;
    return colorForChild(childrenColors, item.childName) || ownColor;
  };

  const childColor = (name) => colorForChild(childrenColors, name) || ownColor;

  const weekEvents = buildWeekEvents({
    data,
    invites: invitesQuery.data?.invites,
    weekStart,
    colorFor,
  }).filter(forChild);

  const legend = (() => {
    const items = [];
    if (showChildTabs) {
      const shown = activeChild ? [activeChild] : children;
      for (const name of shown) {
        items.push({ label: name, color: childColor(name) });
      }
    } else {
      items.push({ label: 'Your lessons', color: ownColor });
    }
    if (weekEvents.some((ev) => ev.color === PARTNER_LESSON_COLOR)) {
      items.push({ label: 'Partner lessons', color: PARTNER_LESSON_COLOR });
    }
    return items;
  })();

  const selectChild = (name) => {
    setParams(name ? { child: name } : {}, { replace: true });
  };

  const cancel = (id) => {
    if (window.confirm('Cancel this lesson? The slot will reopen for others.')) {
      cancelMutation.mutate(id);
    }
  };

  return (
    <div className="container owner-page">
      <h1 className="page-title">My lessons</h1>
      <p className="page-sub">Your upcoming bookings, weekly spots, and history.</p>

      {showChildTabs && (
        <div className="owner-tabs" role="tablist" aria-label="Children">
          <button
            type="button"
            role="tab"
            aria-selected={!activeChild}
            className={`owner-tab${!activeChild ? ' on' : ''}`}
            onClick={() => selectChild(null)}
          >
            All
          </button>
          {children.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={activeChild === name}
              className={`owner-tab${activeChild === name ? ' on' : ''}`}
              onClick={() => selectChild(name)}
            >
              <i className="tab-color-dot" style={{ background: childColor(name) }} aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="loading">Loading…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && (
        <>
          {invites.length > 0 && (
            <div className="card lessons-invite" style={{ borderColor: '#f0c090', borderWidth: 2 }}>
              <div className="section-title">⏳ Lesson scheduled for you</div>
              {invites.map((inv) => {
                const isParent = invitesQuery.data.isParent === true;
                const children = invitesQuery.data.childrenNames || [];
                const teacherChoseChild = Boolean(inv.childName);
                const chosen =
                  inv.childName ||
                  inviteChild[inv.id] ||
                  (children.length === 1 ? children[0] : '');
                return (
                  <div className="list-row" key={inv.id}>
                    <div className="when">
                      <div className="d">{WEEKDAYS[inv.weekday]}</div>
                      <div>
                        {fmtTimeRange(inv.startTime, inv.durationMin)}
                        <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                          {fmtDate(inv.lessonDate, { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </div>
                    <div className="grow">
                      {teacherChoseChild
                        ? `${inv.teacher.name} scheduled this for ${inv.childName}.`
                        : `Accept the spot that ${inv.teacher.name} scheduled for you.`}
                      {isParent && children.length > 1 && !teacherChoseChild && (
                        <div className="field" style={{ margin: '0.45rem 0 0' }}>
                          <label htmlFor={`invite-child-${inv.id}`}>Which child?</label>
                          <select
                            id={`invite-child-${inv.id}`}
                            value={inviteChild[inv.id] ?? (children.length === 1 ? children[0] : '')}
                            onChange={(e) =>
                              setInviteChild((prev) => ({ ...prev, [inv.id]: e.target.value }))
                            }
                          >
                            <option value="">Select a child</option>
                            {children.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ gap: '0.4rem' }}>
                      <button
                        type="button"
                        className="btn btn-green btn-sm"
                        disabled={acceptInvite.isPending || declineInvite.isPending}
                        onClick={() => {
                          if (isParent && children.length > 1 && !teacherChoseChild && !chosen) {
                            toast('Select which child this lesson is for.');
                            return;
                          }
                          acceptInvite.mutate({
                            id: inv.id,
                            childName: isParent ? chosen || children[0] : null,
                          });
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={acceptInvite.isPending || declineInvite.isPending}
                        onClick={() => declineInvite.mutate(inv.id)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pendingRequests.length > 0 && (
            <div className="card" style={{ borderColor: '#f0c090', borderWidth: 2, marginBottom: '1rem' }}>
              <div className="section-title">Waiting on your instructor</div>
              <p className="request-note">
                These weekly requests are not booked yet. Your instructor can accept every week, book the starting date only, or decline.
              </p>
              {pendingRequests.map((r) => (
                <div className="weekly-request" key={`pending-${r.id}`}>
                  <div className="list-row">
                    <div className="when">
                      <div className="d">Every {WEEKDAYS[r.weekday]}</div>
                      <div>
                        {fmtTimeRange(r.startTime, r.durationMin)}
                        {r.startsOn && (
                          <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                            Starting {fmtDate(r.startsOn, { month: 'short', day: 'numeric' })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grow">
                      {r.teacher.name}
                      {(r.childName || (r.isPartner && r.partnerName)) && (
                        <div className="contact">
                          {r.childName ? `For ${r.childName}` : ''}
                          {r.childName && r.isPartner && r.partnerName ? ' · ' : ''}
                          {r.isPartner && r.partnerName
                            ? r.childName
                              ? r.partnerName
                              : `Requested by ${r.partnerName}`
                            : ''}
                        </div>
                      )}
                    </div>
                    {r.canManage !== false && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={cancelRequest.isPending}
                        onClick={() => {
                          if (window.confirm('Cancel this weekly request? The time will open for others.')) {
                            cancelRequest.mutate(r.id);
                          }
                        }}
                      >
                        Cancel request
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="owner-grid cols-3 lessons-row">
            <div className="card">
              <div className="section-title">Weekly spots</div>
              {weeklySpots.length === 0 ? (
                <p className="muted" style={{ fontSize: '14px' }}>No weekly spots yet.</p>
              ) : (
                weeklySpots.map((r) => {
                  const exceptionFor = (date) =>
                    (r.exceptions || []).find((e) => e.date === date)?.kind || null;
                  const paidFor = (date) =>
                    (r.payments || []).find((p) => p.date === date)?.paid === true;
                  const occurrences = r.occurrences;
                  return (
                    <div className="weekly-spot" key={`r-${r.id}`}>
                      <div className="list-row">
                        <div className="when">
                          <div className="d">Every {WEEKDAYS[r.weekday]}</div>
                          <div>{fmtTimeRange(r.startTime, r.durationMin)}</div>
                        </div>
                        <div className="grow">
                          {r.teacher.name}
                          {(r.childName || (r.isPartner && r.partnerName)) && (
                            <div className="contact">
                              {r.childName ? `For ${r.childName}` : ''}
                              {r.childName && r.isPartner && r.partnerName ? ' · ' : ''}
                              {r.isPartner && r.partnerName
                                ? r.childName
                                  ? r.partnerName
                                  : `Booked by ${r.partnerName}`
                                : ''}
                            </div>
                          )}
                        </div>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          {r.isPartner && <span className="pill pill-partner">Partner</span>}
                          <span className="pill pill-taken">Weekly</span>
                          {r.canManage !== false && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setLeaveTarget(r)}
                            >
                              Leave
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="weekly-occurrences">
                        <div className="muted" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                          Upcoming weeks
                        </div>
                        {occurrences.map((date) => {
                          const kind = exceptionFor(date);
                          return (
                            <div className="occurrence-row" key={date}>
                              <span>{fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                              {kind === 'blocked' ? (
                                <span className="pill pill-warn">Cancelled by teacher</span>
                              ) : kind === 'skipped' ? (
                                <span className="pill pill-warn">Cancelled</span>
                              ) : (
                                <div className="row" style={{ gap: '0.4rem' }}>
                                  {r.trackPayments && r.canMarkPaid !== false && (
                                    <PaidToggle
                                      paid={paidFor(date)}
                                      disabled={recurringPaidMutation.isPending}
                                      onChange={(paid) =>
                                        recurringPaidMutation.mutate({ id: r.id, date, paid })
                                      }
                                    />
                                  )}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() =>
                                      setCalendarTarget({
                                        teacherName: r.teacher.name,
                                        childName: r.childName,
                                        lessonDate: date,
                                        startTime: r.startTime,
                                        durationMin: r.durationMin,
                                        subtitle: `${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeRange(r.startTime, r.durationMin)}`,
                                      })
                                    }
                                  >
                                    Calendar
                                  </button>
                                  {r.canManage !== false && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => skipWeek.mutate({ id: r.id, date })}
                                      disabled={skipWeek.isPending}
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="card">
              <div className="section-title">Upcoming</div>
              {upcoming.length === 0 ? (
                <p className="muted" style={{ fontSize: '14px' }}>
                  No upcoming lessons. <Link to="/">Book one →</Link>
                </p>
              ) : (
                upcoming.map((b) => (
                  <div className="list-row" key={b.id}>
                    <div className="when">
                      <div className="d">{fmtDate(b.lessonDate, { weekday: 'short' })}</div>
                      <div>{fmtDate(b.lessonDate, { month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="grow">
                      {fmtTimeRange(b.startTime, b.durationMin)}
                      <div className="contact">{lessonContact(b)}</div>
                    </div>
                    <div className="row" style={{ gap: '0.4rem' }}>
                      {b.isPartner && <span className="pill pill-partner">Partner</span>}
                      {b.trackPayments && b.canMarkPaid !== false && (
                        <PaidToggle
                          paid={b.paid}
                          disabled={paidMutation.isPending}
                          onChange={(paid) => paidMutation.mutate({ id: b.id, paid })}
                        />
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setCalendarTarget({
                            teacherName: b.teacher.name,
                            childName: b.childName,
                            lessonDate: b.lessonDate,
                            startTime: b.startTime,
                            durationMin: b.durationMin,
                            subtitle: `${fmtDate(b.lessonDate, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeRange(b.startTime, b.durationMin)}`,
                          })
                        }
                      >
                        Calendar
                      </button>
                      {b.canManage !== false && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => cancel(b.id)}
                          disabled={cancelMutation.isPending}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <div className="section-title">Past lessons</div>
              {past.length === 0 ? (
                <p className="muted" style={{ fontSize: '14px' }}>No past lessons yet.</p>
              ) : (
                past.map((b) => (
                  <div className="list-row" key={b.id} style={{ opacity: 0.7 }}>
                    <div className="when">
                      <div className="d">{fmtDate(b.lessonDate, { weekday: 'short' })}</div>
                      <div>{fmtDate(b.lessonDate, { month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="grow">
                      {fmtTimeRange(b.startTime, b.durationMin)}
                      <div className="contact">{lessonContact(b)}</div>
                    </div>
                    <div className="row" style={{ gap: '0.4rem' }}>
                      {b.isPartner && <span className="pill pill-partner">Partner</span>}
                      {b.trackPayments && b.canMarkPaid !== false && (
                        <PaidToggle
                          paid={b.paid}
                          disabled={paidMutation.isPending}
                          onChange={(paid) => paidMutation.mutate({ id: b.id, paid })}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <WeekCalendar
            weekStart={weekStart}
            onPrev={() => setWeekOffset((o) => Math.max(0, o - 1))}
            onNext={() => setWeekOffset((o) => Math.min(CALENDAR_WEEKS_AHEAD, o + 1))}
            prevDisabled={weekOffset <= 0}
            nextDisabled={weekOffset >= CALENDAR_WEEKS_AHEAD}
            events={weekEvents}
            legend={legend}
          />
        </>
      )}

      {leaveTarget && (
        <Modal
          title="Leave this weekly slot?"
          subtitle={`Every ${WEEKDAYS[leaveTarget.weekday]} ${fmtTimeRange(
            leaveTarget.startTime,
            leaveTarget.durationMin,
          )} with ${leaveTarget.teacher.name}`}
          onClose={() => setLeaveTarget(null)}
        >
          <ModalOption
            label="Leave permanently"
            description="Gives up this time every week. You can request it again later if it's open."
            danger
            disabled={leaveRecurring.isPending}
            onClick={() => {
              leaveRecurring.mutate(leaveTarget.id);
              setLeaveTarget(null);
            }}
          />
          <ModalOption
            label="Keep my weekly spot"
            description="Close without changing anything."
            disabled={leaveRecurring.isPending}
            onClick={() => setLeaveTarget(null)}
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
  );
}
