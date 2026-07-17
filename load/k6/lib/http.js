import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, LOAD_TEST_SECRET } from '../config.js';

function headers(token, extra = {}) {
  const h = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
  if (LOAD_TEST_SECRET) {
    h['X-Load-Test'] = LOAD_TEST_SECRET;
  }
  return h;
}

export function idemKey(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function get(path, token, name) {
  return http.get(`${BASE_URL}${path}`, {
    headers: headers(token),
    tags: { name },
  });
}

export function put(path, token, body, name) {
  return http.put(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: headers(token),
    tags: { name },
  });
}

export function post(path, token, body, name, idem) {
  const h = headers(token);
  if (idem) h['Idempotency-Key'] = idem;
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body ?? {}), {
    headers: h,
    tags: { name },
  });
}

/** Treat expected contention / client races as OK for pass rate. */
export function okish(res, allowed = [200, 201]) {
  if (allowed.includes(res.status)) return true;
  // Expected under stampede / duplicate apply
  if (res.status === 409) return true;
  if (res.status === 429) return true;
  return false;
}

export function checkOk(res, label, allowed) {
  return check(res, {
    [label]: (r) => okish(r, allowed),
  });
}

export function parseJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}
