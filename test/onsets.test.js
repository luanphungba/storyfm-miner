// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { findOnsets, applyOnsets, FRAME_MS } from '../src/onsets.js';

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
