import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { formValues } from '../lib/form.js';

export default function StudentRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const { password, confirmPassword, email, fullName, phone } = formValues(e, [
      'password',
      'confirmPassword',
      'email',
      'fullName',
      'phone',
    ]);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await register({
        role: 'student',
        fullName,
        email,
        password,
        phone: phone || undefined,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="page-title">Create student account</h1>
      <p className="page-sub">Register to book lessons at your favorite studios.</p>

      <form className="card" onSubmit={submit} method="post">
        <div className="field">
          <label htmlFor="student-register-name">Full name</label>
          <input
            id="student-register-name"
            name="fullName"
            autoComplete="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="student-register-email">Email</label>
          <input
            id="student-register-email"
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
          <label htmlFor="student-register-phone">Phone (optional)</label>
          <input id="student-register-phone" name="phone" autoComplete="tel" />
        </div>

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create student account'}
        </button>
      </form>

      <p className="center muted" style={{ marginTop: '1rem', fontSize: '14px' }}>
        Already have an account? <Link to="/student/login">Student login</Link>
      </p>
    </div>
  );
}
