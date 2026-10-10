import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { fmtPrice } from '../../lib/format.js';
import BarChart from './BarChart.jsx';

const PRESETS = [
  { id: '7d', label: 'Last 7 days' },
  { id: '7w', label: 'Last 7 weeks' },
  { id: '7m', label: 'Last 7 months' },
  { id: 'ytd', label: 'Year to date' },
];

export default function DashboardTab() {
  const [preset, setPreset] = useState('7d');
  const statsQuery = useQuery({
    queryKey: ['owner-dashboard', preset],
    queryFn: () => api(`/owner/dashboard?preset=${preset}`),
  });
  const stats = statsQuery.data;

  return (
    <>
      <div className="range-presets" style={{ justifyContent: 'flex-start', marginBottom: '1rem' }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'on' : ''}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {statsQuery.isLoading && <div className="loading">Loading dashboard…</div>}
      {statsQuery.isError && <p className="error-text">{statsQuery.error.message}</p>}

      {stats && (
        <>
          <div className="owner-grid cols-3">
            <Kpi label="Lessons" value={String(stats.lessons)} />
            <Kpi label="Expected floor fees" value={fmtPrice(stats.floorFeeCents)} />
            <Kpi label="Lesson revenue" value={fmtPrice(stats.revenueCents)} />
            <Kpi label="Students" value={String(stats.uniqueStudents)} hint="Unique people in lessons" />
            <Kpi
              label="Studio-student lessons"
              value={String(stats.studioStudentLessons)}
              hint={`${stats.guestLessons} guest lesson${stats.guestLessons === 1 ? '' : 's'}`}
            />
            <Kpi label="Coaches teaching" value={String(stats.coachesTeaching)} />
          </div>

          <div className="owner-grid cols-2" style={{ marginTop: '1rem' }}>
            <div className="card">
              <div className="section-title">Lessons</div>
              <p className="muted" style={{ fontSize: '13px', marginBottom: '0.85rem' }}>
                Lessons taught in this period.
              </p>
              <BarChart points={stats.series} valueKey="lessons" formatValue={(n) => String(n)} />
            </div>
            <div className="card">
              <div className="section-title">Expected floor fees</div>
              <p className="muted" style={{ fontSize: '13px', marginBottom: '0.85rem' }}>
                Studio-student lessons use that rate. Everyone else uses the guest rate.
              </p>
              <BarChart points={stats.series} valueKey="floorFeeCents" formatValue={fmtPrice} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
