// @ts-check
// The storyfm-audio Worker (cdn/): audio this project hosts itself, served from data/audio/ (not in
// git) as the Worker's static assets — free, 25 MiB a file, asset requests not billed. Bilibili's
// links expire, so its audio has to live here; other podcasts' audio lives here too, because the
// mp3 in their feed may not seek where the player asks it to (see src/podcasts.js). Each m4a has an
// mp3 made next to it (makeMp3), which only Anki's desktop app is served — see cdn/worker.js.

import { execFile } from 'node:child_process';
import { stat, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';

/** Pinned rather than `npx wrangler`, so a deploy never runs whatever version npm serves that day. */
const WRANGLER = 'wrangler@4.142.0';
/** Must match the name in cdn/wrangler.jsonc. */
export const AUDIO_WORKER = 'storyfm-audio';

/** Cloudflare refuses static assets over 25 MiB. */
const ASSET_FILE_LIMIT = 25 * 1024 * 1024;

/** Throws before a deploy that Cloudflare would refuse. */
export async function assertFits(/** @type {string} */ file) {
  const { size } = await stat(file);
  if (size > ASSET_FILE_LIMIT) {
    throw new Error(`Audio ${basename(file)} ${Math.round(size / 1e6)}MB vượt giới hạn 25MB của Cloudflare — cần nén lại.`);
  }
}

/**
 * Makes data/audio/<id>.mp3 from the m4a, unless one at least as new is already there. CBR, whose
 * header lets Chrome compute where a time lies, unlike the VBR mp3s of podcast feeds (up to 6s off
 * in Anki); and without the bit reservoir, since a frame that borrows bits from earlier ones cannot
 * be decoded right after a seek — with it, lines started up to 100ms late. Made from the m4a, it
 * keeps the transcript's timeline: measured in Anki's engine a seek lands 0–31ms early, never late.
 * @param {string} id
 */
export async function makeMp3(id) {
  const m4a = paths.audio(id);
  const mp3 = m4a.replace(/\.m4a$/, '.mp3');
  const [source, made] = await Promise.all([stat(m4a), stat(mp3).catch(() => null)]);
  if (made && made.mtimeMs >= source.mtimeMs) return;
  const run = promisify(execFile);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', m4a]);
  // 64k like the m4a; a long video steps down so the file stays under Cloudflare's limit.
  const kbps = [64, 48, 32].find((k) => Number(stdout) * k * 125 < ASSET_FILE_LIMIT * 0.98) ?? 32;
  console.log(`  làm bản mp3 ${kbps}k cho Anki desktop → data/audio/${basename(mp3)}`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', m4a, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-reservoir', '0', '-f', 'mp3', `${mp3}.tmp`]);
  await rename(`${mp3}.tmp`, mp3);
  await assertFits(mp3);
}

/**
 * Deploys cdn/ — only files Cloudflare does not already hold are uploaded — and returns the URL the
 * episode's audio is served at, once it answers.
 * @param {string} id
 */
export async function publishAudio(id) {
  await makeMp3(id);
  console.log(`  đẩy data/audio/ lên Cloudflare (${AUDIO_WORKER})…`);
  const { stdout } = await promisify(execFile)('npx', ['--yes', WRANGLER, 'deploy'], {
    cwd: join(paths.root, 'cdn'),
    maxBuffer: 16 * 1024 * 1024,
  });
  const origin = stdout.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
  if (!origin) throw new Error(`Deploy xong nhưng không thấy địa chỉ workers.dev trong output:\n${stdout}`);
  const url = `${origin}/${basename(paths.audio(id))}`;
  await assertServed(url);
  return url;
}

/** A fresh Worker can take a moment to answer on its domain; AssemblyAI must not get a 404. */
async function assertServed(/** @type {string} */ url) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Đã deploy nhưng ${url} chưa trả về file.`);
}
