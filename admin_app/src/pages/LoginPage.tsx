import { type FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type ChallengeStart = {
  challengeId: string;
  shortCode: string;
  expiresAt: string;
  status: 'pending';
};

type ChallengePoll = {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  shortCode: string;
  expiresAt: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
};

export function LoginPage() {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeStart | null>(null);
  const [pollStatus, setPollStatus] = useState<ChallengePoll['status'] | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!challenge) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [challenge?.challengeId]);

  useEffect(() => {
    if (!challenge) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const data = await api<ChallengePoll>(
          `/v1/admin/auth/challenge/${challenge.challengeId}`,
          { auth: false },
        );
        if (cancelled) return;
        setPollStatus(data.status);
        if (data.status === 'approved' && data.sessionToken) {
          auth.login(data.sessionToken, data.sessionExpiresAt);
          return;
        }
        if (data.status === 'denied' || data.status === 'expired') {
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Polling failed',
          );
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [challenge?.challengeId, auth]);

  if (auth.authed) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await api<ChallengeStart>('/v1/admin/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ password }),
      });
      setChallenge(data);
      setPollStatus('pending');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge && pollStatus !== 'denied' && pollStatus !== 'expired') {
    return (
      <div className="login-wrap">
        <div className="login-card stack" style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <h1>
            Waiting for <em>Telegram</em>
          </h1>
          <p className="muted">
            Open the approved Telegram chats and send{' '}
            <code className="mono">/allow</code> or{' '}
            <code className="mono">/allow {challenge.shortCode}</code>.
          </p>
          <div className="card">
            <div className="muted" style={{ fontSize: '0.75rem' }}>
              CODE
            </div>
            <div
              className="mono"
              style={{ fontSize: '1.8rem', letterSpacing: '0.12em' }}
            >
              {challenge.shortCode}
            </div>
          </div>
          <p className="muted">
            Status: <strong>{pollStatus ?? 'pending'}</strong> · {elapsed}s
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setChallenge(null);
              setPollStatus(null);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={(e) => void onSubmit(e)}>
        <div>
          <h1>
            Admin <em>gate</em>
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Password, then Telegram <code>/allow</code> from an approved chat.
          </p>
        </div>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? <div className="error">{error}</div> : null}
        {pollStatus === 'denied' ? (
          <div className="error">Telegram denied this login.</div>
        ) : null}
        {pollStatus === 'expired' ? (
          <div className="error">Challenge expired. Try again.</div>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
