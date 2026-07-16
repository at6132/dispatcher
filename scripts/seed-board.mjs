/**
 * Seed the board for Aaron on the live Railway API:
 * - 1 direct job offer (popup Accept/Decline)
 * - 3 open jobs that get an applicant ASAP and auto-accept after 4s
 * - Apply to any open Aaron job within ~4s
 *
 * Usage: node scripts/seed-board.mjs
 */
import { randomUUID } from 'node:crypto';

const API =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://dispatcher-production-31d1.up.railway.app';
const PASS = process.env.TEST_BOT_PASSWORD ?? 'Testpass1';
/**
 * Invitee: Aaron Weinstein (re-signed up after zombie-auth clear).
 * Override with INVITE_USER_ID=… if the logged-in account changes again.
 * Old seed target was 1b35d5a2… (“Aaron” / +15559876042) — stale.
 */
const AARON_USER_ID =
  process.env.INVITE_USER_ID ?? '0333e606-ad27-4444-804f-18f611df11ee';

const ACCEPT_AFTER_MS = 4_000;
const APPLY_POLL_MS = 1_500;
const BETWEEN_CALL_MS = 350;

const POSTER = {
  name: 'Yanky',
  phone: '+15551110211',
  vehicleClass: 'large_suv',
  vehicleType: 'Escalade',
  seats: 10,
  yearsDrivingUpstate: 6,
};

