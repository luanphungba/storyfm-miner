// @ts-check
// The vocabulary, toward a goal of ten thousand words, counted in dictionary words as that goal is:
// tools/build_tokens.py writes the words each line counts as (EXXX.vocab.json), and the server
// (server/miner.py) every day each word was tapped and said to be known. Two numbers:
//
// - understood: heard in a studied chapter without being tapped, as nothing needed looking up;
// - solid: heard so in SOLID_CHAPTERS chapters over SOLID_DAYS days, as once can be a good guess.
//
// A tap takes a word out of both until it is heard untapped on a later day, or said to be known. Both
// start from HSK 1-2, taken as known before listening, less any of it tapped and not caught since.
// Each day is counted as it stood that evening, from what had been studied and tapped by then.

import { SAME_START_S } from './studied.js';

export const GOAL_WORDS = 10_000;
/** The studied chapters, and the days among theirs, a word is heard untapped in to be solid. */
export const SOLID_CHAPTERS = 3;
export const SOLID_DAYS = 2;

/** @typedef {[number, string][]} VocabLines  An episode's lines: each one's start and the words it counts as, spaced. */
/** @typedef {{ base: string[], splits: Record<string, string[]> }} VocabBase
 *   vocab.json: HSK 1-2, and the words each span counts as where they are not the span itself. */
/** @typedef {{ tapped: Record<string, string[]>, known: Record<string, string[]> }} TapHistory
 *   Every day each span was tapped, and was said to be known, as YYYY-MM-DD. */
/**
 * @typedef {{ studied: Pick<import('./studied.js').Studied, 'ep' | 'start' | 'end' | 'dates'>[],
 *   linesOf: Record<string, VocabLines>, vocab: VocabBase, history: TapHistory }} VocabInput
 */
/** @typedef {{ day: string, understood: number, solid: number, heard: number }} VocabDay
 *   `heard` is the words heard in the chapters studied by then, tapped or not. */

/**
 * The vocabulary as it stood on each day given.
 * @param {VocabInput} input
 * @param {string[]} days YYYY-MM-DD
 * @returns {VocabDay[]}
 */
export function vocabularyByDay({ studied, linesOf, vocab, history }, days) {
  const chapters = studied.map((chapter) => ({
    id: `${chapter.ep}@${chapter.start}`,
    dates: chapter.dates,
    words: new Set((linesOf[chapter.ep] ?? [])
      .filter(([start]) => chapter.start - SAME_START_S <= start && start < chapter.end)
      .flatMap(([, line]) => line.split(' '))),
  }));
  // The server keeps what was touched: a tap on 很脏 is a tap on 很 and 脏.
  const byWord = (/** @type {Record<string, string[]>} */ daysOf) => {
    /** @type {Map<string, string[]>} */
    const words = new Map();
    for (const [span, spanDays] of Object.entries(daysOf)) {
      for (const word of vocab.splits[span] ?? [span]) words.set(word, [...(words.get(word) ?? []), ...spanDays]);
    }
    return words;
  };
  const tapped = byWord(history.tapped);
  const known = byWord(history.known);
  return days.map((day) => ({ day, ...countOn(day, chapters, tapped, known, vocab.base) }));
}

/** The last of `days` on or before `day`, or '' for none. */
const lastBy = (/** @type {string[] | undefined} */ days, /** @type {string} */ day) =>
  (days ?? []).reduce((last, d) => (d <= day && d > last ? d : last), '');

/**
 * @param {string} day
 * @param {{ id: string, dates: string[], words: Set<string> }[]} chapters
 * @param {Map<string, string[]>} tapped
 * @param {Map<string, string[]>} known
 * @param {string[]} base
 */
function countOn(day, chapters, tapped, known, base) {
  /** @type {Map<string, string>} */
  const lastTap = new Map();
  for (const [word, days] of tapped) {
    const last = lastBy(days, day);
    if (last) lastTap.set(word, last);
  }
  const marked = [...known].filter(([word, days]) => {
    const last = lastBy(days, day);
    return last && last >= (lastTap.get(word) ?? '');
  }).map(([word]) => word);

  const heard = new Set();
  /** @type {Map<string, { chapters: Set<string>, days: Set<string> }>} */
  const clean = new Map();
  for (const chapter of chapters) {
    const dates = chapter.dates.filter((d) => d <= day);
    if (!dates.length) continue;
    for (const word of chapter.words) {
      heard.add(word);
      const untapped = dates.filter((d) => d > (lastTap.get(word) ?? ''));
      if (!untapped.length) continue;
      let seen = clean.get(word);
      if (!seen) clean.set(word, (seen = { chapters: new Set(), days: new Set() }));
      seen.chapters.add(chapter.id);
      for (const d of untapped) seen.days.add(d);
    }
  }

  const missed = new Set([...lastTap.keys()].filter((word) => !clean.has(word) && !marked.includes(word)));
  const kept = base.filter((word) => !missed.has(word));
  const solid = [...clean].filter(([, seen]) => seen.chapters.size >= SOLID_CHAPTERS && seen.days.size >= SOLID_DAYS)
    .map(([word]) => word);
  return {
    understood: new Set([...kept, ...marked, ...clean.keys()]).size,
    solid: new Set([...kept, ...marked, ...solid]).size,
    heard: heard.size,
  };
}

/** Every day from the first a chapter was studied through `today`: the days the chart draws. */
export function vocabularyDays(/** @type {{ dates: string[] }[]} */ studied, /** @type {string} */ today) {
  const first = studied.flatMap((s) => s.dates).reduce((a, b) => (b < a ? b : a), today);
  const days = [];
  for (let at = new Date(`${first}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
    const day = at.toISOString().slice(0, 10);
    days.push(day);
    if (day >= today) return days;
  }
}

/** The y axis's ticks for counts from `low` to `high`: about four, on a round step, the lowest at
 * or under `low`. Words grow from HSK 1-2, so the axis starts near the lines, not at zero. */
export function wordTicks(/** @type {number} */ low, /** @type {number} */ high) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  const step = steps.find((s) => (high - low) <= 4 * s) ?? 2000;
  const bottom = Math.floor(low / step) * step;
  const top = Math.max(bottom + step, Math.ceil(high / step) * step);
  return Array.from({ length: (top - bottom) / step + 1 }, (_, k) => bottom + k * step);
}

/** "+34", "−3", "±0": a day's change. */
export const formatChange = (/** @type {number} */ n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
