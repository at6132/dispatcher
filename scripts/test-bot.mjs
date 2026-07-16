/**
 * Live tester bot (rate-limit friendly).
 *
 * - Yanky / Avraham / Ari (+ Test Driver) apply to Aaron's open drives
 * - Auto-accepts applicants on Yanky / Avraham / Ari drives after 10s
 *
 * Usage: node scripts/test-bot.mjs
 */
import { randomUUID } from 'node:crypto';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'https://dispatcher-production-31d1.up.railway.app';
const PASS = process.env.TEST_BOT_PASSWORD ?? 'Testpass1';
const AARON_USER_ID =
  process.env.INVITE_USER_ID ?? '0333e606-ad27-4444-804f-18f611df11ee';
const ACCEPT_AFTER_MS = 4_000;
const POLL_MS = 4_000;
const BETWEEN_CALL_MS = 400;

const POSTERS = [
  {
    name: 'Yanky',
    phone: '+15551110211',
    vehicleClass: 'large_suv',
    vehicleType: 'Escalade',
    seats: 10,
    yearsDrivingUpstate: 6,
  },
  {
    name: 'Avraham',
    phone: '+15551110212',
    vehicleClass: 'large_suv',
    vehicleType: 'Suburban',
    seats: 10,
    yearsDrivingUpstate: 7,
  },
  {
    name: 'Ari',
    phone: '+15551110213',
    vehicleClass: 'large_suv',
    vehicleType: 'Tahoe',
    seats: 10,
    yearsDrivingUpstate: 5,
  },
];

const DRIVER = {
  name: 'Test Driver',
  phone: '+15551110202',
  vehicleClass: 'large_suv',
  vehicleType: 'Suburban',
  seats: 10,
  yearsDrivingUpstate: 5,
};

/** One applicant per vehicle class so Aaron’s sedan/suv/minivan jobs are visible. */
const APPLY_FLEET = [
  {
    name: 'Yanky',
    phone: '+15551110211',
    vehicleClass: 'large_suv',
    vehicleType: 'Escalade',
    seats: 10,
    yearsDrivingUpstate: 6,
  },
  {
    name: 'Moshe',
    phone: '+15551110401',
    vehicleClass: 'sedan',
    vehicleType: 'Camry',
    seats: 4,
    yearsDrivingUpstate: 4,
  },
  {
    name: 'Shmuli',
    phone: '+15551110402',
    vehicleClass: 'suv',
    vehicleType: 'Pilot',
    seats: 7,
    yearsDrivingUpstate: 5,
  },
  {
    name: 'Dovid',
    phone: '+15551110403',
    vehicleClass: 'minivan',
    vehicleType: 'Sienna',
    seats: 7,
    yearsDrivingUpstate: 5,
  },
  {
    name: 'Yossi',
    phone: '+15551110404',
    vehicleClass: 'sprinter',
    vehicleType: 'Sprinter',
    seats: 12,
    yearsDrivingUpstate: 3,
  },
  DRIVER,
];

