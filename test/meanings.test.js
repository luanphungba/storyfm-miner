// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { toRead } from '../src/meanings.js';

const line = (s, text, extra = {}) => ({ s, text, speaker: 'A', role: 'storyteller', ...extra });

// 也算是交代一下这个星期的任务。 cut into two lines, as CC5 has it.
const lines = [line(0, '也算是交代'), line(0, '一下这个星期的任务。')];
/** @type {import('../src/meanings.js').Token[][]} */
const tokens = [[[0, 1, 2, 0, 0], [1, 2, 3, 0, 0], [3, 2, 5, 0, 0]], [[0, 2, 1, 0, 0], [4, 2, 3, 0, 0], [7, 2, 4, 0, 0]]];
const written = new Set(['也', '算是', '交代', '一下', '星期', '任务']);
const hasMeaning = (/** @type {string} */ word) => written.has(word);

test('lists a written meaning until it has been read against this episode', () => {
  const pending = toRead(lines, tokens, hasMeaning, new Set());
  assert.deepEqual([...pending.keys()], ['算是', '交代', '星期', '任务']);
  assert.deepEqual(pending.get('交代'), { band: 5, isName: false, said: 1, contexts: ['也算是【交代】一下这个星期的任务。'] });
});

test('leaves out what has been read, and the HSK 1-2 words the reader already knows', () => {
  const pending = toRead(lines, tokens, hasMeaning, new Set(['算是', '星期', '任务']));
  assert.deepEqual([...pending.keys()], ['交代']);
});

test('lists a word with no meaning whatever its band', () => {
  const pending = toRead(lines, tokens, (word) => word !== '一下', new Set(['算是', '交代', '星期', '任务']));
  assert.deepEqual([...pending.keys()], ['一下']);
});

test('reads a word in its whole sentence, not the short line it sits on', () => {
  const pending = toRead(lines, tokens, hasMeaning, new Set());
  assert.deepEqual(pending.get('任务')?.contexts, ['也算是交代一下这个星期的【任务】。']);
});

test('cuts a long sentence to the words around the one being read', () => {
  const long = [line(0, '一二三四五六七八九十一二三四五交代一二三四五六七八九十一二三四五。')];
  const pending = toRead(long, [[[15, 2, 5, 0, 0]]], hasMeaning, new Set());
  assert.deepEqual(pending.get('交代')?.contexts, ['…二三四五六七八九十一二三四五【交代】一二三四五六七八九十一二三四…']);
});

test('counts every time a word is said but shows each sentence once, and two at most', () => {
  const said = [line(0, '交代。'), line(1, '交代。'), line(2, '交代。'), line(3, '还没交代呢。', { u: 2 })];
  const at = /** @type {import('../src/meanings.js').Token[][]} */ ([[[0, 2, 5, 0, 0]], [[0, 2, 5, 0, 0]], [[0, 2, 5, 0, 0]], [[2, 2, 5, 0, 0]]]);
  const pending = toRead(said, at, hasMeaning, new Set());
  assert.equal(pending.get('交代')?.said, 4);
  assert.deepEqual(pending.get('交代')?.contexts, ['【交代】。', '【交代】。还没交代呢。']);
});
