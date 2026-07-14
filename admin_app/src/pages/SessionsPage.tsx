import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

type Session = {
  id: string;
  ip: string;
  userAgent: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
};

export function SessionsPage() {
  const qc = useQueryClient();
  const auth = useAuth();

  const list = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: () => api<{ items: Session[] }>('/v1/admin/sessions'),
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/sessions/${id}/revoke`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['admin-sessions'] });
      // If we revoked ourselves, clear local
      void api('/v1/admin/auth/me').catch(() => auth.logout());
      void id;
    },
  });

  const revokeAll = useMutation({
    mutationFn: () =>
      api<{ revoked: number }>('/v1/admin/sessions/revoke-all', {
        method: 'POST',
      }),
    onSuccess: () => {
      auth.logout();
    },
  });

  return (
    <div>
      <h1 className="page-title">Sessions</h1>
      <p className="page-sub">Active and historical admin console sessions.</p>

      <div className="toolbar">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (confirm('Revoke ALL admin sessions (including yours)?')) {
              revokeAll.mutate();
            }
          }}
        >
          Revoke all
        </button>
      </div>

      {list.isLoading ? <Loading /> : null}
      {list.isError ? <ErrorBox message={(list.error as Error).message} /> : null}
      {list.data?.items.length === 0 ? <Empty /> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Last seen</th>
                <th>IP</th>
                <th>Status</th>
                <th>UA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{fmtDate(s.createdAt)}</td>
                  <td className="mono">{fmtDate(s.lastSeenAt)}</td>
                  <td className="mono">{s.ip}</td>
                  <td>
                    <StatusBadge
                      value={s.revokedAt ? 'revoked' : 'active'}
                    />
                  </td>
                  <td className="muted" style={{ maxWidth: 220 }}>
                    {(s.userAgent ?? '—').slice(0, 80)}
                  </td>
                  <td>
                    {!s.revokedAt ? (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                          if (confirm('Revoke this session?')) {
                            revokeOne.mutate(s.id);
                          }
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
