import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const LOGIN_PATH = { student: '/student/login', teacher: '/teacher/login' };

export default function RequireAuth({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading">Loading…</div>;
  }
  if (!user) {
    const loginPath = role ? LOGIN_PATH[role] : '/student/login';
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'teacher' ? '/teacher' : '/'} replace />;
  }
  return children;
}
