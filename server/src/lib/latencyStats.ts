/** In-memory per-route latency samples (last ~200). Per-instance only — no Redis/DB. */

const MAX_SAMPLES = 200;

type Ring = {
  buf: Float64Array;
  /** Next write index */
  head: number;
  /** How many samples written (capped at MAX_SAMPLES) */
  size: number;
};

const rings = new Map<string, Ring>();

function getOrCreate(routeKey: string): Ring {
  let ring = rings.get(routeKey);
  if (!ring) {
    ring = { buf: new Float64Array(MAX_SAMPLES), head: 0, size: 0 };
    rings.set(routeKey, ring);
  }
  return ring;
}

function samplesOf(ring: Ring): number[] {
  const out = new Array<number>(ring.size);
  if (ring.size < MAX_SAMPLES) {
    for (let i = 0; i < ring.size; i++) out[i] = ring.buf[i]!;
  } else {
    // Oldest sample is at head (next overwrite)
    for (let i = 0; i < MAX_SAMPLES; i++) {
      out[i] = ring.buf[(ring.head + i) % MAX_SAMPLES]!;
    }
  }
  return out;
}

/** Nearest-rank percentile on a pre-sorted ascending array. */
function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!;
}

export function recordLatency(routeKey: string, ms: number): void {
  if (!routeKey || !Number.isFinite(ms) || ms < 0) return;
  const ring = getOrCreate(routeKey);
  ring.buf[ring.head] = ms;
  ring.head = (ring.head + 1) % MAX_SAMPLES;
  if (ring.size < MAX_SAMPLES) ring.size += 1;
}

export function getP95(routeKey: string): number | null {
  const ring = rings.get(routeKey);
  if (!ring || ring.size === 0) return null;
  const sorted = samplesOf(ring).sort((a, b) => a - b);
  return percentileSorted(sorted, 95);
}

export type RouteLatencySnapshot = {
  routeKey: string;
  n: number;
  p50: number;
  p95: number;
  p99: number;
};

/** Snapshot current windows and clear buffers (for a fresh “last minute” window). */
export function snapshotAndResetLatencyStats(): RouteLatencySnapshot[] {
  const out: RouteLatencySnapshot[] = [];
  for (const [routeKey, ring] of rings) {
    if (ring.size === 0) continue;
    const sorted = samplesOf(ring).sort((a, b) => a - b);
    out.push({
      routeKey,
      n: ring.size,
      p50: percentileSorted(sorted, 50),
      p95: percentileSorted(sorted, 95),
      p99: percentileSorted(sorted, 99),
    });
  }
  rings.clear();
  return out;
}
