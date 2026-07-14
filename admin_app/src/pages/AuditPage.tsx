import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate } from '../api/client';
import { Empty, ErrorBox, Loading } from '../components/ui';

type AuditRow = {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  requestId: string | null;
  ip: string | null;
};

export function AuditPage() {
  const [action, setAction] = useState('');

  const list = useQuery({
    queryKey: ['audit', action],
    queryFn: () => {
      const params = new URLSearchParams();
      if (action.trim()) params.set('action', action.trim());
      return api<{ items: AuditRow[] }>(`/v1/admin/audit?${params}`);
    },
  });

  return (
    <div>
      <h1 className="page-title">Audit</h1>
      <p className="page-sub">Every admin mutation and sensitive read.</p>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Filter action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>

      {list.isLoading ? <Loading /> : null}
      {list.isError ? <ErrorBox message={(list.error as Error).message} /> : null}
      {list.data?.items.length === 0 ? <Empty /> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>IP</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtDate(e.at)}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">
                    {e.actorType}:{e.actorId?.slice(0, 8) ?? '—'}
                  </td>
                  <td className="mono">
                    {e.entityType ?? '—'}
                    {e.entityId ? `/${e.entityId.slice(0, 8)}` : ''}
                  </td>
                  <td className="mono">{e.ip ?? '—'}</td>
                  <td className="mono">{e.requestId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
