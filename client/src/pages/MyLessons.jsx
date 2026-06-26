import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { WEEKDAYS, fmtTimeRange, fmtDate } from '../lib/format.js';

export default function MyLessons() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-lessons'],
    queryFn: () => api('/bookings/me'),
    refetchInterval: 20000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => api(`/bookings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Lesson cancelled.');
      queryClient.invalidateQueries({ queryKey: ['my-lessons'] });
    },
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
              {data.recurring.map((r) => (
                <div className="list-row" key={`r-${r.id}`}>
                  <div className="when">
                    <div className="d">Every {WEEKDAYS[r.weekday]}</div>
                    <div>{fmtTimeRange(r.startTime, r.durationMin)}</div>
                  </div>
                  <div className="grow">{r.teacher.name}</div>
                  <span className="pill pill-taken">Weekly</span>
                </div>
              ))}
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => cancel(b.id)}
                    disabled={cancelMutation.isPending}
                  >
                    Cancel
                  </button>
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
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
