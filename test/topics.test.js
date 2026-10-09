// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexTopics } from '../src/topics.js';
import { nextChapter, nextEpisode, topicProgress, topicsOf } from '../docs/topics.js';

const episodes = ['CC4', 'CC118', 'CC39', 'E080', 'CC2'].map((id) => ({ id, title: `title ${id}` }));
const topic = (id, ids) => ({ id, vi: id, zh: '', about: '', episodes: ids });

test('a topic lists its transcribed episodes in order and keeps the rest as the ones to add', () => {
  const [education] = indexTopics([topic('giao-duc', ['CC4', 'CC39', 'E080'])], episodes, new Set(['CC4', 'E080', 'CC2']));
  assert.deepEqual(education.episodes, ['CC4', 'E080']);
  assert.deepEqual(education.planned, [{ id: 'CC39', title: 'title CC39' }]);
});

test('a topic with nothing transcribed yet is left out', () => {
  const topics = indexTopics([topic('giao-duc', ['CC4']), topic('cong-viec', ['CC39'])], episodes, new Set(['CC4']));
  assert.deepEqual(topics.map((t) => t.id), ['giao-duc']);
});

test('an episode that does not exist, or is named twice, stops the build', () => {
  assert.throws(() => indexTopics([topic('giao-duc', ['CC4', 'CC40'])], episodes, new Set()), /CC40/);
  assert.throws(() => indexTopics([topic('giao-duc', ['CC4', 'CC4'])], episodes, new Set()), /CC4 hai lần/);
  assert.throws(() => indexTopics([topic('a', ['CC4']), topic('a', ['CC2'])], episodes, new Set()), /a viết hai lần/);
});

// ---------- the pages ----------

const chapter = (start) => ({ zh: '', vi: '', start, end: start + 90 });
const studied = (ep, start, dates) => ({ ep, episode: '', audio: '', n: 0, zh: '', vi: '', start, end: start + 90, dates });
const education = { ...topic('giao-duc', ['CC4', 'CC118', 'E080']), planned: [] };
const chapters = new Map([
  ['CC4', [chapter(0), chapter(90), chapter(180)]],
  ['CC118', [chapter(0), chapter(90)]],
  ['E080', [chapter(5), chapter(95)]],
]);
const at = (/** @type {import('../docs/topics.js').Place | null} */ place) => place && `${place.ep}#${place.n}`;

test('an episode is in the topics that list it, and the next one is the one after it', () => {
  const work = { ...topic('cong-viec', ['CC2']), planned: [] };
  assert.deepEqual(topicsOf([education, work], 'CC118'), [education]);
  assert.deepEqual(topicsOf([education, work], 'E517'), []);
  assert.equal(nextEpisode(education, 'CC4'), 'CC118');
  assert.equal(nextEpisode(education, 'E080'), undefined);
  assert.equal(nextEpisode(education, 'CC2'), undefined);
});

test('counts each episode\'s chapters and those studied, by the chapter\'s start', () => {
  const list = [studied('CC4', 0.3, ['2026-10-06']), studied('CC4', 180, ['2026-10-07']), studied('E517', 0, ['2026-10-07'])];
  assert.deepEqual(topicProgress(education, chapters, list), [
    { ep: 'CC4', total: 3, studied: 2 },
    { ep: 'CC118', total: 2, studied: 0 },
    { ep: 'E080', total: 2, studied: 0 },
  ]);
});

test('starts the topic at its first chapter', () => {
  assert.equal(at(nextChapter(education, chapters, [])), 'CC4#0');
});

test('goes on after the chapter studied last, into the next episode', () => {
  const list = [studied('CC4', 0, ['2026-10-06']), studied('CC4', 90, ['2026-10-06']), studied('CC4', 180, ['2026-10-07'])];
  assert.equal(at(nextChapter(education, chapters, list)), 'CC118#0');
});

test('picks up after the chapter studied last, not the one furthest on', () => {
  const list = [studied('E080', 5, ['2026-10-01']), studied('CC4', 0, ['2026-10-08'])];
  assert.equal(at(nextChapter(education, chapters, list)), 'CC4#1');
});

test('on one day, goes on from the chapter furthest on, passing over one skipped', () => {
  const list = [studied('CC4', 90, ['2026-10-09']), studied('CC4', 180, ['2026-10-09'])];
  assert.equal(at(nextChapter(education, chapters, list)), 'CC118#0', 'CC4#0, an intro, stays skipped');
});

test('comes back to a chapter not studied once nothing is left after the last one', () => {
  const list = [studied('CC4', 0, ['2026-10-01']), studied('E080', 95, ['2026-10-08'])];
  assert.equal(at(nextChapter(education, chapters, list)), 'CC4#1');
  const all = [...chapters].flatMap(([ep, list]) => list.map((c) => studied(ep, c.start, ['2026-10-01'])));
  assert.equal(nextChapter(education, chapters, all), null);
});
