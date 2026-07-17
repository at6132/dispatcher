import type { FastifyBaseLogger } from 'fastify';

import { env } from '../config/env.js';
import { snapshotAndResetLatencyStats } from '../lib/latencyStats.js';
import { getRedis } from '../lib/redis.js';
import { notifyTelegram } from '../lib/telegram.js';

const LOCK_KEY = 'worker:latency-alerts';

/**
 * Snapshot+reset local rings every tick. Only the Redis NX lock holder
 * evaluates p95 and texts — avoids N replicas paging for the same window.
 * Non-holders still reset so buffers stay “last ~60s,” not lifetime.
 */
export async function runLatencyAlertsPass(): Promise<number> {
  const snapshot = snapshotAndResetLatencyStats();

  const redis = getRedis();
  const got = await redis.set(LOCK_KEY, '1', 'EX', 55, 'NX');
  if (got !== 'OK') return 0;

  let alerted = 0;
  for (const row of snapshot) {
    if (row.p95 <= env.SLOW_REQUEST_MS) continue;
    const space = row.routeKey.indexOf(' ');
    const method = space > 0 ? row.routeKey.slice(0, space) : undefined;
    const path = space > 0 ? row.routeKey.slice(space + 1) : row.routeKey;
    notifyTelegram({
      title: 'Slow route p95',
      code: 'slow_route_p95',
      method,
      path,
      details: {
        n: row.n,
        p50: Math.round(row.p50),
        p95: Math.round(row.p95),
        p99: Math.round(row.p99),
        thresholdMs: env.SLOW_REQUEST_MS,
      },
    });
    alerted += 1;
  }
  return alerted;
}

export function startLatencyAlertsWorker(
  log?: FastifyBaseLogger,
): NodeJS.Timeout {
  const tick = async () => {
    try {
      const n = await runLatencyAlertsPass();
      if (n > 0) {
        log?.info(
          { event: 'worker.latency_alerts', alerted: n },
          'worker.latency_alerts',
        );
      }
    } catch (err) {
      log?.error(
        { event: 'worker.latency_alerts.fail', err },
        'worker.latency_alerts.fail',
      );
      notifyTelegram({
        title: 'Latency alerts worker failed',
        statusCode: 500,
        code: 'worker_latency_alerts',
        error: err,
      });
      if (!log) {
        // eslint-disable-next-line no-console
        console.error('[worker] latency alerts failed', err);
      }
    }
  };
  // First tick after one full window so boot noise doesn’t page.
  return setInterval(tick, 60_000);
}
