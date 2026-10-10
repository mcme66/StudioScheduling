export default function BarChart({ points, valueKey, formatValue }) {
  const max = Math.max(1, ...points.map((p) => Number(p[valueKey]) || 0));
  return (
    <div className="bar-chart" role="img" aria-label="Chart">
      {points.map((p) => {
        const value = Number(p[valueKey]) || 0;
        const height = value === 0 ? 0 : Math.max(4, Math.round((value / max) * 100));
        return (
          <div className="bar-col" key={p.key}>
            <div className="bar-value">{value ? formatValue(value) : ''}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ height: `${height}%` }} />
            </div>
            <div className="bar-label">{p.label}</div>
          </div>
        );
      })}
    </div>
  );
}
