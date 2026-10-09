// @ts-check
// Topics as the pages use them: which topics an episode is in, how far into a topic the chapters
// studied go, and the chapter to study next. Pure, so test/topics.test.js covers it. The topics are
// written in data/topics.json and reach the pages through data/index.json (src/topics.js).

import { findStudied, lastStudied } from './studied.js';

/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {{ id: string, vi: string, zh: string, about: string, episodes: string[], planned: { id: string, title: string }[] }} Topic
 *   The topic's transcribed episodes in the order to study them, and the ones still to add. */
/** @typedef {{ zh: string, vi: string, start: number, end: number }} Chapter */
/** @typedef {{ ep: string, n: number, chapter: Chapter }} Place  A chapter and where it stands. */

/** The topic chosen last on the episode list, in this browser: the player goes by it too. */
export const TOPIC_KEY = 'ci-topic';

/** The topics an episode is in. */
export const topicsOf = (/** @type {Topic[]} */ topics, /** @type {string} */ ep) =>
  topics.filter((topic) => topic.episodes.includes(ep));

/** The episode after `ep` in the topic's order, if there is one. */
export function nextEpisode(/** @type {Topic} */ topic, /** @type {string} */ ep) {
  const i = topic.episodes.indexOf(ep);
  return i < 0 ? undefined : topic.episodes[i + 1];
}

/**
 * How many chapters each of the topic's episodes has, and how many of them were studied.
 * @param {Topic} topic
 * @param {Map<string, Chapter[]>} chapters  each episode's chapters; one not cut into chapters has none
 * @param {Studied[]} studied
 */
export function topicProgress(topic, chapters, studied) {
  return topic.episodes.map((ep) => {
    const list = chapters.get(ep) ?? [];
    return { ep, total: list.length, studied: list.filter((c) => findStudied(studied, ep, c.start)).length };
  });
}

/**
 * The chapter to study next: the first one not studied after the one studied last, going through the
 * topic's episodes in order. Counting from the last one studied, not the furthest, picks up where the
 * study left off even when an episode further on was studied before the topic was; a chapter skipped
 * on purpose, an intro or the credits, is passed over. With nothing left after it, the first chapter
 * not studied; with nothing studied, the topic's first chapter; null once every chapter is.
 * @param {Topic} topic
 * @param {Map<string, Chapter[]>} chapters
 * @param {Studied[]} studied
 * @returns {Place | null}
 */
export function nextChapter(topic, chapters, studied) {
  const places = topic.episodes.flatMap((ep) => (chapters.get(ep) ?? []).map((chapter, n) => ({ ep, n, chapter })));
  const days = places.map(({ ep, chapter }) => {
    const s = findStudied(studied, ep, chapter.start);
    return s ? lastStudied(s) : '';
  });
  // The latest day wins; on the same day, the chapter further on.
  const last = days.reduce((best, day, k) => (day && day >= (days[best] ?? '') ? k : best), -1);
  const after = days.findIndex((day, k) => !day && k > last);
  const k = after >= 0 ? after : days.indexOf('');
  return k >= 0 ? places[k] : null;
}
