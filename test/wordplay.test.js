// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineOf, nextWithLine } from '../docs/wordplay.js';

const lines = [
  { start: 60.1, end: 62.4, text: '我们邀请了朋友，' },
  { start: 67.48, end: 70.52, text: '或者任何嘉宾来录这个节目，' },
  { start: 81.42, end: 84.74, text: '再邀请一个嘉宾。' },
];

test('a word plays in the line it was tapped in, not another that says it too', () => {
  assert.equal(lineOf(lines, '嘉宾', 67.48), lines[1]);
  assert.equal(lineOf(lines, '嘉宾', 81.42), lines[2]);
});

test('a line recut since the tap is found by the nearest line that still says the word', () => {
  assert.equal(lineOf(lines, '邀请', 61.5), lines[0]);
  assert.equal(lineOf(lines, '嘉宾', 69), lines[1]);
});

test('a word no line says has no line', () => {
  assert.equal(lineOf(lines, '偷', 67.48), null);
});

test('the list plays on to the next word with a line, and round to the first after the last', () => {
  const each = [lines[0], null, lines[1], lines[2]];
  assert.equal(nextWithLine(each, -1), 0);
  assert.equal(nextWithLine(each, 0), 2);
  assert.equal(nextWithLine(each, 2), 3);
  assert.equal(nextWithLine(each, 3), 0);
});

test('a list with one line keeps to it, and one with none has nothing to play', () => {
  assert.equal(nextWithLine([null, lines[1]], 1), 1);
  assert.equal(nextWithLine([null, null], -1), -1);
  assert.equal(nextWithLine([], -1), -1);
});
