// @ts-check
// When each studied chapter comes back in Nghe lại. A chapter comes back once, the day after it was
// studied. After that it comes back for its words, not as a whole: a chapter of 10-20 new words always
// holds one not caught yet, and spaced as a whole, a chapter came back every day it had a tap.
//
// A word brings chapters back only once it is said again and still missed: tapped in RECUR_CHAPTERS
// chapters or more, and not said to be known since. A word tapped in one chapter waits to be said
// again: listening to new chapters is what reviews it, and that keeps most of the hours on new
// listening rather than old. Such a word is due the day after it recurred; heard without a tap, in a
// chapter studied or heard again, it waits twice as long as it last held; tapped, it is due the next day.
// A word is the span tapped, as the line is cut: a tap on 整段 says 整段 was missed, not 段.
//
// The words worth the minutes are the ones the next episodes will say: the common ones, by HSK band,
// and the ones said across many episodes of the library. So the easiest come first, and a rare word
// (HSK 7-9 or off the list, said in RARE_EPISODES episodes or fewer) brings no chapter back: it waits
// to be met again, and is listened for when a chapter it is in plays anyway.
//
// Each day the fewest chapters that hold the due words are played, the most of them a minute first, as
// a word said in three chapters needs hearing in one; a chapter back the day after its study takes the
// due words in it along. Pure, so test/spacing.test.js covers it.

import { ADVANCED, levelRank } from './hsk.js';
import { addDays } from './progress.js';
import { SAME_START_S, daysBetween, episodeStudied, lastStudied, linesOf } from './studied.js';

/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {import('./progress.js').Heard} Heard */
/** @typedef {{ ep: string, start: number, days: string[], words: import('./taps.js').TappedWord[],
 *   byDay?: Record<string, string[]> }} Tapped
 *   A chapter's taps as the server lists them: the days anything in it was tapped, its words, and the
 *   words tapped in it each day, known since or not (none from a server older than coverage.js). */
/** @typedef {{ due: string, interval: number }} Schedule  The day a word is next due, and the days it waits for it. */
/** @typedef {{ from: string, tapped: string[] }} Recurring
 *   A word that brings chapters back: the day it recurred, tapped in its RECUR_CHAPTERS-th chapter, and every day it was tapped. */
/** @typedef {import('./hsk.js').Level & { episodes: number }} Reach
 *   How much of what is heard next a word buys: its level, and the episodes of the library it is said in. */

/** A day this share of a chapter's audio was heard counts as heard through: a pass, give or take the
 * second the playhead stood at either end. */
export const HEARD_SHARE = 0.9;

/** Tapped in this many chapters, a word is said often enough to be worth bringing chapters back for. */
export const RECUR_CHAPTERS = 2;

/** Said in no more episodes of the library than this, a word past HSK 6 is rare: not worth an old
 * chapter's minutes, as the next episodes will hardly say it. */
export const RARE_EPISODES = 2;

/** The rows that are this chapter: a re-cut can nudge its start, as findStudied allows. */
const isChapter = (/** @type {{ ep: string, start: number }} */ s) => (/** @type {{ ep: string, start: number }} */ row) =>
  row.ep === s.ep && Math.abs(row.start - s.start) < SAME_START_S;

/** The days a chapter was heard through, on any page. */
export function heardThrough(/** @type {Heard[]} */ heard, /** @type {Studied} */ s) {
  /** @type {Record<string, number>} */
  const audio = {};
  for (const row of heard.filter(isChapter(s))) {
    for (const [day, seconds] of Object.entries(row.byDay ?? {})) audio[day] = (audio[day] ?? 0) + seconds;
  }
  return Object.keys(audio).filter((day) => audio[day] >= HEARD_SHARE * (s.end - s.start));
}

/** A chapter's taps, if anything in it was tapped. */
export const tappedOf = (/** @type {Tapped[]} */ tapped, /** @type {{ ep: string, start: number }} */ s) => tapped.find(isChapter(s));

/**
 * When a word is due, from the day it recurred and the days it was heard and tapped. It is due the day
 * after it recurred. A day with a tap sets the wait back to one day. A day heard without one doubles
 * the wait it survived, counted from the day before; heard early, the wait it had stands, counted from
 * that day.
 * @param {{ from: string, heard: string[], tapped: string[] }} days
 * @returns {Schedule}
 */
export function schedule({ from, heard, tapped }) {
  const missed = new Set(tapped);
  let interval = 1;
  let last = from;
  for (const day of [...new Set([...heard, ...tapped])].sort()) {
    if (day <= from) continue;
    interval = missed.has(day) ? 1 : Math.max(interval, 2 * daysBetween(last, day));
    last = day;
  }
  return { due: addDays(last, interval), interval };
}

/** The day after a chapter was last studied, when it comes back once, or null once it has been heard
 * through since. */
