import { apiFetch } from './client';

/** Fire-and-forget product analytics — never blocks UI. */
export function track(
  name: string,
  props?: Record<string, unknown>,
): void {
  void apiFetch('/v1/analytics/track', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ name, props }),
  }).catch(() => undefined);
}
