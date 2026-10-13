// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_SHARE, MIN_HEARINGS, hskLevel, levelOn } from '../docs/level.js';

const DAY = '2026-10-13';
/** `n` made-up words, a band's half. */
const words = (/** @type {string} */ prefix, /** @type {number} */ n) => Array.from({ length: n }, (_, k) => `${prefix}${k}`);
/** First hearings of `heard` on `day`, the first `tapped` of them tapped. */
const hearings = (/** @type {string[]} */ heard, /** @type {number} */ tapped, day = '2026-10-08') =>
  heard.map((word, k) => /** @type {[string, { day: string, tapped: boolean }]} */ ([word, { day, tapped: k < tapped }]));
/** The words of `heard` untapped at first hearing, understood still. */
const untapped = (/** @type {[string, { tapped: boolean }][]} */ heard) => heard.filter(([, h]) => !h.tapped).map(([w]) => w);

test('a word heard counts as it stands, and one not heard yet at its half\'s first-hearing rate', () => {
  const common = words('c', 100);
  const rare = words('r', 100);
  const heard = [...hearings(common.slice(0, 40), 10), ...hearings(rare.slice(0, 20), 15)];
  const { bands: [band] } = hskLevel({ syllabus: { 3: { common, rare } }, understood: new Set(untapped(heard)), hearings: new Map(heard), day: DAY });
  // Common: 30 of 40 known, and 60 not heard at 30/40. Rare: 5 of 20, and 80 at 5/20.
  assert.deepEqual(band, { band: 3, size: 200, heard: 60, known: 35, estimate: Math.round(30 + 60 * 0.75 + 5 + 80 * 0.25) });
});

test('a half heard too little is guessed at the whole band\'s rate, and a band heard too little not at all', () => {
  const common = words('c', 100);
  const rare = words('r', 100);
  const few = MIN_HEARINGS - 1;
  const heard = [...hearings(common.slice(0, 30), 0), ...hearings(rare.slice(0, few), few)];
  const { bands: [band] } = hskLevel({ syllabus: { 3: { common, rare } }, understood: new Set(untapped(heard)), hearings: new Map(heard), day: DAY });
  const whole = 30 / (30 + few);
  assert.equal(band.estimate, Math.round(30 + 70 * 1 + 0 + (100 - few) * whole));

  const little = hearings(common.slice(0, few), 0);
  const unheard = hskLevel({ syllabus: { 3: { common, rare } }, understood: new Set(untapped(little)), hearings: new Map(little), day: DAY });
  assert.equal(unheard.bands[0].estimate, few);
});

test('a word first heard before taps were logged counts as it stands, but says nothing of the rate', () => {
  const common = words('c', 50);
  const before = hearings(common.slice(0, 30), 0, '2026-10-02');
  const after = hearings(common.slice(30, 50), 5);
  const heard = [...before, ...after];
  const { bands: [band] } = hskLevel({ syllabus: { 3: { common, rare: [] } }, understood: new Set(untapped(heard)), hearings: new Map(heard), day: DAY });
  assert.deepEqual(band, { band: 3, size: 50, heard: 50, known: 45, estimate: 45 });
});

test('a word understood without being heard, as HSK 1-2 is, counts as known', () => {
  const common = words('c', 10);
  const { bands: [band] } = hskLevel({ syllabus: { 1: { common, rare: [] } }, understood: new Set(common), hearings: new Map(), day: DAY });
  assert.deepEqual(band, { band: 1, size: 10, heard: 10, known: 10, estimate: 10 });
});

test('first hearings after the day asked for are left out', () => {
  const common = words('c', 100);
  const heard = [...hearings(common.slice(0, 20), 0, '2026-10-08'), ...hearings(common.slice(20, 40), 20, '2026-10-12')];
  const level = (/** @type {string} */ day) => hskLevel({
    syllabus: { 3: { common, rare: [] } }, understood: new Set(untapped(heard)), hearings: new Map(heard), day,
  }).bands[0];
  assert.deepEqual(level('2026-10-10'), { band: 3, size: 100, heard: 20, known: 20, estimate: 100 });
  assert.deepEqual(level('2026-10-12'), { band: 3, size: 100, heard: 40, known: 20, estimate: 50 });
});

test('the level is the highest band reached with every band under it', () => {
  const band = (/** @type {string} */ prefix) => ({ common: words(prefix, 10), rare: [] });
  const syllabus = { 1: band('a'), 2: band('b'), 3: band('c'), 4: band('d') };
  const knowing = (/** @type {number[]} */ counts) => new Set(Object.values(syllabus).flatMap((b, k) => b.common.slice(0, counts[k])));
  const level = (/** @type {number[]} */ counts) => hskLevel({ syllabus, understood: knowing(counts), hearings: new Map(), day: DAY }).level;
  const enough = Math.ceil(LEVEL_SHARE * 10);
  assert.equal(level([10, 10, enough, enough - 1]), 3);
  assert.equal(level([10, 10, enough - 1, 10]), 2); // HSK 4 known, but not HSK 3
  assert.equal(level([enough - 1, 10, 10, 10]), 0);
  assert.equal(level([10, 10, 10, 10]), 4);
});

test('the level on a day is counted from what was studied and tapped by then', () => {
  const syllabus = { 1: { common: ['我'], rare: [] }, 3: { common: ['尴尬', '脏'], rare: [] } };
  const input = {
    studied: [{ ep: 'CC4', start: 0, end: 90, dates: ['2026-10-07'] }, { ep: 'CC4', start: 100, end: 190, dates: ['2026-10-09'] }],
    linesOf: { CC4: /** @type {[number, string][]} */ ([[0, '我 尴尬'], [100, '脏']]) },
    vocab: { base: ['我'], splits: {} },
    history: { tapped: { 脏: ['2026-10-09'] }, known: {} },
  };
  const on = levelOn(input, syllabus);
  assert.deepEqual(on('2026-10-08').bands.map((b) => [b.heard, b.known]), [[1, 1], [1, 1]]);
  assert.deepEqual(on('2026-10-09').bands.map((b) => [b.heard, b.known]), [[1, 1], [2, 1]]);
});

test('a day before is guessed at a later day\'s rates, so a week\'s change is the words learned', () => {
  const common = words('c', 100);
  const early = hearings(common.slice(0, 20), 0, '2026-10-06');
  const later = hearings(common.slice(20, 60), 30, '2026-10-12');
  const heard = new Map([...early, ...later]);
  const understood = new Set(untapped(early));
  const level = (/** @type {string | undefined} */ rateDay) => hskLevel({
    syllabus: { 3: { common, rare: [] } }, understood, hearings: heard, day: '2026-10-06', rateDay,
  }).bands[0].estimate;
  assert.equal(level(undefined), 100); // 20 of 20 untapped so far
  assert.equal(level('2026-10-12'), 20 + 80 * (30 / 60));
});
