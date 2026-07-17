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

/** Codes that should text even on 2xx (latency), still subject to noise + dedupe. */
const LATENCY_ALERT_CODES = new Set(['slow_request', 'slow_route_p95']);

export function shouldTelegramAlert(input: {
  statusCode?: number;
  code?: string;
  force?: boolean;
}): boolean {
  if (!telegramAlertsEnabled()) return false;
  if (input.force) return true;
  if (input.code && NOISE_CODES.has(input.code)) return false;
  if (input.code && LATENCY_ALERT_CODES.has(input.code)) return true;
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
    formatError(input.error).slice(0, 160),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function redactSecrets(raw: string): string {
  return raw
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '[email]')
    // Mask phones; keep pure floats (e.g. 0.0999… from JS) so PG errors stay readable.
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (match) =>
      /^\d+\.\d+$/.test(match) ? match : '[phone]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, '[db]')
    .replace(/\bredis:\/\/[^\s]+/gi, '[redis]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    // PG "DETAIL:" often embeds row values — keep the label, drop the rest of the line
    .replace(/\bDETAIL:\s*.+$/gim, 'DETAIL:[redacted]');
}

/** Pull a useful ops string from Error / pg / plain objects (message + stack + cause). */
export function formatError(err: unknown): string {
  if (err == null) return '';

  const parts: string[] = [];
  const seen = new Set<unknown>();

  const walk = (value: unknown, depth: number) => {
    if (value == null || depth > 4 || seen.has(value)) return;
    if (typeof value === 'object') seen.add(value);

    if (value instanceof Error) {
      parts.push(`${value.name}: ${value.message}`);
      const extra = value as Error & {
        code?: string;
        severity?: string;
        constraint?: string;
        table?: string;
        column?: string;
        detail?: string;
        routine?: string;
      };
      const meta = [
        extra.code ? `code=${extra.code}` : '',
        extra.severity ? `severity=${extra.severity}` : '',
        extra.table ? `table=${extra.table}` : '',
        extra.column ? `column=${extra.column}` : '',
        extra.constraint ? `constraint=${extra.constraint}` : '',
        extra.routine ? `routine=${extra.routine}` : '',
      ].filter(Boolean);
      if (meta.length) parts.push(meta.join(' '));
      // Avoid leaking row-level DETAIL; code/table/constraint above is enough
      if (value.stack) {
        parts.push(truncate(value.stack, 1600));
      }
      if (value.cause) walk(value.cause, depth + 1);
      return;
    }

    if (typeof value === 'string') {
      parts.push(value);
      return;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        const name = typeof obj.name === 'string' ? obj.name : 'Error';
        parts.push(`${name}: ${obj.message}`);
      }
      if (typeof obj.code === 'string' || typeof obj.code === 'number') {
        parts.push(`code=${String(obj.code)}`);
      }
      if (typeof obj.stack === 'string') {
        parts.push(truncate(obj.stack, 1600));
      }
      if (obj.cause) walk(obj.cause, depth + 1);
      if (parts.length === 0) {
        try {
          parts.push(truncate(JSON.stringify(obj), 800));
        } catch {
          parts.push(String(obj));
        }
      }
      return;
    }

    parts.push(String(value));
  };

  walk(err, 0);
  return truncate(redactSecrets(parts.filter(Boolean).join('\n')), 2800);
}

function buildMessage(input: TelegramAlertInput): string {
  // Plain text — stacks / pg errors break Markdown parse_mode too often.
  const lines: string[] = ['🚨 Dispatcher', input.title];
  if (input.statusCode != null) lines.push(`status: ${input.statusCode}`);
  if (input.code) lines.push(`code: ${input.code}`);
  if (input.method || input.path) {
    lines.push(
      `route: ${[input.method, input.path].filter(Boolean).join(' ')}`,
    );
  }
  if (input.requestId) lines.push(`requestId: ${input.requestId}`);
  if (input.userId) lines.push(`userId: ${input.userId}`);
  const errText = formatError(input.error);
  if (errText) {
    lines.push('error:');
    lines.push(errText);
  }
  if (input.details && Object.keys(input.details).length) {
    const detailStr = truncate(JSON.stringify(input.details), 600);
    lines.push(`details: ${detailStr}`);
  }
  lines.push(`env: ${env.NODE_ENV}`);
  return truncate(lines.join('\n'), 3900);
}

async function sendToChat(
  token: string,
  chatId: string,
  text: string,
  opts?: { parseMode?: 'Markdown' },
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
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

async function sendToChatPlain(
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

/** Send Markdown text to all approved chats. Never throws. */
export async function sendTelegramRaw(text: string): Promise<void> {
  try {
    const token = botToken();
    const ids = chatIds();
    if (!token || !ids.length) return;
    await Promise.allSettled(
      ids.map((id) => sendToChat(token, id, text, { parseMode: 'Markdown' })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'telegram.raw.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Plain-text reply to one chat (no Markdown parse risks). Never throws. */
export async function sendTelegramPlain(
  chatId: string,
  text: string,
): Promise<void> {
  try {
    const token = botToken();
    if (!token) return;
    await sendToChatPlain(token, chatId, text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: 'telegram.plain.fail',
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export function getTelegramBotToken(): string | undefined {
  return botToken();
}

export function getApprovedTelegramChatIds(): string[] {
  return chatIds();
}

export function isApprovedTelegramChat(chatId: string | number): boolean {
  const id = String(chatId);
  return chatIds().includes(id);
}
