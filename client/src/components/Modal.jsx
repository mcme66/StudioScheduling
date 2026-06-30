import { useEffect } from 'react';

/**
 * Minimal modal overlay. Renders a centered card with an optional title and
 * subtitle. `onClose` fires on backdrop click or Escape.
 */
export default function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="modal-title">{title}</div>}
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * A single full-width option button used inside a Modal: a bold label with a
 * one-line description underneath.
 */
export function ModalOption({ label, description, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      className={`modal-option${danger ? ' danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="modal-option-label">{label}</span>
      {description && <span className="modal-option-desc">{description}</span>}
    </button>
  );
}
