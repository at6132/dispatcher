import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

/** Last 4 digits only — never full phone in logs. */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `***${digits.slice(-4)}`;
}

export function shortId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const QUIET_PATHS = new Set(['/healthz', '/readyz']);

export function isQuietPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return QUIET_PATHS.has(path);
}

/** Safe summary of a JSON body for debug logs (no secrets / PII). */
export function summarizeBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = k.toLowerCase();
    if (
      key.includes('password') ||
      key.includes('token') ||
      key.includes('secret') ||
      key.includes('authorization') ||
      key === 'zelle' ||
      key === 'passengerphone' ||
      key === 'phone' ||
      key === 'name' ||
      key === 'extrainfo' ||
      key.includes('photo') ||
      key.endsWith('key')
    ) {
      if (key === 'phone' && typeof v === 'string') {
        out[k] = maskPhone(v);
      } else {
        out[k] = v == null || v === '' ? null : '[redacted]';
      }
      continue;
    }
    if (typeof v === 'string') {
      out[k] = v.length > 40 ? `${v.slice(0, 40)}…` : v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `array(${v.length})`;
    } else {
      out[k] = typeof v;
    }
  }
  return out;
}

export type DomainFields = Record<string, unknown>;

export function logDomain(
  log: FastifyBaseLogger,
  event: string,
  fields: DomainFields = {},
): void {
  log.info({ event, ...fields }, event);
}

export function logDomainWarn(
  log: FastifyBaseLogger,
  event: string,
  fields: DomainFields = {},
): void {
  log.warn({ event, ...fields }, event);
}

export function requestContext(request: FastifyRequest): DomainFields {
  return {
    requestId: request.id,
    method: request.method,
    path: (request.url ?? '').split('?')[0],
    userId: shortId(request.user?.id),
    phone: maskPhone(request.user?.phone),
    onboardingComplete: request.user?.onboardingComplete,
    status: request.user?.status,
    ip: request.ip,
  };
}