export function freshDue(/** @type {Studied} */ s, /** @type {string[]} */ heard) {
  const studied = lastStudied(s);
  return heard.some((day) => day > studied) ? null : addDays(studied, 1);
}

/**
 * What an episode's lines say, as they are cut into word spans (.tok.json): the words each chapter
 * says, on the lines it plays, and how far each word reaches.
 * @param {{ start: number, end: number, text: string }[]} cues  the episode's lines
 * @param {number[][][]} tokens  each line's spans, [start, length, band, count, isName, episodes]
 * @param {Studied[]} chapters  the episode's studied chapters
 * @returns {{ said: Map<Studied, Set<string>>, reach: Map<string, Reach> }}
 */
export function wordsSaid(cues, tokens, chapters) {
  const inChapter = chapters.map((s) => ({ s, lines: linesOf(cues, s), words: /** @type {Set<string>} */ (new Set()) }));
  /** @type {Map<string, Reach>} */
  const reach = new Map();
  for (const [k, cue] of cues.entries()) {
    for (const [start, length, band, , isName, episodes] of tokens[k] ?? []) {
      const word = cue.text.slice(start, start + length);
      reach.set(word, { band, isName: Boolean(isName), episodes });
      for (const { lines: [from, to], words } of inChapter) if (from <= k && k <= to) words.add(word);
    }
  }
  return { said: new Map(inChapter.map(({ s, words }) => [s, words])), reach };
}

/** Whether a word is worth bringing chapters back for: on HSK 1-6, or said across more than
 * RARE_EPISODES episodes. A word whose reach is not known is given the benefit of the doubt. */
export const pullsBack = (/** @type {Reach | undefined} */ reach) =>
  !reach || levelRank(reach) < ADVANCED || reach.episodes > RARE_EPISODES;

/** Words easiest first: the lowest level, as it buys the most of speech (hsk.js), then the one said in
 * the most episodes. */
export const easierFirst = (/** @type {(word: string) => Reach | undefined} */ reachOf) =>
  (/** @type {string} */ a, /** @type {string} */ b) => {
    const [x, y] = [reachOf(a), reachOf(b)];
    return levelRank(x ?? null) - levelRank(y ?? null) || (y?.episodes ?? 0) - (x?.episodes ?? 0);
  };

/**
 * The words that bring chapters back: each tapped in RECUR_CHAPTERS chapters or more, and still in a
 * chapter's words, which list none said to be known since it was last tapped.
 * @param {Tapped[]} tapped  every studied chapter's, as /tapped lists them
 * @returns {Map<string, Recurring>}
 */
export function recurringWords(tapped) {
  const unknown = new Set(tapped.flatMap((c) => c.words.map((w) => w.word)));
  /** @type {Map<string, { firsts: string[], days: Set<string> }>} */
  const found = new Map();
  for (const chapter of tapped) {
    /** @type {Map<string, string>} The first day each word was tapped in this chapter. */
    const first = new Map();
    for (const [day, spans] of Object.entries(chapter.byDay ?? {})) {
      for (const word of spans.filter((w) => unknown.has(w))) {
        const was = first.get(word);
        if (!was || day < was) first.set(word, day);
        let seen = found.get(word);
        if (!seen) found.set(word, (seen = { firsts: [], days: new Set() }));
        seen.days.add(day);
      }
    }
    for (const [word, day] of first) found.get(word)?.firsts.push(day);
  }
  return new Map([...found]
    .filter(([, w]) => w.firsts.length >= RECUR_CHAPTERS)
    .map(([word, w]) => [word, { from: w.firsts.sort()[RECUR_CHAPTERS - 1], tapped: [...w.days].sort() }]));
}

/**
 * Nghe lại's day: the chapters due today, each with the words it is played for, and the day each other
 * chapter next falls due, for the ones anything brings back.
 * @param {{ chapters: Studied[], heardOf: (s: Studied) => string[], words: Map<string, Recurring>,
 *   wordsIn: (s: Studied) => Set<string>, reachOf: (word: string) => Reach | undefined, today: string }} input
 * @returns {{ due: Map<Studied, string>, checks: Map<Studied, string[]>, ease: Map<Studied, number> }}
 *   `checks`, for each chapter due today, the due words said in it, the easiest first, then the longest
 *   due; `ease`, where the easiest of them stands among all the day's (0 the easiest), or after them all
 *   for a chapter back for none, only as studied the day before
 */
