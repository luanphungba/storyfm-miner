// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { vocabulary } from '../docs/vocab.js';

const chapter = (/** @type {number} */ start, /** @type {string[]} */ dates, ep = 'CC4') => ({ ep, start, end: start + 90, dates });
/** One line per chapter's start, and one between them that no chapter has. */
const linesOf = {
  CC4: /** @type {[number, string][]} */ ([[0, '我 尴尬'], [95, '外面'], [100, '尴尬 很 脏'], [200, '尴尬 学 法语'], [300, '脏']]),
  CC5: /** @type {[number, string][]} */ ([[0, '尴尬']]),
};
const vocab = { base: ['我', '很'], splits: { 很脏: ['很', '脏'], 学法语: ['学', '法语'] } };
const latest = (tapped = {}, known = {}) => ({ tapped, known });

test('a word heard untapped is understood, and HSK 1-2 counts unheard', () => {
  const v = vocabulary({ studied: [chapter(0, ['2026-10-01'])], linesOf, vocab, latest: latest() });
  assert.deepEqual(v, { understood: 3, solid: 2, heard: 2 }); // 我 很, and 尴尬 heard once
});

test('a word is solid once heard untapped in three chapters over two days', () => {
  const twoDays = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-01']), chapter(0, ['2026-10-02'], 'CC5')];
  const oneDay = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-01']), chapter(0, ['2026-10-01'], 'CC5')];
  const twoChapters = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-02'])];
  assert.equal(vocabulary({ studied: twoDays, linesOf, vocab, latest: latest() }).solid, 3);
  assert.equal(vocabulary({ studied: oneDay, linesOf, vocab, latest: latest() }).solid, 2);
  assert.equal(vocabulary({ studied: twoChapters, linesOf, vocab, latest: latest() }).solid, 2);
});

test('a tapped word counts again only once heard untapped on a later day', () => {
  const tapped = latest({ 尴尬: '2026-10-02' });
  const sameDay = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-02'])];
  assert.equal(vocabulary({ studied: sameDay, linesOf, vocab, latest: tapped }).understood, 3); // 我 很 脏, not 尴尬
  const later = [...sameDay, chapter(200, ['2026-10-03'])];
  assert.equal(vocabulary({ studied: later, linesOf, vocab, latest: tapped }).understood, 6); // and 尴尬 学 法语
});

test('only the chapters heard after a tap make a tapped word solid', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-01']), chapter(200, ['2026-10-03']),
    chapter(0, ['2026-10-04'], 'CC5')];
  assert.equal(vocabulary({ studied, linesOf, vocab, latest: latest() }).solid, 3);
  assert.equal(vocabulary({ studied, linesOf, vocab, latest: latest({ 尴尬: '2026-10-02' }) }).solid, 2);
});

test('a tap on a phrase is a tap on each word it counts as, HSK 1-2 too', () => {
  const v = vocabulary({ studied: [chapter(100, ['2026-10-01'])], linesOf, vocab, latest: latest({ 很脏: '2026-10-01' }) });
  assert.deepEqual(v, { understood: 2, solid: 1, heard: 3 }); // 我, and 尴尬 understood; 很 and 脏 missed
});

test('a word said to be known counts in both, until it is tapped again later', () => {
  const studied = [chapter(300, ['2026-10-01'])];
  const known = vocabulary({ studied, linesOf, vocab, latest: latest({ 脏: '2026-10-01' }, { 脏: '2026-10-01' }) });
  assert.deepEqual(known, { understood: 3, solid: 3, heard: 1 });
  const again = vocabulary({ studied, linesOf, vocab, latest: latest({ 脏: '2026-10-02' }, { 脏: '2026-10-01' }) });
  assert.deepEqual(again, { understood: 2, solid: 2, heard: 1 });
});

test('a chapter takes the line a re-cut nudged before its start and no line past its end', () => {
  const nudged = { CC4: /** @type {[number, string][]} */ ([[99.7, '外面'], [190, '尴尬']]) };
  const v = vocabulary({ studied: [chapter(100, ['2026-10-01'])], linesOf: nudged, vocab, latest: latest() });
  assert.equal(v.heard, 1);
});

test('nothing studied is HSK 1-2 alone', () => {
  assert.deepEqual(vocabulary({ studied: [], linesOf: {}, vocab, latest: latest() }), { understood: 2, solid: 2, heard: 0 });
});
