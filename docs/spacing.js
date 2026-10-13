// @ts-check
// When each studied chapter comes back in Nghe lại. A chapter comes back once, the day after it was
// studied. After that it comes back for its words, not as a whole: a chapter of 10-20 new words always
// holds one not caught yet, and spaced as a whole, a chapter came back every day it had a tap.
//
// Nghe lại is for making the words worth knowing solid, not for understanding a chapter again. So every
// word tapped and not said to be known since is reviewed, whether or not it was tapped anywhere else.
// It is due the day after it was first tapped; heard without a tap, in a chapter studied or heard
// again, it waits twice as long as it last held; tapped, it is due the next day. A word is the span
// tapped, as the line is cut: a tap on 整段 says 整段 was missed, not 段.
//
// The words worth the minutes are the ones the next episodes will say. The library alone is too small
// to tell, and the HSK band alone puts 唱歌, HSK 1 said in two episodes, before 甚至, HSK 4 said in
// nineteen. So a word is worth the episodes of the library it is said in, plus the episodes a word of
// its band is said in on average (worthBy), and the worthiest go first. A rare word (HSK 7-9 or off
// the list, said in RARE_EPISODES episodes or fewer) brings no chapter back: it waits to be met again.
//
// A chapter is played for a few of its due words, FOCUS_WORDS at most, the worthiest: the ones listened
// for, the rest left for another day. Each day the worthiest word not yet listened for picks the
// chapter that says it with the most due words a minute, until REVIEW_SECONDS of chapters beyond the
// ones back the day after their study; a word left over waits for tomorrow. Pure, so
// test/spacing.test.js covers it.

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
/** @typedef {{ from: string, tapped: string[] }} Missed  A word reviewed: the day it was first tapped, and every day it was. */
/** @typedef {import('./hsk.js').Level & { episodes: number }} Reach
 *   How much of what is heard next a word buys: its level, and the episodes of the library it is said in. */

/** A day this share of a chapter's audio was heard counts as heard through: a pass, give or take the
 * second the playhead stood at either end. */
export const HEARD_SHARE = 0.9;

/** Said in no more episodes of the library than this, a word past HSK 6 is rare: not worth an old
 * chapter's minutes, as the next episodes will hardly say it. */
export const RARE_EPISODES = 2;

/** A chapter is played for this many of the words due in it at most: few enough to listen for. */
export const FOCUS_WORDS = 3;

/** The seconds of chapters a day brings back for words, beyond the ones back the day after their study. */
export const REVIEW_SECONDS = 10 * 60;

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
 * When a word is due, from the day it was first tapped and the days it was heard and tapped since. It is
 * due the day after it was first tapped. A day with a tap sets the wait back to one day. A day heard
 * without one doubles the wait it survived, counted from the day before; heard early, the wait it had
 * stands, counted from that day.
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

/**
 * How much each word is worth listening for: the episodes of the library it is said in, plus the
 * episodes a word of its HSK band is said in on average, over the words `reach` holds. The syllabus
 * knows how common a word is across Chinese, the library what its speakers say, so each counts as much.
 * A name earns no band's average, and a word whose reach is not known is worth nothing.
 * @param {Map<string, Reach>} reach
 * @returns {(word: string) => number}
 */
export function worthBy(reach) {
  /** @type {Map<number, { words: number, episodes: number }>} */
  const bands = new Map();
  for (const { band, isName, episodes } of reach.values()) {
    if (isName) continue;
    const sum = bands.get(band) ?? { words: 0, episodes: 0 };
    bands.set(band, { words: sum.words + 1, episodes: sum.episodes + episodes });
  }
  const usual = (/** @type {Reach} */ { band, isName }) => {
    const sum = bands.get(band);
    return isName || !sum ? 0 : sum.episodes / sum.words;
  };
  return (word) => {
    const far = reach.get(word);
    return far ? far.episodes + usual(far) : 0;
  };
}

/**
 * The words reviewed: each tapped and still in a chapter's words, which list none said to be known since
 * it was last tapped, wherever it was tapped.
 * @param {Tapped[]} tapped  every studied chapter's, as /tapped lists them
 * @returns {Map<string, Missed>}
 */
export function missedWords(tapped) {
  const unknown = new Set(tapped.flatMap((c) => c.words.map((w) => w.word)));
  /** @type {Map<string, Set<string>>} */
  const days = new Map();
  for (const chapter of tapped) {
    for (const [day, spans] of Object.entries(chapter.byDay ?? {})) {
      for (const word of spans.filter((w) => unknown.has(w))) {
        let tappedOn = days.get(word);
        if (!tappedOn) days.set(word, (tappedOn = new Set()));
        tappedOn.add(day);
      }
    }
  }
  return new Map([...days].map(([word, tappedOn]) => {
    const sorted = [...tappedOn].sort();
    return [word, { from: sorted[0], tapped: sorted }];
  }));
}

/**
 * Nghe lại's day: the chapters due today, each with the words it is played for, and the day each other
 * chapter next falls due, for the ones anything brings back.
 * @param {{ chapters: Studied[], heardOf: (s: Studied) => string[], words: Map<string, Missed>,
 *   wordsIn: (s: Studied) => Set<string>, reach: Map<string, Reach>, today: string }} input
 * @returns {{ due: Map<Studied, string>, checks: Map<Studied, string[]>, rank: Map<Studied, number> }}
 *   `checks`, for each chapter played today, the words it is played for: its FOCUS_WORDS worthiest due
 *   words not listened for in a chapter before it, the ones that bring chapters back first; `rank`,
 *   where the first of them stands among all the day's (0 the worthiest), or after them all for a
 *   chapter played for none, only as studied the day before
 */
