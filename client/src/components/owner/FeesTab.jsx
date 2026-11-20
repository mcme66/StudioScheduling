import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import RangePicker from '../RangePicker.jsx';
import { fmtDate, fmtPrice } from '../../lib/format.js';
import {
  initialAnchor,
  lastMonthAnchor,
  lastWeekAnchor,
  rangeBounds,
  shiftAnchor,
  thisMonthAnchor,
  thisWeekAnchor,
} from '../../lib/lessonRange.js';
import ManagedLabel from '../ManagedLabel.jsx';

function dollars(cents) {
  return String(((cents ?? 0) / 100).toFixed(2)).replace(/\.00$/, '');
}

function BalancesCard({ showManagedLabel }) {
  const balancesQuery = useQuery({
    queryKey: ['owner-balances'],
    queryFn: () => api('/owner/balances'),
  });

  const data = balancesQuery.data;
  return (
    <div className="card">
      <div className="section-title">Balances</div>
      <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
        Floor fees from lessons coaches have been paid for, and payouts owed for lessons the studio
        collected. Settle each lesson on the <Link to="/owner/requests">Requests</Link> page.
      </p>
      {balancesQuery.isLoading && <div className="loading">Loading…</div>}
      {balancesQuery.isError && <p className="error-text">{balancesQuery.error.message}</p>}
      {data && data.coaches.length === 0 && (
        <p className="muted" style={{ fontSize: '14px' }}>All settled up.</p>
      )}
      {data && data.coaches.length > 0 && (
        <table className="fee-table">
          <thead>
            <tr>
              <th>Coach</th>
              <th className="num">Floor fees owed</th>
              <th className="num">Payout owed</th>
            </tr>
          </thead>
          <tbody>
            {data.coaches.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.fullName}
                  <ManagedLabel show={showManagedLabel && c.ownerManaged} />
                </td>
                <td className="num">{c.floorFeesOwedCents > 0 ? fmtPrice(c.floorFeesOwedCents) : '—'}</td>
                <td className="num">{c.payoutOwedCents > 0 ? fmtPrice(c.payoutOwedCents) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Studio total</td>
              <td className="num">{fmtPrice(data.floorFeesOwedCents)}</td>
              <td className="num">{fmtPrice(data.payoutOwedCents)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

export default function FeesTab({ studio, teachers }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    floorFeePercent: '0',
    floorFeeFlat: '0',
    floorFeeStudioStudentPercent: '0',
    floorFeeStudioStudent: '0',
  });
  const [error, setError] = useState('');
  const [rangeMode, setRangeMode] = useState('month');
  const [rangeAnchor, setRangeAnchor] = useState(() => initialAnchor('month'));
  const coachRange = useMemo(() => rangeBounds(rangeMode, rangeAnchor), [rangeMode, rangeAnchor]);
  const isWeek = rangeMode === 'week';
  const currentAnchor = isWeek ? thisWeekAnchor() : thisMonthAnchor();
  const previousAnchor = isWeek ? lastWeekAnchor() : lastMonthAnchor();

  useEffect(() => {
    setForm({
      floorFeePercent: String(studio.floorFeePercent ?? 0),
      floorFeeFlat: dollars(studio.floorFeeFlatCents),
      floorFeeStudioStudentPercent: String(studio.studioStudentFloorFeePercent ?? 0),
      floorFeeStudioStudent: dollars(studio.studioStudentFloorFeeCents),
    });
  }, [studio]);

  const floorFeesQuery = useQuery({
    queryKey: ['owner-floor-fees', coachRange.from, coachRange.to],
    queryFn: () =>
      api(
        `/owner/floor-fees?from=${encodeURIComponent(coachRange.from)}&to=${encodeURIComponent(coachRange.to)}`,
      ),
  });

  const save = useMutation({
    mutationFn: () =>
      api('/owner/studio', {
        method: 'PATCH',
        body: {
          floorFeePercent: Number(form.floorFeePercent || 0),
          floorFeeFlatCents: Math.round(Number(form.floorFeeFlat || 0) * 100),
          studioStudentFloorFeePercent: Number(form.floorFeeStudioStudentPercent || 0),
          studioStudentFloorFeeCents: Math.round(Number(form.floorFeeStudioStudent || 0) * 100),
        },
      }),
    onSuccess: () => {
      toast('Floor fees saved.');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['owner-studio'] });
      queryClient.invalidateQueries({ queryKey: ['owner-floor-fees'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
    },
    onError: (err) => setError(err.message),
  });

  const rangePresets = [
    {
      id: 'current',
      label: isWeek ? 'This week' : 'This month',
      active: rangeAnchor === currentAnchor,
      onClick: () => setRangeAnchor(currentAnchor),
    },
    {
      id: 'previous',
      label: isWeek ? 'Last week' : 'Last month',
      active: rangeAnchor === previousAnchor,
      onClick: () => setRangeAnchor(previousAnchor),
    },
  ];

  return (
    <div className="owner-grid cols-2">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="section-title">Rates</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.85rem' }}>
          Each lesson is charged the higher of a percent of the coach&apos;s price and a flat fee.
          Guest lessons and studio students each have their own pair.
        </p>
        <div className="section-title" style={{ fontSize: '13px' }}>Guest lessons</div>
        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="owner-floor-percent">Percent of lesson (%)</label>
            <input
              id="owner-floor-percent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.floorFeePercent}
              onChange={(e) => setForm((f) => ({ ...f, floorFeePercent: e.target.value }))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="owner-floor-flat">Flat fee ($)</label>
            <input
              id="owner-floor-flat"
              type="number"
              min="0"
              step="0.01"
              value={form.floorFeeFlat}
              onChange={(e) => setForm((f) => ({ ...f, floorFeeFlat: e.target.value }))}
            />
          </div>
        </div>
        <div className="section-title" style={{ fontSize: '13px' }}>Studio students</div>
        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="owner-floor-studio-student-percent">Percent of lesson (%)</label>
            <input
              id="owner-floor-studio-student-percent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.floorFeeStudioStudentPercent}
              onChange={(e) => setForm((f) => ({ ...f, floorFeeStudioStudentPercent: e.target.value }))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="owner-floor-studio-student">Flat fee ($)</label>
            <input
              id="owner-floor-studio-student"
              type="number"
              min="0"
              step="0.01"
              value={form.floorFeeStudioStudent}
              onChange={(e) => setForm((f) => ({ ...f, floorFeeStudioStudent: e.target.value }))}
            />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save rates'}
        </button>
      </form>

      <div className="card">
        <div className="section-title">Floor fees</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
          Lessons coaches marked complete, using the fee from when they were marked, plus past
          lessons for coaches who don&apos;t track payments. No-charge lessons aren&apos;t counted.
          Guest lessons use the higher of {Number(studio.floorFeePercent)}% or {fmtPrice(studio.floorFeeFlatCents)}.
          Studio students use the higher of {Number(studio.studioStudentFloorFeePercent ?? 0)}% or{' '}
          {fmtPrice(studio.studioStudentFloorFeeCents ?? 0)}.
        </p>
        <RangePicker
          mode={rangeMode}
          label={coachRange.label}
          presets={rangePresets}
          onModeChange={(next) => {
            setRangeMode(next);
            setRangeAnchor(initialAnchor(next));
          }}
          onPrev={() => setRangeAnchor((a) => shiftAnchor(rangeMode, a, -1))}
          onNext={() => setRangeAnchor((a) => shiftAnchor(rangeMode, a, 1))}
        />
        {floorFeesQuery.isLoading && <div className="loading">Calculating…</div>}
        {floorFeesQuery.isError && <p className="error-text">{floorFeesQuery.error.message}</p>}
        {floorFeesQuery.data && (
          <>
            <table className="fee-table">
              <thead>
                <tr>
                  <th>Coach</th>
                  <th className="num">Lessons</th>
                  <th className="num">Floor fee</th>
                </tr>
              </thead>
              <tbody>
                {floorFeesQuery.data.coaches.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.fullName}
                      <ManagedLabel
                        show={
                          studio.showManagedLabel &&
                          teachers.find((t) => t.id === c.id)?.ownerManaged
                        }
                      />
                      {!c.isActive && <span className="contact"> Inactive</span>}
                      {c.floorFeeExempt && <span className="contact"> Exempt</span>}
                    </td>
                    <td className="num">{c.lessonCount}</td>
                    <td className="num">{fmtPrice(c.floorFeeCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Studio total</td>
                  <td className="num">
                    {floorFeesQuery.data.coaches.reduce((n, c) => n + c.lessonCount, 0)}
                  </td>
                  <td className="num">{fmtPrice(floorFeesQuery.data.studioTotalCents)}</td>
                </tr>
              </tfoot>
            </table>
            {floorFeesQuery.data.awaitingCount > 0 && (
              <p className="muted" style={{ fontSize: '13px', marginTop: '0.6rem' }}>
                {floorFeesQuery.data.awaitingCount} more lesson
                {floorFeesQuery.data.awaitingCount === 1 ? '' : 's'} awaiting completion by the coach.
              </p>
            )}
            {floorFeesQuery.data.weeks.length > 1 && (
              <div className="fee-weeks">
                <div className="section-title" style={{ marginTop: '1.1rem' }}>Weeks in this range</div>
                {floorFeesQuery.data.weeks.map((week) => (
                  <div className="fee-week" key={`${week.from}-${week.to}`}>
                    <div className="fee-week-label">
                      {fmtDate(week.from, { month: 'short', day: 'numeric' })} –{' '}
                      {fmtDate(week.to, { month: 'short', day: 'numeric' })}
                      <span className="muted" style={{ marginLeft: '0.5rem' }}>
                        {fmtPrice(week.totalCents)}
                      </span>
                    </div>
                    {week.coaches.length === 0 ? (
                      <p className="muted" style={{ fontSize: '13px' }}>No lessons this week.</p>
                    ) : (
                      week.coaches.map((c) => {
                        const coach = teachers.find((t) => t.id === c.id);
                        return (
                          <div className="list-row" key={c.id}>
                            <div className="grow">
                              {coach?.fullName || 'Coach'}
                              <ManagedLabel
                                show={studio.showManagedLabel && coach?.ownerManaged}
                              />
                            </div>
                            <span className="muted" style={{ fontSize: '13px' }}>
                              {c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}
                            </span>
                            <strong>{fmtPrice(c.floorFeeCents)}</strong>
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BalancesCard showManagedLabel={studio.showManagedLabel === true} />
    </div>
  );
}
