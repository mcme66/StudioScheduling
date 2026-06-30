import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';

function roleFromPath(pathname) {
  return pathname.startsWith('/teacher') ? 'teacher' : 'student';
}

export default function ForgotPassword() {
  const { pathname } = useLocation();
  const role = roleFromPath(pathname);
  const loginPath = role === 'teacher' ? '/teacher/login' : '/student/login';
  const roleLabel = role === 'teacher' ? 'Teacher' : 'Student';
  const btnClass = role === 'teacher' ? 'btn btn-primary btn-block' : 'btn btn-green btn-block';

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const data = await api('/auth/forgot-password', {
        method: 'POST',
        body: { role, email },
      });
      setSuccess(data.message);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">{roleLabel} password reset</h1>
      <p className="page-sub">Enter your email and we will send you a link to reset your password.</p>

      {success ? (
        <div className="card">
          <p>{success}</p>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
            <Link to={loginPath}>Back to login</Link>
          </p>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
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
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className={btnClass} disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      {!success && (
        <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
          <Link to={loginPath}>Back to login</Link>
        </p>
      )}
    </div>
  );
}
