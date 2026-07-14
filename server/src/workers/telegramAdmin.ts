import type { FastifyBaseLogger } from 'fastify';

import {
  getApprovedTelegramChatIds,
  getTelegramBotToken,
  isApprovedTelegramChat,
  sendTelegramPlain,
} from '../lib/telegram.js';
import {
  resolveChallengeByCommand,
  revokeAllAdminSessions,
} from '../services/adminAuth.js';
import { recordSecurityEvent } from '../lib/securityEvents.js';
import { getRedis } from '../lib/redis.js';

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string };
  };
};

let offset = 0;
let running = false;

const POLL_LOCK = 'worker:telegram-admin-poll';

async function handleText(
  chatId: string,
  text: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase().replace(/@\w+$/, '');
  const arg = parts[1]?.toUpperCase();

  if (cmd === '/allow' || cmd === '/deny') {
    const result = await resolveChallengeByCommand({
      command: cmd === '/allow' ? 'allow' : 'deny',
      shortCode: arg,
      chatId,
    });
    await sendTelegramPlain(chatId, result.message.replace(/`/g, ''));
    log?.info(
      {
        event: 'worker.telegram_admin.command',
        cmd,
        chatId,
        ok: result.ok,
      },
      'worker.telegram_admin.command',
    );
    return;
  }

  if (cmd === '/logoutall') {
    const n = await revokeAllAdminSessions();
    recordSecurityEvent({
      kind: 'admin_logout_all_telegram',
      severity: 'warn',
      detail: { chatId, revoked: n },
      alert: true,
    });
    await sendTelegramPlain(chatId, `Revoked ${n} admin session(s).`);
    return;
  }

  if (cmd === '/adminhelp' || cmd === '/start') {
    await sendTelegramPlain(
      chatId,
      [
        'Dispatcher admin bot',
        '/allow or /allow CODE — approve pending login',
        '/deny or /deny CODE — deny pending login',
        '/logoutall — revoke all admin sessions',
        '/adminhelp — this help',
      ].join('\n'),
    );
  }
}

async function pollOnce(log?: FastifyBaseLogger): Promise<void> {
  const token = getTelegramBotToken();
  if (!token || getApprovedTelegramChatIds().length === 0) return;

  // Only one replica / process should long-poll at a time.
  try {
    const redis = getRedis();
    const got = await redis.set(POLL_LOCK, '1', 'EX', 40, 'NX');
    if (got !== 'OK') return;
  } catch {
    // If Redis is down, still try to poll (single replica assumption).
  }

  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', '25');
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('allowed_updates', JSON.stringify(['message']));

  const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log?.warn(
      {
        event: 'worker.telegram_admin.poll_fail',
        status: res.status,
        body: body.slice(0, 200),
      },
      'worker.telegram_admin.poll_fail',
    );
    return;
  }

  const data = (await res.json()) as {
    ok: boolean;
    result?: TgUpdate[];
  };
  if (!data.ok || !data.result?.length) return;

  for (const update of data.result) {
    offset = update.update_id + 1;
    const msg = update.message;
    if (!msg?.text) continue;
    const chatId = String(msg.chat.id);
    if (!isApprovedTelegramChat(chatId)) {
      recordSecurityEvent({
        kind: 'telegram_unauthorized_chat',
        severity: 'warn',
        detail: { chatId, text: msg.text.slice(0, 80) },
      });
      continue;
    }
    try {
      await handleText(chatId, msg.text, log);
    } catch (err) {
      log?.error(
        {
          event: 'worker.telegram_admin.handle_fail',
          err: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.slice(0, 400) : undefined,
          chatId,
          text: msg.text.slice(0, 80),
        },
        'worker.telegram_admin.handle_fail',
      );
      await sendTelegramPlain(
        chatId,
        'Admin command failed on the server. Try again in a moment.',
      );
    }
  }
}

export function startTelegramAdminWorker(
  log?: FastifyBaseLogger,
): { stop: () => void } {
  if (running) return { stop: () => undefined };
  running = true;
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await pollOnce(log);
      } catch (err) {
        log?.error(
          {
            event: 'worker.telegram_admin.loop_fail',
            err: err instanceof Error ? err.message : String(err),
          },
          'worker.telegram_admin.loop_fail',
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  void loop();
  log?.info({ event: 'worker.telegram_admin.start' }, 'worker.telegram_admin.start');

  return {
    stop: () => {
      stopped = true;
      running = false;
    },
  };
}
