import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export type AuditInput = {
  actorType: 'admin' | 'system' | 'user';
  actorId?: string | null;
  sessionId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

export function writeAudit(input: AuditInput): void {
  void writeAuditAsync(input);
}

export async function writeAuditAsync(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      sessionId: input.sessionId ?? null,
      action: input.action.slice(0, 160),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      beforeJson: input.before != null ? JSON.stringify(input.before).slice(0, 12000) : null,
      afterJson: input.after != null ? JSON.stringify(input.after).slice(0, 12000) : null,
      metaJson: input.meta ? JSON.stringify(input.meta).slice(0, 8000) : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'audit.write.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
