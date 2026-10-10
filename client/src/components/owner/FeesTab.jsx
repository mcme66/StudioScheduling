import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useToast } from '../Toast.jsx';
import RangePicker from '../RangePicker.jsx';
import { fmtDate, fmtPrice } from '../../lib/format.js';
import {
  initialAnchor,
  lastMonthAnchor,
  rangeBounds,
  shiftAnchor,
  thisMonthAnchor,
} from '../../lib/lessonRange.js';

function dollars(cents) {
  return String(((cents ?? 0) / 100).toFixed(2)).replace(/\.00$/, '');
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
  const thisMonth = thisMonthAnchor();
  const lastMonth = lastMonthAnchor();

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
      id: 'this-month',
      label: 'This month',
      active: rangeMode === 'month' && rangeAnchor === thisMonth,
      onClick: () => {
        setRangeMode('month');
        setRangeAnchor(thisMonth);
      },
    },
    {
      id: 'last-month',
      label: 'Last month',
      active: rangeMode === 'month' && rangeAnchor === lastMonth,
      onClick: () => {
        setRangeMode('month');
        setRangeAnchor(lastMonth);
      },
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
        <div className="section-title">Expected floor fees</div>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '0.9rem' }}>
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
                  <th className="num">Expected fee</th>
                </tr>
              </thead>
              <tbody>
                {floorFeesQuery.data.coaches.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.fullName}
                      {!c.isActive && <span className="contact"> Inactive</span>}
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
                      week.coaches.map((c) => (
                        <div className="list-row" key={c.id}>
                          <div className="grow">{teachers.find((t) => t.id === c.id)?.fullName || 'Coach'}</div>
                          <span className="muted" style={{ fontSize: '13px' }}>
                            {c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}
                          </span>
                          <strong>{fmtPrice(c.floorFeeCents)}</strong>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
