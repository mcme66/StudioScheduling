import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';

function roleFromPath(pathname) {
  return pathname.startsWith('/teacher') ? 'teacher' : 'student';
}

export default function ResetPassword() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const role = roleFromPath(pathname);
  const loginPath = role === 'teacher' ? '/teacher/login' : '/student/login';
  const roleLabel = role === 'teacher' ? 'Teacher' : 'Student';
  const btnClass = role === 'teacher' ? 'btn btn-primary btn-block' : 'btn btn-green btn-block';
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is invalid or has expired.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { role, token, password },
      });
      navigate(`${loginPath}?reset=success`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">{roleLabel} password reset</h1>
      <p className="page-sub">Choose a new password for your account.</p>

      <form className="card" onSubmit={submit}>
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label>Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className={btnClass} disabled={busy}>
          {busy ? 'Saving…' : 'Reset password'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        <Link to={loginPath}>Back to login</Link>
      </p>
    </div>
  );
}
