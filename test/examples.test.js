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

test('lists the episode on the page first, then the others in the order they were filed', () => {
  const lines = [line('BV1', 13), line('CC118', 376), line('CC3', 76), line('CC3', 274)];
  assert.deepEqual(groupLines(lines, 'CC3', {}).map((e) => e.ep), ['CC3', 'BV1', 'CC118']);
  assert.deepEqual(groupLines(lines, 'E062', {}).map((e) => e.ep), ['BV1', 'CC118', 'CC3']);
});

test('groups an episode\'s lines by the chapter each falls in, in story order', () => {
  const lines = [line('CC3', 10), line('CC3', 12), line('CC3', 40), line('CC3', 90)];
  const chapters = { CC3: [chapter(0, 9), chapter(10, 30), chapter(31, 39), chapter(40, 60)] };
  assert.deepEqual(groupLines(lines, 'CC3', chapters)[0].chapters.map((c) => [c.n, c.lines.map((l) => l.cue)]), [
    [1, [10, 12]],
    [3, [40]],
    [null, [90]],
  ]);
});

test('lists the lines of an episode not cut into chapters yet under none', () => {
  const groups = groupLines([line('E999', 3), line('E999', 8)], 'CC3', {});
  assert.deepEqual(groups[0].chapters, [{ n: null, lines: [line('E999', 3), line('E999', 8)] }]);
});

test('says when a common word lists only some of its lines', () => {
  assert.equal(countNote(5, 5, 4), '5 câu · 4 tập');
  assert.equal(countNote(20, 3147, 20), '20 trong 3147 câu · 20 tập');
});
