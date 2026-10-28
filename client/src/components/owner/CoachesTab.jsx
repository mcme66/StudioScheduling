import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
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

function TiersEditor() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });
  const [form, setForm] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState(null);
  const tiers = studioQuery.data?.tiers || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    queryClient.invalidateQueries({ queryKey: ['owner-coaches'] });
  };

  const saveTier = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), description: form.description.trim() };
      if (editingId) return api(`/owner/tiers/${editingId}`, { method: 'PATCH', body });
      return api('/owner/tiers', { method: 'POST', body });
    },
    onSuccess: () => {
      setForm({ name: '', description: '' });
      setEditingId(null);
      refresh();
    },
    onError: (err) => toast(err.message),
  });

  const removeTier = useMutation({
    mutationFn: (id) => api(`/owner/tiers/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => toast(err.message),
  });

  const moveTier = useMutation({
    mutationFn: ({ id, direction }) =>
      api(`/owner/tiers/${id}/move`, { method: 'POST', body: { direction } }),
    onSuccess: refresh,
    onError: (err) => toast(err.message),
  });

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="section-title">Coach tiers</div>
      <p className="muted" style={{ fontSize: '14px' }}>
        Up to 5 tiers. The public studio page groups coaches under these names.
      </p>
      {tiers.map((tier, index) => (
        <div className="list-row" key={tier.id}>
          <div className="grow">
            <strong>{tier.name}</strong>
            {tier.description && <div className="contact">{tier.description}</div>}
          </div>
          <div className="row" style={{ gap: '0.35rem' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={index === 0 || moveTier.isPending}
              onClick={() => moveTier.mutate({ id: tier.id, direction: 'up' })}
            >
              Up
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={index === tiers.length - 1 || moveTier.isPending}
              onClick={() => moveTier.mutate({ id: tier.id, direction: 'down' })}
            >
              Down
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditingId(tier.id);
                setForm({ name: tier.name, description: tier.description || '' });
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={removeTier.isPending}
              onClick={() => removeTier.mutate(tier.id)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      {tiers.length < 5 && (
        <form
          className="stack"
          style={{ marginTop: '0.75rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            saveTier.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="tier-name">{editingId ? 'Tier name' : 'New tier'}</label>
            <input
              id="tier-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={80}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="tier-description">Description</label>
            <input
              id="tier-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={240}
            />
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saveTier.isPending}>
              {editingId ? 'Save tier' : 'Add tier'}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditingId(null);
                  setForm({ name: '', description: '' });
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export default function CoachesTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
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
  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });
  const tiers = studioQuery.data?.tiers || [];

  const setManaged = useMutation({
    mutationFn: ({ id, managed }) =>
      api(`/owner/teachers/${id}/managed`, { method: 'PATCH', body: { managed } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-coaches'] });
      queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    },
    onError: (err) => toast(err.message),
  });

  const setTier = useMutation({
    mutationFn: ({ id, tierId }) =>
      api(`/owner/teachers/${id}/tier`, { method: 'PATCH', body: { tierId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-coaches'] });
      queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
    },
    onError: (err) => toast(err.message),
  });

  return (
    <>
    <TiersEditor />
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
                      <div>{coach.fullName}</div>
                      {!coach.isActive && <div className="contact">Inactive</div>}
                      {coach.tierName && <div className="contact">{coach.tierName}</div>}
                      <div
                        className="row"
                        style={{ gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`manage-toggle${coach.ownerManaged ? ' on' : ''}`}
                          aria-pressed={coach.ownerManaged}
                          disabled={setManaged.isPending}
                          onClick={() => setManaged.mutate({ id: coach.id, managed: !coach.ownerManaged })}
                        >
                          <span className={`switch${coach.ownerManaged ? ' on' : ''}`} />
                          Manage
                        </button>
                        {coach.ownerManaged && (
                          <Link className="btn btn-ghost btn-sm" to={`/owner/coaches/${coach.id}/schedule`}>
                            Schedule
                          </Link>
                        )}
                        {tiers.length > 0 && (
                          <select
                            className="tier-assign"
                            aria-label={`Tier for ${coach.fullName}`}
                            value={coach.tierId || ''}
                            disabled={setTier.isPending}
                            onChange={(e) =>
                              setTier.mutate({
                                id: coach.id,
                                tierId: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          >
                            <option value="">No tier</option>
                            {tiers.map((tier) => (
                              <option key={tier.id} value={tier.id}>
                                {tier.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
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
    </>
  );
}

function sortAria(sort, key) {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}
