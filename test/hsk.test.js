// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelLabel, levelOf } from '../docs/hsk.js';

test('a level is named by its band, 7 standing for 7-9, a name or no band said plainly', () => {
  assert.equal(levelLabel(1, false), 'HSK 1');
  assert.equal(levelLabel(4, false), 'HSK 4');
  assert.equal(levelLabel(7, false), 'HSK 7-9');
  assert.equal(levelLabel(0, false), 'ngoài HSK');
  assert.equal(levelLabel(0, true), 'tên riêng');
  assert.equal(levelLabel(3, true), 'tên riêng');
});

const texts = ['然后呢，下个星期我有打算邀请到', '或者任何嘉宾来录这个节目，', '他叫小王'];
const tokens = [
  [[0, 2, 2, 110, 0], [6, 2, 1, 40, 0], [10, 2, 3, 22, 0], [12, 2, 4, 5, 0]],
  [[0, 2, 3, 30, 0], [2, 2, 4, 12, 0], [4, 2, 7, 2, 0], [10, 2, 2, 60, 0]],
  [[0, 1, 1, 900, 0], [1, 1, 1, 300, 0], [2, 2, 0, 1, 1]],
];

test('a word takes the level its span is filed with, wherever in the episode it is', () => {
  assert.equal(levelOf(texts, tokens, '邀请'), 'HSK 4');
  assert.equal(levelOf(texts, tokens, '嘉宾'), 'HSK 7-9');
  assert.equal(levelOf(texts, tokens, '小王'), 'tên riêng');
});

test('only a whole span is the word: one inside a longer span, or none at all, has no level', () => {
  assert.equal(levelOf(texts, tokens, '邀'), null);
  assert.equal(levelOf(texts, tokens, '偷'), null);
  assert.equal(levelOf(texts, [], '邀请'), null);
});
