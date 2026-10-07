// @ts-check
// The vocabulary, toward a goal of ten thousand words, counted in dictionary words as that goal is:
// tools/build_tokens.py writes the words each line counts as (EXXX.vocab.json), and the server
// (server/miner.py) the last day each word was tapped and said to be known. Two numbers:
//
// - understood: heard in a studied chapter without being tapped, as nothing needed looking up;
// - solid: heard so in SOLID_CHAPTERS chapters over SOLID_DAYS days, as once can be a good guess.
//
// A tap takes a word out of both until it is heard untapped on a later day, or said to be known. Both
// start from HSK 1-2, taken as known before listening, less any of it tapped and not caught since.

import { SAME_START_S } from './studied.js';

export const GOAL_WORDS = 10_000;
/** The studied chapters, and the days among theirs, a word is heard untapped in to be solid. */
export const SOLID_CHAPTERS = 3;
export const SOLID_DAYS = 2;

/** @typedef {[number, string][]} VocabLines  An episode's lines: each one's start and the words it counts as, spaced. */
/** @typedef {{ base: string[], splits: Record<string, string[]> }} VocabBase
 *   vocab.json: HSK 1-2, and the words each span counts as where they are not the span itself. */
/** @typedef {{ tapped: Record<string, string>, known: Record<string, string> }} Latest
 *   The last day each span was tapped, and was said to be known, as YYYY-MM-DD. */
/** @typedef {{ understood: number, solid: number, heard: number }} Vocabulary */

/**
 * @param {{ studied: Pick<import('./studied.js').Studied, 'ep' | 'start' | 'end' | 'dates'>[],
 *   linesOf: Record<string, VocabLines>, vocab: VocabBase, latest: Latest }} input
 * @returns {Vocabulary}  `heard` is the words heard in the studied chapters, tapped or not
 */
export function vocabulary({ studied, linesOf, vocab, latest }) {
  // The server keeps what was touched: a tap on 很脏 is a tap on 很 and 脏.
  const latestOf = (/** @type {Record<string, string>} */ days) => {
    /** @type {Map<string, string>} */
    const last = new Map();
    for (const [span, day] of Object.entries(days)) {
      for (const word of vocab.splits[span] ?? [span]) {
        if (day > (last.get(word) ?? '')) last.set(word, day);
      }
    }
    return last;
  };
  const lastTap = latestOf(latest.tapped);
  const lastKnown = latestOf(latest.known);

  const heard = new Set();
  /** @type {Map<string, Set<string>>} */
  const cleanChapters = new Map();
  /** @type {Map<string, Set<string>>} */
  const cleanDays = new Map();
  const add = (/** @type {Map<string, Set<string>>} */ sets, /** @type {string} */ word, /** @type {string[]} */ items) => {
    let set = sets.get(word);
    if (!set) sets.set(word, (set = new Set()));
    for (const item of items) set.add(item);
  };
  for (const chapter of studied) {
    const words = new Set((linesOf[chapter.ep] ?? [])
      .filter(([start]) => chapter.start - SAME_START_S <= start && start < chapter.end)
      .flatMap(([, line]) => line.split(' ')));
    for (const word of words) {
      heard.add(word);
      const untapped = chapter.dates.filter((day) => day > (lastTap.get(word) ?? ''));
      if (!untapped.length) continue;
      add(cleanChapters, word, [`${chapter.ep}@${chapter.start}`]);
      add(cleanDays, word, untapped);
    }
  }

  const marked = [...lastKnown].filter(([word, day]) => day >= (lastTap.get(word) ?? '')).map(([word]) => word);
  const missed = new Set([...lastTap.keys()].filter((word) => !cleanChapters.has(word) && !marked.includes(word)));
  const base = vocab.base.filter((word) => !missed.has(word));
  const solid = [...cleanChapters].filter(([word, chapters]) =>
    chapters.size >= SOLID_CHAPTERS && (cleanDays.get(word)?.size ?? 0) >= SOLID_DAYS).map(([word]) => word);
  return {
    understood: new Set([...base, ...marked, ...cleanChapters.keys()]).size,
    solid: new Set([...base, ...marked, ...solid]).size,
    heard: heard.size,
  };
}
