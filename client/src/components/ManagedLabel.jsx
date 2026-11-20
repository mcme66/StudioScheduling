const TIP =
  'All payments and lesson times go through the studio, not directly with the coach.';

/** Smaller, fainter “Studio Managed” mark with a hover tip when the studio opts in. */
export default function ManagedLabel({ show = false }) {
  if (!show) return null;
  return (
    <span className="managed-label">
      Studio Managed
      <span
        className="managed-info"
        tabIndex={0}
        aria-label={TIP}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span className="managed-info-mark" aria-hidden="true">
          i
        </span>
        <span className="managed-info-tip" role="tooltip">
          {TIP}
        </span>
      </span>
    </span>
  );
}

export function withManagedSuffix(name, { show = false, managed = false } = {}) {
  if (!show || !managed) return name;
  return `${name} · Studio Managed`;
}
