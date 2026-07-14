import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, fmtDate, money } from '../api/client';
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui';

type UserRow = {
  id: string;
  phone: string;
  name: string;
  status: string;
  onboardingComplete: boolean;
  createdAt: string;
  vehicleType: string | null;
  vehicleClass: string | null;
};

type UserDetail = {
  user: {
    id: string;
    phone: string;
    name: string;
    status: string;
    onboardingComplete: boolean;
    createdAt: string;
    updatedAt: string;
  };
  profile: Record<string, unknown> | null;
  drivesPosted: Array<{ id: string; routeText: string; status: string }>;
  drivesTaken: Array<{ id: string; routeText: string; status: string }>;
  balances: Array<{
    id: string;
    amountCents: number;
    status: string;
  }>;
  refreshTokens: Array<{
    id: string;
    revokedAt: string | null;
    expiresAt: string;
  }>;
};

export function UsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const list = useQuery({
    queryKey: ['users', q, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      return api<{ items: UserRow[] }>(`/v1/admin/users?${params}`);
    },
  });

  const detail = useQuery({
    queryKey: ['user', selected],
    enabled: Boolean(selected),
    queryFn: () => api<UserDetail>(`/v1/admin/users/${selected}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/admin/users/${selected}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['user', selected] });
      setEditPassword('');
    },
  });

  const revoke = useMutation({
    mutationFn: () =>
      api(`/v1/admin/users/${selected}/revoke-refresh`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user', selected] }),
  });

  function openUser(row: UserRow) {
    setSelected(row.id);
    setEditName(row.name);
    setEditPhone(row.phone);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: editName,
      phone: editPhone,
    };
    if (editPassword.trim()) body.password = editPassword.trim();
    patch.mutate(body);
  }

  return (
    <div>
      <h1 className="page-title">Users</h1>
      <p className="page-sub">Search, inspect, lock, and remediate drivers.</p>

      <div className="toolbar">
        <input
          className="field"
          placeholder="Search name, phone, id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="field"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      {list.isLoading ? <Loading /> : null}
      {list.isError ? <ErrorBox message={(list.error as Error).message} /> : null}
      {list.data && list.data.items.length === 0 ? <Empty /> : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Onboarding</th>
                <th>Vehicle</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr
                  key={u.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openUser(u)}
                >
                  <td>{u.name}</td>
                  <td className="mono">{u.phone}</td>
                  <td>
                    <StatusBadge value={u.status} />
                  </td>
                  <td>{u.onboardingComplete ? 'done' : 'incomplete'}</td>
                  <td className="muted">
                    {u.vehicleType ?? '—'}
                    {u.vehicleClass ? ` · ${u.vehicleClass}` : ''}
                  </td>
                  <td className="mono">{fmtDate(u.createdAt)}</td>
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
            <h2>User detail</h2>
            {detail.isLoading ? <Loading /> : null}
            {detail.isError ? (
              <ErrorBox message={(detail.error as Error).message} />
            ) : null}
            {detail.data ? (
              <>
                <form className="stack" onSubmit={save}>
                  <input
                    className="field"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <input
                    className="field"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                  <input
                    className="field"
                    type="password"
                    placeholder="New password (optional)"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                  />
                  <div className="row-actions">
                    <button className="btn btn-primary" type="submit">
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        patch.mutate({
                          status:
                            detail.data!.user.status === 'locked'
                              ? 'active'
                              : 'locked',
                        })
                      }
                    >
                      {detail.data.user.status === 'locked'
                        ? 'Unlock'
                        : 'Lock'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        patch.mutate({
                          onboardingComplete:
                            !detail.data!.user.onboardingComplete,
                        })
                      }
                    >
                      Toggle onboarding
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        if (
                          confirm(
                            'Revoke all refresh tokens for this user?',
                          )
                        ) {
                          revoke.mutate();
                        }
                      }}
                    >
                      Revoke sessions
                    </button>
                  </div>
                </form>

                <div className="detail-block">
                  <h3>Profile</h3>
                  <pre className="mono muted" style={{ whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(detail.data.profile, null, 2)}
                  </pre>
                </div>
                <div className="detail-block">
                  <h3>Balances</h3>
                  {detail.data.balances.map((b) => (
                    <div key={b.id}>
                      {money(b.amountCents)} · <StatusBadge value={b.status} />
                    </div>
                  ))}
                </div>
                <div className="detail-block">
                  <h3>Posted</h3>
                  {detail.data.drivesPosted.slice(0, 8).map((d) => (
                    <div key={d.id}>
                      {d.routeText} · <StatusBadge value={d.status} />
                    </div>
                  ))}
                </div>
                <div className="detail-block">
                  <h3>Taken</h3>
                  {detail.data.drivesTaken.slice(0, 8).map((d) => (
                    <div key={d.id}>
                      {d.routeText} · <StatusBadge value={d.status} />
                    </div>
                  ))}
                </div>
                <p className="mono muted">{detail.data.user.id}</p>
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
