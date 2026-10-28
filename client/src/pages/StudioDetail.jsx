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
import StudioRoomsSchedule from '../components/StudioRoomsSchedule.jsx';

function instructorSections(teachers, tiers) {
  const tierById = new Map((tiers || []).map((tier) => [tier.id, tier]));
  const assigned = (tiers || [])
    .map((tier) => ({
      key: tier.id,
      tier,
      teachers: teachers.filter((teacher) => teacher.tierId === tier.id),
    }))
    .filter((section) => section.teachers.length > 0);
  const loose = teachers.filter((teacher) => !tierById.has(teacher.tierId));
  if (assigned.length === 0) {
    return [{ key: 'all', tier: null, title: 'Instructors', teachers }];
  }
  const sections = assigned.map((section) => ({
    key: section.key,
    tier: section.tier,
    title: section.tier.name,
    teachers: section.teachers,
  }));
  if (loose.length) {
    sections.push({ key: 'other', tier: null, title: 'Instructors', teachers: loose });
  }
  return sections;
}

function InstructorCard({ teacher, slug }) {
  return (
    <div className="instructor-card">
      <div className="instructor-heading">
        <h3>{teacher.fullName}</h3>
        {teacher.tierName && <div className="contact">{teacher.tierName}</div>}
      </div>
      {teacher.bio && <p className="bio">{teacher.bio}</p>}
      <div className="row spread">
        <span className="muted" style={{ fontSize: '13px' }}>
          {fmtPrice(teacher.defaultPriceCents)} · {teacher.defaultDurationMin} min
        </span>
        <span className="pill pill-open">
          {teacher.activeSlots} time{teacher.activeSlots === 1 ? '' : 's'}
        </span>
      </div>
      <Link to={`/studios/${slug}/book/${teacher.id}`} className="btn btn-primary btn-block">
        View schedule
      </Link>
    </div>
  );
}

function quarterHours(startMin, endMin) {
  const out = [];
  for (let mins = startMin; mins <= endMin; mins += 15) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return out;
}

const FROM_OPTIONS = quarterHours(7 * 60, 23 * 60 + 30);
const TO_OPTIONS = quarterHours(7 * 60 + 15, 23 * 60 + 45);

export default function StudioDetail() {
  const { slug } = useParams();
  const [searchDate, setSearchDate] = useState('');
  const [searchFrom, setSearchFrom] = useState('');
  const [searchTo, setSearchTo] = useState('');
  const [submitted, setSubmitted] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio', slug],
    queryFn: () => api(`/studios/${slug}`),
  });

  const availabilityQuery = useQuery({
    queryKey: ['studio-availability', slug, submitted?.date, submitted?.from, submitted?.to],
    queryFn: () =>
      api(
        `/studios/${slug}/availability?date=${encodeURIComponent(submitted.date)}&from=${encodeURIComponent(submitted.from)}&to=${encodeURIComponent(submitted.to)}`,
      ),
    enabled: !!submitted,
  });

  const toOptions = TO_OPTIONS.filter((t) => !searchFrom || t > searchFrom);
  const canSearch = Boolean(searchDate && searchFrom && searchTo && searchFrom < searchTo);

  const runSearch = (e) => {
    e.preventDefault();
    if (!canSearch) return;
    setSubmitted({ date: searchDate, from: searchFrom, to: searchTo });
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

          {(data.rooms?.length > 0 || data.classSchedules?.length > 0) && (
            <StudioRoomsSchedule
              rooms={data.rooms || []}
              classes={data.classSchedules || []}
              scheduleDescription="Weekly group classes at this studio. Private lessons are booked with an instructor below."
            />
          )}

          {data.teachers.length > 0 && (
            <details className="card studio-search">
              <summary className="studio-search-summary">
                <span>Find a lesson by date &amp; time</span>
              </summary>
              <div className="studio-search-body">
              <p className="muted" style={{ fontSize: '14px', marginBottom: '1rem' }}>
                An open lesson is listed only when it starts and ends inside the range. A 3:00–3:45
                lesson shows up in a 1:00–3:45 search, and not in a 1:00–3:30 search.
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
                  <label htmlFor="search-from">From</label>
                  <select
                    id="search-from"
                    value={searchFrom}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSearchFrom(next);
                      if (searchTo && next && searchTo <= next) setSearchTo('');
                    }}
                    required
                  >
                    <option value="">Select a start</option>
                    {FROM_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="search-to">To</label>
                  <select
                    id="search-to"
                    value={searchTo}
                    onChange={(e) => setSearchTo(e.target.value)}
                    required
                    disabled={!searchFrom}
                  >
                    <option value="">Select an end</option>
                    {toOptions.map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={!canSearch}>
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
                      No open lessons start and end inside that range.
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
                            {r.tierName && <div className="contact">{r.tierName}</div>}
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
              </div>
            </details>
          )}

          {data.teachers.length === 0 && (
            <div className="card center muted">No instructors are available at this studio yet.</div>
          )}

          {data.teachers.length > 0 &&
            instructorSections(data.teachers, data.tiers).map((section) => (
              <section className="instructor-tier" key={section.key}>
                {section.tier ? (
                  <>
                    <h2 className="tier-heading">{section.title}</h2>
                    {section.tier.description && (
                      <p className="muted" style={{ fontSize: '14px', marginBottom: '0.85rem' }}>
                        {section.tier.description}
                      </p>
                    )}
                  </>
                ) : (
                  <h2 className="section-title" style={{ marginTop: '0.25rem' }}>
                    {section.title}
                  </h2>
                )}
                <div className="instructor-grid">
                  {section.teachers.map((teacher) => (
                    <InstructorCard key={teacher.id} teacher={teacher} slug={slug} />
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </div>
  );
}
