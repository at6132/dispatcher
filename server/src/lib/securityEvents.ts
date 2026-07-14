import { db } from '../db/client.js';
import { securityEvents } from '../db/schema.js';
import { notifyTelegramForce } from './telegram.js';

export type SecurityEventInput = {
  kind: string;
  severity?: 'info' | 'warn' | 'critical';
  ip?: string | null;
  userId?: string | null;
  adminChallengeId?: string | null;
  requestId?: string | null;
  detail?: Record<string, unknown>;
  /** Also push a Telegram alert */
  alert?: boolean;
};

export function recordSecurityEvent(input: SecurityEventInput): void {
  void recordSecurityEventAsync(input);
}

export async function recordSecurityEventAsync(
  input: SecurityEventInput,
): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      kind: input.kind.slice(0, 120),
      severity: input.severity ?? 'info',
      ip: input.ip ?? null,
      userId: input.userId ?? null,
      adminChallengeId: input.adminChallengeId ?? null,
      requestId: input.requestId ?? null,
      detailJson: input.detail
        ? JSON.stringify(input.detail).slice(0, 8000)
        : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'security.write.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  if (input.alert || input.severity === 'critical') {
    notifyTelegramForce({
      title: `Security: ${input.kind}`,
      code: input.kind,
      statusCode: input.severity === 'critical' ? 500 : 400,
      requestId: input.requestId ?? undefined,
      details: {
        ip: input.ip,
        ...(input.detail ?? {}),
      },
      force: true,
    });
  }
}
