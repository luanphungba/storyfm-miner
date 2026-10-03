#!/usr/bin/env node
// @ts-check
// Turns an app interface (data/ui/<id>.json) into an episode: a TTS voice reads every piece, the
// clips are laid out on one timeline (src/ui.js), and the episode, translation and chapter files are
// written in the shapes every other episode has — so the player, ✓ Học xong, Nghe lại and ＋ Anki
// need nothing of their own.
//
//   node tools/ui.mjs build UI1     voice what is not voiced yet, lay out data/audio/UI1.m4a, write the episode
//   node tools/ui.mjs check UI1     have whisper listen to every clip and name those that read something else
//   node tools/ui.mjs publish UI1   put the audio on the storyfm-audio Worker and point the episode at it
//
// The voice is Qwen3-TTS cloning a reference clip, through Runware (RUNWARE_API_KEY, UI_VOICE_AUDIO,
// UI_VOICE_TEXT in .env). Each clip is kept in tools/.cache/tts/ under a hash of the voice and the
// text, so a rebuild — a new cut, a fixed line — pays only for what changed.

import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { paths } from '../src/paths.js';
import { loadContent, piecesOf, spoken, timeline, planChapters, translationLedger } from '../src/ui.js';
import { writeJson, rebuildIndex, rebuildTranslation, rebuildChapters } from '../src/build.js';
import { publishAudio } from '../src/cdn.js';

const run = promisify(execFile);
const RATE = 24000; // Hz, mono, 16-bit: what the voice returns and what the episode is laid out in
const MODEL = 'alibaba:qwen@3-tts-1.7b-base';
const PARALLEL = 4;

try {
  process.loadEnvFile(join(paths.root, '.env'));
} catch {}

const [command, id] = process.argv.slice(2);
if (!id || !['build', 'check', 'publish'].includes(command)) {
  console.log('Dùng: node tools/ui.mjs build|check|publish UI1');
  process.exit(1);
}

// ---------- the voice ----------

function voice() {
  const { RUNWARE_API_KEY: key, UI_VOICE_AUDIO: audio, UI_VOICE_TEXT: text } = process.env;
  if (!key || !audio || !text) throw new Error('Thiếu RUNWARE_API_KEY, UI_VOICE_AUDIO hoặc UI_VOICE_TEXT trong .env (xem .env.example).');
  const reference = readFileSync(audio);
  const fingerprint = createHash('sha1').update(MODEL).update(reference).update(text).digest('hex');
  return { key, reference: reference.toString('base64'), text, fingerprint };
}

const clipPath = (/** @type {ReturnType<typeof voice>} */ v, /** @type {string} */ text) =>
  join(paths.tts, `${createHash('sha1').update(v.fingerprint).update(spoken(text)).digest('hex')}.wav`);

/** Runware's audio task, retried on the statuses that mean "busy" rather than "wrong". */
async function synthesize(/** @type {ReturnType<typeof voice>} */ v, /** @type {string} */ text) {
  const body = JSON.stringify([{
    taskUUID: randomUUID(), taskType: 'audioInference', model: MODEL,
    speech: { text: spoken(text), voice: 'clone', language: 'Chinese', speed: 1.0 },
    inputs: { audio: v.reference }, settings: { transcript: v.text },
    outputType: 'URL', outputFormat: 'MP3', audioSettings: { sampleRate: RATE, channels: 1, bitrate: 96 },
  }]);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch('https://api.runware.ai/v1', {
      method: 'POST', body, signal: AbortSignal.timeout(90_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.key}` },
    });
    const reply = await response.text();
    if (response.ok) {
      const url = JSON.parse(reply).data?.[0]?.audioURL;
      if (!url) throw new Error(`Runware không trả audio cho "${text}": ${reply.slice(0, 200)}`);
      return Buffer.from(await (await fetch(url)).arrayBuffer());
    }
    if (attempt >= 5 || ![429, 502, 503, 504].includes(response.status)) throw new Error(`Runware ${response.status}: ${reply.slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
  }
}

/** The clip as 16-bit mono PCM at RATE, its leading and trailing silence trimmed to a breath, so the
 * pauses the timeline lays out are the pauses heard. */
async function voiceInto(/** @type {ReturnType<typeof voice>} */ v, /** @type {string} */ text, /** @type {string} */ file) {
  const mp3 = `${file}.mp3`;
  await writeFile(mp3, await synthesize(v, text));
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05';
  await run('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-af', `${trim},areverse,${trim},areverse`,
    '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', file]);
  await rm(mp3);
}

/** The PCM samples of a WAV ffmpeg wrote, whatever chunks come before its data. */
function samplesOf(/** @type {Buffer} */ wav) {
  let at = 12;
  while (at + 8 <= wav.length) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') return wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV không có khối data');
}

// ---------- build ----------

