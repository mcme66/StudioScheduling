import { useEffect, useId, useRef, useState } from 'react';
import {
  DEFAULT_LESSON_COLOR,
  LESSON_COLOR_NAMES,
  LESSON_COLOR_PALETTE,
  isHexColor,
} from '../lib/lessonColors.js';

/** Dropdown of the preset lesson colors, ending with a custom color picker. */
export default function ColorSelect({ value, onChange, label, showLabel = false }) {
  const current = isHexColor(value) ? value.toLowerCase() : DEFAULT_LESSON_COLOR;
  const isPreset = LESSON_COLOR_PALETTE.includes(current);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const customRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (color) => {
    onChange(color);
    setOpen(false);
  };

  return (
    <div className="color-select" ref={rootRef}>
      {showLabel && label && <span className="color-select-label">{label}</span>}
      <button
        type="button"
        className={`color-select-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label ? `${label}: ${isPreset ? LESSON_COLOR_NAMES[current] : current}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <i className="color-select-dot" style={{ background: current }} aria-hidden="true" />
        <span className="color-select-name">
          {isPreset ? LESSON_COLOR_NAMES[current] : 'Custom'}
        </span>
        <span className="color-select-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul className="color-select-menu" role="listbox" id={menuId} aria-label={label}>
          {LESSON_COLOR_PALETTE.map((color) => (
            <li key={color} role="option" aria-selected={current === color}>
              <button
                type="button"
                className={`color-select-option${current === color ? ' on' : ''}`}
                onClick={() => pick(color)}
              >
                <i className="color-select-dot" style={{ background: color }} aria-hidden="true" />
                <span className="color-select-name">{LESSON_COLOR_NAMES[color]}</span>
                {current === color && <span className="color-select-check" aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
          <li role="option" aria-selected={!isPreset} className="color-select-custom-row">
            <button
              type="button"
              className={`color-select-option${!isPreset ? ' on' : ''}`}
              onClick={() => customRef.current?.click()}
            >
              <i className="color-select-dot color-select-dropper" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m2 22 1-1h3l9-9" />
                  <path d="M3 21v-3l9-9" />
                  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
                </svg>
              </i>
              <span className="color-select-name">
                Custom color…
              </span>
              {!isPreset && <span className="color-select-check" aria-hidden="true">✓</span>}
            </button>
          </li>
        </ul>
      )}

      <input
        ref={customRef}
        type="color"
        className="color-select-native"
        value={current}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
