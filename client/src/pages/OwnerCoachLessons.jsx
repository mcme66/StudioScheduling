import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import RangePicker from '../components/RangePicker.jsx';
import { WEEKDAYS, fmtDate, fmtTimeRange, getMonday, monthStart } from '../lib/format.js';
import { initialAnchor, rangeBounds, shiftAnchor } from '../lib/lessonRange.js';

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

  const mode = searchParams.get('range') === 'month' ? 'month' : 'week';
  const paramFrom = searchParams.get('from');
  const paramTo = searchParams.get('to');

  const { from, to, label, anchor } = useMemo(() => {
    const fallbackAnchor = paramFrom
      ? mode === 'month'
        ? monthStart(paramFrom)
        : getMonday(paramFrom)
      : initialAnchor(mode);
    const bounds = rangeBounds(mode, fallbackAnchor);
    return {
      from: paramFrom || bounds.from,
      to: paramTo || bounds.to,
      label: bounds.label,
      anchor: fallbackAnchor,
    };
  }, [mode, paramFrom, paramTo]);

  const setRange = (nextMode, nextAnchor) => {
    const bounds = rangeBounds(nextMode, nextAnchor);
    setSearchParams({ range: nextMode, from: bounds.from, to: bounds.to });
  };

  const lessonsQuery = useQuery({
    queryKey: ['owner-coach-lessons', teacherId, from, to],
    queryFn: () =>
      api(
        `/owner/teachers/${teacherId}/lessons?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: Boolean(teacherId && from && to),
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

  const count = lessonsQuery.data?.lessons?.length ?? 0;
  const teacherName = lessonsQuery.data?.teacher?.fullName || 'Coach';

  return (
    <div className="container">
      <p className="muted" style={{ fontSize: '13px', marginBottom: '0.75rem' }}>
        <Link to="/owner">← Studio dashboard</Link>
      </p>
      <h1 className="page-title">{teacherName}</h1>
      <p className="page-sub">
        Lessons taught {label}
        {lessonsQuery.data ? ` · ${count} lesson${count === 1 ? '' : 's'}` : ''}
      </p>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <RangePicker
          mode={mode}
          label={label}
          onModeChange={(next) => setRange(next, initialAnchor(next))}
          onPrev={() => setRange(mode, shiftAnchor(mode, anchor, -1))}
          onNext={() => setRange(mode, shiftAnchor(mode, anchor, 1))}
        />
      </div>

      {lessonsQuery.isLoading && <div className="loading">Loading lessons…</div>}
      {lessonsQuery.isError && (
        <p className="error-text">
          {lessonsQuery.error.message}
          {lessonsQuery.error.message?.includes('not listed') && (
            <>
              {' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/owner')}>
                Back
              </button>
            </>
          )}
        </p>
      )}

      {lessonsQuery.data && count === 0 && (
        <div className="card center muted">No lessons in this timeframe.</div>
      )}

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