async function build() {
  const content = await loadContent(id);
  const pieces = piecesOf(content.pages);
  const v = voice();
  await mkdir(paths.tts, { recursive: true });

  const texts = [...new Set(pieces.map((piece) => piece.text))];
  const todo = texts.filter((text) => !existsSync(clipPath(v, text)));
  console.log(`${id} · ${pieces.length} đoạn, ${texts.length} câu khác nhau, ${todo.length} câu chưa có giọng đọc`);
  let done = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
      await voiceInto(v, text, clipPath(v, text));
      process.stdout.write(`\r  đọc ${++done}/${todo.length}   `);
    }
  }));
  if (todo.length) process.stdout.write('\n');

  const clips = new Map(texts.map((text) => [text, samplesOf(readFileSync(clipPath(v, text)))]));
  const durations = pieces.map((piece) => /** @type {Buffer} */ (clips.get(piece.text)).length / 2 / RATE);
  const { cues, plan, duration } = timeline(pieces, durations);

  // Laid out sample by sample, so every cue's start is where its first reading really begins.
  const wavFile = join(paths.tts, `${id}.episode.wav`);
  const out = await open(wavFile, 'w');
  await out.write(Buffer.alloc(44));
  let written = 0;
  let drift = 0;
  const begun = new Set();
  for (const step of plan) {
    if ('clip' in step) {
      if (!begun.has(step.clip)) {
        begun.add(step.clip);
        drift = Math.max(drift, Math.abs(written / 2 / RATE - cues[step.clip].start));
      }
      const samples = /** @type {Buffer} */ (clips.get(pieces[step.clip].text));
      await out.write(samples);
      written += samples.length;
    } else {
      const bytes = Math.round(step.silence * RATE) * 2;
      await out.write(Buffer.alloc(bytes));
      written += bytes;
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + written, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(written, 40);
  await out.write(header, 0, 44, 0);
  await out.close();
  if (drift > 0.02) throw new Error(`Audio lệch ${Math.round(drift * 1000)}ms so với mốc của các dòng.`);

  // 48k mono is plenty for one voice, and keeps an hour and a half well under Cloudflare's 25 MiB a file.
  await mkdir(join(paths.root, 'data', 'audio'), { recursive: true });
  await run('ffmpeg', ['-v', 'error', '-y', '-i', wavFile, '-c:a', 'aac', '-b:a', '48k', '-ac', '1', paths.audio(id)]);
  await rm(wavFile);

  const registry = JSON.parse(await readFile(paths.ui, 'utf8'));
  const entry = registry.episodes.find((/** @type {any} */ episode) => episode.id === id);
  if (!entry) throw new Error(`${id} chưa có trong data/ui.json.`);
  entry.duration = Math.round(duration);
  await writeJson(paths.ui, registry);

  await writeJson(paths.episode(id), {
    id, title: entry.title, guid: id, pubDate: entry.pubDate, duration: Math.round(duration),
    // Until `publish`, the page points at the copy in data/audio/, which the dev server does not serve.
    audio: { m4a: entry.m4a ?? `../data/audio/${id}.m4a` },
    source: 'ui', owner: entry.owner, engine: 'tts', cues,
  });
  await writeJson(paths.translations(id), translationLedger(content));
  await writeJson(paths.chapters(id), { chapters: planChapters(content.pages, content.chapters) });
  await rebuildIndex();
  await rebuildTranslation(id, cues);
  const chapters = await rebuildChapters(id, cues, { capped: false });
  const minutes = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`✓ ${cues.length} dòng · ${chapters?.sidecar.chapters.length} chương · ${minutes(duration)} · data/audio/${id}.m4a`);
  if (!entry.m4a) console.log(`  Audio chưa lên mạng: node tools/ui.mjs publish ${id}`);
}

// ---------- check ----------

/** Whisper hears each clip; a clip whose pinyin (tones aside) differs from its text is named. It
 * cannot hear a wrong tone, so a polyphone read in the wrong sense still needs an ear. */
async function check() {
  const content = await loadContent(id);
  const v = voice();
  const texts = [...new Set(piecesOf(content.pages).map((piece) => piece.text))];
  const dir = join(paths.tts, `check-${id}`);
  await mkdir(dir, { recursive: true });
  const files = texts.map((text) => clipPath(v, text));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length) throw new Error(`${missing.length} câu chưa có giọng đọc — chạy build trước.`);
  const heard = (/** @type {string} */ file) => join(dir, file.split('/').pop().replace(/\.wav$/, '.txt'));
  const todo = files.filter((file) => !existsSync(heard(file)));
  for (let k = 0; k < todo.length; k += 50) {
    process.stdout.write(`\r  whisper ${k}/${todo.length}   `);
    await run('whisper', [...todo.slice(k, k + 50), '--model', 'small', '--language', 'zh', '--output_format', 'txt',
      '--output_dir', dir, '--fp16', 'False', '--verbose', 'False'], { maxBuffer: 64 * 1024 * 1024 });
  }
  const bundle = { exports: {} };
  new Function('module', 'exports', readFileSync(join(paths.root, 'tools/vendor/pinyin-pro.js'), 'utf8'))(bundle, bundle.exports);
  const { pinyin } = /** @type {any} */ (bundle.exports);
  const sound = (/** @type {string} */ text) => pinyin(text.replace(/[^㐀-鿿]/g, ''), { toneType: 'none', type: 'array' }).join(' ');
  const wrong = [];
  for (const [k, text] of texts.entries()) {
    const said = readFileSync(heard(files[k]), 'utf8').trim();
    if (sound(said) !== sound(text)) wrong.push({ text, said });
  }
  await writeFile(join(dir, 'report.json'), `${JSON.stringify(wrong, null, 1)}\n`);
  console.log(`\n${texts.length - wrong.length}/${texts.length} câu whisper nghe đúng âm. Khác:`);
  for (const { text, said } of wrong) console.log(`  ${text}  →  ${said}`);
}

// ---------- publish ----------

async function publish() {
  if (!existsSync(paths.audio(id))) throw new Error(`Chưa có data/audio/${id}.m4a — chạy build trước.`);
  const url = await publishAudio(id);
  const registry = JSON.parse(await readFile(paths.ui, 'utf8'));
  const entry = registry.episodes.find((/** @type {any} */ episode) => episode.id === id);
  entry.m4a = url;
  await writeJson(paths.ui, registry);
  const episode = JSON.parse(await readFile(paths.episode(id), 'utf8'));
  await writeJson(paths.episode(id), { ...episode, audio: { m4a: url } });
  console.log(`✓ ${url}`);
}

await { build, check, publish }[command]();
