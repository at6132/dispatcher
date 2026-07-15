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
let lastPollAt: string | null = null;
let lastCommandAt: string | null = null;
let lastError: string | null = null;
let pollCount = 0;
let commandCount = 0;

const POLL_LOCK = 'worker:telegram-admin-poll';

export function getTelegramAdminWorkerDebug() {
  return {
    running,
    offset,
    lastPollAt,
    lastCommandAt,
    lastError,
    pollCount,
    commandCount,
    approvedChatCount: getApprovedTelegramChatIds().length,
    hasToken: Boolean(getTelegramBotToken()),
  };
}

/** Process an inbound Telegram command text (shared by poller + webhook). */
export async function handleTelegramAdminCommand(
  chatId: string,
  text: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase().replace(/@\w+$/, '');
  const arg = parts[1]?.toUpperCase();

  log?.info(
    {
      event: 'worker.telegram_admin.inbound',
      chatId,
      cmd,
      hasArg: Boolean(arg),
      text: trimmed.slice(0, 80),
    },
    'worker.telegram_admin.inbound',
  );

  if (cmd === '/allow' || cmd === '/deny') {
    const result = await resolveChallengeByCommand({
      command: cmd === '/allow' ? 'allow' : 'deny',
      shortCode: arg,
      chatId,
    });
    commandCount += 1;
    lastCommandAt = new Date().toISOString();
    await sendTelegramPlain(chatId, result.message.replace(/`/g, ''));
    log?.info(
      {
        event: 'worker.telegram_admin.command',
        cmd,
        chatId,
        ok: result.ok,
        message: result.message.slice(0, 120),
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

  if (cmd === '/adminhelp' || cmd === '/start' || cmd === '/ping') {
    await sendTelegramPlain(
      chatId,
      [
        'Dispatcher admin bot — alive',
        '/allow or /allow CODE — approve pending login',
        '/deny or /deny CODE — deny pending login',
        '/logoutall — revoke all admin sessions',
        '/ping — bot health check',
        '/adminhelp — this help',
      ].join('\n'),
    );
  }
}

async function pollOnce(log?: FastifyBaseLogger): Promise<void> {
  const token = getTelegramBotToken();
  if (!token || getApprovedTelegramChatIds().length === 0) {
    log?.warn(
      {
        event: 'worker.telegram_admin.skip',
        hasToken: Boolean(token),
        chats: getApprovedTelegramChatIds().length,
      },
      'worker.telegram_admin.skip',
    );
    return;
  }

  try {
    const redis = getRedis();
    const got = await redis.set(POLL_LOCK, '1', 'EX', 40, 'NX');
    if (got !== 'OK') {
      log?.debug(
        { event: 'worker.telegram_admin.lock_busy' },
        'worker.telegram_admin.lock_busy',
      );
      return;
    }
  } catch (err) {
    log?.warn(
      {
        event: 'worker.telegram_admin.lock_fail',
        err: err instanceof Error ? err.message : String(err),
      },
      'worker.telegram_admin.lock_fail',
    );
  }

  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', '25');
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('allowed_updates', JSON.stringify(['message']));

  const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
  lastPollAt = new Date().toISOString();
  pollCount += 1;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    lastError = `poll_fail status=${res.status} ${body.slice(0, 160)}`;
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
    description?: string;
  };
  if (!data.ok) {
    lastError = `getUpdates not ok: ${data.description ?? 'unknown'}`;
    log?.warn(
      { event: 'worker.telegram_admin.poll_not_ok', data },
      'worker.telegram_admin.poll_not_ok',
    );
    return;
  }
  if (!data.result?.length) return;

  log?.info(
    {
      event: 'worker.telegram_admin.updates',
      count: data.result.length,
      offset,
    },
    'worker.telegram_admin.updates',
  );

  for (const update of data.result) {
    offset = update.update_id + 1;
    const msg = update.message;
    if (!msg?.text) continue;
    const chatId = String(msg.chat.id);
    if (!isApprovedTelegramChat(chatId)) {
      lastError = `unauthorized chat ${chatId}`;
      log?.warn(
        {
          event: 'worker.telegram_admin.unauthorized_chat',
          chatId,
          text: msg.text.slice(0, 80),
          approved: getApprovedTelegramChatIds(),
        },
        'worker.telegram_admin.unauthorized_chat',
      );
      recordSecurityEvent({
        kind: 'telegram_unauthorized_chat',
        severity: 'warn',
        detail: { chatId, text: msg.text.slice(0, 80) },
      });
      continue;
    }
    try {
      await handleTelegramAdminCommand(chatId, msg.text, log);
      lastError = null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log?.error(
        {
          event: 'worker.telegram_admin.handle_fail',
          err: lastError,
          stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
          chatId,
          text: msg.text.slice(0, 80),
        },
        'worker.telegram_admin.handle_fail',
      );
      await sendTelegramPlain(
        chatId,
        `Admin command failed: ${lastError.slice(0, 180)}. Try again.`,
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
        lastError = err instanceof Error ? err.message : String(err);
        log?.error(
          {
            event: 'worker.telegram_admin.loop_fail',
            err: lastError,
          },
          'worker.telegram_admin.loop_fail',
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  void loop();
  log?.info(
    {
      event: 'worker.telegram_admin.start',
      chats: getApprovedTelegramChatIds().length,
      hasToken: Boolean(getTelegramBotToken()),
    },
    'worker.telegram_admin.start',
  );

  return {
    stop: () => {
      stopped = true;
      running = false;
    },
  };
}
