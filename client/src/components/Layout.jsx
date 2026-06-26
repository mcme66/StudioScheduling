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
              <NavLink to="/" end>
                Studios
              </NavLink>
              <NavLink to="/teacher">Dashboard</NavLink>
            </>
          ) : user?.role === 'student' ? (
            <NavLink to="/" end>
              Studios
            </NavLink>
          ) : (
            <>
              <NavLink to="/teacher/login" className="header-auth-btn header-auth-teacher">
                Teacher Login
              </NavLink>
              <NavLink to="/teacher/register" className="header-auth-link">
                Sign up - Teacher
              </NavLink>
            </>
          )}
        </div>

        <Link to="/" className="header-brand">
          Lesson Scheduling
        </Link>

        <div className="header-side header-right">
          {user?.role === 'student' && (
            <>
              <NavLink to="/my-lessons">My Lessons</NavLink>
            </>
          )}
          {user ? (
            <>
              <Link to="/profile" className="user-chip user-chip-link">
                {user.fullName}
              </Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/student/register" className="header-auth-link">
                Sign up - Student
              </NavLink>
              <NavLink to="/student/login" className="header-auth-btn header-auth-student">
                Student Login
              </NavLink>
            </>
          )}
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </>
  );
}
