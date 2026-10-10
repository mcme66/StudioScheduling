import { useState } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { formValues } from '../lib/form.js';

const REGISTRATIONS = [
  {
    title: 'Student',
    text: 'Book lessons, manage your schedule, and share lessons with a partner.',
    to: '/student/register',
    label: 'Create a student account',
  },
  {
    title: 'Teacher',
    text: 'Join a studio and manage the lessons you teach.',
    to: '/teacher/register',
    label: 'Create a teacher account',
  },
  {
    title: 'Studio owner',
    text: 'Run a studio, its coaches, rooms, and floor fees. This asks for an add code.',
    to: '/teacher/owner-register',
    label: 'Create an owner account',
  },
];

function homeFor(user) {
  if (user.role === 'studio_owner') return '/owner';
  if (user.role === 'teacher') return '/teacher';
  return '/';
}

export default function Login() {
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
      const signedIn = await login({ email, password });
      const from = location.state?.from?.pathname;
      const dest = from && !from.endsWith('/login') ? from : homeFor(signedIn);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">Log in</h1>
      <p className="page-sub">Students, teachers, and studio owners all sign in here.</p>

      <form className="card" onSubmit={submit} method="post">
        {resetSuccess && (
          <p className="muted" style={{ marginBottom: '1rem', fontSize: '14px' }}>
            Your password has been reset. You can log in now.
          </p>
        )}
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <p style={{ marginTop: '0.35rem', fontSize: '13px', textAlign: 'right' }}>
            <Link to="/forgot-password">Forgot my password?</Link>
          </p>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-title">Create an account</div>
        {REGISTRATIONS.map((item) => (
          <div className="register-choice" key={item.to}>
            <strong>{item.title}</strong>
            <p className="contact">{item.text}</p>
            <Link to={item.to} className="btn btn-ghost btn-sm">
              {item.label}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
