// @ts-check
// The studied chapters as the pages use them: which one a chapter on the page is, which ones are
// recent, in what order they play, how long ago each was studied, and the link back to it in the
// player. Pure, so the player and the "Nghe lại" page share it and test/studied.test.js covers it.
// The list itself lives on the server (server/miner.py), so every device sees the same one.

/**
 * @typedef {{ ep: string, episode: string, audio: string, n: number, zh: string, vi: string,
 *   start: number, end: number, dates: string[] }} Studied
 *   One chapter as it was marked studied, with every day it was: enough to play it back without
 *   loading its episode.
 */

/** A studied chapter is the chapter on the page that starts this close to it: a re-cut can nudge a
 * chapter's first line, and the server matches the same way. */
export const SAME_START_S = 0.5;

/** The loop bar shows tenths of a second, so a chapter goes in rounded outward: a loop a few
 * hundredths longer catches a breath of silence, one a few shorter clips a syllable. */
export const floorTenth = (/** @type {number} */ seconds) => Math.floor(seconds * 10) / 10;
export const ceilTenth = (/** @type {number} */ seconds) => Math.ceil(seconds * 10) / 10;

/** @returns {Studied | undefined} */
export function findStudied(/** @type {Studied[]} */ list, /** @type {string} */ ep, /** @type {number} */ start) {
  return list.find((s) => s.ep === ep && Math.abs(s.start - start) < SAME_START_S);
}

/** The latest day a chapter was studied, as YYYY-MM-DD. */
export const lastStudied = (/** @type {Studied} */ s) => [...s.dates].sort().at(-1) ?? '';

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(/** @type {string} */ from, /** @type {string} */ to) {
  const utc = (/** @type {string} */ day) => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** How long ago a day was, as the list says it. */
export function dayLabel(/** @type {string} */ day, /** @type {string} */ today) {
  const days = daysBetween(day, today);
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  return `${days} ngày trước`;
}

/**
 * The chapters to play: studied within the last `days` days counting today (all of them when
 * null), of one episode when `ep` is given. Each episode plays whole and in story order, so a pass
 * tells its story as it was told, even when its chapters were studied days apart. The episode
 * studied latest comes first, because what was studied yesterday most needs hearing again.
 * @param {Studied[]} list
 * @param {{ today: string, days: number | null, ep?: string }} filter
 */
export function playlist(list, { today, days, ep }) {
  const shown = list.filter((s) => (days === null || daysBetween(lastStudied(s), today) < days) && (!ep || s.ep === ep));
  const episodeDay = episodeStudied(shown);
  return shown.sort((a, b) => episodeDay(b).localeCompare(episodeDay(a)) || a.ep.localeCompare(b.ep) || a.start - b.start);
}

/** The latest day any of a chapter's episode was studied, among the chapters given. */
export function episodeStudied(/** @type {Studied[]} */ list) {
  /** @type {Map<string, string>} */
  const latest = new Map();
  for (const s of list) {
    if (lastStudied(s) > (latest.get(s.ep) ?? '')) latest.set(s.ep, lastStudied(s));
  }
  return (/** @type {Studied} */ s) => latest.get(s.ep) ?? '';
}

/**
 * A shuffled copy, with `first` kept first: the chapter tapped is the one that should play now.
 * @template T
 * @param {T[]} items
 * @param {T | undefined} first
 * @param {() => number} random
 */
export function shuffled(items, first, random = Math.random) {
  const rest = items.filter((item) => item !== first);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first === undefined ? rest : [first, ...rest];
}

/**
 * The chapters with their episodes shuffled, each episode's chapters still together and in the
 * order given: a shuffle changes which story comes next, never the order a story is told in. The
 * episode of `first`, the chapter tapped, comes first, so it plays now.
 * @template {{ ep: string }} T
 * @param {T[]} chapters
 * @param {T | undefined} first
 * @param {() => number} random
 */
export function shuffledByEpisode(chapters, first, random = Math.random) {
  /** @type {Map<string, T[]>} */
  const episodes = new Map();
  for (const chapter of chapters) {
    let episode = episodes.get(chapter.ep);
    if (!episode) episodes.set(chapter.ep, (episode = []));
    episode.push(chapter);
  }
  const groups = [...episodes.values()];
  return shuffled(groups, groups.find((episode) => first !== undefined && episode.includes(first)), random).flat();
}

/** The player opened on the chapter, looped: rounded as the loop bar holds a chapter, so the player
 * recognises the range as that chapter. */
export function chapterLink(/** @type {Pick<Studied, 'ep' | 'start' | 'end'>} */ s) {
  return `player.html?ep=${encodeURIComponent(s.ep)}&start=${floorTenth(s.start)}&end=${ceilTenth(s.end)}`;
}