const APPLICANTS = [
  {
    name: 'Test Driver',
    phone: '+15551110202',
    vehicleClass: 'large_suv',
    vehicleType: 'Suburban',
    seats: 10,
    yearsDrivingUpstate: 5,
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
];

const JOBS = [
  {
    routeText: 'Seed · Monticello → Brooklyn',
    vehicleClass: 'large_suv',
    seats: 7,
    tripType: 'one_way',
    passengerPhone: '+15559876101',
    address: '12 Main St, Monticello NY',
  },
  {
    routeText: 'Seed · South Fallsburg → Crown Heights',
    vehicleClass: 'sedan',
    seats: 3,
    tripType: 'round_trip',
    passengerPhone: '+15559876102',
    address: '88 Maple Ave, South Fallsburg NY',
  },
  {
    routeText: 'Seed · Woodbourne → Flatbush',
    vehicleClass: 'minivan',
    seats: 6,
    tripType: 'one_way',
    passengerPhone: '+15559876103',
    address: '4 Firehouse Rd, Woodbourne NY',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[seed-board ${t}]`, ...args);
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
    const err = new Error(
      `${method} ${path} → ${res.status} ${data?.error?.code ?? ''} ${data?.error?.message ?? text}`,
    );
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

async function loginOrSignup(account) {
  try {
    return await api('POST', '/v1/auth/login', {
      body: { phone: account.phone, password: PASS },
    });
  } catch {
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
  if (
    session.user?.onboardingComplete &&
    session.user?.onboarding?.vehicleClass === account.vehicleClass
  ) {
    return { token: session.accessToken, userId: session.user.id };
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
  return { token: session.accessToken, userId: session.user.id };
}

async function boot(account) {
  const session = await loginOrSignup(account);
  return ensureOnboarded(session, account);
}

/**
 * Prefer INVITE_USER_ID; otherwise pick the newest "Aaron Weinstein" / "Aaron"
 * profile so re-signups don't silently target a stale UUID.
 */
async function resolveInvitee(token) {
  if (process.env.INVITE_USER_ID) return process.env.INVITE_USER_ID;
  try {
    const { items } = await api('GET', '/v1/profiles?limit=50', { token });
    const aarons = (items ?? []).filter((p) =>
      /^aaron(\s|$)/i.test(String(p.name ?? '')),
    );
    aarons.sort((a, b) => {
      // Prefer full "Aaron Weinstein" over bare "Aaron"
      const score = (n) => (/weinstein/i.test(n) ? 2 : 1);
      return score(b.name) - score(a.name);
    });
    if (aarons[0]?.id) {
      log(`resolved invitee ${aarons[0].name} → ${aarons[0].id}`);
      return aarons[0].id;
    }
  } catch (e) {
    log(`invitee lookup failed: ${e.message}`);
  }
  return AARON_USER_ID;
}

async function main() {
  log(`API ${API}`);

  const poster = await boot(POSTER);
  log(`poster Yanky ready`);

  const inviteeId = await resolveInvitee(poster.token);
  log(`Aaron invitee ${inviteeId}`);

  const fleet = [];
  for (const account of APPLICANTS) {
    if (account.phone === POSTER.phone) {
      fleet.push({ ...account, ...poster });
      continue;
    }
    const s = await boot(account);
    fleet.push({ ...account, ...s });
    log(`applicant ${account.name} (${account.vehicleClass})`);
    await sleep(BETWEEN_CALL_MS);
  }

  // 1) Direct offer to Aaron (popup — no vehicle-class filter on offers)
  const { drive: offer } = await api('POST', '/v1/drives', {
    token: poster.token,
    idempotency: randomUUID(),
    body: {
      routeText: `Direct · Catskills → Boro Park ${new Date()
        .toISOString()
        .slice(11, 16)}`,
      passengerPhone: '+15559876099',
      vehicleClass: 'suv',
      seats: 7,
      tripType: 'one_way',
      address: '1 Lake St, Liberty NY',
      extraInfo: 'Direct bot offer — Accept or Decline on Home.',
      inviteDriverId: inviteeId,
    },
  });
  log(
    `direct offer ${offer.id} status=${offer.status} invited=${offer.invitedDriverId ?? '∅'}`,
  );

  // Stay-open job matching Aaron Weinstein (suv/7) so Open board has something
  const { drive: openForAaron } = await api('POST', '/v1/drives', {
    token: poster.token,
    idempotency: randomUUID(),
    body: {
      routeText: 'Seed · Liberty → Williamsburg (open for you)',
      vehicleClass: 'suv',
      seats: 6,
      tripType: 'one_way',
      passengerPhone: '+15559876104',
      address: '22 Chestnut St, Liberty NY',
      extraInfo: 'Left open on the board — apply if you want.',
    },
  });
  log(`left open ${openForAaron.id} (suv) for Aaron Open board`);

  // 2) Post 3 open jobs that get applicants + auto-accept (Active for assignees)
  /** @type {{ id: string, vehicleClass: string, postedAt: number, accepted?: boolean }[]} */
  const posted = [];
  for (const job of JOBS) {
    const { drive } = await api('POST', '/v1/drives', {
      token: poster.token,
      idempotency: randomUUID(),
      body: {
        ...job,
        extraInfo: 'Seed board job — applicant within 4s, accept at 4s.',
      },
    });
    posted.push({
      id: drive.id,
      vehicleClass: job.vehicleClass,
      postedAt: Date.now(),
    });
    log(`posted open ${drive.id} (${job.vehicleClass}) ${job.routeText}`);
    await sleep(BETWEEN_CALL_MS);
  }

  const applied = new Set();
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    // Apply to any matching open Aaron/Yanky jobs ASAP
    for (const applicant of fleet) {
      try {
        const { items } = await api('GET', '/v1/drives?status=open&limit=50', {
          token: applicant.token,
        });
        for (const d of items ?? []) {
          if (d.posterId === applicant.userId) continue;
          if (d.invitedDriverId) continue;
          if (d.status !== 'open') continue;
          const key = `${d.id}:${applicant.userId}`;
          if (applied.has(key)) continue;
          if (
            d.vehicleClass &&
            d.vehicleClass !== applicant.vehicleClass
          ) {
            continue;
          }
          if (d.seats != null && d.seats > applicant.seats) continue;
          try {
            await api('POST', `/v1/drives/${d.id}/applications`, {
              token: applicant.token,
              idempotency: randomUUID(),
              body: { lat: 41.655, lng: -74.689 },
            });
            applied.add(key);
            log(`applied ${applicant.name} → ${d.routeText}`);
          } catch (e) {
            if (e.status === 409) applied.add(key);
            else log(`apply fail ${applicant.name}: ${e.message}`);
          }
          await sleep(BETWEEN_CALL_MS);
        }
      } catch (e) {
        log(`list fail ${applicant.name}: ${e.message}`);
      }
    }

    // Accept after 4s on our three seed posts
    for (const job of posted) {
      if (job.accepted) continue;
      if (Date.now() - job.postedAt < ACCEPT_AFTER_MS) continue;
      try {
        const { items } = await api(
          'GET',
          `/v1/drives/${job.id}/applications`,
          { token: poster.token },
        );
        const pending = (items ?? []).find((a) => a.status === 'pending');
        if (!pending) {
          log(`waiting for applicant on ${job.id.slice(0, 8)}`);
          continue;
        }
        await api('POST', `/v1/drives/${job.id}/accept`, {
          token: poster.token,
          idempotency: randomUUID(),
          body: { applicationId: pending.id },
        });
        job.accepted = true;
        log(`accepted ${pending.driver?.name ?? pending.id} on ${job.id.slice(0, 8)}`);
      } catch (e) {
        log(`accept fail ${job.id.slice(0, 8)}: ${e.message}`);
      }
      await sleep(BETWEEN_CALL_MS);
    }

    if (posted.every((j) => j.accepted)) {
      log('all 3 seed jobs accepted');
      break;
    }
    await sleep(APPLY_POLL_MS);
  }

  log(
    'done — open Home as Aaron Weinstein for the direct offer popup + Open board',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
