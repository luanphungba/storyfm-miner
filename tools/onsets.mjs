// Writes data/onsets/<id>.json: where the words AssemblyAI collapsed are really said, read from the
// episode's audio. What it looks for and why is in src/onsets.js; src/build.js replays the ledger.
//
// The mp3 is downloaded once into tools/.cache/audio/ (not committed) and decoded with ffmpeg.
// Rerun this after a --force transcription, then rebuild with --resegment.
//
// Usage: node tools/onsets.mjs [EPISODE_ID ...]     (default: every episode in data/raw)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { paths } from '../src/paths.js';
import { COLLAPSED_MS, FRAME_MS, applyOnsets, findOnsets, findRuns } from '../src/onsets.js';

const RATE = 16_000;
const CACHE = join(paths.root, 'tools', '.cache', 'audio');

async function audioFile(/** @type {string} */ id) {
  // A Bilibili video's audio was downloaded when it was added; ffmpeg reads m4a as well as mp3.
  if (existsSync(paths.audio(id))) return paths.audio(id);
  const file = join(CACHE, `${id}.mp3`);
  if (existsSync(file)) return file;
  const episode = JSON.parse(await readFile(paths.episode(id), 'utf8'));
  const response = await fetch(episode.audio.m4a ?? episode.audio.mp3);
  if (!response.ok) throw new Error(`${id}: tải audio lỗi ${response.status}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/** Loudness of every FRAME_MS of the episode, in dB, decoded the way AssemblyAI's timestamps count. */
async function loudness(/** @type {string} */ file) {
  const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of ffmpeg.stdout) chunks.push(chunk);
  const pcm = Buffer.concat(chunks);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  const size = (RATE * FRAME_MS) / 1000;
  const db = new Float32Array(Math.floor(samples.length / size));
  for (let f = 0; f < db.length; f++) {
    let sum = 0;
    for (let k = f * size; k < (f + 1) * size; k++) sum += samples[k] * samples[k];
    db[f] = 20 * Math.log10(Math.sqrt(sum / size) + 1e-9);
  }
  return db;
}

async function run(/** @type {string} */ id) {
  const { words } = JSON.parse(await readFile(paths.raw(id), 'utf8'));
  const db = await loudness(await audioFile(id));
  const onsets = findOnsets(words, db);
  const runs = findRuns(applyOnsets(words, onsets), db);
  await mkdir(dirname(paths.onsets(id)), { recursive: true });
  await writeFile(paths.onsets(id), `${JSON.stringify({ words: onsets, runs }, null, 2)}\n`);
  const collapsed = words.filter((/** @type {any} */ w) => w.end - w.start <= COLLAPSED_MS).length;
  console.log(`${id}: ${collapsed} từ bị dồn, dời ${Object.keys(onsets).length} từ về sau khoảng lặng trước nó, trải ${Object.keys(runs).length} cụm ra khoảng trống sau nó`);
}

const ids = process.argv.slice(2);
const all = ids.length ? ids : (await readdir(dirname(paths.raw('x')))).map((f) => f.replace(/\.json$/, ''));
for (const id of all) await run(id);
