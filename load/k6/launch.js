import { SharedArray } from 'k6/data';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

import {
  BASE_URL,
  DISPATCHER_VUS,
  DRIVER_VUS,
  LOAD_TEST_SECRET,
  ROUTES,
  THRESHOLDS,
} from './config.js';
import {
  checkOk,
  get,
  idemKey,
  parseJson,
  post,
  put,
} from './lib/http.js';

const boardOpenTrend = new Trend('board_open_ms', true);
const offersTrend = new Trend('offers_ms', true);
const createTrend = new Trend('drive_create_ms', true);
const applyTrend = new Trend('drive_apply_ms', true);
const acceptTrend = new Trend('drive_accept_ms', true);
const createsOk = new Counter('drives_created');
const appliesOk = new Counter('drives_applied');
const acceptsOk = new Counter('drives_accepted');

const drivers = new SharedArray('drivers', () => {
  return JSON.parse(open('../tokens/drivers.json'));
});

const dispatchers = new SharedArray('dispatchers', () => {
  return JSON.parse(open('../tokens/dispatchers.json'));
});

export const options = {
  scenarios: {
    // Idle drivers on Home — offer poll every 8s + board reads + presence
    drivers_home: {
      executor: 'ramping-vus',
      exec: 'driverHome',
      startVUs: 0,
      stages: [
        { duration: '2m', target: Math.min(500, DRIVER_VUS) },
        { duration: '3m', target: Math.min(1000, DRIVER_VUS) },
        { duration: '5m', target: DRIVER_VUS },
        { duration: '20m', target: DRIVER_VUS },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      tags: { role: 'driver' },
    },
    // Dispatchers posting rides and accepting applicants
    dispatchers_post: {
      executor: 'ramping-vus',
      exec: 'dispatcherLoop',
      startVUs: 0,
      startTime: '1m',
      stages: [
        { duration: '2m', target: Math.min(100, DISPATCHER_VUS) },
        { duration: '3m', target: Math.min(250, DISPATCHER_VUS) },
        { duration: '4m', target: DISPATCHER_VUS },
        { duration: '18m', target: DISPATCHER_VUS },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      tags: { role: 'dispatcher' },
    },
  },
  thresholds: THRESHOLDS,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function pickDriver() {
  const i = (__VU - 1) % drivers.length;
  return drivers[i];
}

function pickDispatcher() {
  const i = (__VU - 1) % dispatchers.length;
  return dispatchers[i];
}

function catskillsLatLng() {
  // Rough Catskills / upstate jitter
  return {
    lat: 41.65 + Math.random() * 0.35,
    lng: -74.85 + Math.random() * 0.4,
  };
}

/**
 * Matches real HomeScreen behavior:
 * - offers every ~8s
 * - open board every ~20–40s
 * - active/history occasionally
 * - presence every ~45–90s when available
 */
export function driverHome() {
  const user = pickDriver();
  const token = user.token;

  // Cold open — three boards like app mount
  if (__ITER === 0) {
    const open = get('/v1/drives?status=open&limit=50', token, 'board_open');
    boardOpenTrend.add(open.timings.duration);
    checkOk(open, 'driver cold open board', [200]);

    checkOk(
      get('/v1/drives?status=active&limit=50', token, 'board_active'),
      'driver cold active board',
      [200],
    );
    checkOk(
      get('/v1/drives?status=history&limit=50', token, 'board_history'),
      'driver cold history board',
      [200],
    );

    const presence = put(
      '/v1/me/presence',
      token,
      { availability: 'available', ...catskillsLatLng() },
      'presence',
    );
    checkOk(presence, 'driver set available', [200]);
  }

  // Offer poll (every iteration ≈ 8s sleep at end)
  const offers = get('/v1/drives?status=offers&limit=10', token, 'board_offers');
  offersTrend.add(offers.timings.duration);
  checkOk(offers, 'driver offers poll', [200]);

  // Board refresh ~every 3rd iteration (~24s)
  if (__ITER % 3 === 1) {
    const open = get('/v1/drives?status=open&limit=50', token, 'board_open');
    boardOpenTrend.add(open.timings.duration);
    checkOk(open, 'driver open board', [200]);

    const body = parseJson(open);
    const items = body && body.items ? body.items : [];
    // ~15% of board refreshes try to apply (stampede pressure)
    if (items.length > 0 && Math.random() < 0.15) {
      const drive = items[Math.floor(Math.random() * Math.min(items.length, 10))];
      const apply = post(
        `/v1/drives/${drive.id}/applications`,
        token,
        catskillsLatLng(),
        'drive_apply',
        idemKey('apply'),
      );
      applyTrend.add(apply.timings.duration);
      if (checkOk(apply, 'driver apply', [201, 409, 429])) {
        if (apply.status === 201) appliesOk.add(1);
      }
    }
  }

  // Presence heartbeat ~every 6th iteration (~48s)
  if (__ITER % 6 === 0) {
    const presence = put(
      '/v1/me/presence',
      token,
      { ...catskillsLatLng() },
      'presence',
    );
    checkOk(presence, 'driver presence', [200, 429]);
  }

  // Occasional active/history
  if (__ITER % 8 === 0) {
    checkOk(
      get('/v1/drives?status=active&limit=50', token, 'board_active'),
      'driver active board',
      [200],
    );
  }
  if (__ITER % 12 === 0) {
    checkOk(
      get('/v1/drives?status=history&limit=50', token, 'board_history'),
      'driver history board',
      [200],
    );
  }

  sleep(8);
}

/**
 * Dispatcher posts a ride, waits for applicants, accepts one.
 * Create rate capped at 30/user/hour → ~one post every 2.5–4 min.
 */
export function dispatcherLoop() {
  const user = pickDispatcher();
  const token = user.token;
  const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];

  const create = post(
    '/v1/drives',
    token,
    {
      routeText: route,
      passengerPhone: `+1555987${String(1000 + (__VU % 8000)).padStart(4, '0')}`,
      vehicleClass: 'sedan',
      seats: 4,
      tripType: Math.random() < 0.3 ? 'round_trip' : 'one_way',
      fromPlace: route.split('→')[0]?.trim(),
      toPlace: route.split('→')[1]?.trim(),
      extraInfo: 'load-test ride',
    },
    'drive_create',
    idemKey('create'),
  );
  createTrend.add(create.timings.duration);

  if (!checkOk(create, 'dispatcher create', [201, 429])) {
    sleep(30);
    return;
  }
  if (create.status !== 201) {
    sleep(45 + Math.random() * 30);
    return;
  }
  createsOk.add(1);

  const created = parseJson(create);
  const driveId = created && created.drive ? created.drive.id : null;
  if (!driveId) {
    sleep(60);
    return;
  }

  // Wait for drivers to see + apply
  sleep(20 + Math.random() * 25);

  const apps = get(
    `/v1/drives/${driveId}/applications`,
    token,
    'drive_applications',
  );
  checkOk(apps, 'dispatcher list apps', [200]);
  const appsBody = parseJson(apps);
  const pending =
    appsBody && appsBody.items
      ? appsBody.items.filter((a) => a.status === 'pending')
      : [];

  if (pending.length > 0) {
    const pick = pending[0];
    const accept = post(
      `/v1/drives/${driveId}/accept`,
      token,
      { applicationId: pick.id },
      'drive_accept',
      idemKey('accept'),
    );
    acceptTrend.add(accept.timings.duration);
    if (checkOk(accept, 'dispatcher accept', [200, 409, 429])) {
      if (accept.status === 200) acceptsOk.add(1);
    }
  }

  // Also refresh own boards (posters stay on Home)
  checkOk(
    get('/v1/drives?status=open&limit=50', token, 'board_open'),
    'dispatcher open board',
    [200],
  );
  checkOk(
    get('/v1/drives?status=offers&limit=10', token, 'board_offers'),
    'dispatcher offers',
    [200],
  );

  // Stay under 30 creates/user/hour
  sleep(150 + Math.random() * 90);
}

export function setup() {
  if (!LOAD_TEST_SECRET) {
    console.warn(
      'WARNING: LOAD_TEST_BYPASS_SECRET unset — IP rate limits will crush this run from one machine.',
    );
  }
  if (drivers.length < DRIVER_VUS) {
    throw new Error(
      `Need ${DRIVER_VUS} driver tokens, have ${drivers.length}. Run seed-load-users.ts`,
    );
  }
  if (dispatchers.length < DISPATCHER_VUS) {
    throw new Error(
      `Need ${DISPATCHER_VUS} dispatcher tokens, have ${dispatchers.length}. Run seed-load-users.ts`,
    );
  }
  const bare = get('/healthz', drivers[0].token, 'healthz');
  console.log(
    `Target ${BASE_URL} health=${bare.status} tokens drivers=${drivers.length} dispatchers=${dispatchers.length}`,
  );
  return { startedAt: new Date().toISOString() };
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    '../reports/summary.json': JSON.stringify(data),
  };
}
