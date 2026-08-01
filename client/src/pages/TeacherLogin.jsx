import { useState } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { formValues } from '../lib/form.js';

export default function TeacherLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resetSuccess = searchParams.get('reset') === 'success';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const { email, password } = formValues(e, ['email', 'password']);
    setBusy(true);
    try {
      await login({ role: 'teacher', email, password });
      const dest = location.state?.from?.pathname || '/teacher';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">Teacher login</h1>
      <p className="page-sub">Sign in to manage your schedule and bookings.</p>

      <form className="card" onSubmit={submit} method="post">
        {resetSuccess && (
          <p className="muted" style={{ marginBottom: '1rem', fontSize: '14px' }}>
            Your password has been reset. You can log in now.
          </p>
        )}
        <div className="field">
          <label htmlFor="teacher-login-email">Email</label>
          <input
            id="teacher-login-email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="teacher-login-password">Password</label>
          <input
            id="teacher-login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <p style={{ marginTop: '0.35rem', fontSize: '13px', textAlign: 'right' }}>
            <Link to="/teacher/forgot-password">Forgot my password?</Link>
          </p>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        New instructor? <Link to="/teacher/register">Create a teacher account</Link>
      </p>
    </div>
  );
}
