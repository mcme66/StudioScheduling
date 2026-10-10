import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const LOGIN_PATH = '/login';

function homeForRole(role) {
  if (role === 'teacher') return '/teacher';
  if (role === 'studio_owner') return '/owner';
  return '/';
}

export default function RequireAuth({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading">Loading…</div>;
  }
  if (!user) {
    return <Navigate to={LOGIN_PATH} state={{ from: location }} replace />;
  }
  const teacherBookerOk =
    role === 'student' && user.role === 'teacher' && user.canBookAsStudent === true;
  if (role && user.role !== role && !teacherBookerOk) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return children;
}
