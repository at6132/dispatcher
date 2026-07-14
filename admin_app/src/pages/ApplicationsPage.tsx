import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type AppRow = {
  id: string;
  driveId: string;
  driverId: string;
  status: string;
  lat: string | null;
  lng: string | null;
  createdAt: string;
};

export function ApplicationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');

  const list = useQuery({
    queryKey: ['applications', status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      return api<{ items: AppRow[] }>(`/v1/admin/applications?${params}`);
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api(`/v1/admin/applications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['applications'] }),
  });

  return (
    <div>
      <h1 className="page-title">Applications</h1>
      <p className="page-sub">Cross-drive applicant list with status overrides.</p>

      <div className="toolbar">
        <select
          className="field"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="cleared">Cleared</option>
        </select>
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
                <th>Drive</th>
                <th>Driver</th>
                <th>Status</th>
                <th>Location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{fmtDate(a.createdAt)}</td>
                  <td className="mono">{a.driveId.slice(0, 8)}</td>
                  <td className="mono">{a.driverId.slice(0, 8)}</td>
                  <td>
                    <StatusBadge value={a.status} />
                  </td>
                  <td className="muted">
                    {a.lat && a.lng ? `${a.lat}, ${a.lng}` : '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      {(['pending', 'accepted', 'rejected', 'cleared'] as const)
                        .filter((s) => s !== a.status)
                        .map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="btn"
                            onClick={() =>
                              patch.mutate({ id: a.id, next: s })
                            }
                          >
                            {s}
                          </button>
                        ))}
                    </div>
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
