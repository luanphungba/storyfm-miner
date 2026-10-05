// @ts-check
// Puts the words the ASR collapsed back where they are spoken, read from the episode's audio.
//
// AssemblyAI sometimes gives a word no length at all and parks it on a neighbour. Which neighbour
// says which side of the timestamp its audio is on.
//
// Parked on the start of the word after it (就是 355.59 → 355.59), the words before drift late with
// it (一样 stretched across the pause that really follows it), so a line starting on such a word
// starts after its own first syllable: the loop and the Anki card both skip 就是 and play 装修都很好嘛.
// In the five episodes checked, one line in eight started on a collapsed word. The audio says where
// the word really starts: after the last pause before the timestamp. findOnsets walks back from the
// collapsed word, at most MAX_MS_PER_CHAR a character of it, to the nearest run of quiet at least
// MIN_PAUSE_MS long, and takes the end of that quiet as the word's start. The word before is ended in
// the middle of the pause, so the previous line no longer runs on into this one. No pause that close
// — continuous speech — and the word is left alone.
//
// Parked on the end of the word before, with the next word not placed until a gap later (CC3's
// 类似的交换学习这样的 all at 161.2, the next word at 163.12 — most often exactly 1.92s on, a stretch
// the aligner gave up on), the run is said in that gap. A line ending on it ended before it was
// said: 丹麦，也是进行类似的交换学习这样的。 looped 丹麦也是进行 and stopped. findRuns takes the gap up to
// the pause before the next word, at most MAX_MS_PER_CHAR a character, and spreadRuns shares it out
// over the run's words by how many characters each says.
//
// tools/onsets.mjs runs this over the audio once and saves the result in data/onsets/<id>.json;
// src/build.js replays that ledger onto the ASR words on every build, like data/corrections/ and
// data/cuts/. Only timestamps change, never a character, and a rebuild stays offline.

/** @typedef {import('./segment.js').Word} Word */
/** @typedef {{ was: number, start: number, prevEnd: number }} Onset */
/** @typedef {{ was: number, end: number }} Run */

/** Shorter than any spoken syllable: the ASR had no idea where this word was. */
export const COLLAPSED_MS = 40;
/** A breath between words; shorter dips happen inside a word (就-是). */
const MIN_PAUSE_MS = 120;
/** How far back the real start can be, per character of the collapsed word(s): a syllable runs
 * 150-300ms. Checked with whisper on every line this moved: at up to 400ms a character every one
 * then heard its missing first word; past it, most reached back over words the ASR had placed right
 * into the pause before the previous line (给你宣布 heard as 就像是突然间给你宣布). */
const MAX_MS_PER_CHAR = 400;
const MAX_SHIFT_MS = 1_000;
/** The shortest a syllable runs: a gap after a run any shorter cannot be where it was said. */
const MIN_SYLLABLE_MS = 150;
/** Under this far below the episode's loud speech counts as quiet. */
const QUIET_DB = 30;
/** Nudges smaller than this are inside the timing noise and not worth a ledger entry. */
const MIN_SHIFT_MS = 60;
/** One loudness value per this many ms: the unit the audio is read in. */
export const FRAME_MS = 10;

const HAN = /[㐀-鿿]/g;

const collapsed = (/** @type {Word} */ word) => word.end - word.start <= COLLAPSED_MS;

/** Only the first of a run parked on one timestamp: the rest follow it, not a pause. */
const startsRun = (/** @type {Word[]} */ words, /** @type {number} */ k) =>
  collapsed(words[k]) && !(collapsed(words[k - 1]) && words[k - 1].start === words[k].start);

/** Index just past the run of collapsed words that starts at k. */
function runEnd(/** @type {Word[]} */ words, /** @type {number} */ k) {
  let j = k;
  while (j < words.length && collapsed(words[j]) && words[j].start === words[k].start) j++;
  return j;
}

/** A run parked on the end of the word before it, the next word placed a syllable or more later. */
function parkedBeforeGap(/** @type {Word[]} */ words, /** @type {number} */ k) {
  const next = words[runEnd(words, k)];
  return words[k - 1].end === words[k].start && next !== undefined && next.start - words[k].start >= MIN_SYLLABLE_MS;
}

/** What a word takes to say: a syllable per Chinese character, one per Latin word or number. */
const syllables = (/** @type {Word} */ word) =>
  (word.text.match(HAN)?.length ?? 0) + (word.text.match(/[A-Za-z0-9]+/g)?.length ?? 0);

/** Whether each FRAME_MS of the episode is quiet, against the episode's own loud speech. */
function quietness(/** @type {Float32Array} */ db) {
  const loud = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.95)];
  return (/** @type {number} */ f) => db[f] < loud - QUIET_DB;
}

