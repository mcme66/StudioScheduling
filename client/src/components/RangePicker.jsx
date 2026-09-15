export default function RangePicker({ mode, label, onModeChange, onPrev, onNext, presets }) {
  return (
    <div className="range-picker">
      <div className="range-toggle" role="group" aria-label="Time range">
        <button
          type="button"
          className={mode === 'week' ? 'on' : ''}
          aria-pressed={mode === 'week'}
          onClick={() => onModeChange('week')}
        >
          Week
        </button>
        <button
          type="button"
          className={mode === 'month' ? 'on' : ''}
          aria-pressed={mode === 'month'}
          onClick={() => onModeChange('month')}
        >
          Month
        </button>
      </div>
      {presets?.length > 0 && (
        <div className="range-presets" role="group" aria-label="Quick ranges">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.active ? 'on' : ''}
              aria-pressed={p.active}
              onClick={p.onClick}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="week-nav range-picker-nav">
        <button type="button" className="week-nav-btn" onClick={onPrev} aria-label="Previous">
          ‹
        </button>
        <span className="week-nav-text">
          <strong>{label}</strong>
        </span>
        <button type="button" className="week-nav-btn" onClick={onNext} aria-label="Next">
          ›
        </button>
      </div>
    </div>
  );
}
