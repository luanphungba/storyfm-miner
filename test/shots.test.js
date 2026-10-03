// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterShots, framePercent } from '../docs/shots.js';

/** @type {import('../docs/shots.js').Place[]} */
const places = [
  ['p06-00', 20, 100, 100, 22],
  ['p06-00', 20, 300, 100, 22],
  null,
  ['p06-01', 20, 500, 100, 22],
  ['p07-00', 20, 120, 100, 22],
];

test('a chapter shows its screenshots in the order its lines first appear on them, each once', () => {
  assert.deepEqual(chapterShots(places, { from: 0, to: 3 }), ['p06-00', 'p06-01']);
  assert.deepEqual(chapterShots(places, { from: 4, to: 4 }), ['p07-00']);
  assert.deepEqual(chapterShots(places, { from: 2, to: 2 }), [], 'a line with no place adds no screenshot');
});

test('a frame is placed in percent of the picture, a little wider than the text, inside the screen', () => {
  assert.deepEqual(framePercent([100, 466, 100, 22], { width: 400, height: 932 }), { left: 24, top: 49.57, width: 27, height: 3.22 });
  assert.deepEqual(framePercent([0, 0, 400, 10], { width: 400, height: 932 }), { left: 0, top: 0, width: 100, height: 1.5 });
});
