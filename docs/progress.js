// @ts-check
// What the listening adds up to, from what the server keeps: the way to a thousand hours, the days in
// a row, each day's hours, chapters and words, and how many times each chapter was heard. Pure, so
// test/progress.test.js covers it; index.html, listen.html and stats.html show it.

import { SAME_START_S, daysBetween, findStudied, lastStudied } from './studied.js';

export const GOAL_HOURS = 1000;
/** A day counts as listened on, for the days in a row, from this much. */
const LISTENED_DAY_S = 60;
/** A chapter shows as heard from this much, so skimming past it on the way to another does not list it. */
const HEARD_CHAPTER_S = 30;
/** The pace is the average of up to this many days before today. */
const PACE_DAYS = 7;

/** @typedef {import('./listening.js').Page} Page */
/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {Record<string, Partial<Record<Page, number>>>} Days  Seconds heard per day and page, as the server sums them. */
/** @typedef {{ ep: string, start: number, seconds: number, audio: number, days: number, last: string, byDay?: Record<string, number> }} Heard
 *   One chapter as the server sums it: the time spent on it, the audio of it heard (more than the time
 *   at a faster speed), on how many days, the last of them, and the audio of it heard on each. */
/** @typedef {{ zh: string, vi: string, start: number, end: number }} Chapter  As data/<ep>.chapters.json has it. */
/**
 * @typedef {{ today: Partial<Record<Page, number>>, total: number, pace: number, reach: string | null }} Progress
 *   Today's seconds per page, every second so far, the seconds a day lately, and the day the goal is
 *   reached at that pace.
 */
/** @typedef {{ day: string, player: number, listen: number, chapters: number, words: number }} DayRow */
/**
 * @typedef {{ ep: string, n: number | null, zh: string, vi: string, start: number, end: number,
 *   seconds: number, passes: number, heardDays: number, last: string, studied: string[] }} ChapterRow
 *   A chapter heard or studied: `n` its place in the episode, null when the episode's chapters no
 *   longer have it; `seconds` the time spent on it, `passes` the times through it.
 */
/** @typedef {'recent' | 'most' | 'least'} ChapterOrder */

// ---------- days ----------

export function addDays(/** @type {string} */ day, /** @type {number} */ count) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** Seconds heard on a day, on every page. */
export const heardOn = (/** @type {Days} */ days, /** @type {string} */ day) =>
  Object.values(days[day] ?? {}).reduce((sum, seconds) => sum + (seconds ?? 0), 0);

/** @returns {Progress} */
export function progress(/** @type {Days} */ days, /** @type {string} */ today) {
  const total = Object.keys(days).reduce((sum, day) => sum + heardOn(days, day), 0);
  // Today is not over, so the pace leaves it out; and it starts at the first day counted, so the
  // first week is not averaged with days from before there was a count.
  const first = Object.keys(days).sort()[0];
  const span = first ? Math.min(PACE_DAYS, daysBetween(first, today)) : 0;
  let recent = 0;
  for (let back = 1; back <= span; back += 1) recent += heardOn(days, addDays(today, -back));
  const pace = span > 0 ? recent / span : 0;
  const left = GOAL_HOURS * 3600 - total;
  return { today: days[today] ?? {}, total, pace, reach: pace > 0 && left > 0 ? addDays(today, Math.ceil(left / pace)) : null };
}

