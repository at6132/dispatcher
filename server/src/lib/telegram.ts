import { createHash } from 'node:crypto';

import { env } from '../config/env.js';

export type TelegramAlertInput = {
  /** Short headline shown first */
  title: string;
  /** HTTP / domain code when known */
  code?: string;
  statusCode?: number;
  requestId?: string;
  path?: string;
  method?: string;
  userId?: string;
  /** Extra lines (already redacted) */
  details?: Record<string, unknown>;
  /** Error message / stack (truncated) */
  error?: unknown;
  /** Bypass noise filters / min status (still needs chat ids) */
  force?: boolean;
};

const NOISE_CODES = new Set([
  's3_disabled',
  'rate_limited',
  'unauthorized',
  'invalid_credentials',
  'invalid_body',
  'invalid_refresh',
  'phone_taken',
  'invalid_phone',
  'invalid_password',
  'invalid_name',
]);

/** In-process dedupe so a flapping error doesn’t text-flood. */
const recent = new Map<string, number>();
const DEDUPE_MS = 60_000;

function botToken(): string | undefined {
  return env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_ID || undefined;
}

function chatIds(): string[] {
  return (env.TELEGRAM_CHAT_IDS ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function telegramAlertsEnabled(): boolean {
  return Boolean(botToken() && chatIds().length > 0);
}

export function shouldTelegramAlert(input: {
  statusCode?: number;
  code?: string;
  force?: boolean;
}): boolean {
  if (!telegramAlertsEnabled()) return false;
  if (input.force) return true;
  if (input.code && NOISE_CODES.has(input.code)) return false;
  const min = env.TELEGRAM_ALERT_MIN_STATUS;
  const status = input.statusCode ?? 500;
  return status >= min;
}

function fingerprint(input: TelegramAlertInput): string {
  const raw = [
    input.title,
    input.code ?? '',
    String(input.statusCode ?? ''),
    input.path ?? '',
    String(input.error ?? '').slice(0, 120),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatError(err: unknown): string {
  if (err == null) return '';
  let raw = '';
  if (err instanceof Error) {
    raw = `${err.name}: ${err.message}`;
  } else {
    raw = String(err);
  }
  // Strip common secret/PII patterns before leaving the trust boundary
  raw = raw
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, '[db]')
    .replace(/\bredis:\/\/[^\s]+/gi, '[redis]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/detail:\s*.+$/gim, 'detail:[redacted]');
  return truncate(raw, 280);
}

function buildMessage(input: TelegramAlertInput): string {
  const lines: string[] = [
    `🚨 *Dispatcher*`,
    `*${escapeMd(input.title)}*`,
  ];
  if (input.statusCode != null) lines.push(`status: \`${input.statusCode}\``);
  if (input.code) lines.push(`code: \`${escapeMd(input.code)}\``);
  if (input.method || input.path) {
    lines.push(
      `route: \`${escapeMd([input.method, input.path].filter(Boolean).join(' '))}\``,
    );
  }
  if (input.requestId) lines.push(`requestId: \`${escapeMd(input.requestId)}\``);
  if (input.userId) lines.push(`userId: \`${escapeMd(input.userId)}\``);
  const errText = formatError(input.error);
  if (errText) lines.push(`error: \`${escapeMd(errText)}\``);
  if (input.details && Object.keys(input.details).length) {
    const detailStr = truncate(JSON.stringify(input.details), 600);
    lines.push(`details: \`${escapeMd(detailStr)}\``);
  }
  lines.push(`env: \`${env.NODE_ENV}\``);
  return lines.join('\n');
}

/** Escape for Telegram MarkdownV2-ish (we use Markdown parse_mode). */
function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}

async function sendToChat(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'telegram.send.fail',
        chatId,
        status: res.status,
        body: body.slice(0, 200),
      }),
    );
  }
}

/**
 * Fire-and-forget Telegram alert. Never throws to callers.
 * No-ops until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_IDS are set.
 */
export function notifyTelegram(input: TelegramAlertInput): void {
  void notifyTelegramAsync(input);
}

export async function notifyTelegramAsync(
  input: TelegramAlertInput,
): Promise<void> {
  try {
    if (
      !shouldTelegramAlert({
        statusCode: input.statusCode,
        code: input.code,
        force: input.force,
      })
    ) {
      return;
    }

    const token = botToken();
    const ids = chatIds();
    if (!token || !ids.length) return;

    const fp = fingerprint(input);
    const now = Date.now();
    const last = recent.get(fp) ?? 0;
    if (now - last < DEDUPE_MS) return;
    recent.set(fp, now);
    // prune map occasionally
    if (recent.size > 200) {
      for (const [k, t] of recent) {
        if (now - t > DEDUPE_MS) recent.delete(k);
      }
    }

    const text = buildMessage(input);
    await Promise.allSettled(ids.map((id) => sendToChat(token, id, text)));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'telegram.notify.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Always try to text (boot/fatal) — bypasses min-status, still needs chat ids. */
export function notifyTelegramForce(input: TelegramAlertInput): void {
  void notifyTelegramAsync({
    ...input,
    statusCode: input.statusCode ?? 500,
    force: true,
  });
}
