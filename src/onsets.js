// @ts-check
// Moves a line's start back to where its first word is really spoken, for words the ASR collapsed.
//
// AssemblyAI sometimes gives a word no length at all (就是 355.59 → 355.59) and parks it on the
// start of the word after it. The words before drift late with it (一样 stretched across the pause
// that really follows it), so a line starting on such a word starts after its own first syllable:
// the loop and the Anki card both skip 就是 and play 装修都很好嘛. In the five episodes checked, one
// line in eight started on a collapsed word.
//
// The audio says where the word really starts: after the last pause before the timestamp. This
// walks back from the collapsed word, at most MAX_MS_PER_CHAR a character of it, to the nearest run
// of quiet at least MIN_PAUSE_MS long, and takes the end of that quiet as the word's start. The word
// before is ended in the middle of the pause, so the previous line no longer runs on into this one.
// No pause that close — continuous speech — and the word is left alone.
//
// tools/onsets.mjs runs this over the audio once and saves the result in data/onsets/<id>.json;
// src/build.js replays that ledger onto the ASR words on every build, like data/corrections/ and
// data/cuts/. Only timestamps change, never a character, and a rebuild stays offline.

/** @typedef {import('./segment.js').Word} Word */
/** @typedef {{ was: number, start: number, prevEnd: number }} Onset */

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
/** Under this far below the episode's loud speech counts as quiet. */
const QUIET_DB = 30;
/** Nudges smaller than this are inside the timing noise and not worth a ledger entry. */
const MIN_SHIFT_MS = 60;
/** One loudness value per this many ms: the unit the audio is read in. */
export const FRAME_MS = 10;

const HAN = /[㐀-鿿]/g;

/**
 * Onsets for an episode's collapsed words, keyed by word index.
 * @param {Word[]} words
 * @param {Float32Array} db  Loudness of every FRAME_MS of the episode, in dB.
 */
export function findOnsets(words, db) {
  const loud = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.95)];
  const quiet = (/** @type {number} */ f) => db[f] < loud - QUIET_DB;
  const collapsed = (/** @type {number} */ k) => words[k].end - words[k].start <= COLLAPSED_MS;

  /** @type {Record<string, Onset>} */
  const onsets = {};
  for (let k = 1; k < words.length; k++) {
    // Only the first of a run parked on one timestamp: the rest follow it, not a pause.
    if (!collapsed(k) || (collapsed(k - 1) && words[k - 1].start === words[k].start)) continue;

    let chars = 0;
    for (let j = k; j < words.length && collapsed(j) && words[j].start === words[k].start; j++) {
      chars += words[j].text.match(HAN)?.length ?? 0;
    }
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