/**
 * Onsets for an episode's collapsed words, keyed by word index.
 * @param {Word[]} words
 * @param {Float32Array} db  Loudness of every FRAME_MS of the episode, in dB.
 */
export function findOnsets(words, db) {
  const quiet = quietness(db);

  /** @type {Record<string, Onset>} */
  const onsets = {};
  for (let k = 1; k < words.length; k++) {
    if (!startsRun(words, k) || parkedBeforeGap(words, k)) continue;

    let chars = 0;
    for (const word of words.slice(k, runEnd(words, k))) chars += word.text.match(HAN)?.length ?? 0;
    const reach = Math.min(MAX_SHIFT_MS, Math.max(1, chars) * MAX_MS_PER_CHAR);
    const at = Math.floor(words[k].start / FRAME_MS);
    const floor = Math.max(0, at - reach / FRAME_MS);
    let pause = null;
    for (let f = at - 1; f > floor && !pause; f--) {
      if (!quiet(f)) continue;
      let g = f;
      while (g > floor && quiet(g - 1)) g--;
      if ((f - g + 1) * FRAME_MS >= MIN_PAUSE_MS) pause = { from: g, to: f + 1 };
      f = g;
    }
    if (!pause || (at - pause.to) * FRAME_MS < MIN_SHIFT_MS) continue;

    onsets[k] = {
      was: words[k].start,
      start: pause.to * FRAME_MS,
      prevEnd: Math.min(words[k - 1].end, Math.floor((pause.from + pause.to) / 2) * FRAME_MS),
    };
  }
  return onsets;
}

/**
 * Where each run parked before a gap stops being said, keyed by the index of its first word. Run it
 * on the words with the onsets applied: an onset can move the next word's start into the gap.
 * @param {Word[]} words
 * @param {Float32Array} db  Loudness of every FRAME_MS of the episode, in dB.
 */
export function findRuns(words, db) {
  const quiet = quietness(db);

  /** @type {Record<string, Run>} */
  const runs = {};
  for (let k = 1; k < words.length; k++) {
    if (!startsRun(words, k) || !parkedBeforeGap(words, k)) continue;

    const run = words.slice(k, runEnd(words, k));
    const said = run.reduce((total, word) => total + syllables(word), 0);
    // Punctuation alone (。” after the word that says it) has nothing to hear.
    if (!said) continue;

    // Said up to the pause before the next word, if there is one; else right up to that word.
    const was = words[k].start;
    const next = words[k + run.length].start;
    const at = Math.floor(was / FRAME_MS);
    let g = Math.ceil(next / FRAME_MS);
    while (g > at && quiet(g - 1)) g--;
    const spoken = next - g * FRAME_MS >= MIN_PAUSE_MS ? g * FRAME_MS : next;
    const end = Math.min(spoken, was + said * MAX_MS_PER_CHAR);
    if (end - was < MIN_SHIFT_MS) continue;

    runs[k] = { was, end };
  }
  return runs;
}

/**
 * The words with each ledger entry replayed: the collapsed word starts where the audio says, and the
 * word before it ends in the pause between them. An entry whose word no longer starts where it was
 * measured (a fresh --force transcription) is stale, and this throws rather than guess.
 * @param {Word[]} words
 * @param {Record<string, Onset>} onsets
 */
export function applyOnsets(words, onsets) {
  const out = words.map((word) => ({ ...word }));
  for (const [key, { was, start, prevEnd }] of Object.entries(onsets)) {
    const k = Number(key);
    if (k < 1 || out[k]?.start !== was) throw new Error(`từ ${k} không còn bắt đầu ở ${was}ms`);
    out[k].start = start;
    out[k - 1].end = Math.min(out[k - 1].end, prevEnd);
  }
  return out;
}

/**
 * The words with each run in the ledger shared out over the time it is said, by how many characters
 * each word says — every word gets a start and an end, so a line ending inside it ends where its
 * words do. Stale entries throw, as in applyOnsets.
 * @param {Word[]} words  With the onsets applied.
 * @param {Record<string, Run>} runs
 */
export function spreadRuns(words, runs) {
  const out = words.map((word) => ({ ...word }));
  for (const [key, { was, end }] of Object.entries(runs)) {
    const k = Number(key);
    if (k < 1 || out[k]?.start !== was || !startsRun(out, k)) throw new Error(`từ ${k} không còn bắt đầu cụm dồn ở ${was}ms`);
    const run = out.slice(k, runEnd(out, k));
    const total = run.reduce((sum, word) => sum + syllables(word), 0);
    let said = 0;
    for (const word of run) {
      word.start = was + Math.round(((end - was) * said) / total);
      said += syllables(word);
      word.end = was + Math.round(((end - was) * said) / total);
    }
  }
  return out;
}
