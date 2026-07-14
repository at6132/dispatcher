/**
 * Client-side debug logging.
 * On by default in __DEV__. Also on when EXPO_PUBLIC_DEBUG_LOGS=1
 * (useful for Expo Go / TestFlight chasing prod bugs).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const FORCE =
  process.env.EXPO_PUBLIC_DEBUG_LOGS === '1' ||
  process.env.EXPO_PUBLIC_DEBUG_LOGS === 'true';

const ENABLED = typeof __DEV__ !== 'undefined' ? __DEV__ || FORCE : FORCE;

const REDACT_KEYS = new Set([
  'password',
  'confirmPassword',
  'accessToken',
  'refreshToken',
  'authorization',
  'Authorization',
  'zelle',
  'passengerPhone',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 200) return `${value.slice(0, 200)}…`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k) || /token|password|secret|zelle/i.test(k)) {
      out[k] = v == null || v === '' ? null : '[redacted]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level: Level, scope: string, message: string, fields?: unknown) {
  if (!ENABLED && level !== 'error') return;
  const tag = `[dispatcher:${scope}]`;
  const payload = fields === undefined ? undefined : redact(fields);
  const line = payload === undefined ? `${tag} ${message}` : `${tag} ${message}`;
  // Prefer a single structured object so Metro / Flipper stay readable
  const args =
    payload === undefined ? [line] : [line, payload];
  switch (level) {
    case 'debug':
      console.debug(...args);
      break;
    case 'info':
      console.info(...args);
      break;
    case 'warn':
      console.warn(...args);
      break;
    case 'error':
      console.error(...args);
      break;
  }
}

export const logger = {
  enabled: ENABLED,
  debug: (scope: string, message: string, fields?: unknown) =>
    emit('debug', scope, message, fields),
  info: (scope: string, message: string, fields?: unknown) =>
    emit('info', scope, message, fields),
  warn: (scope: string, message: string, fields?: unknown) =>
    emit('warn', scope, message, fields),
  error: (scope: string, message: string, fields?: unknown) =>
    emit('error', scope, message, fields),
};

export function newRequestId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
