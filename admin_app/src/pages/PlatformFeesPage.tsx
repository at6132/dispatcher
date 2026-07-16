import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, money } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type PlatformFee = {
  id: string;
  driveId: string;
  posterId: string;
  amountCents: number;
  status: string;
  dueSunday: string;
  paidAt: string | null;
  settledAt: string | null;
  createdAt: string;
  settlementProofUrl: string | null;
};

export function PlatformFeesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('payment_pending');
  const [overdue, setOverdue] = useState(false);

  const list = useQuery({
    queryKey: ['platform-fees', status, overdue],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (overdue) params.set('overdue', '1');
      return api<{ items: PlatformFee[] }>(`/v1/admin/platform-fees?${params}`);
    },
  });

  const confirmReceived = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/platform-fees/${id}/confirm-received`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-fees'] }),
  });

  return (
    <div>
      <h1 className="page-title">Platform fees</h1>
      <p className="page-sub">
        Dispatchers remit 2% of trip cost. Mark received after payment clears.
      </p>

      <div className="toolbar">
        <select
          className="field"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="payment_pending">Payment pending</option>
          <option value="settled">Settled</option>
        </select>
        <label className="muted" style={{ display: 'flex', gap: 8 }}>
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
          />
          Overdue only
        </label>
      </div>

      {list.isLoading ? <Loading /> : null}
      {list.isError ? <ErrorBox message={(list.error as Error).message} /> : null}
      {list.data?.items.length === 0 ? <Empty /> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Amount</th>
                <th>Status</th>
                <th>Due Sunday</th>
                <th>Dispatcher</th>
                <th>Paid</th>
                <th>Proof</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((f) => (
                <tr key={f.id}>
                  <td>{money(f.amountCents)}</td>
                  <td>
                    <StatusBadge value={f.status} />
                  </td>
                  <td className="mono">{fmtDate(f.dueSunday)}</td>
                  <td className="mono">{f.posterId.slice(0, 8)}</td>
                  <td className="mono">
                    {f.paidAt ? fmtDate(f.paidAt) : '—'}
                  </td>
                  <td>
                    {f.settlementProofUrl ? (
                      <a
                        href={f.settlementProofUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {f.status !== 'settled' ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          if (
                            window.confirm('Mark this 2% fee received?')
                          ) {
                            confirmReceived.mutate(f.id);
                          }
                        }}
                      >
                        Mark received
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
