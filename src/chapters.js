// @ts-check
// The episode cut into chapters: runs of one to two minutes on one small topic, each with a Chinese
// and a Vietnamese title. A chapter is what a day of active listening loops, and what goes into the
// list of studied chapters played back later, so it has to hold together on its own.
//
// A chapter starts at a sentence (the unit translations are written against), never inside one: a
// topic turns between sentences, and a sentence is never cut by a re-cut of its lines. Each keeps the
// Chinese of the sentence it starts at. A fix to that sentence leaves the boundary where it was and is
// only named; a join that swallows it moves the chapter's start into the one before, so it is dropped
// and named, and the chapter before it runs on until the list is written again.
//
// The last chapter can stop before the episode does: the outro credits and the music under them are
// nothing to study, and looped they would cost every pass of the last chapter half a minute.

import { sentencesOf } from './translations.js';

/** Looped for most of an hour, a chapter has to be short enough for each line in it to be heard many times. */
export const MAX_SECONDS = 120;

/** Shorter than this is a fragment, better joined to a neighbour than studied on its own. */
export const MIN_SECONDS = 60;

/**
 * @typedef {{ s: number, u?: number, start: number, end: number, text: string, speaker: string, role: string }} Line
 * @typedef {{ from: number, zh: string, vi: string, first: string }} Entry
 *   `from` is the sentence unit the chapter starts at, `first` that sentence's Chinese when written.
 * @typedef {{ chapters?: Entry[], end?: { from: number, first: string } }} Ledger
 *   `end` is the sentence the last chapter stops before, when it does not run to the end of the episode.
 * @typedef {{ zh: string, vi: string, from: number, to: number, start: number, end: number }} Chapter
 *   `from` and `to` are the first and last line on the page; `start` and `end` what the loop plays.
 */

const bare = (/** @type {string} */ text) => text.replace(/\s+/g, '');

/**
 * What the page loads: each chapter with its first and last line and the stretch of audio between
 * them. `lost` names chapters whose first sentence is no longer a sentence, `changed` those whose
 * first sentence a fix rewrote, `long` and `short` the chapters past the limits, and `uncovered` is
 * true when the first chapter does not start at the first sentence.
 * @param {Line[]} lines
 * @param {Ledger} ledger
 */
export function buildChapters(lines, ledger) {
  const sentences = sentencesOf(lines);
  const indexOf = new Map(sentences.map((sentence, k) => [sentence.unit, k]));
  /** @type {number[]} */
  const lost = [];
  /** @type {number[]} */
  const changed = [];
  /** @type {{ entry: Entry, k: number }[]} */
  const kept = [];
  for (const entry of ledger.chapters ?? []) {
    const k = indexOf.get(entry.from);
    if (k === undefined) {
      lost.push(entry.from);
      continue;
    }
    if (bare(entry.first) !== bare(sentences[k].text)) changed.push(entry.from);
    kept.push({ entry, k });
  }
  kept.sort((a, b) => a.k - b.k);
  let endK = ledger.end ? indexOf.get(ledger.end.from) : undefined;
  if (ledger.end && endK === undefined) lost.push(ledger.end.from);
  else if (ledger.end && endK !== undefined) {
    if (bare(ledger.end.first) !== bare(sentences[endK].text)) changed.push(ledger.end.from);
    if (kept.length && endK <= kept[kept.length - 1].k) endK = undefined;
  }

  /** @type {Chapter[]} */
  const chapters = kept.map(({ entry, k }, n) => {
    const next = n + 1 < kept.length ? kept[n + 1].k : endK ?? sentences.length;
    const from = sentences[k].lines[0];
    const to = /** @type {number} */ (sentences[next - 1].lines.at(-1));
    return { zh: entry.zh, vi: entry.vi, from, to, start: lines[from].start, end: lines[to].end };
  });
  const length = (/** @type {Chapter} */ chapter) => chapter.end - chapter.start;
  return {
    sidecar: { chapters },
    lost,
    changed,
    long: chapters.flatMap((chapter, n) => (length(chapter) > MAX_SECONDS ? [n] : [])),
    short: chapters.flatMap((chapter, n) => (length(chapter) < MIN_SECONDS ? [n] : [])),
    uncovered: kept.length > 0 && kept[0].k > 0,
  };
}

/**
 * The ledger entry for a chapter starting at sentence unit `from`, its Chinese taken from the page.
 * Null when `from` is not a sentence that starts a unit.
 * @param {Line[]} lines
 * @param {number} from
 * @param {string} zh
 * @param {string} vi
 * @returns {Entry | null}
 */
export function entryAt(lines, from, zh, vi) {
  const sentence = sentencesOf(lines).find((s) => s.unit === from);
  return sentence ? { from, zh, vi, first: sentence.text } : null;
}
