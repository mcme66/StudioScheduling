import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import { WEEKDAYS, fmtDate, fmtTimeRange } from '../lib/format.js';

export default function OwnerCancellationRequests() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fillFor, setFillFor] = useState(null);
  const [substituteId, setSubstituteId] = useState('');

  const requestsQuery = useQuery({
    queryKey: ['owner-cancellation-requests'],
    queryFn: () => api('/owner/cancellation-requests'),
  });
  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['owner-cancellation-requests'] });
    queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    queryClient.invalidateQueries({ queryKey: ['teacher-bookings'] });
    queryClient.invalidateQueries({ queryKey: ['slots'] });
    queryClient.invalidateQueries({ queryKey: ['teacher-schedule'] });
  };

  const applyRequest = useMutation({
    mutationFn: (id) => api(`/owner/cancellation-requests/${id}/apply`, { method: 'POST' }),
    onSuccess: () => {
      toast('Cancellation applied.');
      refresh();
    },
    onError: (err) => toast(err.message),
  });
  const dismissRequest = useMutation({
    mutationFn: (id) => api(`/owner/cancellation-requests/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => {
      toast('Request dismissed.');
      refresh();
    },
    onError: (err) => toast(err.message),
  });
  const fillRequest = useMutation({
    mutationFn: ({ id, teacherId }) =>
      api(`/owner/cancellation-requests/${id}/fill`, { method: 'POST', body: { teacherId } }),
    onSuccess: () => {
      toast('Lesson moved to the other coach.');
      setFillFor(null);
      setSubstituteId('');
      refresh();
    },
    onError: (err) => toast(err.message),
  });

  const requests = requestsQuery.data?.requests || [];
  const coaches = studioQuery.data?.teachers || [];
  const busy = applyRequest.isPending || dismissRequest.isPending || fillRequest.isPending;
  const substitutes = coaches.filter((coach) => coach.id !== fillFor?.teacherId);

  return (
    <div className="container">
      <p style={{ marginTop: 0 }}>
        <Link to="/owner">← Studio</Link>
      </p>
      <h1 className="page-title">Cancellation requests</h1>
      <p className="page-sub">
        Managed coaches ask here instead of changing the lesson themselves. Apply the cancellation,
        fill it with another coach at your studio, or dismiss it and leave the schedule as it is.
      </p>

      {requestsQuery.isLoading && <div className="loading">Loading…</div>}
      {requestsQuery.isError && <p className="error-text">{requestsQuery.error.message}</p>}

      {!requestsQuery.isLoading && requests.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No cancellation requests right now.
          </p>
        </div>
      )}

      {requests.length > 0 && (
        <div className="card">
          {requests.map((request) => {
            const when = request.series
              ? `Every ${WEEKDAYS[request.weekday]} · ${fmtTimeRange(request.startTime, request.durationMin)}`
              : `${fmtDate(request.lessonDate, { weekday: 'long', month: 'short', day: 'numeric' })} · ${fmtTimeRange(request.startTime, request.durationMin)}`;
            return (
              <div className="list-row" key={request.id} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <strong>{request.teacherName}</strong>
                  <div>{request.actionLabel}</div>
                  <div className="contact">
                    {when}
                    {request.fromDate && request.action === 'series_end'
                      ? ` · from ${fmtDate(request.fromDate, { month: 'short', day: 'numeric' })}`
                      : ''}
                  </div>
                  <div className="contact">
                    Who: {request.occupantLabel}
                    {request.occupantDetail ? ` · ${request.occupantDetail}` : ''}
                  </div>
                </div>
                <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => applyRequest.mutate(request.id)}
                  >
                    {request.actionLabel}
                  </button>
                  {request.canFill && (
                    <button
                      type="button"
                      className="btn btn-green btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setFillFor(request);
                        setSubstituteId('');
                      }}
                    >
                      Fill
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => dismissRequest.mutate(request.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {fillFor && (
        <Modal
          title="Fill with another coach"
          subtitle={`${fillFor.teacherName} · ${fillFor.actionLabel} · ${fillFor.occupantLabel}`}
          onClose={() => setFillFor(null)}
        >
          <p className="muted" style={{ fontSize: '13px' }}>
            {fillFor.action === 'recurring_remove'
              ? 'The whole weekly series moves to the coach you choose.'
              : fillFor.action === 'series_end'
                ? 'The weekly spot and future bookings move to the coach you choose, starting on the requested date.'
                : 'Only this lesson moves. The student stays at the same day and time.'}
          </p>
          {substitutes.length === 0 ? (
            <p>No other coaches are listed at this studio.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!substituteId) return;
                fillRequest.mutate({ id: fillFor.id, teacherId: Number(substituteId) });
              }}
            >
              <div className="field">
                <label htmlFor="fill-coach">Coach</label>
                <select
                  id="fill-coach"
                  value={substituteId}
                  onChange={(e) => setSubstituteId(e.target.value)}
                  required
                >
                  <option value="">Choose a coach</option>
                  {substitutes.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={fillRequest.isPending || !substituteId}>
                {fillRequest.isPending ? 'Moving…' : 'Move this lesson'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