export function planDay({ chapters, heardOf, words, wordsIn, reachOf, today }) {
  /** @type {Map<string, string>} */
  const wordDue = new Map();
  for (const [word, { from, tapped }] of words) {
    const heard = chapters.filter((s) => wordsIn(s).has(word)).flatMap((s) => [...s.dates, ...heardOf(s)]);
    wordDue.set(word, schedule({ from, heard, tapped }).due);
  }
  const easier = easierFirst(reachOf);
  const dueOn = (/** @type {string} */ word) => /** @type {string} */ (wordDue.get(word));
  const dueWords = [...wordDue.keys()]
    .filter((word) => dueOn(word) <= today)
    .sort((a, b) => easier(a, b) || dueOn(a).localeCompare(dueOn(b)));
  const pulling = (/** @type {string} */ word) => pullsBack(reachOf(word));
  const fresh = new Map(chapters.map((s) => [s, freshDue(s, heardOf(s))]));

  const playing = new Set(chapters.filter((s) => {
    const day = fresh.get(s);
    return day != null && day <= today;
  }));
  const left = new Set(dueWords.filter((word) => pulling(word) && ![...playing].some((s) => wordsIn(s).has(word))));
  while (left.size) {
    /** @type {Studied | null} */
    let best = null;
    let bestPerSecond = 0;
    for (const s of chapters) {
      if (playing.has(s)) continue;
      const perSecond = [...left].filter((word) => wordsIn(s).has(word)).length / (s.end - s.start);
      if (perSecond > bestPerSecond) [best, bestPerSecond] = [s, perSecond];
    }
    if (!best) break;
    playing.add(best);
    for (const word of wordsIn(best)) left.delete(word);
  }

  /** @type {Map<Studied, string>} */
  const due = new Map();
  /** @type {Map<Studied, string[]>} */
  const checks = new Map();
  /** @type {Map<Studied, number>} */
  const ease = new Map();
  for (const s of chapters) {
    const inIt = [...wordDue].filter(([word]) => pulling(word) && wordsIn(s).has(word));
    const days = playing.has(s)
      ? inIt.filter(([, day]) => day <= today).map(([, day]) => day)
      : inIt.filter(([, day]) => day > today).map(([, day]) => day);
    const next = [fresh.get(s) ?? '', ...days].filter(Boolean).sort()[0];
    if (next) due.set(s, next);
    if (!playing.has(s)) continue;
    const listenFor = dueWords.filter((word) => wordsIn(s).has(word));
    checks.set(s, listenFor);
    ease.set(s, listenFor.length ? dueWords.indexOf(listenFor[0]) : dueWords.length);
  }
  return { due, checks, ease };
}

/** How a due day stands from today, as the list says it. */
export function dueLabel(/** @type {string} */ due, /** @type {string} */ today) {
  const days = daysBetween(today, due);
  if (days < 0) return `quá hạn ${-days} ngày`;
  if (days === 0) return 'đến hạn hôm nay';
  if (days === 1) return 'đến hạn mai';
  return `còn ${days} ngày`;
}

/**
 * The chapters as Nghe lại plays them by their schedule: first the ones due today or before, then the
 * rest by the day each falls due, so listening on past the day's share hears the next ones early. A
 * chapter nothing brings back is in neither.
 * Each episode's chapters go together in story order: among the due, the episode holding the easiest
 * word of the day first (planDay's `ease`), then the one due longest ago; among the rest, by day, and
 * inside a day by episode. Ties go to the episode studied latest.
 * @param {Studied[]} list
 * @param {{ today: string, ep?: string, dueOf: (s: Studied) => string | undefined, easeOf?: (s: Studied) => number }} options
 */
export function spacedPlaylist(list, { today, ep, dueOf, easeOf = () => 0 }) {
  const shown = list.filter((s) => !ep || s.ep === ep);
  const episodeDay = episodeStudied(shown);
  const day = (/** @type {Studied} */ s) => dueOf(s) ?? '';
  const due = shown.filter((s) => day(s) && day(s) <= today);
  const upcoming = shown.filter((s) => day(s) > today);
  /** @type {Map<string, string>} */
  const firstDue = new Map();
  /** @type {Map<string, number>} */
  const easiest = new Map();
  for (const s of due) {
    if (!firstDue.has(s.ep) || day(s) < /** @type {string} */ (firstDue.get(s.ep))) firstDue.set(s.ep, day(s));
    easiest.set(s.ep, Math.min(easiest.get(s.ep) ?? Infinity, easeOf(s)));
  }
  const order = (/** @type {(s: Studied) => string} */ group) => (/** @type {Studied} */ a, /** @type {Studied} */ b) =>
    group(a).localeCompare(group(b)) || episodeDay(b).localeCompare(episodeDay(a)) || a.ep.localeCompare(b.ep) || a.start - b.start;
  const byEase = (/** @type {Studied} */ s) => /** @type {number} */ (easiest.get(s.ep));
  const dueOrder = order((s) => firstDue.get(s.ep) ?? '');
  return {
    due: due.sort((a, b) => byEase(a) - byEase(b) || dueOrder(a, b)),
    upcoming: upcoming.sort(order(day)),
  };
}
