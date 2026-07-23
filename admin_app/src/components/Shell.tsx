import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const links = [
  ['/', 'Dashboard'],
  ['/users', 'Users'],
  ['/drives', 'Drives'],
  ['/applications', 'Applications'],
  ['/balances', 'Balances'],
  ['/platform-fees', 'Platform fees'],
  ['/analytics', 'Analytics'],
  ['/security', 'Security'],
  ['/audit', 'Audit'],
  ['/sessions', 'Sessions'],
  ['/settings', 'Settings'],
] as const;

export function Shell() {
  const auth = useAuth();

  async function logout() {
    try {
      await api('/v1/admin/auth/logout', { method: 'POST' });
    } catch {
      // still clear local
    }
    auth.logout();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          Dispatcher <span>admin</span>
        </div>
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `nav-link${isActive ? ' active' : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => void logout()}>
          Log out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
