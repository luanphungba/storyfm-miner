// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bucket, countNote, groupLines, toLine } from '../docs/examples.js';

const DATA = new URL('../docs/data/', import.meta.url);
const WORDS = new URL('words/', DATA);
const readJson = (/** @type {URL} */ url) => JSON.parse(readFileSync(url, 'utf8'));
/** [file name, { word: lines }] for every file the words are filed in. */
const filed = readdirSync(WORDS).filter((f) => /^\d+\.json$/.test(f)).map((f) => [f, readJson(new URL(f, WORDS))]);

const line = (ep, cue) => toLine([ep, cue, 0, cue * 2, cue * 2 + 1.5, '特殊的']);
const chapter = (from, to) => ({ zh: '', start: from * 2, end: to * 2 + 1.5, from, to });
const studied = (ep, c, dates) => ({ ep, episode: '', audio: '', n: 0, zh: '', vi: '', start: c.start, end: c.end, dates });
/** Each part as [studied?, [episode, [chapter, cues]...]...], to read at a glance. */
const shape = (parts) => parts.map((p) => [p.studied, p.episodes.map((e) => [e.ep, e.chapters.map((c) => [c.n, c.lines.map((l) => l.cue)])])]);

test('a filed line reads back by name', () => {
  assert.deepEqual(toLine(['CC3', 76, 3, 208.73, 210.63, '可能有特殊的做事逻辑。']), {
    ep: 'CC3', cue: 76, at: 3, start: 208.73, end: 210.63, text: '可能有特殊的做事逻辑。',
  });
});

test('picks a word\'s file the way tools/build_tokens.py filed it', () => {
  assert.equal(bucket('特殊'), (0x7279 + 0x6b8a) % 64);
  for (const [file, words] of filed) {
    assert.deepEqual(Object.keys(words).filter((word) => `${bucket(word)}.json` !== file), [], file);
  }
});

test('every filed line is still its episode\'s line — else rerun tools/build_tokens.py', () => {
  const episodes = new Map();
  const stale = [];
  for (const [, words] of filed) {
    for (const [word, lines] of Object.entries(words)) {
      for (const [ep, index, at, start, end, text] of lines) {
        if (!episodes.has(ep)) episodes.set(ep, readJson(new URL(`${ep}.json`, DATA)).cues);
        const cue = episodes.get(ep)[index];
        const same = cue?.text === text && cue.start === start && cue.end === end && text.startsWith(word, at);
        if (!same) stale.push(`${ep} #${index} ${word}`);
      }
    }
  }
  assert.deepEqual(stale.slice(0, 5), []);
});

test('with nothing studied, lists the episode on the page first, then the others as filed', () => {
  const lines = [line('BV1', 13), line('CC118', 376), line('CC3', 76), line('CC3', 274)];
  assert.deepEqual(groupLines(lines, 'CC3', {}, []).map((p) => [p.studied, p.episodes.map((e) => e.ep)]), [[false, ['CC3', 'BV1', 'CC118']]]);
  assert.deepEqual(groupLines(lines, 'E062', {}, []).map((p) => [p.studied, p.episodes.map((e) => e.ep)]), [[false, ['BV1', 'CC118', 'CC3']]]);
});

test('groups an episode\'s lines by the chapter each falls in, in story order', () => {
  const lines = [line('CC3', 10), line('CC3', 12), line('CC3', 40), line('CC3', 90)];
  const chapters = { CC3: [chapter(0, 9), chapter(10, 30), chapter(31, 39), chapter(40, 60)] };
  assert.deepEqual(shape(groupLines(lines, 'CC3', chapters, [])), [
    [false, [['CC3', [[1, [10, 12]], [3, [40]], [null, [90]]]]]],
  ]);
});

test('lists the lines in chapters already studied first, an episode split between the two', () => {
  const chapters = { CC2: [chapter(0, 9), chapter(10, 19)], CC3: [chapter(0, 9), chapter(10, 19)] };
  const lines = [line('CC2', 3), line('CC2', 12), line('CC3', 4), line('CC3', 15)];
  const marks = [studied('CC3', chapters.CC3[1], ['2026-10-03'])];
  assert.deepEqual(shape(groupLines(lines, 'CC2', chapters, marks)), [
    [true, [['CC3', [[1, [15]]]]]],
    [false, [['CC2', [[0, [3]], [1, [12]]]], ['CC3', [[0, [4]]]]]],
  ]);
});

test('among studied episodes, the one on the page first, then the latest studied', () => {
  const chapters = { CC1: [chapter(0, 9)], CC2: [chapter(0, 9)], CC3: [chapter(0, 9)], CC4: [chapter(0, 9)] };
  const lines = ['CC1', 'CC2', 'CC3', 'CC4'].map((ep) => line(ep, 5));
  const marks = [
    studied('CC1', chapters.CC1[0], ['2026-10-01', '2026-10-04']),
    studied('CC2', chapters.CC2[0], ['2026-10-02']),
    studied('CC3', chapters.CC3[0], ['2026-10-03']),
  ];
  assert.deepEqual(groupLines(lines, 'CC2', chapters, marks).map((p) => [p.studied, p.episodes.map((e) => e.ep)]), [
    [true, ['CC2', 'CC1', 'CC3']],
    [false, ['CC4']],
  ]);
});

test('lists the lines of an episode not cut into chapters yet under none, not studied', () => {
  const parts = groupLines([line('E999', 3), line('E999', 8)], 'CC3', {}, [studied('E999', chapter(0, 9), ['2026-10-01'])]);
  assert.deepEqual(shape(parts), [[false, [['E999', [[null, [3, 8]]]]]]]);
});

test('says when a common word lists only some of its lines', () => {
  assert.equal(countNote(5, 5, 4), '5 câu · 4 tập');
  assert.equal(countNote(20, 3147, 20), '20 trong 3147 câu · 20 tập');
});
