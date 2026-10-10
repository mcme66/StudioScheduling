import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { fmtDate, fmtPrice } from '../../lib/format.js';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'ytd', label: 'Year to date' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'lastLesson', label: 'Last lesson' },
  { key: 'lessons', label: 'Lessons', numeric: true },
  { key: 'fees', label: 'Floor fees', numeric: true },
];

function rangeLabel(from, to) {
  if (!from || !to) return '';
  if (from === to) return fmtDate(from, { month: 'short', day: 'numeric', year: 'numeric' });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = fmtDate(
    from,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  const end = fmtDate(to, { month: 'short', day: 'numeric' });
  return `${start} – ${end}`;
}

function compareCoaches(a, b, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'name') return a.fullName.localeCompare(b.fullName) * sign;
  if (key === 'lessons') return (a.lessonCount - b.lessonCount) * sign;
  if (key === 'fees') return (a.floorFeeCents - b.floorFeeCents) * sign;
  const aDate = a.lastLessonDate || '';
  const bDate = b.lastLessonDate || '';
  if (!aDate && !bDate) return a.fullName.localeCompare(b.fullName);
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate.localeCompare(bDate) * sign;
}

export default function CoachesTab() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get('preset');
  const preset = PRESETS.some((p) => p.id === requested) ? requested : 'week';
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });

  const coachesQuery = useQuery({
    queryKey: ['owner-coaches', preset],
    queryFn: () => api(`/owner/coaches?preset=${preset}`),
  });

  const rows = useMemo(() => {
    const list = coachesQuery.data?.coaches || [];
    const filtered = list.filter((c) => {
      if (status === 'active') return c.isActive;
      if (status === 'inactive') return !c.isActive;
      return true;
    });
    return [...filtered].sort((a, b) => compareCoaches(a, b, sort.key, sort.dir));
  }, [coachesQuery.data, status, sort]);

  const setPreset = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'coaches');
    next.set('preset', id);
    setParams(next, { replace: true });
  };

  const toggleSort = (key) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  };

  const data = coachesQuery.data;

  return (
    <div className="card">
      <div className="coach-toolbar">
        <div className="quiet-presets" role="group" aria-label="Time period">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? 'on' : ''}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          {data && <span className="quiet-range">{rangeLabel(data.from, data.to)}</span>}
        </div>
        <div className="quiet-presets" role="group" aria-label="Coach status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={status === f.id ? 'on' : ''}
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {coachesQuery.isLoading && <div className="loading">Loading coaches…</div>}
      {coachesQuery.isError && <p className="error-text">{coachesQuery.error.message}</p>}

      {data && data.coaches.length === 0 && (
        <p className="muted" style={{ fontSize: '14px' }}>
          No coaches are listed at this studio yet.
        </p>
      )}

      {data && data.coaches.length > 0 && rows.length === 0 && (
        <p className="muted" style={{ fontSize: '14px' }}>
          No coaches match this filter.
        </p>
      )}

      {data && rows.length > 0 && (
        <div className="coach-table-wrap">
          <table className="coach-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={col.numeric ? 'num' : undefined} aria-sort={sortAria(sort, col.key)}>
                    <button
                      type="button"
                      className={sort.key === col.key ? 'on' : ''}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {sort.key === col.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((coach) => {
                const href = `/owner/coaches/${coach.id}?preset=${preset}`;
                return (
                  <tr
                    key={coach.id}
                    className="coach-row"
                    tabIndex={0}
                    onClick={() => navigate(href)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(href);
                      }
                    }}
                  >
                    <td>
                      {coach.fullName}
                      {!coach.isActive && <span className="contact"> Inactive</span>}
                    </td>
                    <td>{coach.lastLessonDate ? fmtDate(coach.lastLessonDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="num">{coach.lessonCount}</td>
                    <td className="num">{fmtPrice(coach.floorFeeCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function sortAria(sort, key) {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}
