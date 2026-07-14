import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate } from '../api/client';
import { Empty, ErrorBox, Loading } from '../components/ui';

type Summary = {
  since: string;
  topEvents: Array<{ name: string; count: number }>;
  daily: Array<{ day: string; n: number }>;
  funnel: Array<{ name: string; count: number }>;
};

type EventRow = {
  id: string;
  at: string;
  name: string;
  userId: string | null;
  ip: string | null;
  propsJson: string | null;
};

export function AnalyticsPage() {
  const [name, setName] = useState('');
  const summary = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => api<Summary>('/v1/admin/analytics/summary'),
  });
  const events = useQuery({
    queryKey: ['analytics-events', name],
    queryFn: () => {
      const params = new URLSearchParams();
      if (name.trim()) params.set('name', name.trim());
      return api<{ items: EventRow[] }>(`/v1/admin/analytics/events?${params}`);
    },
  });

  const maxDaily = Math.max(1, ...(summary.data?.daily.map((d) => d.n) ?? [1]));
  const maxFunnel = Math.max(
    1,
    ...(summary.data?.funnel.map((f) => f.count) ?? [1]),
  );

  return (
    <div>
      <h1 className="page-title">Analytics</h1>
      <p className="page-sub">First-party product events from the API.</p>

      {summary.isLoading ? <Loading /> : null}
      {summary.isError ? (
        <ErrorBox message={(summary.error as Error).message} />
      ) : null}

      {summary.data ? (
        <div className="stack" style={{ marginBottom: 20 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Daily volume (7d)</h3>
            <div className="chart-bars">
              {summary.data.daily.map((d) => (
                <div
                  key={d.day}
                  className="bar"
                  style={{ height: `${(d.n / maxDaily) * 100}%` }}
                  title={`${d.n}`}
                >
                  <span>{new Date(d.day).getDate()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Funnel (7d)</h3>
            <div className="funnel">
              {summary.data.funnel.map((f) => (
                <div key={f.name} className="funnel-row">
                  <span className="mono">{f.name}</span>
                  <div className="funnel-track">
                    <div
                      className="funnel-fill"
                      style={{ width: `${(f.count / maxFunnel) * 100}%` }}
                    />
                  </div>
                  <span>{f.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Top events</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.topEvents.map((e) => (
                    <tr key={e.name}>
                      <td className="mono">{e.name}</td>
                      <td>{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <input
          className="field"
          placeholder="Filter event name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {events.isLoading ? <Loading /> : null}
      {events.data?.items.length === 0 ? <Empty /> : null}
      {events.data && events.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Name</th>
                <th>User</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtDate(e.at)}</td>
                  <td className="mono">{e.name}</td>
                  <td className="mono">{e.userId?.slice(0, 8) ?? '—'}</td>
                  <td className="mono">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
