// @ts-check
// The storyfm-audio Worker (cdn/): audio this project hosts itself, served from data/audio/ (not in
// git) as the Worker's static assets — free, 25 MiB a file, asset requests not billed. Bilibili's
// links expire, so its audio has to live here; other podcasts' audio lives here too, because the
// mp3 in their feed may not seek where the player asks it to (see src/podcasts.js).

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
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
 * Deploys cdn/ — only files Cloudflare does not already hold are uploaded — and returns the URL the
 * episode's audio is served at, once it answers.
 * @param {string} id
 */
export async function publishAudio(id) {
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
