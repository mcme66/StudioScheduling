import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function StudentRegister() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await register({
        role: 'student',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
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

      <form className="card" onSubmit={submit}>
        <div className="field">
          <label>Full name</label>
          <input value={form.fullName} onChange={update('fullName')} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </div>
        <PasswordField
          label="Password"
          value={form.password}
          onChange={update('password')}
          minLength={8}
          required
        />
        <PasswordField
          label="Confirm password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          minLength={8}
          required
        />
        <div className="field">
          <label>Phone (optional)</label>
          <input value={form.phone} onChange={update('phone')} autoComplete="tel" />
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