/** Days in a row with listening, up to today. Today not listened on yet does not break it: it is not over. */
export function streak(/** @type {Days} */ days, /** @type {string} */ today) {
  let day = heardOn(days, today) >= LISTENED_DAY_S ? today : addDays(today, -1);
  let count = 0;
  while (heardOn(days, day) >= LISTENED_DAY_S) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/** Days listened on, ever. */
export const listenedDays = (/** @type {Days} */ days) =>
  Object.keys(days).filter((day) => heardOn(days, day) >= LISTENED_DAY_S).length;

/**
 * The `count` days up to today, oldest first: each one's hours by page, the chapters marked studied
 * on it and the words added.
 * @param {{ days: Days, studied: Studied[], words: Record<string, number>, today: string, count: number }} input
 * @returns {DayRow[]}
 */
export function dayRows({ days, studied, words, today, count }) {
  return Array.from({ length: count }, (_, k) => {
    const day = addDays(today, k - count + 1);
    return {
      day,
      player: days[day]?.player ?? 0,
      listen: days[day]?.listen ?? 0,
      chapters: studied.filter((s) => s.dates.includes(day)).length,
      words: words[day] ?? 0,
    };
  });
}

// ---------- chapters ----------

/** The heard rows that are this chapter: a re-cut can nudge its start, as findStudied allows. */
const heardOf = (/** @type {Heard[]} */ heard, /** @type {string} */ ep, /** @type {number} */ start) =>
  heard.filter((h) => h.ep === ep && Math.abs(h.start - start) < SAME_START_S);

/** The time spent on a chapter and the audio of it heard, on every day and page. */
export const heardTotals = (/** @type {Heard[]} */ heard, /** @type {string} */ ep, /** @type {number} */ start) =>
  heardOf(heard, ep, start).reduce((sum, h) => ({ seconds: sum.seconds + h.seconds, audio: sum.audio + h.audio }), { seconds: 0, audio: 0 });

/** Times through a chapter: the audio of it heard over its length, so a pass at 2x is still one pass,
 * and a line of it looped counts its share. */
export const passes = (/** @type {number} */ audio, /** @type {number} */ length) => (length > 0 ? audio / length : 0);

/**
 * Every chapter heard for more than a skim or marked studied, in episode order.
 * @param {{ heard: Heard[], studied: Studied[], chaptersOf: Record<string, Chapter[]> }} input
 * @returns {ChapterRow[]}
 */
export function chapterRows({ heard, studied, chaptersOf }) {
  /** @type {ChapterRow[]} */
  const rows = [];
  const placed = new Set();
  const row = (/** @type {string} */ ep, /** @type {number | null} */ n, /** @type {Chapter} */ c, /** @type {Studied | undefined} */ s) => {
    const mine = heardOf(heard, ep, c.start);
    const { seconds, audio } = heardTotals(heard, ep, c.start);
    const last = [...mine.map((h) => h.last), s ? lastStudied(s) : ''].sort().at(-1) ?? '';
    return {
      ep, n, zh: c.zh, vi: c.vi, start: c.start, end: c.end, seconds, passes: passes(audio, c.end - c.start),
      heardDays: Math.max(0, ...mine.map((h) => h.days)), last, studied: s?.dates ?? [],
    };
  };
  for (const [ep, chapters] of Object.entries(chaptersOf)) {
    chapters.forEach((c, n) => {
      const s = findStudied(studied, ep, c.start);
      if (s) placed.add(s);
      if (s || heardTotals(heard, ep, c.start).seconds >= HEARD_CHAPTER_S) rows.push(row(ep, n, c, s));
    });
  }
  // A studied chapter whose episode no longer cuts there still shows, as it was studied.
  for (const s of studied) if (!placed.has(s)) rows.push(row(s.ep, null, s, s));
  return rows;
}

/** The rows in the order picked: the latest first, or by passes with the latest first among equals. */
export function sortChapters(/** @type {ChapterRow[]} */ rows, /** @type {ChapterOrder} */ order) {
  const latest = (/** @type {ChapterRow} */ a, /** @type {ChapterRow} */ b) =>
    b.last.localeCompare(a.last) || a.ep.localeCompare(b.ep) || a.start - b.start;
  const byPasses = {
    recent: () => 0,
    most: (/** @type {ChapterRow} */ a, /** @type {ChapterRow} */ b) => b.passes - a.passes,
    least: (/** @type {ChapterRow} */ a, /** @type {ChapterRow} */ b) => a.passes - b.passes,
  }[order];
  return [...rows].sort((a, b) => byPasses(a, b) || latest(a, b));
}

/**
 * One row per episode with a chapter heard or studied, the latest first.
 * @param {{ rows: ChapterRow[], chaptersOf: Record<string, Chapter[]>, titles: Record<string, string> }} input
 */
export function episodeRows({ rows, chaptersOf, titles }) {
  const episodes = [...new Set(rows.map((r) => r.ep))].map((ep) => {
    const mine = rows.filter((r) => r.ep === ep);
    return {
      ep,
      title: titles[ep] ?? ep,
      chapters: chaptersOf[ep]?.length ?? 0,
      studied: mine.filter((r) => r.studied.length).length,
      seconds: mine.reduce((sum, r) => sum + r.seconds, 0),
      last: mine.map((r) => r.last).sort().at(-1) ?? '',
    };
  });
  return episodes.sort((a, b) => b.last.localeCompare(a.last) || a.ep.localeCompare(b.ep));
}

// ---------- the chart ----------

/** Gridlines for a column of hours: steps of a quarter, half, one, two or four hours, at most five of
 * them, the top one at or above the tallest day. */
export function hourTicks(/** @type {number} */ tallest) {
  const steps = [900, 1800, 3600, 7200, 14_400];
  const step = steps.find((s) => tallest <= 4 * s) ?? 14_400;
  const top = Math.max(step, Math.ceil(tallest / step) * step);
  return Array.from({ length: top / step + 1 }, (_, k) => k * step);
}

/** "30 phút", "1 giờ", "1,5 giờ": a tick's label. */
export const formatTick = (/** @type {number} */ seconds) =>
  (seconds < 3600 ? `${seconds / 60} phút` : `${(seconds / 3600).toLocaleString('vi-VN')} giờ`);

// ---------- saying it ----------

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "T5": a day's weekday, as a Vietnamese calendar abbreviates it. */
export function weekday(/** @type {string} */ day) {
  const [year, month, date] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
}

/** "Hôm nay", "Hôm qua", "T5 1/10". */
export function shortDay(/** @type {string} */ day, /** @type {string} */ today) {
  const back = daysBetween(day, today);
  if (back === 0) return 'Hôm nay';
  if (back === 1) return 'Hôm qua';
  const [, month, date] = day.split('-').map(Number);
  return `${weekday(day)} ${date}/${month}`;
}

/** "1 giờ 12 phút", "2 giờ", "45 phút". */
export function formatDuration(/** @type {number} */ seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} phút`;
  return minutes % 60 ? `${hours} giờ ${minutes % 60} phút` : `${hours} giờ`;
}

/** "37,5": hours to one decimal. */
export const formatHours = (/** @type {number} */ seconds) =>
  (seconds / 3600).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** "0,4 lượt", "3,5 lượt", "12 lượt": tenths while they still matter. */
export const formatPasses = (/** @type {number} */ count) =>
  `${count.toLocaleString('vi-VN', { maximumFractionDigits: count < 10 ? 1 : 0 })} lượt`;

/** "Hôm nay nghe 1 giờ 12 phút (học 40 phút, nghe lại 32 phút)": the split only when there is one. */
export function todayLine(/** @type {Progress} */ p) {
  const { player = 0, listen = 0 } = p.today;
  const split = player >= 60 && listen >= 60 ? ` (học ${formatDuration(player)}, nghe lại ${formatDuration(listen)})` : '';
  return `Hôm nay nghe ${formatDuration(player + listen)}${split}`;
}

/** "Tổng 37,5/1000 giờ · TB 2 giờ 5 phút/ngày · đủ 1000 giờ khoảng tháng 3/2028" */
export function goalLine(/** @type {Progress} */ p) {
  const parts = [`Tổng ${formatHours(p.total)}/${GOAL_HOURS} giờ`];
  if (p.total >= GOAL_HOURS * 3600) {
    parts.push('đã đủ mục tiêu');
  } else if (p.reach) {
    parts.push(`TB ${formatDuration(p.pace)}/ngày`, `đủ ${GOAL_HOURS} giờ ${reachLabel(p.reach)}`);
  }
  return parts.join(' · ');
}

/** "khoảng tháng 3/2028" */
export function reachLabel(/** @type {string} */ day) {
  const [year, month] = day.split('-').map(Number);
  return `khoảng tháng ${month}/${year}`;
}
