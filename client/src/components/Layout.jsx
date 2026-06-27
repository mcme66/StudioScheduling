import { NavLink, Link, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
      <header className="app-header">
        <div className="header-side header-left">
          {user?.role === 'teacher' ? (
            <>
              <NavLink to="/teacher" className="header-nav-pill">
                Dashboard
              </NavLink>
              <Link to="/profile" className="header-nav-pill">
                {user.fullName}
              </Link>
            </>
          ) : user?.role === 'student' ? (
            <>
              <NavLink to="/my-lessons" className="header-nav-pill">
                My Lessons
              </NavLink>
              <Link to="/profile" className="header-nav-pill">
                {user.fullName}
              </Link>
            </>
          ) : (
            <NavLink to="/teacher/login" className="header-auth-btn header-auth-teacher">
              Teacher Login
            </NavLink>
          )}
        </div>

        <Link to="/" className="header-brand">
          Studio Core
        </Link>

        <div className="header-side header-right">
          {user ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Log out
            </button>
          ) : (
            <NavLink to="/student/login" className="header-auth-btn header-auth-student">
              Student Login
            </NavLink>
          )}
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </>
  );
}
