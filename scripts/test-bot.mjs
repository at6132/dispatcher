/**
 * Live tester bot (no app code changes).
 *
 * - Applies to Aaron's open drives (large_suv match)
 * - On Test Poster drives: auto-accepts the first pending application after 10s
 *
 * Usage: node scripts/test-bot.mjs
 * Stop: Ctrl+C
 */
import { randomUUID } from 'node:crypto';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'https://api-production-f4ac.up.railway.app';
const PASS = process.env.TEST_BOT_PASSWORD ?? 'Testpass1';

// Aaron Weinstein (from live board)
const AARON_USER_ID = '9f87cccf-9168-46a2-9eea-26a140f7ad7c';

const POSTER = {
  name: 'Test Poster',
  phone: '+15551110201',
  vehicleClass: 'large_suv',
  vehicleType: 'Escalade',
  seats: 10,
  yearsDrivingUpstate: 6,
};

const DRIVER = {
  name: 'Test Driver',
  phone: '+15551110202',
  vehicleClass: 'large_suv',
  vehicleType: 'Suburban',
  seats: 10,
  yearsDrivingUpstate: 5,
};

const ACCEPT_AFTER_MS = 10_000;
const POLL_MS = 3_000;

/** @type {Map<string, { driveId: string, applicationId: string, seenAt: number, accepted?: boolean }>} */
const pendingAccept = new Map();
/** @type {Set<string>} */
const appliedDriveIds = new Set();

async function api(method, path, { token, body, idempotency } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${data?.error?.code ?? ''} ${data?.error?.message ?? text}`,
    );
    err.status = res.status;
    err.code = data?.error?.code;
    err.data = data;
    throw err;
  }
  return data;
}

async function loginOrSignup(account) {
  try {
    return await api('POST', '/v1/auth/login', {
      body: { phone: account.phone, password: PASS },
    });
  } catch (e) {
    if (e.code !== 'invalid_credentials' && e.status !== 401) throw e;
    return api('POST', '/v1/auth/signup', {
      body: { name: account.name, phone: account.phone, password: PASS },
    });
  }
}

async function ensureOnboarded(session, account) {
  if (session.user?.onboardingComplete) {
    // Keep profile as large_suv so bot can apply to Aaron's drives / post matching ones
    const v = session.user.onboarding?.vehicleClass;
    if (v === account.vehicleClass) return session.accessToken;
  }
  await api('PUT', '/v1/me/onboarding', {
    token: session.accessToken,
    body: {
      vehicleClass: account.vehicleClass,
      vehicleType: account.vehicleType,
      seats: account.seats,
      yearsDrivingUpstate: account.yearsDrivingUpstate,
    },
  });
  return session.accessToken;
}

async function refreshIfNeeded(getToken, setToken, phone) {
  // Simple: re-login when we hit 401
  return async (fn) => {
    try {
      return await fn(getToken());
    } catch (e) {
      if (e.status !== 401) throw e;
      const s = await api('POST', '/v1/auth/login', {
        body: { phone, password: PASS },
      });
      setToken(s.accessToken);
      return fn(s.accessToken);
    }
  };
}

function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[test-bot ${t}]`, ...args);
}

async function applyToAaronDrives(driverToken) {
  const { items } = await api('GET', '/v1/drives?status=open&limit=50', {
    token: driverToken,
  });
  for (const drive of items ?? []) {
    if (drive.posterId !== AARON_USER_ID) continue;
    if (drive.status !== 'open') continue;
    if (appliedDriveIds.has(drive.id)) continue;
    try {
      const res = await api('POST', `/v1/drives/${drive.id}/applications`, {
        token: driverToken,
        body: { lat: 41.6554, lng: -74.6892 },
      });
      appliedDriveIds.add(drive.id);
      log(
        `applied → "${drive.routeText}" (${drive.id.slice(0, 8)}) app=${res.application?.id?.slice(0, 8)}`,
      );
    } catch (e) {
      if (e.code === 'already_applied' || e.code === 'duplicate_application') {
        appliedDriveIds.add(drive.id);
        log(`already applied → "${drive.routeText}"`);
      } else if (e.code === 'vehicle_mismatch') {
        log(`skip vehicle_mismatch → "${drive.routeText}"`);
        appliedDriveIds.add(drive.id);
      } else if (e.code === 'self_apply' || e.status === 403) {
        log(`skip → "${drive.routeText}" (${e.code ?? e.status})`);
        appliedDriveIds.add(drive.id);
      } else {
        log(`apply failed → "${drive.routeText}": ${e.message}`);
      }
    }
  }
}

