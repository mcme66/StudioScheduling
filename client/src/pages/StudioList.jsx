import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function StudioList() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['studios'],
    queryFn: () => api('/studios'),
  });

  return (
    <div className="container">
      <h1 className="page-title">Find a studio</h1>
      <p className="page-sub">Browse local studios and book lessons with their instructors.</p>

      {isLoading && <div className="loading">Loading studios…</div>}
      {isError && <p className="error-text">{error.message}</p>}

      {data && data.studios.length === 0 && (
        <div className="card center muted">No studios are listed yet. Check back soon.</div>
      )}

      {data && data.studios.length > 0 && (
        <div className="studio-grid">
          {data.studios.map((studio) => (
            <div className="studio-card" key={studio.id}>
              <h3>{studio.name}</h3>
              {studio.description && <p className="bio">{studio.description}</p>}
              <div className="row spread">
                <span className="muted" style={{ fontSize: '13px' }}>
                  {studio.instructorCount} instructor{studio.instructorCount === 1 ? '' : 's'}
                </span>
              </div>
              <Link to={`/studios/${studio.slug}`} className="btn btn-primary btn-block">
                View instructors
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
