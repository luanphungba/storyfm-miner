// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstHearings, formatChange, gained, timesSaid, vocabularyByDay, vocabularyDays, vocabularyWords, wordTicks,
} from '../docs/vocab.js';

const chapter = (/** @type {number} */ start, /** @type {string[]} */ dates, ep = 'CC4') => ({ ep, start, end: start + 90, dates });
/** One line per chapter's start, and one between them that no chapter has. */
const linesOf = {
  CC4: /** @type {[number, string][]} */ ([[0, '我 尴尬'], [95, '外面'], [100, '尴尬 很 脏'], [200, '尴尬 学 法语'], [300, '脏']]),
  CC5: /** @type {[number, string][]} */ ([[0, '尴尬']]),
};
const vocab = { base: ['我', '很'], splits: { 很脏: ['很', '脏'], 学法语: ['学', '法语'] } };
/** Each span's days, the way the server sends them: one day each, as most have. */
const latest = (/** @type {Record<string, string>} */ tapped = {}, /** @type {Record<string, string>} */ known = {}) => ({
  tapped: Object.fromEntries(Object.entries(tapped).map(([w, d]) => [w, [d]])),
  known: Object.fromEntries(Object.entries(known).map(([w, d]) => [w, [d]])),
});
/** The vocabulary as it stands at the end of the days tested. */
const vocabulary = (/** @type {{ studied: any[], linesOf: any, vocab: any, latest: any }} */ { studied, linesOf, vocab, latest }) => {
  const { day, ...counts } = vocabularyByDay({ studied, linesOf, vocab, history: latest }, ['2026-12-31'])[0];
  return counts;
};

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

test('a chapter studied again does not bring back a word tapped in it', () => {
  const tapped = latest({ 尴尬: '2026-10-01' });
  const again = [chapter(0, ['2026-10-01', '2026-10-03'])];
  assert.equal(vocabulary({ studied: again, linesOf, vocab, latest: tapped }).understood, 2); // 我 很, not 尴尬
  const fresh = [...again, chapter(100, ['2026-10-03'])];
  assert.equal(vocabulary({ studied: fresh, linesOf, vocab, latest: tapped }).understood, 4); // and 尴尬 脏
});

test('a chapter studied again adds no day toward solid', () => {
  const studied = [chapter(0, ['2026-10-01', '2026-10-02']), chapter(100, ['2026-10-01']), chapter(0, ['2026-10-01'], 'CC5')];
  assert.equal(vocabulary({ studied, linesOf, vocab, latest: latest() }).solid, 2); // 我 很: 尴尬 in three chapters, one day
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

test('each day counts what was studied and tapped by its evening', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-02']), chapter(200, ['2026-10-04'])];
  const history = { tapped: { 尴尬: ['2026-10-02'], 很脏: ['2026-10-02'] }, known: { 脏: ['2026-10-03'] } };
  const days = vocabularyByDay({ studied, linesOf, vocab, history }, ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(days.map(({ day, understood, heard }) => [day, understood, heard]), [
    ['2026-09-30', 2, 0], // HSK 1-2 alone
    ['2026-10-01', 3, 2], // 我 很 尴尬
    ['2026-10-02', 1, 4], // 尴尬 and 很脏 tapped that day: 我 alone
    ['2026-10-03', 2, 4], // 脏 known
    ['2026-10-04', 5, 6], // + 尴尬 学 法语 heard untapped; 很 still missed
  ]);
});

test('the words themselves are the ones counted, as they stood on each evening', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-02']), chapter(200, ['2026-10-04'])];
  const history = { tapped: { 尴尬: ['2026-10-02'], 很脏: ['2026-10-02'] }, known: { 脏: ['2026-10-03'] } };
  const wordsOn = vocabularyWords({ studied, linesOf, vocab, history });
  assert.deepEqual([...wordsOn('2026-10-03').understood].sort(), ['我', '脏'].sort());
  assert.deepEqual([...wordsOn('2026-10-04').understood].sort(), ['我', '脏', '尴尬', '学', '法语'].sort());
});

test('a word tapped twice is out from its first tap and back after its last', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-03']), chapter(200, ['2026-10-05'])];
  const history = { tapped: { 尴尬: ['2026-10-01', '2026-10-03'] }, known: {} };
  const days = vocabularyByDay({ studied, linesOf, vocab, history }, ['2026-10-01', '2026-10-03', '2026-10-05']);
  assert.deepEqual(days.map((d) => d.understood), [2, 3, 6]); // 我 很 · + 脏 · + 尴尬 学 法语
});

test('a word is first heard in the earliest chapter studied with it, tapped there or not', () => {
  const studied = [chapter(100, ['2026-10-03']), chapter(0, ['2026-10-04', '2026-10-01']), chapter(200, ['2026-10-03'])];
  const history = { tapped: { 很脏: ['2026-10-03'], 尴尬: ['2026-10-04'] }, known: {} };
  assert.deepEqual(Object.fromEntries(firstHearings({ studied, linesOf, vocab, history })), {
    我: { day: '2026-10-01', tapped: false },
    尴尬: { day: '2026-10-01', tapped: false }, // tapped only later
    很: { day: '2026-10-03', tapped: true }, // a tap on 很脏
    脏: { day: '2026-10-03', tapped: true },
    学: { day: '2026-10-03', tapped: false },
    法语: { day: '2026-10-03', tapped: false },
  });
});

test('each word is counted as often as it is said in the chapters studied by the day', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-03', '2026-10-01']), chapter(200, ['2026-10-05'])];
  assert.deepEqual(Object.fromEntries(timesSaid({ studied, linesOf }, '2026-10-03')), { 我: 1, 尴尬: 2, 很: 1, 脏: 1 });
  assert.equal(timesSaid({ studied, linesOf }, '2026-09-30').size, 0);
});

test('the chart runs from the first day studied through today, across a month', () => {
  assert.deepEqual(vocabularyDays([{ dates: ['2026-11-02', '2026-10-30'] }], '2026-11-01'),
    ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(vocabularyDays([], '2026-10-07'), ['2026-10-07']);
});

test('the axis steps roundly from at or under the lowest count', () => {
  assert.deepEqual(wordTicks(1232, 1556), [1200, 1300, 1400, 1500, 1600]);
  assert.deepEqual(wordTicks(1256, 1260), [1250, 1260]);
  assert.deepEqual(wordTicks(1256, 1256), [1250, 1260]);
});

test('a gain counts the change in words understood, and the words made solid, not the change in solid', () => {
  const studied = [chapter(0, ['2026-10-01']), chapter(100, ['2026-10-02']), chapter(0, ['2026-10-03'], 'CC5')];
  const wordsOn = vocabularyWords({ studied, linesOf, vocab, history: latest({ 很脏: '2026-10-03' }) });
  // 尴尬 is solid on the 3rd, heard in three chapters over three days; 很 and 脏, tapped as 很脏, are out
  assert.deepEqual(gained(wordsOn, '2026-10-02', '2026-10-03'), { understood: -2, solid: 1 });
  assert.deepEqual(gained(wordsOn, '2026-09-30', '2026-10-01'), { understood: 1, solid: 0 }); // 尴尬 heard once
});

test('a change says its sign', () => {
  assert.deepEqual([34, -3, 0].map(formatChange), ['+34', '−3', '±0']);
});
