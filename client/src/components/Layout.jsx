import { NavLink, Link, useNavigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import WhatsNewNotice from './WhatsNewNotice.jsx';
import NotificationBell from './NotificationBell.jsx';
import { api } from '../api/client.js';
import { settlementRequestsKey } from './owner/SettlementRequests.jsx';

function useOwnerRequestCount(enabled) {
  const settlements = useQuery({
    queryKey: settlementRequestsKey,
    queryFn: () => api('/owner/settlement-requests'),
    enabled,
    refetchInterval: 30000,
  });
  const studio = useQuery({
    queryKey: ['owner-studio'],
    queryFn: () => api('/owner/studio'),
    enabled,
  });
  if (!enabled) return 0;
  return (
    (settlements.data?.floorFees.length || 0) +
    (settlements.data?.payouts.length || 0) +
    (studio.data?.pendingCancellationCount || 0)
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const requestCount = useOwnerRequestCount(user?.role === 'studio_owner');

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
      <header className="app-header">
        <Link to="/" className="header-brand">
          <img src="/logo.png" alt="Studio Core" />
        </Link>

        <div className="header-side header-left">
          {user?.role === 'teacher' ? (
            <>
              <NavLink to="/teacher" className="header-nav-pill">
                Dashboard
              </NavLink>
              {user.canBookAsStudent && (
                <NavLink to="/my-lessons" className="header-nav-pill">
                  My Lessons
                </NavLink>
              )}
              <Link to="/profile" className="header-nav-pill">
                {user.fullName}
              </Link>
            </>
          ) : user?.role === 'studio_owner' ? (
            <>
              <NavLink to="/owner" className="header-nav-pill">
                Dashboard
              </NavLink>
              <NavLink to="/owner/requests" className="header-nav-pill">
                Requests
                {requestCount > 0 && <span className="tab-count">{requestCount}</span>}
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
          ) : null}
        </div>

        <div className="header-side header-right">
          {user ? (
            <>
              <NotificationBell />
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="header-auth-btn">
              Log in
            </NavLink>
          )}
        </div>
      </header>

      <main>
        <Outlet />
      </main>
      <WhatsNewNotice />
    </>
  );
}
