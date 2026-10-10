import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { WEEKDAYS, fmtDate, fmtPrice, fmtTimeRange } from '../lib/format.js';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'ytd', label: 'Year to date' },
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

function studentLabel(lesson) {
  const name = lesson.student.childName || lesson.student.name;
  const bits = [];
  if (lesson.student.childName) bits.push(`Parent: ${lesson.student.name}`);
  if (lesson.paymentPartner?.name) bits.push(`Partner: ${lesson.paymentPartner.name}`);
  return { name, contact: bits.join(' · ') };
}

export default function OwnerCoachLessons() {
  const { teacherId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requested = searchParams.get('preset');
  const preset = PRESETS.some((p) => p.id === requested) ? requested : 'week';

  const lessonsQuery = useQuery({
    queryKey: ['owner-coach-lessons', teacherId, preset],
    queryFn: () => api(`/owner/teachers/${teacherId}/lessons?preset=${preset}`),
    enabled: Boolean(teacherId),
  });

  const days = useMemo(() => {
    const groups = [];
    for (const lesson of lessonsQuery.data?.lessons || []) {
      const last = groups[groups.length - 1];
      if (!last || last.date !== lesson.lessonDate) {
        groups.push({ date: lesson.lessonDate, items: [lesson] });
      } else {
        last.items.push(lesson);
      }
    }
    return groups;
  }, [lessonsQuery.data]);

  const data = lessonsQuery.data;
  const count = data?.lessonCount ?? data?.lessons?.length ?? 0;
  const teacherName = data?.teacher?.fullName || 'Coach';

  const setPreset = (id) => setSearchParams({ preset: id }, { replace: true });

  return (
    <div className="container">
      <p className="muted" style={{ fontSize: '13px', marginBottom: '0.75rem' }}>
        <Link to={`/owner?tab=coaches&preset=${preset}`}>← Coaches</Link>
      </p>
      <h1 className="page-title">{teacherName}</h1>
      <div className="quiet-presets" style={{ marginBottom: '0.65rem' }} role="group" aria-label="Time period">
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
      {data && (
        <p className="page-sub">
          {count} lesson{count === 1 ? '' : 's'} · {fmtPrice(data.floorFeeCents)} expected floor fees
        </p>
      )}

      {lessonsQuery.isLoading && <div className="loading">Loading lessons…</div>}
      {lessonsQuery.isError && (
        <p className="error-text">
          {lessonsQuery.error.message}
          {lessonsQuery.error.message?.includes('not listed') && (
            <>
              {' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/owner?tab=coaches')}>
                Back
              </button>
            </>
          )}
        </p>
      )}

      {data && count === 0 && <div className="card center muted">No lessons in this period.</div>}

      {days.map((day) => (
        <div className="card" key={day.date}>
          <div className="section-title">
            {fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          {day.items.map((lesson, i) => {
            const { name, contact } = studentLabel(lesson);
            return (
              <div className="list-row" key={`${lesson.lessonDate}-${lesson.startTime}-${i}`}>
                <div className="when">
                  <div className="d">{WEEKDAYS[lesson.weekday]}</div>
                  <div>{fmtTimeRange(lesson.startTime, lesson.durationMin)}</div>
                </div>
                <div className="grow">
                  {name}
                  {contact && <div className="contact">{contact}</div>}
                </div>
                <span className="muted" style={{ fontSize: '13px' }}>
                  {fmtPrice(lesson.floorFeeCents)}
                </span>
                <span className={lesson.kind === 'weekly' ? 'pill pill-taken' : 'pill pill-open'}>
                  {lesson.kind === 'weekly' ? 'Weekly' : 'One-off'}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
