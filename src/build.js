// @ts-check
// Assembles one episode file and keeps the index in step.
//
// Nothing reaches disk until the whole episode has been built and checked. A half-written
// E910.json is worse than no file at all: the page would render it happily and the missing half
// would look like bad transcription rather than a crash.

import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.js';
import { loadFeed } from './feed.js';
import { transcribe } from './asr.js';
import { toSentences, punctuationRate } from './segment.js';
import { splitSentence, joinSentences } from './cuts.js';
import { assignRoles, speakingTime, narratorShare } from './roles.js';

/** Below this share of cues ending on 。！？ the ASR barely punctuated and the cuts are guesses. */
const POOR_PUNCTUATION = 0.5;

/** 爱哲 holds well under a third of an episode; past this the two roles are too close to call. */
const UNCERTAIN_NARRATOR_SHARE = 0.35;

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
export async function buildEpisode(episode, { force = false, resegment = false, narrator } = {}) {
  if (existsSync(paths.episode(episode.id)) && !force && !resegment) {
    throw new Error(`${episode.id} đã có transcript. Dùng --force để chạy lại, --resegment để cắt lại câu.`);
  }

  console.log(`${episode.id} · ${episode.title}`);
  const raw = resegment ? await loadRaw(episode.id) : await runAsr(episode);
  const lines = await toLines(episode.id, raw.words ?? []);
  const cues = assignRoles(lines, narrator ?? (resegment ? await currentNarrator(episode.id) : undefined));
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
 * Sentences from the ASR, with the reviewed fixes replayed and each one cut into lines as
 * data/cuts/ says. Both files index sentences the same way, so rebuilding from data/raw/ never
 * loses a fix or a cut.
 * @param {string} id
 * @param {import('./segment.js').Word[]} words
 */
async function toLines(id, words) {
  const ledger = await readJsonOr(paths.corrections(id), { fixes: [] });
  const plan = await readJsonOr(paths.cuts(id), { cuts: {}, joins: [] });

  /** @type {Map<number, {before: string, after: string}[]>} */
  const fixes = new Map();
  for (const fix of ledger.fixes) fixes.set(fix.cueIndex, [...(fixes.get(fix.cueIndex) ?? []), fix]);

  const sentences = toSentences(words);
  const errors = [];
  const lines = [];
  for (const [s, sentence] of sentences.entries()) {
    try {
      for (const line of splitSentence(sentence, fixes.get(s) ?? [], plan.cuts[s])) lines.push({ s, ...line });
    } catch (error) {
      errors.push(`  câu ${s}: ${/** @type {Error} */ (error).message}`);
    }
  }
  if (errors.length) {
    throw new Error(`Không dựng được ${id} — sửa data/corrections/ hoặc data/cuts/:\n${errors.join('\n')}`);
  }
  return withUnits(joinSentences(lines, plan.joins ?? []), plan.joins ?? []).map((line, i) => ({ i, ...line }));
}

/**
 * Marks the lines of a sentence that was joined onto the one before with `u`, the sentence its run
 * of joins starts at. tools/build_tokens.py and build_gloss.mjs cut words over a whole unit — the
 * sentence, or a run of joined ones — never a single line, so re-cutting lines leaves the word list
 * alone and never turns up a new word to gloss.
 * @template {{ s: number }} Line
 * @param {Line[]} lines
 * @param {number[]} joins
 */
function withUnits(lines, joins) {
  const joined = new Set(joins);
  /** @type {Map<number, number>} */
  const unit = new Map();
  const unitOf = (/** @type {number} */ s) => {
    if (!unit.has(s)) unit.set(s, joined.has(s - 1) ? unitOf(s - 1) : s);
    return /** @type {number} */ (unit.get(s));
  };
  return lines.map((line) => (unitOf(line.s) === line.s ? line : { ...line, u: unitOf(line.s) }));
}

/** A rebuild keeps whichever speaker was the narrator, so a past --narrator is not silently lost. */
async function currentNarrator(/** @type {string} */ id) {
  const episode = await readJsonOr(paths.episode(id), { cues: [] });
  return episode.cues.find((/** @type {any} */ cue) => cue.role === 'narrator')?.speaker;
}

async function readJsonOr(/** @type {string} */ path, /** @type {any} */ fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Re-cutting sentences from a saved response costs nothing, so changing segment.js never re-bills. */
async function loadRaw(/** @type {string} */ id) {
  try {
    console.log('Cắt lại câu từ data/raw/ (không gọi API).');
    return JSON.parse(await readFile(paths.raw(id), 'utf8'));
  } catch {
    throw new Error(`Không có data/raw/${id}.json để cắt lại. Chạy --force để transcribe.`);
  }
}

async function runAsr(/** @type {import('./feed.js').Episode} */ episode) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu ASSEMBLYAI_API_KEY. Copy .env.example thành .env rồi điền key.');
  }

  console.log(`Gửi cho AssemblyAI (${formatDuration(episode.duration)}, họ tự tải audio)…`);
  const raw = await transcribe(episode.mp3, apiKey, (status, elapsed) => {
    process.stdout.write(`\r  ${status} · ${elapsed}s   `);
  });
  process.stdout.write('\n');

  await writeJson(paths.raw(episode.id), raw);
  return raw;
}

/**
 * @param {string} id
 * @param {import('./roles.js').RoledCue[]} cues
 */
function report(id, cues) {
  // Punctuation is judged on whole sentences: a line cut out of one ends on a comma by design.
  const lastLines = cues.filter((cue, n) => cues[n + 1]?.s !== cue.s);
  const rate = punctuationRate(lastLines);
  const narrated = cues.filter((cue) => cue.role === 'narrator').length;

  console.log(`\n✓ ${lastLines.length} câu → ${cues.length} dòng · ${narrated} dòng của người dẫn, ${cues.length - narrated} của người kể`);
  console.log(`  dấu câu: ${Math.round(rate * 100)}% câu kết thúc bằng 。！？`);

  for (const [speaker, seconds] of speakingTime(cues)) {
    const role = cues.find((cue) => cue.speaker === speaker)?.role;
    console.log(`  speaker ${speaker}: ${formatDuration(seconds)} · ${role === 'narrator' ? 'người dẫn' : 'người kể'}`);
  }

  if (rate < POOR_PUNCTUATION) {
    console.log('  ⚠ ASR chấm câu kém — nhiều câu bị cắt theo độ dài, nên xem lại trước khi tin.');
  }
  const share = narratorShare(cues);
  if (share > UNCERTAIN_NARRATOR_SHARE) {
    console.log(`  ⚠ Người dẫn chiếm ${Math.round(share * 100)}% thời lượng — chia vai không chắc.`);
    console.log('    Xem vài câu đầu rồi chỉnh bằng --narrator <speaker> --resegment.');
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
