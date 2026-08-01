import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import PasswordField from '../components/PasswordField.jsx';
import { formValues } from '../lib/form.js';

export default function TeacherRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: studiosData } = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
  });

  const [studioId, setStudioId] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('74');
  const [defaultDurationMin, setDefaultDurationMin] = useState('45');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const studios = studiosData?.studios || [];

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const values = formValues(e, [
      'password',
      'confirmPassword',
      'email',
      'fullName',
      'phone',
      'bio',
      'defaultPrice',
      'defaultDurationMin',
      'studioId',
    ]);
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        role: 'teacher',
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        phone: values.phone || undefined,
        bio: values.bio || undefined,
        defaultPriceCents: Math.round(Number(values.defaultPrice || defaultPrice || 0) * 100),
        defaultDurationMin: Number(values.defaultDurationMin || defaultDurationMin || 45),
      };
      const chosenStudio = values.studioId || studioId;
      if (chosenStudio) {
        payload.studioId = Number(chosenStudio);
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

  return (
    <div className="container narrow">
      <h1 className="page-title">Create teacher account</h1>
      <p className="page-sub">Register as an instructor to manage your lesson schedule.</p>

      <form className="card" onSubmit={submit} method="post">
        {studios.length > 0 && (
          <div className="field">
            <label htmlFor="teacher-register-studio">Studio</label>
            <select
              id="teacher-register-studio"
              name="studioId"
              value={studioId || String(studios[0]?.id || '')}
              onChange={(e) => setStudioId(e.target.value)}
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
          <label htmlFor="teacher-register-name">Full name</label>
          <input
            id="teacher-register-name"
            name="fullName"
            autoComplete="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="teacher-register-email">Email</label>
          <input
            id="teacher-register-email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </div>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <div className="field">
          <label htmlFor="teacher-register-phone">Phone (optional)</label>
          <input id="teacher-register-phone" name="phone" autoComplete="tel" />
        </div>
        <div className="field">
          <label htmlFor="teacher-register-bio">Short bio (optional)</label>
          <textarea id="teacher-register-bio" name="bio" rows={2} />
        </div>
        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="teacher-register-price">Default price ($)</label>
            <input
              id="teacher-register-price"
              name="defaultPrice"
              type="number"
              min="0"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="teacher-register-duration">Lesson length (min)</label>
            <input
              id="teacher-register-duration"
              name="defaultDurationMin"
              type="number"
              min="5"
              value={defaultDurationMin}
              onChange={(e) => setDefaultDurationMin(e.target.value)}
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
