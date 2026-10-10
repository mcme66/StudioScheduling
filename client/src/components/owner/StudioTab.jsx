import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';

export default function StudioTab({ data }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const studio = data.studio;
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      name: studio.name || '',
      description: studio.description || '',
    });
  }, [studio]);

  const save = useMutation({
    mutationFn: () =>
      api('/owner/studio', {
        method: 'PATCH',
        body: { name: form.name, description: form.description },
      }),
    onSuccess: () => {
      toast('Studio details saved.');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
      if (studio.slug) queryClient.invalidateQueries({ queryKey: ['studio', studio.slug] });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <>
      <div className="owner-grid cols-3">
        <div className="card kpi-card">
          <div className="kpi-label">Rooms</div>
          <div className="kpi-value">{data.rooms.length}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Classes</div>
          <div className="kpi-value">{data.classSchedules.length}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Coaches</div>
          <div className="kpi-value">{data.teachers.length}</div>
        </div>
      </div>

      <div className="owner-grid cols-2" style={{ marginTop: '1rem' }}>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="section-title">Studio details</div>
          <div className="field">
            <label htmlFor="owner-studio-name">Name</label>
            <input
              id="owner-studio-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="owner-studio-description">Description</label>
            <textarea
              id="owner-studio-description"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save studio'}
          </button>
        </form>

        <div className="card">
          <div className="section-title">Public page</div>
          <p className="muted" style={{ fontSize: '13px', marginBottom: '0.85rem' }}>
            Students and teachers see this page when they browse studios.
          </p>
          <p style={{ marginBottom: '0.85rem' }}>{studio.description || 'No description yet.'}</p>
          <Link to={`/studios/${studio.slug}`}>View {studio.name}</Link>
        </div>
      </div>
    </>
  );
}
