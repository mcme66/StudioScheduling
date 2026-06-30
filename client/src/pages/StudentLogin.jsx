import { useState } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function StudentLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resetSuccess = searchParams.get('reset') === 'success';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login({ role: 'student', email, password });
      const dest = location.state?.from?.pathname || '/';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">Student login</h1>
      <p className="page-sub">Sign in to book lessons and manage your schedule.</p>

      <form className="card" onSubmit={submit}>
        {resetSuccess && (
          <p className="muted" style={{ marginBottom: '1rem', fontSize: '14px' }}>
            Your password has been reset. You can log in now.
          </p>
        )}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <p style={{ marginTop: '0.35rem', fontSize: '13px', textAlign: 'right' }}>
            <Link to="/student/forgot-password">Forgot my password?</Link>
          </p>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        New student? <Link to="/student/register">Create a student account</Link>
      </p>
    </div>
  );
}
