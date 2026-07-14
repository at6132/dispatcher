import { useQuery } from '@tanstack/react-query';
import { api, fmtDate, money } from '../api/client';
import { ErrorBox, Loading, StatusBadge } from '../components/ui';

type Stats = {
  users: { active: number; locked: number };
  drives: { open: number; assigned: number; completedToday: number };
  applications: { pending: number };
  balances: { openCount: number; openCents: number; overdueCount: number };
  security: {
    failedAdminLogins24h: number;
    recent: Array<{
      id: string;
      at: string;
      kind: string;
      severity: string;
      ip: string | null;
    }>;
  };
};

export function DashboardPage() {
  const q = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/v1/admin/stats'),
    refetchInterval: 30_000,
  });

  if (q.isLoading) return <Loading label="Loading dashboard…" />;
  if (q.isError) {
    return <ErrorBox message={(q.error as Error).message} />;
  }
  const s = q.data!;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Live ops snapshot for the shared drive board.</p>

      <div className="grid-kpi">
        <div className="card kpi">
          <div className="label">Active users</div>
          <div className="value">{s.users.active}</div>
        </div>
        <div className="card kpi">
          <div className="label">Locked</div>
          <div className="value">{s.users.locked}</div>
        </div>
        <div className="card kpi">
          <div className="label">Open drives</div>
          <div className="value">{s.drives.open}</div>
        </div>
        <div className="card kpi">
          <div className="label">Assigned</div>
          <div className="value">{s.drives.assigned}</div>
        </div>
        <div className="card kpi">
          <div className="label">Completed today</div>
          <div className="value">{s.drives.completedToday}</div>
        </div>
        <div className="card kpi">
          <div className="label">Pending apps</div>
          <div className="value">{s.applications.pending}</div>
        </div>
        <div className="card kpi">
          <div className="label">Open balances</div>
          <div className="value">{money(s.balances.openCents)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Overdue</div>
          <div className="value">{s.balances.overdueCount}</div>
        </div>
        <div className="card kpi">
          <div className="label">Bad admin PW 24h</div>
          <div className="value">{s.security.failedAdminLogins24h}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent security signals</h3>
        {s.security.recent.length === 0 ? (
          <p className="muted">Quiet. No recent signals.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Severity</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {s.security.recent.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{fmtDate(e.at)}</td>
                    <td>{e.kind}</td>
                    <td>
                      <StatusBadge value={e.severity} />
                    </td>
                    <td className="mono">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
