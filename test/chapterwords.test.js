// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { newWords } from '../docs/chapterwords.js';

const texts = ['通用设置', '关于本机', '网络设置', 'Wi-Fi网络'];
const tokens = [
  [[0, 2, 1, 3, 0], [2, 2, 1, 3, 0]],
  [[0, 2, 1, 1, 0], [2, 2, 0, 1, 0]],
  [[0, 2, 1, 2, 0], [2, 2, 1, 3, 0]],
  [[0, 5, 0, 1, 0], [5, 2, 1, 2, 0]],
];

test('a chapter lists the Chinese words no chapter before it had, where each is first heard', () => {
  assert.deepEqual(newWords(texts, tokens, [{ from: 0, to: 1 }, { from: 2, to: 3 }]), [
    [{ word: '通用', line: 0, start: 0, band: 1 }, { word: '设置', line: 0, start: 2, band: 1 }, { word: '关于', line: 1, start: 0, band: 1 }, { word: '本机', line: 1, start: 2, band: 0 }],
    [{ word: '网络', line: 2, start: 0, band: 1 }],
  ]);
});

test('a line with no word spans yet adds nothing rather than failing', () => {
  assert.deepEqual(newWords(texts, [], [{ from: 0, to: 3 }]), [[]]);
});
