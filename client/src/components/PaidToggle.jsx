/** Compact paid/unpaid control for lesson rows. */
export default function PaidToggle({ paid, onChange, disabled }) {
  return (
    <button
      type="button"
      className={`paid-toggle${paid ? ' paid' : ''}`}
      onClick={() => onChange(!paid)}
      disabled={disabled}
      aria-pressed={paid}
      title={paid ? 'Mark as unpaid' : 'Mark as paid'}
    >
      {paid ? 'Paid' : 'Mark paid'}
    </button>
  );
}
