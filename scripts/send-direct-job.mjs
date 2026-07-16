/**
 * Send Aaron a direct job offer (popup on Home).
 *
 * Requires the API build with status=offers + accept/decline-invite.
 *
 * Usage:
 *   node scripts/send-direct-job.mjs
 *   INVITE_USER_ID=<uuid> node scripts/send-direct-job.mjs
 */
import { randomUUID } from 'node:crypto';

const API =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://dispatcher-production-31d1.up.railway.app';
const PASS = process.env.TEST_BOT_PASSWORD ?? 'Testpass1';
/** Aaron Weinstein — override with INVITE_USER_ID if account changes */
const TARGET_USER_ID =
  process.env.INVITE_USER_ID ?? '0333e606-ad27-4444-804f-18f611df11ee';

const POSTER = {
  name: 'Yanky',
  phone: '+15551110211',
  vehicleClass: 'large_suv',
  vehicleType: 'Escalade',
  seats: 10,
  yearsDrivingUpstate: 6,
};

function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[send-direct ${t}]`, ...args);
}

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
    throw new Error(
      `${method} ${path} → ${res.status} ${data?.error?.code ?? data?.code ?? ''} ${data?.error?.message ?? data?.message ?? text}`,
    );
  }
  return data;
}

async function loginOrSignup(account) {
  try {
    return await api('POST', '/v1/auth/login', {
      body: { phone: account.phone, password: PASS },
    });
  } catch (e) {
    if (!String(e.message).includes('401') && !String(e.message).includes('invalid')) {
      // try signup anyway
    }
    return api('POST', '/v1/auth/signup', {
      body: {
        name: account.name,
        phone: account.phone,
        password: PASS,
      },
    });
  }
}

async function ensureOnboarded(session, account) {
  if (session.user?.onboardingComplete) return session.accessToken;
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

async function main() {
  log(`API ${API}`);
  log(`Target invitee ${TARGET_USER_ID}`);

  const session = await loginOrSignup(POSTER);
  const token = await ensureOnboarded(session, POSTER);
  log(`Poster ready: ${POSTER.name}`);

  const routeText = `Bot direct · Monticello → Brooklyn ${new Date()
    .toISOString()
    .slice(11, 16)}`;

  try {
    const { drive } = await api('POST', '/v1/drives', {
      token,
      idempotency: randomUUID(),
      body: {
        routeText,
        passengerPhone: '+15559876001',
        vehicleClass: 'suv',
        seats: 7,
        tripType: 'one_way',
        address: '12 Main St, Monticello NY',
        extraInfo: 'Direct offer from the bot — accept or decline in the app.',
        inviteDriverId: TARGET_USER_ID,
      },
    });
    log(`Offer created ${drive.id}`);
    log(`status=${drive.status} invitedDriverId=${drive.invitedDriverId ?? '∅'}`);
    if (drive.status === 'assigned' && !drive.invitedDriverId) {
      log(
        'WARN: API still does immediate-assign (old build). Redeploy server for the popup flow.',
      );
    } else {
      log('Open the app on Home — solid “Direct job” box should appear.');
    }
  } catch (e) {
    log(`FAILED: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
