import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, 'server', '.env'));

export function getTelegramConfig() {
  const token =
    process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_ID || '';
  const chatIds = (
    process.env.TELEGRAM_TUNNEL_CHAT_IDS ||
    process.env.TELEGRAM_CHAT_IDS ||
    ''
  )
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { token, chatIds };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Send HTML Telegram message to configured chats. */
export async function sendTelegramHtml(text) {
  const { token, chatIds } = getTelegramConfig();
  if (!token || chatIds.length === 0) {
    console.warn(
      '[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS missing — skip.',
    );
    return false;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  let ok = 0;
  for (const chatId of chatIds) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        console.warn(
          `[telegram] send failed for ${chatId}:`,
          data.description || res.status,
        );
      } else {
        ok += 1;
      }
    } catch (err) {
      console.warn(`[telegram] send error for ${chatId}:`, err?.message || err);
    }
  }
  if (ok > 0) console.log(`[telegram] Posted to ${ok} chat(s).`);
  return ok > 0;
}

export { root };
