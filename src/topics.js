// @ts-check
// Topics: episodes grouped by what they are about, so one subject can be studied episode after
// episode until its words stick. A topic is kept tight (高考 and university, not everything set in a
// school): the other 高考 episodes held 8–11 points more of CC4's and CC118's harder words than as
// many words of other topics did, while E081, a course in Pyongyang, held no more than they did.
//
// data/topics.json is the one place topics are written, each one's episodes in the order to study
// them. It may name episodes not transcribed yet: they wait in the index as the topic's next ones, and
// take their place in it once added.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { paths } from './paths.js';

/** @typedef {{ id: string, vi: string, zh: string, about: string, episodes: string[] }} Topic */
/** @typedef {Omit<Topic, 'episodes'> & { episodes: string[], planned: { id: string, title: string }[] }} IndexedTopic
 *   A topic as the pages read it: its transcribed episodes in study order, and the ones still to add. */

/** @returns {Promise<Topic[]>} */
export async function loadTopics() {
  if (!existsSync(paths.topics)) return [];
  return JSON.parse(await readFile(paths.topics, 'utf8')).topics;
}

/**
 * The topics for the index. A topic with nothing transcribed yet is left out, as there is nothing in
 * it to study. An id that is no episode at all is a typo, and one named twice would be studied twice,
 * so either stops the build rather than drop out of the topic unnoticed.
 * @param {Topic[]} topics
 * @param {{ id: string, title: string }[]} episodes  every episode that can be built
 * @param {Set<string>} built  the ids with a transcript
 * @returns {IndexedTopic[]}
 */
export function indexTopics(topics, episodes, built) {
  const titles = new Map(episodes.map((episode) => [episode.id, episode.title]));
  const ids = topics.map((topic) => topic.id);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) throw new Error(`data/topics.json: chủ đề ${twice.join(', ')} viết hai lần`);
  for (const topic of topics) {
    const unknown = topic.episodes.filter((id) => !titles.has(id));
    if (unknown.length) throw new Error(`data/topics.json: ${topic.id} có mã tập không tồn tại: ${unknown.join(', ')}`);
    const repeated = topic.episodes.filter((id, i) => topic.episodes.indexOf(id) !== i);
    if (repeated.length) throw new Error(`data/topics.json: ${topic.id} có ${repeated.join(', ')} hai lần`);
  }
  return topics
    .map((topic) => ({
      ...topic,
      episodes: topic.episodes.filter((id) => built.has(id)),
      planned: topic.episodes.filter((id) => !built.has(id)).map((id) => ({ id, title: titles.get(id) ?? id })),
    }))
    .filter((topic) => topic.episodes.length);
}
