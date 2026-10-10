import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import { fmtDate } from '../../lib/format.js';

export default function StudentsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const recentQuery = useQuery({
    queryKey: ['owner-recent-students'],
    queryFn: () => api('/owner/recent-students'),
  });
  const rosterQuery = useQuery({
    queryKey: ['owner-studio-students'],
    queryFn: () => api('/owner/studio-students'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['owner-recent-students'] });
    queryClient.invalidateQueries({ queryKey: ['owner-studio-students'] });
    queryClient.invalidateQueries({ queryKey: ['owner-floor-fees'] });
    queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
  };

  const setAttendance = useMutation({
    mutationFn: ({ studentId, attends }) =>
      api(`/owner/students/${studentId}/attendance`, {
        method: 'PATCH',
        body: { attends },
      }),
    onSuccess: refresh,
    onError: (err) => toast(err.message),
  });

  const deactivate = useMutation({
    mutationFn: (studentId) => api(`/owner/students/${studentId}/deactivate`, { method: 'POST' }),
    onSuccess: () => {
      toast('Removed from studio students.');
      refresh();
    },
    onError: (err) => toast(err.message),
  });

  const roster = rosterQuery.data?.students || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) =>
      [s.fullName, s.email, s.childName].filter(Boolean).some((v) => v.toLowerCase().includes(q)),
    );
  }, [roster, search]);

  return (
    <div className="owner-grid cols-2">
      <div className="card">
        <div className="section-title">Recent lesson takers</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
          The last students to take a lesson here. Turn on Attends this studio if they train here.
          If they already selected your studio on their profile, the reduced fee stays on even when
          this toggle is off.
        </p>
        {recentQuery.isLoading && <div className="loading">Loading students…</div>}
        {recentQuery.isError && <p className="error-text">{recentQuery.error.message}</p>}
        {recentQuery.data?.students?.length === 0 && (
          <p className="muted" style={{ fontSize: '14px' }}>No lessons at this studio yet.</p>
        )}
        {recentQuery.data?.students?.map((s) => (
          <div className="list-row" key={s.studentId}>
            <div className="grow">
              <div>{s.childName || s.fullName}</div>
              <div className="contact">
                {s.childName ? `${s.fullName} · ` : ''}
                {fmtDate(s.lessonDate, { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              {s.selectedByStudent && (
                <span className="pill pill-partner" style={{ display: 'inline-block', marginTop: '0.35rem' }}>
                  Selected by student
                </span>
              )}
              {s.reducedFeeApplies && (
                <div className="muted" style={{ fontSize: '12px', marginTop: '0.25rem' }}>
                  Reduced fee applies
                </div>
              )}
            </div>
            <span className="muted" style={{ fontSize: '12px' }}>Attends</span>
            <button
              type="button"
              className={`switch${s.markedByOwner ? ' on' : ''}`}
              aria-pressed={s.markedByOwner}
              aria-label={`${s.markedByOwner ? 'Unmark' : 'Mark'} ${s.fullName} as attending this studio`}
              disabled={setAttendance.isPending && setAttendance.variables?.studentId === s.studentId}
              onClick={() => setAttendance.mutate({ studentId: s.studentId, attends: !s.markedByOwner })}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-title">Studio students</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
          Everyone currently charged the studio-student rate. Deactivate someone who no longer
          trains here. If they selected this studio on their profile, that selection is cleared too.
        </p>
        <div className="field">
          <label htmlFor="studio-student-search">Search</label>
          <input
            id="studio-student-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email"
          />
        </div>
        {rosterQuery.isLoading && <div className="loading">Loading studio students…</div>}
        {rosterQuery.isError && <p className="error-text">{rosterQuery.error.message}</p>}
        {!rosterQuery.isLoading && filtered.length === 0 && (
          <p className="muted" style={{ fontSize: '14px' }}>
            {roster.length === 0 ? 'No studio students yet.' : 'No matches.'}
          </p>
        )}
        {filtered.map((s) => (
          <div className="list-row" key={s.studentId}>
            <div className="grow">
              <div>{s.fullName}</div>
              <div className="contact">{s.email}</div>
              <div className="contact">
                {s.lastLessonDate
                  ? `Last lesson ${fmtDate(s.lastLessonDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'No recent lesson'}
                {s.markedByOwner ? ' · Marked by you' : ''}
                {s.selectedByStudent ? ' · Selected on their profile' : ''}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={deactivate.isPending}
              onClick={() => {
                const extra = s.selectedByStudent
                  ? ' They selected this studio on their profile, so that selection will be cleared.'
                  : '';
                if (window.confirm(`Deactivate ${s.fullName} as a studio student?${extra}`)) {
                  deactivate.mutate(s.studentId);
                }
              }}
            >
              Deactivate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
