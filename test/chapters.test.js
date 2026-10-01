// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChapters, entryAt } from '../src/chapters.js';

const line = (s, start, end, text, extra = {}) => ({ s, start, end, text, speaker: 'A', role: 'storyteller', ...extra });

// Six sentences, the third of two lines, the fifth joined onto the fourth.
const lines = [
  line(0, 0, 30, '大家好。'),
  line(1, 31, 60, '我去了东京。'),
  line(2, 62, 90, '第一份工作，'),
  line(2, 90, 120, '是做保姆。'),
  line(3, 125, 150, '雇主很严格'),
  line(4, 150, 180, '规矩很多。', { u: 3 }),
];

test('a chapter runs from its first sentence to the line before the next chapter', () => {
  const { sidecar, lost, changed, long, short, uncovered } = buildChapters(lines, {
    chapters: [
      { from: 0, zh: '开场', vi: 'Mở đầu', first: '大家好。' },
      { from: 2, zh: '第一份工作', vi: 'Việc đầu tiên', first: '第一份工作，是做保姆。' },
    ],
  });
  assert.deepEqual(sidecar.chapters, [
    { zh: '开场', vi: 'Mở đầu', from: 0, to: 1, start: 0, end: 60 },
    { zh: '第一份工作', vi: 'Việc đầu tiên', from: 2, to: 5, start: 62, end: 180 },
  ]);
  assert.deepEqual([lost, changed, long, short, uncovered], [[], [], [], [], false]);
});

test('measures a chapter by its audio, and names the ones past two minutes or under one', () => {
  const { long, short } = buildChapters(lines, {
    chapters: [
      { from: 0, zh: '一', vi: 'Một', first: '大家好。' },
      { from: 1, zh: '二', vi: 'Hai', first: '我去了东京。' },
    ],
  });
  assert.deepEqual([long, short], [[1], [0]]);
});

test('a chapter whose first sentence was joined into the one before is dropped and named', () => {
  const { sidecar, lost } = buildChapters(lines, {
    chapters: [
      { from: 0, zh: '一', vi: 'Một', first: '大家好。' },
      { from: 4, zh: '规矩', vi: 'Quy tắc', first: '规矩很多。' },
    ],
  });
  assert.deepEqual(lost, [4]);
  assert.equal(sidecar.chapters.length, 1);
  assert.equal(sidecar.chapters[0].to, 5);
});

test('a fix to a chapter\'s first sentence keeps the chapter and names it', () => {
  const { sidecar, changed } = buildChapters(lines, {
    chapters: [{ from: 0, zh: '开场', vi: 'Mở đầu', first: '大家早。' }],
  });
  assert.deepEqual(changed, [0]);
  assert.equal(sidecar.chapters.length, 1);
});

test('says when the first chapter leaves the start of the episode out', () => {
  const { uncovered } = buildChapters(lines, { chapters: [{ from: 1, zh: '东京', vi: 'Tokyo', first: '我去了东京。' }] });
  assert.equal(uncovered, true);
});

test('the last chapter can stop before the outro, which then belongs to no chapter', () => {
  const { sidecar, lost } = buildChapters(lines, {
    chapters: [{ from: 0, zh: '一', vi: 'Một', first: '大家好。' }],
    end: { from: 2, first: '第一份工作，是做保姆。' },
  });
  assert.deepEqual(lost, []);
  assert.deepEqual([sidecar.chapters[0].to, sidecar.chapters[0].end], [1, 60]);
});

test('an end the joins swallowed is named, and the last chapter runs on to the end', () => {
  const { sidecar, lost } = buildChapters(lines, {
    chapters: [{ from: 0, zh: '一', vi: 'Một', first: '大家好。' }],
    end: { from: 4, first: '规矩很多。' },
  });
  assert.deepEqual(lost, [4]);
  assert.equal(sidecar.chapters[0].to, 5);
});

test('an entry takes its Chinese from the whole sentence, and only a unit can start one', () => {
  assert.deepEqual(entryAt(lines, 2, '工作', 'Việc'), { from: 2, zh: '工作', vi: 'Việc', first: '第一份工作，是做保姆。' });
  assert.deepEqual(entryAt(lines, 3, '规矩', 'Quy tắc')?.first, '雇主很严格规矩很多。');
  assert.equal(entryAt(lines, 4, '规矩', 'Quy tắc'), null);
});
