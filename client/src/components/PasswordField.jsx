import { useState } from 'react';

/**
 * Uncontrolled password input so browser / Google Password Manager autofill
 * and generated passwords are preserved in the DOM (React controlled value=
 * often stays empty when autofill skips onChange).
 */
export default function PasswordField({
  label,
  name,
  autoComplete = 'new-password',
  minLength,
  required = false,
  id,
  defaultValue = '',
}) {
  const [visible, setVisible] = useState(false);
  const inputId = id || name || label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={inputId}
          name={name}
          type={visible ? 'text' : 'password'}
          defaultValue={defaultValue}
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
          tabIndex={-1}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
