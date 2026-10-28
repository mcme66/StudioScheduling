import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import TeacherDashboard from './TeacherDashboard.jsx';

export default function OwnerCoachSchedule() {
  const { teacherId } = useParams();
  const id = Number(teacherId);
  const studioQuery = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
  });
  const teacher = (studioQuery.data?.teachers || []).find((t) => t.id === id);

  if (studioQuery.isLoading) {
    return (
      <div className="container">
        <div className="loading">Loading…</div>
      </div>
    );
  }
  if (!teacher) {
    return (
      <div className="container">
        <h1 className="page-title">Coach not found</h1>
        <Link to="/owner">← Studio</Link>
      </div>
    );
  }
  if (!teacher.ownerManaged) {
    return (
      <div className="container">
        <p style={{ marginTop: 0 }}>
          <Link to="/owner">← Studio</Link>
        </p>
        <h1 className="page-title">{teacher.fullName}</h1>
        <p className="page-sub">Turn on Manage for this coach before editing their schedule.</p>
      </div>
    );
  }
  return <TeacherDashboard ownerTeacher={teacher} />;
}