/** @type {Map<string, { driveId: string, applicationId: string, seenAt: number, routeText: string, posterPhone: string, accepted?: boolean }>} */
const pendingAccept = new Map();
/** applied key = `${driveId}:${applicantUserId}` */
const appliedKeys = new Set();
/** @type {Set<string>} */
const skipNoPending = new Set(); // drives we already know have no pending apps this open window
let rateLimitedUntil = 0;
let looping = false;
let applyCursor = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[test-bot ${t}]`, ...args);
}

async function api(method, path, { token, body, idempotency } = {}) {
  if (Date.now() < rateLimitedUntil) {
    const err = new Error('backing off after 429');
    err.status = 429;
    err.code = 'rate_limited';
    throw err;
  }
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
  if (res.status === 429) {
    rateLimitedUntil = Date.now() + 60_000;
    log('rate limited — pausing 60s');
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${data?.error?.code ?? data?.code ?? ''} ${data?.error?.message ?? data?.message ?? text}`,
    );
    err.status = res.status;
    err.code = data?.error?.code ?? data?.code;
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
  const v = session.user?.onboarding?.vehicleClass;
  if (session.user?.onboardingComplete && v === account.vehicleClass) {
    return session.accessToken;
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

/**
 * Each fleet account only sees matching vehicleClass on open board.
 * Poll every class so sedan / suv / minivan / etc Aaron posts get applications.
 */
async function applyToAaronDrives(applicants) {
  if (!applicants.length) return;

  /** @type {Map<string, any>} driveId -> drive */
  const aaronOpens = new Map();

  for (const viewer of applicants) {
    try {
      const { items } = await api('GET', '/v1/drives?status=open&limit=50', {
        token: viewer.token,
      });
      for (const d of items ?? []) {
        if (d.posterId === AARON_USER_ID && d.status === 'open') {
          aaronOpens.set(d.id, d);
        }
      }
    } catch (e) {
      if (e.status === 429) return;
      log(`open list failed (${viewer.name}): ${e.message}`);
    }
    await sleep(BETWEEN_CALL_MS);
  }

  if (!aaronOpens.size) {
    log('no Aaron open drives visible to fleet (check vehicle class on post)');
    return;
  }

  log(`Aaron open visible: ${aaronOpens.size}`);

  for (const drive of aaronOpens.values()) {
    // Prefer an applicant whose class matches the drive
    const matching = applicants.filter(
      (a) =>
        a.vehicleClass === drive.vehicleClass &&
        (a.seats ?? 99) >= (drive.seats ?? 1),
    );
    const pool = matching.length ? matching : applicants;

    let picked = null;
    for (let i = 0; i < pool.length; i++) {
      const idx = (applyCursor + i) % pool.length;
      const a = pool[idx];
      const key = `${drive.id}:${a.userId}`;
      if (!appliedKeys.has(key)) {
        picked = a;
        applyCursor = (idx + 1) % pool.length;
        break;
      }
    }
    if (!picked) continue;

    const key = `${drive.id}:${picked.userId}`;
    try {
      const res = await api('POST', `/v1/drives/${drive.id}/applications`, {
        token: picked.token,
        body: {
          lat: 41.65 + Math.random() * 0.04,
          lng: -74.71 + Math.random() * 0.04,
        },
      });
      appliedKeys.add(key);
      log(
        `${picked.name} (${picked.vehicleClass}) applied → Aaron "${drive.routeText}" [${drive.vehicleClass}/${drive.seats}] app=${res.application?.id?.slice(0, 8)}`,
      );
    } catch (e) {
      if (
        e.code === 'already_applied' ||
        e.code === 'duplicate_application' ||
        e.code === 'vehicle_mismatch' ||
        e.code === 'self_apply' ||
        e.status === 403
      ) {
        appliedKeys.add(key);
        log(
          `skip apply ${picked.name} → "${drive.routeText}" (${e.code ?? e.status})`,
        );
      } else if (e.status === 429) {
        return;
      } else {
        log(
          `apply failed ${picked.name} → "${drive.routeText}": ${e.message}`,
        );
      }
    }
    await sleep(BETWEEN_CALL_MS);
  }
}

async function watchPosterAccepts(poster) {
  const { token: posterToken, userId: posterUserId, phone: posterPhone, name: posterName } =
    poster;
  const { items } = await api('GET', '/v1/drives?status=mine&limit=50', {
    token: posterToken,
  });
  await sleep(BETWEEN_CALL_MS);

  const mine = (items ?? []).filter(
    (d) =>
      d.posterId === posterUserId &&
      d.status === 'open' &&
      d.vehicleClass === 'large_suv',
  );

  const candidates = mine.filter((d) => !skipNoPending.has(d.id));
  const batch = (candidates.length ? candidates : mine).slice(0, 3);

  for (const drive of batch) {
    let apps;
    try {
      const res = await api('GET', `/v1/drives/${drive.id}/applications`, {
        token: posterToken,
      });
      apps = res.items ?? [];
    } catch (e) {
      if (e.status === 429) return;
      log(`list apps failed ${drive.id.slice(0, 8)}: ${e.message}`);
      await sleep(BETWEEN_CALL_MS);
      continue;
    }
    await sleep(BETWEEN_CALL_MS);

    const pending = apps.filter((a) => a.status === 'pending');
    if (!pending.length) {
      skipNoPending.add(drive.id);
      continue;
    }
    skipNoPending.delete(drive.id);

    const pick =
      pending.find((a) => a.driver?.id === AARON_USER_ID) ?? pending[0];
    const key = `${drive.id}:${pick.id}`;
    if (!pendingAccept.has(key)) {
      const createdAt = pick.createdAt ? Date.parse(pick.createdAt) : Date.now();
      const age = Number.isFinite(createdAt) ? Date.now() - createdAt : 0;
      const seenAt = Date.now() - Math.min(age, ACCEPT_AFTER_MS);
      pendingAccept.set(key, {
        driveId: drive.id,
        applicationId: pick.id,
        seenAt,
        routeText: drive.routeText,
        posterPhone,
      });
      const waitSec = Math.max(
        0,
        Math.ceil((ACCEPT_AFTER_MS - (Date.now() - seenAt)) / 1000),
      );
      log(
        `saw ${pick.driver?.name ?? 'applicant'} on ${posterName} "${drive.routeText}" — accept in ${waitSec}s`,
      );
    }
  }

  if (skipNoPending.size > 60) skipNoPending.clear();

  const now = Date.now();
  for (const [, job] of pendingAccept) {
    if (job.accepted) continue;
    if (job.posterPhone !== posterPhone) continue;
    if (now - job.seenAt < ACCEPT_AFTER_MS) continue;
    try {
      await api('POST', `/v1/drives/${job.driveId}/accept`, {
        token: posterToken,
        body: { applicationId: job.applicationId },
        idempotency: randomUUID(),
      });
      job.accepted = true;
      skipNoPending.add(job.driveId);
      log(
        `ACCEPTED (${posterName}) "${job.routeText}" app=${job.applicationId.slice(0, 8)}`,
      );
    } catch (e) {
      if (
        e.code === 'not_open' ||
        e.code === 'drive_already_assigned' ||
        e.code === 'already_assigned' ||
        e.status === 409
      ) {
        job.accepted = true;
        log(`accept skip (${e.code ?? e.status}) "${job.routeText}"`);
      } else if (e.status === 429) {
        return;
      } else {
        log(`accept failed "${job.routeText}": ${e.message}`);
        job.seenAt = now - ACCEPT_AFTER_MS + 5_000;
      }
    }
    await sleep(BETWEEN_CALL_MS);
  }
}

async function refreshTokens(state) {
  for (const poster of state.posters) {
    const account = POSTERS.find((p) => p.phone === poster.phone);
    const s = await api('POST', '/v1/auth/login', {
      body: { phone: poster.phone, password: PASS },
    });
    poster.token = s.accessToken;
    if (account) await ensureOnboarded(s, account);
  }
  for (const a of state.applicants ?? []) {
    const account = APPLY_FLEET.find((p) => p.phone === a.phone);
    const s = await api('POST', '/v1/auth/login', {
      body: { phone: a.phone, password: PASS },
    });
    a.token = s.accessToken;
    if (account) await ensureOnboarded(s, account);
  }
  log('refreshed tokens');
}

async function tick(state) {
  if (looping) return;
  if (Date.now() < rateLimitedUntil) return;
  looping = true;
  try {
    await applyToAaronDrives(state.applicants);
    for (const poster of state.posters) {
      await watchPosterAccepts(poster);
      await sleep(BETWEEN_CALL_MS);
    }
  } catch (e) {
    if (e.status === 401) {
      try {
        await refreshTokens(state);
      } catch (re) {
        log('token refresh failed', re.message);
      }
    } else if (e.status !== 429) {
      log('loop error', e.message);
      // Transient network — refresh tokens next cycle
      if (String(e.message).includes('fetch failed')) {
        try {
          await refreshTokens(state);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    looping = false;
  }
}

async function main() {
  log(`API ${API}`);
  log(`accept delay ${ACCEPT_AFTER_MS / 1000}s · poll ${POLL_MS / 1000}s`);

  const posters = [];
  for (const account of POSTERS) {
    const session = await loginOrSignup(account);
    const token = await ensureOnboarded(session, account);
    posters.push({
      name: account.name,
      phone: account.phone,
      userId: session.user.id,
      token,
    });
    log(
      `poster ${account.name} ${account.phone} (${session.user.id.slice(0, 8)}) name=${session.user.name}`,
    );
    await sleep(BETWEEN_CALL_MS);
  }

  const applicants = [];
  for (const account of APPLY_FLEET) {
    // Reuse poster session if same phone (Yanky)
    const existing = posters.find((p) => p.phone === account.phone);
    if (existing) {
      applicants.push({
        ...existing,
        vehicleClass: account.vehicleClass,
        seats: account.seats,
      });
      continue;
    }
    const session = await loginOrSignup(account);
    const token = await ensureOnboarded(session, account);
    applicants.push({
      name: account.name,
      phone: account.phone,
      userId: session.user.id,
      token,
      vehicleClass: account.vehicleClass,
      seats: account.seats,
    });
    log(
      `applicant ${account.name} ${account.phone} (${account.vehicleClass}/${account.seats})`,
    );
    await sleep(BETWEEN_CALL_MS);
  }

  log(
    `applicants on Aaron's jobs: ${applicants.map((a) => `${a.name}:${a.vehicleClass}`).join(', ')}`,
  );

  const state = { posters, applicants };
  await tick(state);
  setInterval(() => tick(state), POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

process.on('uncaughtException', (e) => {
  console.error('[test-bot] uncaughtException', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[test-bot] unhandledRejection', e);
});
