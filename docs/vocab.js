// @ts-check
// The vocabulary, toward a goal of ten thousand words, counted in dictionary words as that goal is:
// tools/build_tokens.py writes the words each line counts as (EXXX.vocab.json), and the server
// (server/miner.py) every day each word was tapped and said to be known. Two numbers:
//
// - understood: heard in a chapter studied for the first time without being tapped, as nothing needed
//   looking up;
// - solid: heard so in SOLID_CHAPTERS chapters first studied over SOLID_DAYS days, as once can be a
//   good guess.
//
// A chapter speaks for its words only on the day it is first studied: studied again, its lines are
// remembered, so a word not tapped there says little. A tap takes a word out of both until it is heard
// untapped in a chapter first studied on a later day, or said to be known. Both start from HSK 1-2,
// taken as known before listening, less any of it tapped and not caught since.
// Each day is counted as it stood that evening, from what had been studied and tapped by then.

import { SAME_START_S } from './studied.js';

export const GOAL_WORDS = 10_000;
/** What study aims for: words understood a day, and words made solid a week. Most words made solid
 * are said to be known on the day, the rest heard in three chapters, so it is judged over a week. */
export const DAY_UNDERSTOOD = 65;
export const WEEK_SOLID = 200;
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

/** @typedef {{ understood: Set<string>, solid: Set<string>, heard: Set<string> }} VocabWords */

/**
 * The vocabulary as it stood on each day given.
 * @param {VocabInput} input
 * @param {string[]} days YYYY-MM-DD
 * @returns {VocabDay[]}
 */
export function vocabularyByDay(input, days) {
  const vocabularyOn = vocabularyWords(input);
  return days.map((day) => {
    const { understood, solid, heard } = vocabularyOn(day);
    return { day, understood: understood.size, solid: solid.size, heard: heard.size };
  });
}

/**
 * The words themselves, for what needs more than their count: how much of a chapter they cover
 * (coverage.js).
 * @param {VocabInput} input
 * @returns {(day: string) => VocabWords}  the vocabulary as it stood on the evening of a day, YYYY-MM-DD
 */
export function vocabularyWords({ studied, linesOf, vocab, history }) {
  const chapters = studiedChapters(studied, linesOf);
  const tapped = wordDays(vocab, history.tapped);
  const known = wordDays(vocab, history.known);
  /** @type {Map<string, VocabWords>} Each day asked for, as every chapter of a page asks for the same few. */
  const asked = new Map();
  return (day) => {
    let words = asked.get(day);
    if (!words) asked.set(day, (words = wordsOn(day, chapters, tapped, known, vocab.base)));
    return words;
  };
}

/** @typedef {Map<string, { day: string, tapped: boolean }>} Hearings */

/**
 * Every word heard in a chapter studied for the first time: the first day it was, and whether it was
 * tapped that day. Heard untapped then, it was known before the app could teach it, which is what
 * says how many of the words not heard yet are known already (level.js).
 * @param {VocabInput} input
 * @returns {Hearings}
 */
export function firstHearings({ studied, linesOf, vocab, history }) {
  const tapped = wordDays(vocab, history.tapped);
  /** @type {Map<string, string>} */
  const first = new Map();
  for (const chapter of studiedChapters(studied, linesOf)) {
    if (!chapter.first) continue;
    for (const word of chapter.words) {
      const seen = first.get(word);
      if (!seen || chapter.first < seen) first.set(word, chapter.first);
    }
  }
  return new Map([...first].map(([word, day]) => [word, { day, tapped: tapped.get(word)?.includes(day) ?? false }]));
}

/**
 * Each word said in the chapters studied by the evening of `day`, with the times it was said in them:
 * a word said nine times is nine of the words heard (level.js, a band's share of speech).
 * @param {Pick<VocabInput, 'studied' | 'linesOf'>} input
 * @param {string} day YYYY-MM-DD
 * @returns {Map<string, number>}
 */
export function timesSaid({ studied, linesOf }, day) {
  /** @type {Map<string, number>} */
  const times = new Map();
  for (const chapter of studied) {
    if (!chapter.dates.some((d) => d <= day)) continue;
    for (const [, line] of chapterLines(linesOf[chapter.ep] ?? [], chapter)) {
      for (const word of line.split(' ')) times.set(word, (times.get(word) ?? 0) + 1);
    }
  }
  return times;
}

