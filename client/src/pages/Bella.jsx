import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { WEEKDAYS, fmtTimeRange, fmtDate } from '../lib/format.js';

function studentLabel(lesson) {
  const name = lesson.student.childName || lesson.student.name;
  const bits = [];
  if (lesson.student.childName) bits.push(`Parent: ${lesson.student.name}`);
  if (lesson.paymentPartner?.name) bits.push(`Partner: ${lesson.paymentPartner.name}`);
  return { name, contact: bits.join(' · ') };
}

export default function Bella() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bella-august'],
    queryFn: () => api('/bella'),
  });

  const days = useMemo(() => {
    const groups = [];
    for (const lesson of data?.lessons || []) {
      const last = groups[groups.length - 1];
      if (!last || last.date !== lesson.lessonDate) {
        groups.push({ date: lesson.lessonDate, items: [lesson] });
      } else {
        last.items.push(lesson);
      }
    }
    return groups;
  }, [data]);

  const count = data?.lessons?.length ?? 0;

  return (
    <div className="container">
      <h1 className="page-title">{data?.teacher?.fullName || 'Isabella Siller'}</h1>
      <p className="page-sub">
        Lessons taught in {data?.monthLabel || 'August 2026'}
        {data && ` · ${count} lesson${count === 1 ? '' : 's'}`}
      </p>

      {isLoading && <div className="loading">Loading lessons…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && count === 0 && (
        <div className="card center muted">No lessons found for this month.</div>
      )}

      {days.map((day) => (
        <div className="card" key={day.date}>
          <div className="section-title">
            {fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          {day.items.map((lesson, i) => {
            const { name, contact } = studentLabel(lesson);
            const weekday = new Date(`${lesson.lessonDate}T12:00:00`).getDay();
            return (
              <div className="list-row" key={`${lesson.lessonDate}-${lesson.startTime}-${i}`}>
                <div className="when">
                  <div className="d">{WEEKDAYS[weekday]}</div>
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