export function planDay({ chapters, heardOf, words, wordsIn, reach, today }) {
  /** @type {Map<string, string>} */
  const wordDue = new Map();
  for (const [word, { from, tapped }] of words) {
    const heard = chapters.filter((s) => wordsIn(s).has(word)).flatMap((s) => [...s.dates, ...heardOf(s)]);
    wordDue.set(word, schedule({ from, heard, tapped }).due);
  }
  const worth = worthBy(reach);
  const pulling = (/** @type {string} */ word) => pullsBack(reach.get(word));
  const dueOn = (/** @type {string} */ word) => /** @type {string} */ (wordDue.get(word));
  const dueWords = [...wordDue.keys()]
    .filter((word) => dueOn(word) <= today)
    .sort((a, b) => Number(pulling(b)) - Number(pulling(a)) || worth(b) - worth(a) || dueOn(a).localeCompare(dueOn(b)));
  const fresh = new Map(chapters.map((s) => [s, freshDue(s, heardOf(s))]));

  /** @type {Map<Studied, string[]>} */
  const checks = new Map();
  /** @type {Set<string>} */
  const listenedFor = new Set();
  /** Plays `s` for its worthiest due words not listened for in a chapter before it. */
  const play = (/** @type {Studied} */ s) => {
    const listenFor = dueWords.filter((word) => !listenedFor.has(word) && wordsIn(s).has(word)).slice(0, FOCUS_WORDS);
    for (const word of listenFor) listenedFor.add(word);
    checks.set(s, listenFor);
  };
  for (const s of chapters) {
    const day = fresh.get(s);
    if (day != null && day <= today) play(s);
  }
  let seconds = 0;
  for (const word of dueWords) {
    if (listenedFor.has(word) || !pulling(word)) continue;
    const left = dueWords.filter((w) => pulling(w) && !listenedFor.has(w));
    /** @type {Studied | null} */
    let best = null;
    let bestPerSecond = 0;
    for (const s of chapters) {
      if (checks.has(s) || !wordsIn(s).has(word)) continue;
      const perSecond = left.filter((w) => wordsIn(s).has(w)).length / (s.end - s.start);
      if (perSecond > bestPerSecond) [best, bestPerSecond] = [s, perSecond];
    }
    if (!best) continue;
    seconds += best.end - best.start;
    if (seconds > REVIEW_SECONDS) break;
    play(best);
  }

  /** @type {Map<Studied, string>} */
  const due = new Map();
  /** @type {Map<Studied, number>} */
  const rank = new Map();
  const tomorrow = addDays(today, 1);
  for (const s of chapters) {
    const listenFor = checks.get(s);
    // Not played today, a chapter is back when a word in it falls due, one due already the next day.
    const days = listenFor
      ? listenFor.filter(pulling).map(dueOn)
      : [...wordDue].filter(([word]) => pulling(word) && wordsIn(s).has(word)).map(([, day]) => (day > today ? day : tomorrow));
    const next = [fresh.get(s) ?? '', ...days].filter(Boolean).sort()[0];
    if (next) due.set(s, next);
    if (listenFor) rank.set(s, listenFor.length ? dueWords.indexOf(listenFor[0]) : dueWords.length);
  }
  return { due, checks, rank };
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
 * Each episode's chapters go together in story order: among the due, the episode played for the
 * worthiest word of the day first (planDay's `rank`), then the one due longest ago; among the rest, by
 * day, and inside a day by episode. Ties go to the episode studied latest.
 * @param {Studied[]} list
 * @param {{ today: string, ep?: string, dueOf: (s: Studied) => string | undefined, rankOf?: (s: Studied) => number }} options
 */
export function spacedPlaylist(list, { today, ep, dueOf, rankOf = () => 0 }) {
  const shown = list.filter((s) => !ep || s.ep === ep);
  const episodeDay = episodeStudied(shown);
  const day = (/** @type {Studied} */ s) => dueOf(s) ?? '';
  const due = shown.filter((s) => day(s) && day(s) <= today);
  const upcoming = shown.filter((s) => day(s) > today);
  /** @type {Map<string, string>} */
  const firstDue = new Map();
  /** @type {Map<string, number>} */
  const worthiest = new Map();
  for (const s of due) {
    if (!firstDue.has(s.ep) || day(s) < /** @type {string} */ (firstDue.get(s.ep))) firstDue.set(s.ep, day(s));
    worthiest.set(s.ep, Math.min(worthiest.get(s.ep) ?? Infinity, rankOf(s)));
  }
  const order = (/** @type {(s: Studied) => string} */ group) => (/** @type {Studied} */ a, /** @type {Studied} */ b) =>
    group(a).localeCompare(group(b)) || episodeDay(b).localeCompare(episodeDay(a)) || a.ep.localeCompare(b.ep) || a.start - b.start;
  const byRank = (/** @type {Studied} */ s) => /** @type {number} */ (worthiest.get(s.ep));
  const dueOrder = order((s) => firstDue.get(s.ep) ?? '');
  return {
    due: due.sort((a, b) => byRank(a) - byRank(b) || dueOrder(a, b)),
    upcoming: upcoming.sort(order(day)),
  };
}
