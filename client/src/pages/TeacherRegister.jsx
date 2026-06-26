import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

export default function TeacherRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: studiosData } = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
  });

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    bio: '',
    defaultPrice: '74',
    defaultDurationMin: '45',
    studioId: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        role: 'teacher',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        bio: form.bio || undefined,
        defaultPriceCents: Math.round(Number(form.defaultPrice || 0) * 100),
        defaultDurationMin: Number(form.defaultDurationMin || 45),
      };
      if (form.studioId) {
        payload.studioId = Number(form.studioId);
      } else if (studios[0]?.id) {
        payload.studioId = studios[0].id;
      }

      await register(payload);
      navigate('/teacher', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const studios = studiosData?.studios || [];

  return (
    <div className="container narrow">
      <h1 className="page-title">Create teacher account</h1>
      <p className="page-sub">Register as an instructor to manage your lesson schedule.</p>

      <form className="card" onSubmit={submit}>
        {studios.length > 0 && (
          <div className="field">
            <label>Studio</label>
            <select
              value={form.studioId || String(studios[0]?.id || '')}
              onChange={update('studioId')}
              required
            >
              {studios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>Full name</label>
          <input value={form.fullName} onChange={update('fullName')} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label>Phone (optional)</label>
          <input value={form.phone} onChange={update('phone')} autoComplete="tel" />
        </div>
        <div className="field">
          <label>Short bio (optional)</label>
          <textarea rows={2} value={form.bio} onChange={update('bio')} />
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

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create teacher account'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        Already have an account? <Link to="/teacher/login">Teacher login</Link>
      </p>
    </div>
  );
}
