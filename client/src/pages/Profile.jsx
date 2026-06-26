import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isTeacher = user?.role === 'teacher';

  const teacherQuery = useQuery({
    queryKey: ['teacher-profile'],
    queryFn: () => api('/teachers/me'),
    enabled: isTeacher,
  });
  const studentQuery = useQuery({
    queryKey: ['student-profile'],
    queryFn: () => api('/students/me'),
    enabled: !isTeacher,
  });
  const studiosQuery = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
    enabled: isTeacher,
  });
  const myStudiosQuery = useQuery({
    queryKey: ['my-studios'],
    queryFn: () => api('/teachers/me/studios'),
    enabled: isTeacher,
  });

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    receiveEmails: true,
    bio: '',
    defaultPrice: '74',
    defaultDurationMin: '45',
    studioId: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isTeacher && teacherQuery.data?.teacher) {
      const t = teacherQuery.data.teacher;
      const studio = myStudiosQuery.data?.studios?.[0];
      setForm({
        fullName: t.fullName || '',
        phone: t.phone || '',
        bio: t.bio || '',
        defaultPrice: String((t.defaultPriceCents || 7400) / 100),
        defaultDurationMin: String(t.defaultDurationMin || 45),
        studioId: studio ? String(studio.id) : '',
      });
    } else if (!isTeacher && studentQuery.data?.student) {
      const s = studentQuery.data.student;
      setForm((f) => ({
        ...f,
        fullName: s.fullName || '',
        phone: s.phone || '',
        receiveEmails: s.receiveEmails !== false,
      }));
    }
  }, [isTeacher, teacherQuery.data, studentQuery.data, myStudiosQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (isTeacher) {
        const currentStudio = myStudiosQuery.data?.studios?.[0];
        const studioId = Number(form.studioId);
        if (!studioId) throw new Error('Select a studio.');

        if (currentStudio && currentStudio.id !== studioId) {
          const nextStudio = studiosQuery.data?.studios?.find((s) => s.id === studioId);
          const message = `You will be removed from ${currentStudio.name} and listed at ${nextStudio?.name || 'the selected studio'} instead. Continue?`;
          if (!window.confirm(message)) throw new Error('__cancelled__');
        }

        await api('/teachers/me', {
          method: 'PATCH',
          body: {
            fullName: form.fullName,
            phone: form.phone || '',
            bio: form.bio || '',
            defaultPriceCents: Math.round(Number(form.defaultPrice || 0) * 100),
            defaultDurationMin: Number(form.defaultDurationMin || 45),
          },
        });

        if (!currentStudio || currentStudio.id !== studioId) {
          await api('/teachers/me/studios', { method: 'PUT', body: { studioId } });
        }
      } else {
        await api('/students/me', {
          method: 'PATCH',
          body: {
            fullName: form.fullName,
            phone: form.phone || '',
            receiveEmails: form.receiveEmails,
          },
        });
      }
    },
    onSuccess: async () => {
      toast('Profile saved.');
      setError('');
      await refresh();
      navigate('/');
    },
    onError: (err) => {
      if (err.message === '__cancelled__') return;
      setError(err.message);
    },
  });

  const loading = isTeacher
    ? teacherQuery.isLoading || myStudiosQuery.isLoading
    : studentQuery.isLoading;

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!user) {
    return null;
  }

  return (
    <div className="container narrow">
      <h1 className="page-title">Your profile</h1>
      <p className="page-sub">Update your account information.</p>

      {loading && <div className="loading">Loading profile…</div>}

      {!loading && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            save.mutate();
          }}
        >
          <div className="field">
            <label>Email</label>
            <input value={user.email} readOnly disabled />
          </div>
          <div className="field">
            <label>Full name</label>
            <input value={form.fullName} onChange={update('fullName')} required />
          </div>
          <div className="field">
            <label>Phone (optional)</label>
            <input value={form.phone} onChange={update('phone')} autoComplete="tel" />
          </div>

          {!isTeacher && (
            <div className={`recurring-toggle${form.receiveEmails ? ' active' : ''}`}>
              <div
                className="recurring-toggle-row"
                onClick={() => setForm((f) => ({ ...f, receiveEmails: !f.receiveEmails }))}
              >
                <div className="recurring-toggle-label">
                  <strong>Receive emails?</strong>
                  <span>Booking confirmations and lesson reminders</span>
                </div>
                <button
                  type="button"
                  className={`switch${form.receiveEmails ? ' on' : ''}`}
                  aria-pressed={form.receiveEmails}
                  aria-label="Toggle email notifications"
                />
              </div>
            </div>
          )}

          {isTeacher && (
            <>
              <div className="field">
                <label>Studio</label>
                <p className="muted" style={{ fontSize: '12px', marginBottom: '6px' }}>
                  You can only be listed at one studio at a time.
                </p>
                <select value={form.studioId} onChange={update('studioId')} required>
                  <option value="">Select a studio…</option>
                  {(studiosQuery.data?.studios || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Short bio (optional)</label>
                <textarea rows={3} value={form.bio} onChange={update('bio')} />
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Default price ($)</label>
                  <input type="number" min="0" value={form.defaultPrice} onChange={update('defaultPrice')} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Lesson length (min)</label>
                  <input
                    type="number"
                    min="5"
                    value={form.defaultDurationMin}
                    onChange={update('defaultDurationMin')}
                  />
                </div>
              </div>
            </>
          )}

          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}
    </div>
  );
}
