/**
 * Publish EAS Update to channel `internal` (personal ad hoc phone) + Telegram.
 *
 * Usage: npm run update:internal -- --message "fix board layout"
 */
import { spawn } from 'node:child_process';
import { escapeHtml, root, sendTelegramHtml } from './lib/telegram-env.mjs';

const args = process.argv.slice(2);
let message = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--message' && args[i + 1]) {
    message = args[++i];
  } else if (args[i].startsWith('--message=')) {
    message = args[i].slice('--message='.length);
  }
}
if (!message.trim()) {
  message = `internal OTA ${new Date().toISOString().slice(0, 16)}`;
}

function run(bin, cmdArgs) {
  return new Promise((resolvePromise, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? `${bin}.cmd` : bin, cmdArgs, {
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
      else reject(new Error(`eas update exited ${code}`));
    });
  });
}

console.log(`[update:internal] Publishing to channel internal — "${message}"`);

try {
  const out = await run('eas', [
    'update',
    '--channel',
    'internal',
    '--environment',
    'preview',
    '--non-interactive',
    '--message',
    message,
  ]);

  const urlMatch = out.match(
    /https:\/\/expo\.dev[^\s"'<>]+|https:\/\/u\.expo\.dev[^\s"'<>]+/i,
  );
  const link = urlMatch?.[0] ?? null;
  const who = escapeHtml(process.env.USERNAME || process.env.USER || 'dev');

  const lines = [
    '⚡️ <b>Internal OTA published</b>',
    '',
    `Channel: <code>internal</code>`,
    escapeHtml(message),
    '',
  ];
  if (link) {
    lines.push(`<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`, '');
  }
  lines.push(
    'Open the ad hoc app on your phone (foreground it) to fetch.',
    '',
    `by ${who}`,
  );
  await sendTelegramHtml(lines.join('\n'));
} catch (err) {
  console.error('[update:internal]', err.message || err);
  await sendTelegramHtml(
    `⚡️ <b>Internal OTA failed</b>\n\n${escapeHtml(err.message || String(err))}`,
  );
  process.exit(1);
}