/** Each chapter studied, by the first day it was and the words said in it. */
const studiedChapters = (/** @type {VocabInput['studied']} */ studied, /** @type {VocabInput['linesOf']} */ linesOf) =>
  studied.map((chapter) => ({
    id: `${chapter.ep}@${chapter.start}`,
    first: chapter.dates.reduce((a, b) => (b < a ? b : a), chapter.dates[0] ?? ''),
    words: chapterWords(linesOf[chapter.ep] ?? [], chapter),
  }));

/** Every day each word was tapped, or said to be known, from the days of each span. */
function wordDays(/** @type {Pick<VocabBase, 'splits'>} */ vocab, /** @type {Record<string, string[]>} */ daysOf) {
  /** @type {Map<string, string[]>} */
  const words = new Map();
  for (const [span, spanDays] of Object.entries(daysOf)) {
    for (const word of spanWords(vocab, span)) words.set(word, [...(words.get(word) ?? []), ...spanDays]);
  }
  return words;
}

/** The words a tapped span counts as. The server keeps what was touched: a tap on 很脏 is a tap on 很 and 脏. */
const spanWords = (/** @type {Pick<VocabBase, 'splits'>} */ vocab, /** @type {string} */ span) => vocab.splits[span] ?? [span];

/** A chapter's lines, of its episode's. */
const chapterLines = (/** @type {VocabLines} */ lines, /** @type {{ start: number, end: number }} */ chapter) =>
  lines.filter(([start]) => chapter.start - SAME_START_S <= start && start < chapter.end);

/** The words said in a chapter, from its episode's lines. */
const chapterWords = (/** @type {VocabLines} */ lines, /** @type {{ start: number, end: number }} */ chapter) =>
  new Set(chapterLines(lines, chapter).flatMap(([, line]) => line.split(' ')));

/**
 * What the vocabulary is counted from, beside the page: vocab.json, and the words of each episode
 * given, none for one whose file did not come.
 * @param {string[]} episodes
 * @returns {Promise<Pick<VocabInput, 'linesOf' | 'vocab'>>}
 */
export async function fetchVocabulary(episodes) {
  const [vocab, lines] = await Promise.all([
    fetch('data/vocab.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('vocab.json')))),
    Promise.all(episodes.map((ep) => fetch(`data/${encodeURIComponent(ep)}.vocab.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null))),
  ]);
  return { vocab, linesOf: Object.fromEntries(episodes.map((ep, i) => [ep, lines[i]?.cues ?? []])) };
}

/** The last of `days` on or before `day`, or '' for none. */
const lastBy = (/** @type {string[] | undefined} */ days, /** @type {string} */ day) =>
  (days ?? []).reduce((last, d) => (d <= day && d > last ? d : last), '');

/**
 * @param {string} day
 * @param {{ id: string, first: string, words: Set<string> }[]} chapters
 * @param {Map<string, string[]>} tapped
 * @param {Map<string, string[]>} known
 * @param {string[]} base
 * @returns {VocabWords}
 */
function wordsOn(day, chapters, tapped, known, base) {
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
    if (!chapter.first || chapter.first > day) continue;
    for (const word of chapter.words) {
      heard.add(word);
      if (chapter.first <= (lastTap.get(word) ?? '')) continue;
      let seen = clean.get(word);
      if (!seen) clean.set(word, (seen = { chapters: new Set(), days: new Set() }));
      seen.chapters.add(chapter.id);
      seen.days.add(chapter.first);
    }
  }

  const missed = new Set([...lastTap.keys()].filter((word) => !clean.has(word) && !marked.includes(word)));
  const kept = base.filter((word) => !missed.has(word));
  const solid = [...clean].filter(([, seen]) => seen.chapters.size >= SOLID_CHAPTERS && seen.days.size >= SOLID_DAYS)
    .map(([word]) => word);
  return {
    understood: new Set([...kept, ...marked, ...clean.keys()]),
    solid: new Set([...kept, ...marked, ...solid]),
    heard,
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

/** @typedef {{ understood: number, solid: number }} Gain */

/**
 * What the vocabulary gained from the evening of `from` to that of `to`, as the targets count it: the
 * change in words understood, and the words made solid, solid on `to` and not on `from`. Not the change
 * in solid: HSK 1-2 tapped in a phrase (很 in 很脏) is out of it until heard again, so it falls on days
 * nothing was forgotten.
 * @param {(day: string) => VocabWords} wordsOn  vocabularyWords
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @returns {Gain}
 */
export function gained(wordsOn, from, to) {
  const before = wordsOn(from);
  const now = wordsOn(to);
  return {
    understood: now.understood.size - before.understood.size,
    solid: [...now.solid].filter((word) => !before.solid.has(word)).length,
  };
}

/** "+34", "−3", "±0": a day's change. */
export const formatChange = (/** @type {number} */ n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
