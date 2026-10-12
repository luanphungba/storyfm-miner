// @ts-check
// The storyfm-audio Worker (cdn/) and the R2 bucket it serves: audio this project hosts itself,
// uploaded from data/audio/ (not in git). R2 is free up to 10 GB and takes files of any size; the
// Worker's own static assets, used before it, refused one over 25 MiB. Bilibili's links expire, so
// its audio has to live here; other podcasts' audio lives here too, because the mp3 in their feed may
// not seek where the player asks it to (see src/podcasts.js).

import { execFile } from 'node:child_process';
import { stat, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './paths.js';

/** Pinned rather than `npx wrangler`, so an upload never runs whatever version npm serves that day. */
const WRANGLER = 'wrangler@4.142.0';
/** Must match bucket_name in cdn/wrangler.jsonc. */
const AUDIO_BUCKET = 'storyfm-audio';
/** Where the Worker answers. Every hosted episode's audio URL starts with it. */
const AUDIO_ORIGIN = 'https://storyfm-audio.luanphungba.workers.dev';

/**
 * Re-encodes `source` into `file`, an m4a of 128k mono AAC, 58 MB an hour. Measured against three
 * feeds' originals, its error from 4 kHz up is 8–14 dB below 64k's; the two whose stereo was one
 * channel twice lose nothing to mono.
 * @param {string} source  Any audio ffmpeg reads.
 * @param {string} file
 */
export async function compressAudio(source, file) {
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${file}.tmp.m4a`]);
  await rename(`${file}.tmp.m4a`, file);
}

/**
 * Uploads data/audio/<id>.m4a to R2 and returns the URL it is served at, once it answers with the
 * file uploaded.
 * @param {string} id
 */
export async function publishAudio(id) {
  const file = paths.audio(id);
  console.log(`  đẩy ${basename(file)} lên Cloudflare R2 (${AUDIO_BUCKET})…`);
  await promisify(execFile)('npx', ['--yes', WRANGLER, 'r2', 'object', 'put', `${AUDIO_BUCKET}/${basename(file)}`, '--file', file, '--content-type', 'audio/mp4', '--remote'], {
    cwd: join(paths.root, 'cdn'),
  });
  const url = `${AUDIO_ORIGIN}/${basename(file)}`;
  await assertServed(url, (await stat(file)).size);
  return url;
}

/** AssemblyAI must not get a 404, nor an older file left under the same name. */
async function assertServed(/** @type {string} */ url, /** @type {number} */ size) {
  const response = await fetch(url, { method: 'HEAD' });
  const served = Number(response.headers.get('Content-Length'));
  if (!response.ok || served !== size) {
    throw new Error(`Đã đẩy lên nhưng ${url} trả về ${response.status}, ${served} byte (file có ${size}).`);
  }
}
