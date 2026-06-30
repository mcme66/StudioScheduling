import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import {
  bookableDates,
  fmtDate,
  fmtPrice,
  fmtTime,
  fmtTimeRange,
} from '../lib/format.js';

const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

export default function StudioDetail() {
  const { slug } = useParams();
  const [searchDate, setSearchDate] = useState('');
  const [searchTime, setSearchTime] = useState('');
  const [submitted, setSubmitted] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio', slug],
    queryFn: () => api(`/studios/${slug}`),
  });

  const availabilityQuery = useQuery({
    queryKey: ['studio-availability', slug, submitted?.date, submitted?.time],
    queryFn: () =>
      api(
        `/studios/${slug}/availability?date=${encodeURIComponent(submitted.date)}&time=${encodeURIComponent(submitted.time)}`,
      ),
    enabled: !!submitted,
  });

  const runSearch = (e) => {
    e.preventDefault();
    if (!searchDate || !searchTime) return;
    setSubmitted({ date: searchDate, time: searchTime });
  };

  const dateOptions = bookableDates();

  return (
    <div className="container">
      {isLoading && <div className="loading">Loading studio…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && (
        <>
          <h1 className="page-title" style={{ marginTop: '0.5rem' }}>
            {data.studio.name}
          </h1>
          {data.studio.description && <p className="page-sub">{data.studio.description}</p>}

          {data.teachers.length > 0 && (
            <details className="card studio-search">
              <summary className="studio-search-summary">Find a lesson by date &amp; time</summary>
              <p className="muted" style={{ fontSize: '14px', marginBottom: '1rem' }}>
                Search across all instructors at this studio for an open time slot.
              </p>
              <form className="studio-search-form" onSubmit={runSearch}>
                <div className="field">
                  <label htmlFor="search-date">Date</label>
                  <select
                    id="search-date"
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                    required
                  >
                    <option value="">Select a date</option>
                    {dateOptions.map((d) => (
                      <option key={d} value={d}>
                        {fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="search-time">Time</label>
                  <select
                    id="search-time"
                    value={searchTime}
                    onChange={(e) => setSearchTime(e.target.value)}
                    required
                  >
                    <option value="">Select a time</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={!searchDate || !searchTime}>
                  Search
                </button>
              </form>

              {submitted && availabilityQuery.isLoading && (
                <div className="loading" style={{ padding: '1.5rem 0' }}>
                  Searching…
                </div>
              )}

              {submitted && availabilityQuery.isError && (
                <p className="error-text">{availabilityQuery.error.message}</p>
              )}

              {submitted && availabilityQuery.data && (
                <div className="studio-search-results">
                  {availabilityQuery.data.results.length === 0 ? (
                    <p className="muted center" style={{ fontSize: '14px', padding: '0.5rem 0' }}>
                      No teachers are available to teach at that time.
                    </p>
                  ) : (
                    <div className="availability-list">
                      {availabilityQuery.data.results.map((r) => (
                        <Link
                          key={r.slotId}
                          to={`/studios/${slug}/book/${r.teacherId}`}
                          className="availability-row slot-card"
                        >
                          <div className="slot-dot" />
                          <div className="slot-info">
                            <div className="slot-time">{r.teacherName}</div>
                            <div className="slot-meta">
                              {fmtDate(r.lessonDate, { weekday: 'long', month: 'short', day: 'numeric' })} ·{' '}
                              {fmtTimeRange(r.startTime, r.durationMin)} · {r.durationMin} min ·{' '}
                              {fmtPrice(r.priceCents)}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </details>
          )}

          {data.teachers.length === 0 && (
            <div className="card center muted">No instructors are available at this studio yet.</div>
          )}

          {data.teachers.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: '0.25rem' }}>
                Instructors
              </h2>
              <div className="instructor-grid">
                {data.teachers.map((t) => (
                  <div className="instructor-card" key={t.id}>
                    <h3>{t.fullName}</h3>
                    {t.bio && <p className="bio">{t.bio}</p>}
                    <div className="row spread">
                      <span className="muted" style={{ fontSize: '13px' }}>
                        {fmtPrice(t.defaultPriceCents)} · {t.defaultDurationMin} min
                      </span>
                      <span className="pill pill-open">
                        {t.activeSlots} time{t.activeSlots === 1 ? '' : 's'}
                      </span>
                    </div>
                    <Link to={`/studios/${slug}/book/${t.id}`} className="btn btn-primary btn-block">
                      View schedule
                    </Link>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
