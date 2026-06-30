import { useState } from 'react';

export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'new-password',
  minLength,
  required = false,
  id,
}) {
  const [visible, setVisible] = useState(false);
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
