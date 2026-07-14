import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, fmtDate, money } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type Drive = {
  id: string;
  routeText: string;
  status: string;
  passengerPhone: string;
  tripType: string;
  costCents: number | null;
  posterId: string;
  assigneeId: string | null;
  createdAt: string;
  hiddenByPoster: boolean;
  address: string | null;
  extraInfo: string | null;
};

type DriveDetail = {
  drive: Drive;
  applications: Array<{
    id: string;
    driverId: string;
    status: string;
    lat: string | null;
    lng: string | null;
  }>;
  balance: { id: string; amountCents: number; status: string } | null;
};

export function DrivesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [routeText, setRouteText] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');

  const list = useQuery({
    queryKey: ['drives', q, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      return api<{ items: Drive[] }>(`/v1/admin/drives?${params}`);
    },
  });

  const detail = useQuery({
    queryKey: ['drive', selected],
    enabled: Boolean(selected),
    queryFn: () => api<DriveDetail>(`/v1/admin/drives/${selected}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/admin/drives/${selected}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drives'] });
      void qc.invalidateQueries({ queryKey: ['drive', selected] });
    },
  });

  const cancel = useMutation({
    mutationFn: () =>
      api(`/v1/admin/drives/${selected}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drives'] });
      void qc.invalidateQueries({ queryKey: ['drive', selected] });
    },
  });

  function open(d: Drive) {
    setSelected(d.id);
    setRouteText(d.routeText);
    setPassengerPhone(d.passengerPhone);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    patch.mutate({ routeText, passengerPhone });
  }

  return (
    <div>
      <h1 className="page-title">Drives</h1>
      <p className="page-sub">Full board visibility including passenger phone.</p>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search route, phone, id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="field"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="assigned">Assigned</option>
          <option value="picked_up">Picked up</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
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
                <th>Route</th>
                <th>Status</th>
                <th>Trip</th>
                <th>Passenger</th>
                <th>Cost</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr
                  key={d.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => open(d)}
                >
                  <td>{d.routeText}</td>
                  <td>
                    <StatusBadge value={d.status} />
                  </td>
                  <td>{d.tripType}</td>
                  <td className="mono">{d.passengerPhone}</td>
                  <td>{d.costCents != null ? money(d.costCents) : '—'}</td>
                  <td className="mono">{fmtDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <div className="drawer" onClick={() => setSelected(null)}>
          <div
            className="drawer-panel stack"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Drive</h2>
            {detail.isLoading ? <Loading /> : null}
            {detail.data ? (
              <>
                <form className="stack" onSubmit={save}>
                  <input
                    className="field"
                    value={routeText}
                    onChange={(e) => setRouteText(e.target.value)}
                  />
                  <input
                    className="field"
                    value={passengerPhone}
                    onChange={(e) => setPassengerPhone(e.target.value)}
                  />
                  <div className="row-actions">
                    <button className="btn btn-primary" type="submit">
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        if (confirm('Cancel this drive?')) cancel.mutate();
                      }}
                    >
                      Cancel drive
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        patch.mutate({
                          hiddenByPoster: !detail.data!.drive.hiddenByPoster,
                        })
                      }
                    >
                      Toggle hidden
                    </button>
                  </div>
                </form>
                <div className="detail-block">
                  <h3>Meta</h3>
                  <p className="muted">
                    Address: {detail.data.drive.address ?? '—'}
                  </p>
                  <p className="muted">
                    Extra: {detail.data.drive.extraInfo ?? '—'}
                  </p>
                  <p className="mono muted">{detail.data.drive.id}</p>
                </div>
                <div className="detail-block">
                  <h3>Applications</h3>
                  {detail.data.applications.map((a) => (
                    <div key={a.id}>
                      <span className="mono">{a.driverId.slice(0, 8)}</span> ·{' '}
                      <StatusBadge value={a.status} />
                      {a.lat && a.lng ? (
                        <span className="muted">
                          {' '}
                          · {a.lat}, {a.lng}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
                {detail.data.balance ? (
                  <div className="detail-block">
                    <h3>Balance</h3>
                    {money(detail.data.balance.amountCents)} ·{' '}
                    <StatusBadge value={detail.data.balance.status} />
                  </div>
                ) : null}
              </>
            ) : null}
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