async function watchPosterAccepts(posterToken, posterUserId) {
  const { items } = await api('GET', '/v1/drives?status=open&limit=50', {
    token: posterToken,
  });
  const mine = (items ?? []).filter((d) => d.posterId === posterUserId && d.status === 'open');

  for (const drive of mine) {
    let apps;
    try {
      const res = await api('GET', `/v1/drives/${drive.id}/applications`, {
        token: posterToken,
      });
      apps = res.items ?? [];
    } catch (e) {
      log(`list apps failed ${drive.id.slice(0, 8)}: ${e.message}`);
      continue;
    }

    const pending = apps.filter((a) => a.status === 'pending');
    // Prefer Aaron if present
    const pick =
      pending.find((a) => a.driver?.id === AARON_USER_ID) ?? pending[0];
    if (!pick) continue;

    const key = `${drive.id}:${pick.id}`;
    if (!pendingAccept.has(key)) {
      // If app is already older than the delay, accept on next tick
      const createdAt = pick.createdAt ? Date.parse(pick.createdAt) : Date.now();
      const age = Number.isFinite(createdAt) ? Date.now() - createdAt : 0;
      const seenAt = Date.now() - Math.min(age, ACCEPT_AFTER_MS);
      pendingAccept.set(key, {
        driveId: drive.id,
        applicationId: pick.id,
        seenAt,
        routeText: drive.routeText,
      });
      const waitSec = Math.max(0, Math.ceil((ACCEPT_AFTER_MS - (Date.now() - seenAt)) / 1000));
      log(
        `saw ${pick.driver?.name ?? 'applicant'} on "${drive.routeText}" — accept in ${waitSec}s`,
      );
    }
  }

  const now = Date.now();
  for (const [key, job] of pendingAccept) {
    if (job.accepted) continue;
    if (now - job.seenAt < ACCEPT_AFTER_MS) continue;
    try {
      await api('POST', `/v1/drives/${job.driveId}/accept`, {
        token: posterToken,
        body: { applicationId: job.applicationId },
        idempotency: randomUUID(),
      });
      job.accepted = true;
      log(`ACCEPTED "${job.routeText}" app=${job.applicationId.slice(0, 8)}`);
    } catch (e) {
      if (e.code === 'not_open' || e.code === 'already_assigned' || e.status === 409) {
        job.accepted = true;
        log(`accept skip (${e.code ?? e.status}) "${job.routeText}"`);
      } else {
        log(`accept failed "${job.routeText}": ${e.message}`);
        // retry next loop — bump seenAt slightly so we don't hammer
        job.seenAt = now - ACCEPT_AFTER_MS + 2000;
      }
    }
  }
}

async function main() {
  log(`API ${API}`);
  log(`accept delay ${ACCEPT_AFTER_MS / 1000}s · poll ${POLL_MS / 1000}s`);

  const posterSession = await loginOrSignup(POSTER);
  const posterToken0 = await ensureOnboarded(posterSession, POSTER);
  let posterToken = posterToken0;
  const posterUserId = posterSession.user.id;

  const driverSession = await loginOrSignup(DRIVER);
  const driverToken0 = await ensureOnboarded(driverSession, DRIVER);
  let driverToken = driverToken0;

  log(`poster ${POSTER.phone} (${posterUserId.slice(0, 8)})`);
  log(`driver ${DRIVER.phone} (${driverSession.user.id.slice(0, 8)}) — applies to Aaron`);

  // Immediate pass
  await applyToAaronDrives(driverToken);
  await watchPosterAccepts(posterToken, posterUserId);

  setInterval(async () => {
    try {
      await applyToAaronDrives(driverToken);
      await watchPosterAccepts(posterToken, posterUserId);
    } catch (e) {
      if (e.status === 401) {
        try {
          const ps = await api('POST', '/v1/auth/login', {
            body: { phone: POSTER.phone, password: PASS },
          });
          posterToken = ps.accessToken;
          const ds = await api('POST', '/v1/auth/login', {
            body: { phone: DRIVER.phone, password: PASS },
          });
          driverToken = ds.accessToken;
          log('refreshed tokens');
        } catch (re) {
          log('token refresh failed', re.message);
        }
      } else {
        log('loop error', e.message);
      }
    }
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
