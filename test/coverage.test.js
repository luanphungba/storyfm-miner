// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAPS_FROM, chapterCoverage, foretell, measure, wordsSaid } from '../docs/coverage.js';

/** A phrase cut into its words, a name holding a word, and two lines starting together. */
const cues = [
  { start: 0, text: '我学法语，刘哥说' },
  { start: 3, text: '嗯，' },
  { start: 3, text: '历史课很好' },
  { start: 5, text: '历史很好' },
];
const tokens = [
  [[0, 1, 1, 9, 0], [1, 3, 0, 1, 0], [5, 2, 0, 1, 1], [7, 1, 1, 9, 0]],
  [[0, 1, 0, 4, 0]],
  [[0, 3, 0, 1, 0], [3, 1, 1, 9, 0], [4, 1, 1, 9, 0]],
  [[0, 2, 3, 2, 0], [2, 1, 1, 9, 0], [3, 1, 1, 9, 0]],
];
/** @type {[number, string][]} */
const counted = [[0, '我 学 法语 说'], [3, '历史 课 很 好'], [5, '历史 很 好']];
const said = wordsSaid(cues, tokens, counted).flat();
const understood = new Set(['我', '很', '好', '说', '历史']);

test('each word said is placed in the span it is said in, and a name counts as none', () => {
  assert.deepEqual(wordsSaid(cues, tokens, counted), [
    [{ word: '我', span: '我' }, { word: '学', span: '学法语' }, { word: '法语', span: '学法语' }, { word: '说', span: '说' }],
    [],
    [{ word: '历史', span: '历史课' }, { word: '课', span: '历史课' }, { word: '很', span: '很' }, { word: '好', span: '好' }],
    [{ word: '历史', span: '历史' }, { word: '很', span: '很' }, { word: '好', span: '好' }],
  ]);
});

test('lines starting together each take the words their own spans hold, in either order', () => {
  const swapped = [cues[0], cues[2], cues[1], cues[3]];
  const lines = wordsSaid(swapped, [tokens[0], tokens[2], tokens[1], tokens[3]], counted);
  assert.deepEqual(lines.map((line) => line.length), [4, 4, 0, 3]);
});

test('a line with no word spans yet says nothing rather than failing', () => {
  assert.deepEqual(wordsSaid(cues, [], counted), [[], [], [], []]);
});

test('foretold, each time a word is said counts, and the words not understood yet are told once', () => {
  assert.deepEqual(foretell(said, understood), { share: 1 - 3 / 11, unknown: 3 }); // 学 法语 课
});

test('a tap on a phrase misses it where it is said, not its words heard on their own', () => {
  assert.equal(measure(said, ['历史课']), 1 - 2 / 11); // 历史 课 in 历史课
  assert.equal(measure(said, ['学法语']), 1 - 2 / 11);
});

test('a word tapped on its own is missed wherever it is said, inside a phrase too', () => {
  assert.equal(measure(said, ['历史']), 1 - 2 / 11); // in 历史课 and alone
  assert.equal(measure(said, ['很', '好']), 1 - 4 / 11);
});

test('a chapter with no word to count has no share', () => {
  assert.equal(measure([], ['历史']), null);
  assert.equal(foretell([], understood).share, null);
  assert.equal(chapterCoverage([], { dates: [], tappedOn: {}, understoodOn: () => understood, today: '2026-10-11' }), null);
});

/** The words understood, noting each day they are asked for. */
function asked() {
  /** @type {string[]} */
  const days = [];
  return { days, understoodOn: (/** @type {string} */ day) => (days.push(day), understood) };
}

test('a chapter not studied yet is foretold from the words understood today', () => {
  const { days, understoodOn } = asked();
  assert.deepEqual(chapterCoverage(said, { dates: [], tappedOn: {}, understoodOn, today: '2026-10-11' }),
    { text: '≈72%', title: 'Dự đoán: hiểu ≈72% lượt từ, 3 từ chưa hiểu khi nghe', measured: false });
  assert.deepEqual(days, ['2026-10-11']);
});

test('a chapter studied is measured by the taps of the day it was first studied only', () => {
  const { days, understoodOn } = asked();
  const tappedOn = { '2026-10-09': ['历史课'], '2026-10-10': ['很', '好'] };
  assert.deepEqual(chapterCoverage(said, { dates: ['2026-10-10', '2026-10-09'], tappedOn, understoodOn, today: '2026-10-11' }), {
    text: '81%',
    title: 'Hiểu 81% lượt từ, đo bằng 1 từ đã tra ngày học đầu tiên (2 ngày trước) · dự đoán trước khi học ≈72%',
    measured: true,
  });
  assert.deepEqual(days, ['2026-10-08']);
});

test('a chapter studied with nothing tapped in it that day was all understood', () => {
  const coverage = chapterCoverage(said, { dates: ['2026-10-11'], tappedOn: { '2026-10-12': ['历史'] }, understoodOn: null, today: '2026-10-11' });
  assert.deepEqual(coverage, { text: '100%', title: 'Hiểu 100% lượt từ, đo bằng 0 từ đã tra ngày học đầu tiên (hôm nay)', measured: true });
});

test('a chapter studied with nothing to measure it by is foretold as it stood the day before', () => {
  const foretold = { text: '≈72%', title: 'Dự đoán trước khi học: hiểu ≈72% lượt từ', measured: false };
  for (const [first, tappedOn, before] of /** @type {const} */ ([['2026-10-01', {}, '2026-09-30'], [TAPS_FROM, null, '2026-10-05']])) {
    const { days, understoodOn } = asked();
    assert.deepEqual(chapterCoverage(said, { dates: [first], tappedOn, understoodOn, today: '2026-10-11' }), foretold);
    assert.deepEqual(days, [before]);
  }
});

test('without the vocabulary only a measured chapter says anything', () => {
  assert.equal(chapterCoverage(said, { dates: [], tappedOn: {}, understoodOn: null, today: '2026-10-11' }), null);
  assert.equal(chapterCoverage(said, { dates: ['2026-10-01'], tappedOn: {}, understoodOn: null, today: '2026-10-11' }), null);
  assert.equal(chapterCoverage(said, { dates: ['2026-10-09'], tappedOn: {}, understoodOn: null, today: '2026-10-11' })?.text, '100%');
});
