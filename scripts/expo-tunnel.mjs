/**
 * Start Expo with --tunnel and post the public link to Telegram.
 *
 * Env (root .env and/or server/.env):
 *   TELEGRAM_BOT_TOKEN   — BotFather token
 *   TELEGRAM_CHAT_IDS    — comma-separated chat/channel IDs (alerts + tunnel)
 *   TELEGRAM_TUNNEL_CHAT_IDS — optional override; only these get tunnel links
 *
 * Usage: npm run tunnel
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const METRO = process.env.EXPO_METRO_URL || 'http://127.0.0.1:8081';
const POLL_MS = 1500;
const POLL_MAX_MS = 120_000;

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

/** Prefer public tunnel URLs over LAN. */
const URL_RE =
  /(exp:\/\/[^\s"'<>]+|(?:https?:\/\/)?(?:u\.expo\.dev|[\w-]+\.exp\.direct)(?::\d+)?[^\s"'<>]*)/gi;

function scoreUrl(url) {
  const u = url.toLowerCase();
  if (u.includes('exp.direct') || u.includes('u.expo.dev')) return 3;
  if (u.startsWith('exp://')) return 2;
  return 1;
}

function normalizeUrl(raw) {
  let u = String(raw).replace(/[),.;]+$/, '');
  // Strip path/query from host URLs → Expo Go wants the project root
  try {
    if (/^https?:\/\//i.test(u) || u.includes('.exp.direct')) {
      if (!/^https?:\/\//i.test(u) && !u.startsWith('exp://')) {
        u = `https://${u}`;
      }
      if (!u.startsWith('exp://')) {
        const parsed = new URL(u);
        if (parsed.hostname.endsWith('.exp.direct')) {
          return `exp://${parsed.hostname}:80`;
        }
      }
    }
  } catch {
    /* keep raw */
  }
  return u;
}

function extractTunnelFromText(text) {
  const matches = String(text).match(URL_RE);
  if (!matches) return null;
  let best = null;
  for (const m of matches) {
    const url = normalizeUrl(m);
    if (!best || scoreUrl(url) > scoreUrl(best)) best = url;
  }
  return best;
}

async function fetchTunnelFromMetro() {
  try {
    const res = await fetch(METRO, {
      headers: { Accept: 'application/json', 'expo-platform': 'ios' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    // Manifest JSON embeds http://….exp.direct/…
    const fromText = extractTunnelFromText(body);
    if (fromText) return fromText;
    try {
      const json = JSON.parse(body);
      const assetUrl = json?.launchAsset?.url;
      if (assetUrl) return normalizeUrl(assetUrl);
    } catch {
      /* not json */
    }
  } catch {
    /* metro not ready */
  }
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Telegram only auto-linkifies http(s); map exp://host → https for tapping. */
function httpsUrlFromExpo(url) {
  const m = String(url).match(
    /^(?:exp:\/\/|https?:\/\/)?([\w.-]+\.exp\.direct|u\.expo\.dev[\w./-]*)(?::\d+)?/i,
  );
  if (!m) {
    if (/^https?:\/\//i.test(url)) return url;
    return null;
  }
  const hostOrPath = m[1];
  if (hostOrPath.startsWith('u.expo.dev')) {
    return `https://${hostOrPath.replace(/\/$/, '')}`;
  }
  return `https://${hostOrPath}`;
}

function buildTelegramMessage(expoUrl) {
  const who = escapeHtml(process.env.USERNAME || process.env.USER || 'dev');
  const https = httpsUrlFromExpo(expoUrl);
  const exp = expoUrl.startsWith('exp://')
    ? expoUrl
    : https
      ? `exp://${new URL(https).hostname}:80`
      : expoUrl;

  // https is clickable in TG; also wrap as HTML anchor for reliable link entity
  const linkLine = https
    ? `<a href="${escapeHtml(https)}">${escapeHtml(https)}</a>`
    : escapeHtml(exp);

  return [
    '🚇 <b>Expo tunnel ready</b>',
    '',
    linkLine,
    '',
    `Open in Expo Go · started by ${who}`,
  ].join('\n');
}

async function sendTelegram(text) {
  if (!token || chatIds.length === 0) {
    console.warn(
      '[tunnel-notify] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS missing — skipping Telegram.',
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
          `[tunnel-notify] Telegram send failed for chat ${chatId}:`,
          data.description || res.status,
        );
      } else {
        ok += 1;
      }
    } catch (err) {
      console.warn(
        `[tunnel-notify] Telegram send error for chat ${chatId}:`,
        err?.message || err,
      );
    }
  }
  if (ok > 0) {
    console.log(`[tunnel-notify] Posted Expo tunnel link to ${ok} chat(s).`);
    return true;
  }
  return false;
}

let bestUrl = null;
let notified = false;

function consider(line) {
  const found = extractTunnelFromText(line);
  if (!found) return;
  if (!bestUrl || scoreUrl(found) > scoreUrl(bestUrl)) {
    bestUrl = found;
  }
}

async function notify(url) {
  if (notified || !url) return;
  notified = true;
  bestUrl = url;
  console.log(`[tunnel-notify] Link: ${url}`);
  await sendTelegram(buildTelegramMessage(url));
}

async function pollMetroForTunnel() {
  const started = Date.now();
  while (!notified && Date.now() - started < POLL_MAX_MS) {
    const url = await fetchTunnelFromMetro();
    if (url && scoreUrl(url) >= 3) {
      await notify(url);
      return;
    }
    if (url && (!bestUrl || scoreUrl(url) > scoreUrl(bestUrl))) {
      bestUrl = url;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!notified && bestUrl) await notify(bestUrl);
}

console.log('[tunnel-notify] Starting expo start --tunnel …');
if (token && chatIds.length) {
  console.log(
    `[tunnel-notify] Will text ${chatIds.length} Telegram chat(s) when the tunnel URL appears.`,
  );
} else {
  console.warn(
    '[tunnel-notify] Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_IDS (or TELEGRAM_TUNNEL_CHAT_IDS) to notify.',
  );
}

const isWin = process.platform === 'win32';
const child = spawn(
  isWin ? 'npx.cmd' : 'npx',
  ['expo', 'start', '--tunnel'],
  {
    cwd: root,
    shell: isWin,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

function attach(stream) {
  const rl = createInterface({ input: stream });
  rl.on('line', (line) => {
    process.stdout.write(line + '\n');
    consider(line);
    if (/tunnel ready/i.test(line) && !notified) {
      void pollMetroForTunnel();
    }
  });
}

attach(child.stdout);
attach(child.stderr);

// Also poll even if the "Tunnel ready" line is missed (piped/TTY quirks).
setTimeout(() => {
  if (!notified) void pollMetroForTunnel();
}, 8000);

child.on('exit', (code, signal) => {
  const exit = () => process.exit(code ?? (signal ? 1 : 0));
  if (!notified && bestUrl) {
    void notify(bestUrl).finally(exit);
    return;
  }
  exit();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
