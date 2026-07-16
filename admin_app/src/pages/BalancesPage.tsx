import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, money } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type Balance = {
  id: string;
  driveId: string;
  posterId: string;
  driverId: string;
  amountCents: number;
  status: string;
  dueSunday: string;
  settledAt: string | null;
  createdAt: string;
};

export function BalancesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);

  const list = useQuery({
    queryKey: ['balances', status, overdue],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (overdue) params.set('overdue', '1');
      return api<{ items: Balance[] }>(`/v1/admin/balances?${params}`);
    },
  });

  const settle = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/balances/${id}/settle`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balances'] }),
  });

  const adjust = useMutation({
    mutationFn: ({
      id,
      amountCents,
      reason,
    }: {
      id: string;
      amountCents: number;
      reason: string;
    }) =>
      api(`/v1/admin/balances/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amountCents, reason }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['balances'] }),
  });

  return (
    <div>
      <h1 className="page-title">Balances</h1>
      <p className="page-sub">
        Driver → dispatcher 12% settlement ledger.
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
                <th>Driver</th>
                <th>Poster</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((b) => (
                <tr key={b.id}>
                  <td>{money(b.amountCents)}</td>
                  <td>
                    <StatusBadge value={b.status} />
                  </td>
                  <td className="mono">{fmtDate(b.dueSunday)}</td>
                  <td className="mono">{b.driverId.slice(0, 8)}</td>
                  <td className="mono">{b.posterId.slice(0, 8)}</td>
                  <td className="mono">{fmtDate(b.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      {b.status !== 'settled' ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            if (confirm('Mark settled?')) settle.mutate(b.id);
                          }}
                        >
                          Settle
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const dollars = prompt(
                            'New amount in dollars',
                            (b.amountCents / 100).toFixed(2),
                          );
                          const reason = prompt('Reason (required)');
                          if (!dollars || !reason) return;
                          const amountCents = Math.round(
                            Number(dollars) * 100,
                          );
                          if (!Number.isFinite(amountCents)) return;
                          adjust.mutate({ id: b.id, amountCents, reason });
                        }}
                      >
                        Adjust
                      </button>
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
