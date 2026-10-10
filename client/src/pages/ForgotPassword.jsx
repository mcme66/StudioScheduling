import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { formValues } from '../lib/form.js';

function roleFromPath(pathname) {
  if (pathname.startsWith('/teacher')) return 'teacher';
  if (pathname.startsWith('/student')) return 'student';
  return null;
}

export default function ForgotPassword() {
  const { pathname } = useLocation();
  const role = roleFromPath(pathname);
  const loginPath = '/login';
  const roleLabel = role === 'teacher' ? 'Teacher or studio owner' : role === 'student' ? 'Student' : '';
  const btnClass = 'btn btn-primary btn-block';

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const { email } = formValues(e, ['email']);
    setBusy(true);
    try {
      const data = await api('/auth/forgot-password', {
        method: 'POST',
        body: role ? { role, email } : { email },
      });
      setSuccess(data.message);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">{roleLabel ? `${roleLabel} password reset` : 'Reset your password'}</h1>
      <p className="page-sub">Enter your email and we will send you a link to reset your password.</p>

      {success ? (
        <div className="card">
          <p>{success}</p>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
            <Link to={loginPath}>Back to login</Link>
          </p>
        </div>
      ) : (
        <form className="card" onSubmit={submit} method="post">
          <div className="field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="username"
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
