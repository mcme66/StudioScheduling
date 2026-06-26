import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { fmtPrice } from '../lib/format.js';

export default function StudioDetail() {
  const { slug } = useParams();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studio', slug],
    queryFn: () => api(`/studios/${slug}`),
  });

  return (
    <div className="container">
      <Link to="/" className="muted" style={{ fontSize: '13px' }}>
        ← All studios
      </Link>

      {isLoading && <div className="loading">Loading studio…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && (
        <>
          <h1 className="page-title" style={{ marginTop: '0.5rem' }}>
            {data.studio.name}
          </h1>
          {data.studio.description && <p className="page-sub">{data.studio.description}</p>}

          {data.teachers.length === 0 && (
            <div className="card center muted">No instructors are available at this studio yet.</div>
          )}

          {data.teachers.length > 0 && (
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
          )}
        </>
      )}
    </div>
  );
}
