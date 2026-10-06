// @ts-check
// When each studied chapter comes back in Nghe lại. Heard through with no word tapped in it, a
// chapter waits twice as long as it last held before it comes back; a word tapped in it, or the
// chapter studied again, brings it back the next day. Its words are spaced with it, at no cost of
// their own: a word that keeps being tapped keeps its chapter coming back daily, until the word card
// says it is worth a card (taps.js). Pure, so test/spacing.test.js covers it.

import { addDays } from './progress.js';
import { SAME_START_S, daysBetween, episodeStudied } from './studied.js';

/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {import('./progress.js').Heard} Heard */
/** @typedef {{ ep: string, start: number, days: string[], words: import('./taps.js').TappedWord[] }} Tapped
 *   A studied chapter's taps as the server lists them: the days anything in it was tapped, and its words. */
/** @typedef {{ due: string, interval: number }} Schedule  The day a chapter is next due, and the days it waits for it. */

/** A day this share of a chapter's audio was heard counts as heard through: a pass, give or take the
 * second the playhead stood at either end. */
export const HEARD_SHARE = 0.9;

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
export const tappedOf = (/** @type {Tapped[]} */ tapped, /** @type {Studied} */ s) => tapped.find(isChapter(s));

/**
 * When a chapter is due, from the days it was studied, heard through and had a word tapped in it.
 * It starts due the day after it was first studied. A day with a tap, or studied again, sets the wait
 * back to one day. A day heard through without either doubles the wait it survived, counted from the
 * day before; heard early, the wait it had stands, counted from that day.
 * @param {{ studied: string[], heard: string[], tapped: string[] }} days
 * @returns {Schedule}
 */
export function schedule({ studied, heard, tapped }) {
  const first = [...studied].sort()[0];
  const again = new Set([...studied, ...tapped]);
  let interval = 1;
  let last = first;
  for (const day of [...new Set([...heard, ...again])].sort()) {
    if (day <= first) continue;
    interval = again.has(day) ? 1 : Math.max(interval, 2 * daysBetween(last, day));
    last = day;
  }
  return { due: addDays(last, interval), interval };
}

/** How a chapter's due day stands from today, as the list says it. */
export function dueLabel(/** @type {string} */ due, /** @type {string} */ today) {
  const days = daysBetween(today, due);
  if (days < 0) return `quá hạn ${-days} ngày`;
  if (days === 0) return 'đến hạn hôm nay';
  if (days === 1) return 'đến hạn mai';
  return `còn ${days} ngày`;
}

/**
 * The chapters as Nghe lại plays them by their schedule: first the ones due today or before, then the
 * rest by the day each falls due, so listening on past the day's share hears the next ones early.
 * Each episode's chapters go together in story order: among the due, the episode due longest ago
 * first; among the rest, by day, and inside a day by episode. Ties go to the episode studied latest.
 * @param {Studied[]} list
 * @param {{ today: string, ep?: string, dueOf: (s: Studied) => string }} options
 */
export function spacedPlaylist(list, { today, ep, dueOf }) {
  const shown = list.filter((s) => !ep || s.ep === ep);
  const episodeDay = episodeStudied(shown);
  const due = shown.filter((s) => dueOf(s) <= today);
  const upcoming = shown.filter((s) => dueOf(s) > today);
  /** @type {Map<string, string>} */
  const firstDue = new Map();
  for (const s of due) {
    if (!firstDue.has(s.ep) || dueOf(s) < /** @type {string} */ (firstDue.get(s.ep))) firstDue.set(s.ep, dueOf(s));
  }
  const order = (/** @type {(s: Studied) => string} */ group) => (/** @type {Studied} */ a, /** @type {Studied} */ b) =>
    group(a).localeCompare(group(b)) || episodeDay(b).localeCompare(episodeDay(a)) || a.ep.localeCompare(b.ep) || a.start - b.start;
  return {
    due: due.sort(order((s) => firstDue.get(s.ep) ?? '')),
    upcoming: upcoming.sort(order(dueOf)),
  };
}
