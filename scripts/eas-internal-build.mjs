/**
 * Ad hoc internal build (NOT TestFlight) + Telegram install link.
 * Channel: internal → OTA with `npm run update:internal` while you're away.
 *
 * First-time iOS needs Apple login once in your own terminal:
 *   npx eas build --profile internal --platform ios
 *
 * Usage:
 *   npm run build:internal
 *   npm run build:internal -- --platform android
 */
import { spawn } from 'node:child_process';
import { escapeHtml, root, sendTelegramHtml } from './lib/telegram-env.mjs';

const args = process.argv.slice(2);
let platform = 'ios';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--platform' && args[i + 1]) {
    platform = args[++i];
  } else if (args[i].startsWith('--platform=')) {
    platform = args[i].slice('--platform='.length);
  }
}

const profile = 'internal';

function run(cmd, cmdArgs) {
  return new Promise((resolvePromise, reject) => {
    const isWin = process.platform === 'win32';
    // Prefer global `eas` (npx may resolve a stale eas-cli).
    const bin = cmd === 'eas' ? (isWin ? 'eas.cmd' : 'eas') : isWin ? `${cmd}.cmd` : cmd;
    const child = spawn(bin, cmdArgs, {
      cwd: root,
      shell: isWin,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stderr.write(s);
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${code}`));
    });
  });
}

function parseJsonBlobs(text) {
  // Prefer the last JSON array/object in the stream (eas prints noise first).
  const matches = [...text.matchAll(/(\[[\s\S]*\]|\{[\s\S]*\})/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(matches[i][1]);
    } catch {
      /* try earlier */
    }
  }
  return null;
}

function installUrl(build) {
  if (build?.buildDetailsPageUrl) return build.buildDetailsPageUrl;
  if (build?.id) {
    return `https://expo.dev/accounts/avitaub/projects/dispatcher/builds/${build.id}`;
  }
  return null;
}

async function notifyBuilds(builds) {
  const who = escapeHtml(process.env.USERNAME || process.env.USER || 'dev');
  const lines = [
    '🧪 <b>Dispatcher INTERNAL build ready</b>',
    '',
    'Ad hoc install (not TestFlight)',
    'Channel: <code>internal</code>',
    'OTA while away: <code>npm run update:internal</code>',
    '',
  ];
  for (const b of builds) {
    const link = installUrl(b);
    const plat = escapeHtml(b.platform || '?');
    const status = escapeHtml(b.status || '?');
    if (link) {
      lines.push(
        `${plat}: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a> (${status})`,
      );
    } else {
      lines.push(`${plat}: ${status}`);
    }
  }
  lines.push('', `started by ${who}`);
  await sendTelegramHtml(lines.join('\n'));
}

console.log(
  `[build:internal] Ad hoc EAS build (profile=internal, platform=${platform}) …`,
);

try {
  const easArgs = [
    'build',
    '--profile',
    profile,
    '--platform',
    platform,
    '--non-interactive',
    '--wait',
    '--json',
  ];
  if (platform === 'ios' || platform === 'all') {
    easArgs.push('--refresh-ad-hoc-provisioning-profile');
  }

  const out = await run('eas', easArgs);

  let builds = parseJsonBlobs(out);
  if (!builds) {
    const listOut = await run('eas', [
      'build:list',
      '--profile',
      profile,
      '--limit',
      '1',
      '--non-interactive',
      '--json',
    ]);
    builds = parseJsonBlobs(listOut);
  }

  const list = Array.isArray(builds) ? builds : builds ? [builds] : [];
  const finished = list.filter(
    (b) =>
      String(b.status).toLowerCase() === 'finished' ||
      String(b.status).toLowerCase() === 'errored',
  );
  await notifyBuilds(finished.length ? finished : list);
} catch (err) {
  console.error('[build:internal]', err.message || err);
  const tip =
    /credentials|Apple|ad hoc|internal distribution/i.test(err.message || '')
      ? '\n\nOne-time fix on your laptop:\n<code>npx eas device:create</code>\n<code>npx eas build --profile internal --platform ios</code>\n(log into Apple when prompted)'
      : '';
  await sendTelegramHtml(
    `🧪 <b>Dispatcher INTERNAL build failed</b>\n\n${escapeHtml(err.message || String(err))}${tip}`,
  );
  process.exit(1);
}
