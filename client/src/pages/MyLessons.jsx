import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import PaidToggle from '../components/PaidToggle.jsx';
import Modal, { ModalOption } from '../components/Modal.jsx';
import { WEEKDAYS, fmtTimeRange, fmtDate, upcomingWeekdayDates } from '../lib/format.js';

const UPCOMING_WEEKS = 6;

export default function MyLessons() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [leaveTarget, setLeaveTarget] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-lessons'],
    queryFn: () => api('/bookings/me'),
    refetchInterval: 20000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['my-lessons'] });

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

  const cancel = (id) => {
    if (window.confirm('Cancel this lesson? The slot will reopen for others.')) {
      cancelMutation.mutate(id);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">My lessons</h1>
      <p className="page-sub">Your upcoming bookings, weekly spots, and history.</p>

      {isLoading && <div className="loading">Loading…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && (
        <>
          {data.recurring.length > 0 && (
            <div className="card">
              <div className="section-title">Weekly spots</div>
              {data.recurring.map((r) => {
                const exceptionFor = (date) =>
                  (r.exceptions || []).find((e) => e.date === date)?.kind || null;
                const paidFor = (date) =>
                  (r.payments || []).find((p) => p.date === date)?.paid === true;
                const occurrences = upcomingWeekdayDates(r.weekday, UPCOMING_WEEKS);
                return (
                  <div className="weekly-spot" key={`r-${r.id}`}>
                    <div className="list-row">
                      <div className="when">
                        <div className="d">Every {WEEKDAYS[r.weekday]}</div>
                        <div>{fmtTimeRange(r.startTime, r.durationMin)}</div>
                      </div>
                      <div className="grow">{r.teacher.name}</div>
                      <div className="row" style={{ gap: '0.4rem' }}>
                        <span className="pill pill-taken">Weekly</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setLeaveTarget(r)}
                        >
                          Leave
                        </button>
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
                                {r.trackPayments && (
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
                                  onClick={() => skipWeek.mutate({ id: r.id, date })}
                                  disabled={skipWeek.isPending}
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card">
            <div className="section-title">Upcoming</div>
            {data.upcoming.length === 0 ? (
              <p className="muted" style={{ fontSize: '14px' }}>
                No upcoming lessons. <Link to="/">Book one →</Link>
              </p>
            ) : (
              data.upcoming.map((b) => (
                <div className="list-row" key={b.id}>
                  <div className="when">
                    <div className="d">{fmtDate(b.lessonDate, { weekday: 'short' })}</div>
                    <div>{fmtDate(b.lessonDate, { month: 'short', day: 'numeric' })}</div>
                  </div>
                  <div className="grow">
                    {fmtTimeRange(b.startTime, b.durationMin)}
                    <div className="contact">{b.teacher.name}</div>
                  </div>
                  <div className="row" style={{ gap: '0.4rem' }}>
                    {b.trackPayments && (
                      <PaidToggle
                        paid={b.paid}
                        disabled={paidMutation.isPending}
                        onChange={(paid) => paidMutation.mutate({ id: b.id, paid })}
                      />
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => cancel(b.id)}
                      disabled={cancelMutation.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {data.past.length > 0 && (
            <div className="card">
              <div className="section-title">Past lessons</div>
              {data.past.map((b) => (
                <div className="list-row" key={b.id} style={{ opacity: 0.7 }}>
                  <div className="when">
                    <div className="d">{fmtDate(b.lessonDate, { weekday: 'short' })}</div>
                    <div>{fmtDate(b.lessonDate, { month: 'short', day: 'numeric' })}</div>
                  </div>
                  <div className="grow">
                    {fmtTimeRange(b.startTime, b.durationMin)}
                    <div className="contact">{b.teacher.name}</div>
                  </div>
                  {b.trackPayments && (
                    <PaidToggle
                      paid={b.paid}
                      disabled={paidMutation.isPending}
                      onChange={(paid) => paidMutation.mutate({ id: b.id, paid })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
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
    </div>
  );
}
