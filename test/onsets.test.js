// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { findOnsets, applyOnsets, findRuns, spreadRuns, FRAME_MS } from '../src/onsets.js';

/** Loudness, 10ms a frame: speech at 0dB except the quiet spans given as [fromMs, toMs). */
function audio(/** @type {number} */ totalMs, /** @type {[number, number][]} */ quiet) {
  const db = new Float32Array(totalMs / FRAME_MS).fill(0);
  for (const [from, to] of quiet) db.fill(-60, from / FRAME_MS, to / FRAME_MS);
  return db;
}

// E001's 那房子都像高级公寓一样，就是装修都很好嘛。: the pause after 一样 is at 1850-2150ms, but the
// ASR stretched 一 over it, pushed 样 into 就是's audio and collapsed 就是 onto 装.
const words = [
  { text: '一', start: 1590, end: 2170 },
  { text: '样，', start: 2170, end: 2590 },
  { text: '就是', start: 2590, end: 2590 },
  { text: '装', start: 2590, end: 2630 + 100 },
  { text: '修', start: 2730, end: 2900 },
];

test('starts a collapsed word after the pause before it, and ends the word before in that pause', () => {
  const onsets = findOnsets(words, audio(4000, [[1850, 2150]]));
  assert.deepEqual(onsets, { 2: { was: 2590, start: 2150, prevEnd: 2000 } });
  const moved = applyOnsets(words, onsets);
  assert.deepEqual([moved[1].end, moved[2].start], [2000, 2150]);
  assert.equal(moved[2].text, '就是');
  assert.equal(words[2].start, 2590, 'the raw words are left alone');
});

test('leaves a collapsed word alone in continuous speech', () => {
  assert.deepEqual(findOnsets(words, audio(4000, [])), {});
});

test('ignores a dip too short to be a pause between words', () => {
  assert.deepEqual(findOnsets(words, audio(4000, [[2400, 2450]])), {});
});

test('does not reach further back than a collapsed character could take to say', () => {
  // 给 is one character: a pause 800ms before it lies behind words the ASR placed right.
  const one = [
    { text: '间', start: 1000, end: 1200 },
    { text: '给', start: 2000, end: 2000 },
    { text: '你', start: 2000, end: 2200 },
  ];
  assert.deepEqual(findOnsets(one, audio(3000, [[1000, 1200]])), {});
  assert.deepEqual(Object.keys(findOnsets(one, audio(3000, [[1500, 1750]]))), ['1']);
});

test('refuses a ledger entry whose word has moved since it was measured', () => {
  assert.throws(() => applyOnsets(words, { 2: { was: 2500, start: 2150, prevEnd: 2000 } }), /không còn/);
});

// CC3's 丹麦，也是进行类似的交换学习这样的。: the ASR placed 进行 and parked 类似的交换学习这样的 on the end
// of 行, the next word only at 163.12 — the run is said in that gap, and the line looped 丹麦也是进行.
const parked = [
  { text: '进', start: 920, end: 1100 },
  { text: '行', start: 1100, end: 1200 },
  { text: '类', start: 1200, end: 1200 },
  { text: '似', start: 1200, end: 1200 },
  { text: '这样', start: 1200, end: 1200 },
  { text: '的。', start: 1200, end: 1200 },
  { text: '一个', start: 3200, end: 3700 },
];

test('spreads a run parked on the word before over the gap after it, by its characters', () => {
  const runs = findRuns(parked, audio(4000, []));
  assert.deepEqual(runs, { 2: { was: 1200, end: 3200 } });
  const spread = spreadRuns(parked, runs);
  assert.deepEqual(spread.slice(2, 6).map((w) => [w.start, w.end]), [[1200, 1600], [1600, 2000], [2000, 2800], [2800, 3200]]);
  assert.equal(parked[5].end, 1200, 'the raw words are left alone');
});

test('ends a parked run at the pause before the next word', () => {
  assert.deepEqual(findRuns(parked, audio(4000, [[2900, 3200]])), { 2: { was: 1200, end: 2900 } });
  assert.deepEqual(findRuns(parked, audio(4000, [[3100, 3200]])), { 2: { was: 1200, end: 3200 } }, 'a dip, not a pause');
});

test('does not spread a run further than its characters could take to say', () => {
  const late = parked.map((w, k) => (k === 6 ? { ...w, start: 9000, end: 9500 } : w));
  assert.deepEqual(findRuns(late, audio(10000, [])), { 2: { was: 1200, end: 1200 + 5 * 400 } });
});

test('leaves a parked run alone when the gap after it is silent', () => {
  assert.deepEqual(findRuns(parked, audio(4000, [[1200, 3200]])), {});
});

test('leaves punctuation parked on its word alone: there is nothing to hear', () => {
  const closing = [{ text: '走', start: 800, end: 1000 }, { text: '。”', start: 1000, end: 1000 }, { text: '然', start: 1500, end: 1700 }];
  assert.deepEqual(findRuns(closing, audio(2000, [])), {});
});

test('does not walk a parked run back into the pause before it', () => {
  assert.deepEqual(findOnsets(parked, audio(4000, [[600, 900]])), {});
});

test('only spreads a run with a gap after it: one parked on the next word is said before', () => {
  assert.deepEqual(findRuns(words, audio(4000, [])), {});
});

test('refuses a run whose words have moved since it was measured', () => {
  assert.throws(() => spreadRuns(parked, { 2: { was: 1300, end: 3200 } }), /không còn/);
  assert.throws(() => spreadRuns(parked, { 3: { was: 1200, end: 3200 } }), /không còn/);
});
