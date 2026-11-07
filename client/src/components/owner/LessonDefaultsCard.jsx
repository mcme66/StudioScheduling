import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';

function toDollars(cents) {
  return String(((cents ?? 0) / 100).toFixed(2)).replace(/\.00$/, '');
}

/** Studio-controlled price and lesson length for a managed coach's new lesson times. */
export default function LessonDefaultsCard({ teacherId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profileKey = ['owner-coach-profile', teacherId];
  const profileQuery = useQuery({
    queryKey: profileKey,
    queryFn: () => api(`/owner/teachers/${teacherId}/profile`),
  });
  const profile = profileQuery.data?.profile;
  const [form, setForm] = useState({ price: '', duration: '' });

  useEffect(() => {
    if (!profile) return;
    setForm({ price: toDollars(profile.defaultPriceCents), duration: String(profile.defaultDurationMin) });
  }, [profile]);

  const save = useMutation({
    mutationFn: () =>
      api(`/owner/teachers/${teacherId}/profile`, {
        method: 'PATCH',
        body: {
          defaultPriceCents: Math.round(Number(form.price || 0) * 100),
          defaultDurationMin: Number(form.duration || 45),
        },
      }),
    onSuccess: () => {
      toast('Lesson price and length saved.');
      queryClient.invalidateQueries({ queryKey: profileKey });
    },
    onError: (err) => toast(err.message),
  });

  const unchanged =
    profile &&
    Math.round(Number(form.price || 0) * 100) === profile.defaultPriceCents &&
    Number(form.duration || 0) === profile.defaultDurationMin;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="section-title">Lesson price &amp; length</div>
      <p className="muted" style={{ fontSize: '13px', marginTop: '-4px' }}>
        Set by the studio. New lesson times for this coach use these; existing times keep theirs.
      </p>
      {profileQuery.isLoading && <div className="loading">Loading…</div>}
      {profileQuery.isError && <p className="error-text">{profileQuery.error.message}</p>}
      {profile && (
        <>
          <div className="row" style={{ gap: '0.75rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="coach-default-price">Price ($)</label>
              <input
                id="coach-default-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="coach-default-duration">Lesson length (min)</label>
              <input
                id="coach-default-duration"
                type="number"
                min="5"
                max="240"
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={unchanged || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </form>
  );
}
