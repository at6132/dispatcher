import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { analyticsEvents } from '../db/schema.js';

export type TrackEventInput = {
  name: string;
  userId?: string | null;
  anonymousId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  props?: Record<string, unknown>;
};

/** Fire-and-forget product analytics. Never throws to callers. */
export function trackEvent(input: TrackEventInput): void {
  void trackEventAsync(input);
}

export async function trackEventAsync(input: TrackEventInput): Promise<void> {
  try {
    await db.insert(analyticsEvents).values({
      name: input.name.slice(0, 120),
      userId: input.userId || null,
      anonymousId: input.anonymousId?.slice(0, 128) || null,
      requestId: input.requestId?.slice(0, 80) || null,
      ip: input.ip?.slice(0, 64) || null,
      propsJson: input.props ? JSON.stringify(input.props).slice(0, 8000) : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'analytics.track.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const key = env.POSTHOG_API_KEY;
  if (!key) return;
  try {
    const host = (env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(
      /\/$/,
      '',
    );
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event: input.name,
        distinct_id: input.userId || input.anonymousId || input.ip || 'anon',
        properties: {
          ...(input.props ?? {}),
          $ip: input.ip,
          request_id: input.requestId,
        },
      }),
    });
  } catch {
    // ignore PostHog mirror failures
  }
}
