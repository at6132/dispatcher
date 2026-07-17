/**
 * Smaller smoke run — 50 drivers + 10 dispatchers for ~5 minutes.
 * Usage: k6 run smoke.js
 */
import { SharedArray } from 'k6/data';
import { sleep } from 'k6';

import { THRESHOLDS } from './config.js';
import { checkOk, get, post, put, idemKey } from './lib/http.js';

const drivers = new SharedArray('drivers', () =>
  JSON.parse(open('../tokens/drivers.json')),
);
const dispatchers = new SharedArray('dispatchers', () =>
  JSON.parse(open('../tokens/dispatchers.json')),
);

export const options = {
  scenarios: {
    drivers: {
      executor: 'constant-vus',
      exec: 'driver',
      vus: 50,
      duration: '5m',
    },
    dispatchers: {
      executor: 'constant-vus',
      exec: 'dispatcher',
      vus: 10,
      duration: '5m',
      startTime: '15s',
    },
  },
  thresholds: {
    ...THRESHOLDS,
    http_req_failed: ['rate<0.05'],
  },
};

export function driver() {
  const u = drivers[(__VU - 1) % drivers.length];
  checkOk(get('/v1/drives?status=offers&limit=10', u.token, 'board_offers'), 'offers', [200]);
  if (__ITER % 3 === 0) {
    checkOk(get('/v1/drives?status=open&limit=50', u.token, 'board_open'), 'open', [200]);
  }
  if (__ITER % 5 === 0) {
    checkOk(
      put('/v1/me/presence', u.token, { availability: 'available', lat: 41.7, lng: -74.7 }, 'presence'),
      'presence',
      [200, 429],
    );
  }
  sleep(8);
}

export function dispatcher() {
  const u = dispatchers[(__VU - 1) % dispatchers.length];
  checkOk(
    post(
      '/v1/drives',
      u.token,
      {
        routeText: 'Monticello → Brooklyn',
        passengerPhone: '+15559876543',
        vehicleClass: 'sedan',
        seats: 4,
        tripType: 'one_way',
      },
      'drive_create',
      idemKey('smoke-create'),
    ),
    'create',
    [201, 429],
  );
  sleep(60);
}
