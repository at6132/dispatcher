import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorBox, Loading } from '../components/ui';

type SignupPinResponse = {
  pin: string | null;
  configured: boolean;
};

export function SettingsPage() {
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  const current = useQuery({
    queryKey: ['settings-signup-pin'],
    queryFn: () => api<SignupPinResponse>('/v1/admin/settings/signup-pin'),
  });

  useEffect(() => {
    if (current.data?.pin != null) {
      setPin(current.data.pin);
    }
  }, [current.data?.pin]);

  const save = useMutation({
    mutationFn: (next: string) =>
      api<SignupPinResponse>('/v1/admin/settings/signup-pin', {
        method: 'PATCH',
        body: JSON.stringify({ pin: next }),
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings-signup-pin'] });
      setPin(data.pin ?? '');
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = pin.trim();
    if (!/^\d{4,8}$/.test(next)) return;
    save.mutate(next);
  }

  const formatOk = /^\d{4,8}$/.test(pin.trim());

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Signup PIN required to create a driver account. Share it with people you
        want on the board.
      </p>

      {current.isLoading ? <Loading /> : null}
      {current.isError ? (
        <ErrorBox message={(current.error as Error).message} />
      ) : null}

      {current.data ? (
        <div className="card" style={{ maxWidth: 420 }}>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div>
              <label className="muted" htmlFor="signup-pin">
                Signup PIN
              </label>
              <input
                id="signup-pin"
                className="field"
                style={{ width: '100%', marginTop: 6 }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="4–8 digits"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                {current.data.configured
                  ? 'Currently set — change it anytime.'
                  : 'Not set yet — signup is blocked until you save a PIN.'}
              </p>
            </div>

            {save.isError ? (
              <ErrorBox message={(save.error as Error).message} />
            ) : null}
            {savedFlash ? (
              <p style={{ margin: 0, color: 'var(--success)', fontSize: 14 }}>
                Saved.
              </p>
            ) : null}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!formatOk || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save PIN'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
