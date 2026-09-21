// @ts-check
// Assembles one episode file and keeps the index in step.
//
// Nothing reaches disk until the whole episode has been built and checked. A half-written
// E910.json is worse than no file at all: the page would render it happily and the missing half
// would look like bad transcription rather than a crash.

import { writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.js';
import { loadFeed } from './feed.js';
import { transcribe } from './asr.js';
import { toCues, punctuationRate } from './segment.js';
import { assignRoles } from './roles.js';

/** Below this share of cues ending on 。！？ the ASR barely punctuated and the cuts are guesses. */
const POOR_PUNCTUATION = 0.5;

/** Single write, via a temp file, so a crash mid-write cannot leave a partial JSON behind. */
async function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

const formatDuration = (/** @type {number} */ seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * @param {import('./feed.js').Episode} episode
 * @param {{ force?: boolean, narrator?: string }} options
 */
export async function buildEpisode(episode, { force = false, narrator } = {}) {
  if (existsSync(paths.episode(episode.id)) && !force) {
    throw new Error(`${episode.id} đã có transcript. Dùng --force để chạy lại.`);
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu ASSEMBLYAI_API_KEY. Copy .env.example thành .env rồi điền key.');
  }

  console.log(`${episode.id} · ${episode.title}`);
  console.log(`Gửi cho AssemblyAI (${formatDuration(episode.duration)}, họ tự tải audio)…`);

  const raw = await transcribe(episode.mp3, apiKey, (status, elapsed) => {
    process.stdout.write(`\r  ${status} · ${elapsed}s   `);
  });
  process.stdout.write('\n');

  await writeJson(paths.raw(episode.id), raw);

  const cues = assignRoles(toCues(raw.words ?? []), narrator);
  if (!cues.length) {
    throw new Error('AssemblyAI không trả về câu nào — xem data/raw/ để biết nó nghe ra gì.');
  }

  await writeJson(paths.episode(episode.id), {
    id: episode.id,
    title: episode.title,
    guid: episode.guid,
    pubDate: episode.pubDate,
    duration: episode.duration,
    audio: { mp3: episode.mp3 },
    engine: 'assemblyai',
    cues,
  });
  await rebuildIndex();

  report(episode.id, cues);
}

/**
 * @param {string} id
 * @param {import('./roles.js').RoledCue[]} cues
 */
function report(id, cues) {
  const rate = punctuationRate(cues);
  const narrated = cues.filter((cue) => cue.role === 'narrator').length;

  console.log(`\n✓ ${cues.length} câu · ${narrated} của người dẫn, ${cues.length - narrated} của người kể`);
  console.log(`  dấu câu: ${Math.round(rate * 100)}% câu kết thúc bằng 。！？`);

  if (rate < POOR_PUNCTUATION) {
    console.log('  ⚠ ASR chấm câu kém — nhiều câu bị cắt theo độ dài, nên xem lại trước khi tin.');
  }
  console.log(`\nXem thử:  npm run serve  →  http://localhost:8080/player.html?ep=${id}`);
}

/** The index is derived from the feed so titles and dates have exactly one source. */
export async function rebuildIndex() {
  const episodes = await loadFeed();
  const entries = episodes
    .filter((episode) => existsSync(paths.episode(episode.id)))
    .map(({ id, title, pubDate, duration }) => ({ id, title, pubDate, duration }));

  await writeJson(paths.index, { updated: new Date().toISOString().slice(0, 10), episodes: entries });
  return entries;
}
