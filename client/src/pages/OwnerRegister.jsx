import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import PasswordField from '../components/PasswordField.jsx';
import { formValues } from '../lib/form.js';

export default function OwnerRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: studiosData } = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
  });

  const available = (studiosData?.studios || []).filter((s) => !s.hasOwner);
  const [studioMode, setStudioMode] = useState('existing');
  const [studioId, setStudioId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const linking = studioMode === 'existing';

  useEffect(() => {
    if (!studiosData) return;
    if (!available.length) setStudioMode('new');
  }, [studiosData, available.length]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const values = formValues(e, [
      'addCode',
      'password',
      'confirmPassword',
      'email',
      'fullName',
      'phone',
      'studioId',
      'studioName',
      'studioDescription',
    ]);
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (linking) {
      if (!available.length) {
        setError('Every listed studio already has an owner. Create a new studio instead.');
        return;
      }
      if (!(values.studioId || studioId)) {
        setError('Choose a studio to link.');
        return;
      }
    } else if (!values.studioName.trim()) {
      setError('Enter a studio name.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        addCode: values.addCode,
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        phone: values.phone || undefined,
      };
      if (linking) {
        payload.studioId = Number(values.studioId || studioId);
      } else {
        payload.studioName = values.studioName.trim();
        payload.studioDescription = values.studioDescription.trim() || undefined;
      }
      await register(payload, '/auth/register-owner');
      navigate('/owner', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const chosenStudioId = studioId || String(available[0]?.id || '');

  return (
    <div className="container narrow">
      <h1 className="page-title">Owner account creation</h1>
      <p className="page-sub">
        Create a studio owner account with an add code. Link a studio that does not have an owner
        yet, or start a new one.
      </p>

      <form className="card" onSubmit={submit} method="post">
        <div className="field">
          <label htmlFor="owner-register-code">Add code</label>
          <input
            id="owner-register-code"
            name="addCode"
            autoComplete="off"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="owner-register-name">Full name</label>
          <input
            id="owner-register-name"
            name="fullName"
            autoComplete="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="owner-register-email">Email</label>
          <input
            id="owner-register-email"
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
          <label htmlFor="owner-register-phone">Phone (optional)</label>
          <input id="owner-register-phone" name="phone" autoComplete="tel" />
        </div>

        <div className="field">
          <span className="field-label">Studio</span>
          <label className="choice-row">
            <input
              type="radio"
              name="studioMode"
              value="existing"
              checked={linking}
              disabled={Boolean(studiosData) && !available.length}
              onChange={() => setStudioMode('existing')}
            />
            Link to an existing studio
          </label>
          <label className="choice-row">
            <input
              type="radio"
              name="studioMode"
              value="new"
              checked={!linking}
              onChange={() => setStudioMode('new')}
            />
            Create a new studio
          </label>
        </div>

        {linking ? (
          !studiosData ? (
            <p className="muted" style={{ fontSize: '14px', marginBottom: '0.9rem' }}>
              Loading studios…
            </p>
          ) : available.length > 0 ? (
            <div className="field">
              <label htmlFor="owner-register-studio">Studio</label>
              <select
                id="owner-register-studio"
                name="studioId"
                value={chosenStudioId}
                onChange={(e) => setStudioId(e.target.value)}
                required
              >
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '14px', marginBottom: '0.9rem' }}>
              Every listed studio already has an owner. Create a new studio instead.
            </p>
          )
        ) : (
          <>
            <div className="field">
              <label htmlFor="owner-register-studio-name">Studio name</label>
              <input id="owner-register-studio-name" name="studioName" required={!linking} />
            </div>
            <div className="field">
              <label htmlFor="owner-register-studio-desc">Description (optional)</label>
              <textarea id="owner-register-studio-desc" name="studioDescription" rows={3} />
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create owner account'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        Already have an account? <Link to="/teacher/login">Teacher login</Link>
      </p>
    </div>
  );
}
