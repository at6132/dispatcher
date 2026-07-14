import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, fmtDate } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type TraceResult = {
  query: string;
  users: Array<{
    id: string;
    name: string;
    phone: string;
    status: string;
  }>;
  timeline: Array<{
    source: string;
    at: string;
    label: string;
    data: Record<string, unknown>;
  }>;
};

export function SecurityPage() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const events = useQuery({
    queryKey: ['security-events'],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          at: string;
          kind: string;
          severity: string;
          ip: string | null;
          requestId: string | null;
        }>;
      }>('/v1/admin/security/events?limit=80'),
  });

  const trace = useQuery({
    queryKey: ['trace', submitted],
    enabled: submitted.length >= 2,
    queryFn: () =>
      api<TraceResult>(
        `/v1/admin/security/trace?q=${encodeURIComponent(submitted)}`,
      ),
  });

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setSubmitted(q.trim());
  }

  return (
    <div>
      <h1 className="page-title">Security</h1>
      <p className="page-sub">
        Trace request IDs, IPs, phones, and dig intrusion signals.
      </p>

      <form className="toolbar" onSubmit={onSearch}>
        <input
          className="field"
          style={{ minWidth: 280 }}
          placeholder="requestId · IP · userId · phone · challenge"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Trace
        </button>
      </form>

      {trace.isFetching ? <Loading label="Tracing…" /> : null}
      {trace.isError ? (
        <ErrorBox message={(trace.error as Error).message} />
      ) : null}
      {trace.data ? (
        <div className="stack" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Matching users</h3>
            {trace.data.users.length === 0 ? (
              <p className="muted">None</p>
            ) : (
              trace.data.users.map((u) => (
                <div key={u.id}>
                  {u.name} · <span className="mono">{u.phone}</span> ·{' '}
                  <StatusBadge value={u.status} />
                </div>
              ))
            )}
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Timeline</h3>
            {trace.data.timeline.length === 0 ? (
              <Empty label="No trail hits." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Source</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.data.timeline.map((t, i) => (
                      <tr key={`${t.source}-${i}-${t.at}`}>
                        <td className="mono">{fmtDate(t.at)}</td>
                        <td>
                          <StatusBadge value={t.source} />
                        </td>
                        <td className="mono">{t.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>
        Intrusion feed
      </h2>
      {events.isLoading ? <Loading /> : null}
      {events.isError ? (
        <ErrorBox message={(events.error as Error).message} />
      ) : null}
      {events.data?.items.length === 0 ? <Empty /> : null}
      {events.data && events.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Severity</th>
                <th>IP</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fmtDate(e.at)}</td>
                  <td>{e.kind}</td>
                  <td>
                    <StatusBadge value={e.severity} />
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
