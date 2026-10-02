// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chapterRows, dayRows, episodeRows, formatDuration, formatHours, formatPasses, formatTick, goalLine, heardTotals,
  hourTicks, listenedDays, passes, progress, shortDay, sortChapters, streak, todayLine, weekday,
} from '../docs/progress.js';

/** @typedef {import('../docs/studied.js').Studied} Studied */

const studied = (/** @type {string} */ ep, /** @type {number} */ start, /** @type {string[]} */ dates) =>
  /** @type {Studied} */ ({ ep, episode: '', audio: 'https://a/x.m4a', n: 0, zh: `${ep}@${start}`, vi: '', start, end: start + 90, dates });
const heard = (/** @type {string} */ ep, /** @type {number} */ start, /** @type {number} */ seconds, last = '2026-10-01', days = 1, audio = seconds) =>
  ({ ep, start, seconds, audio, days, last });
const chapter = (/** @type {number} */ start, /** @type {number} */ end) => ({ zh: `@${start}`, vi: '', start, end });

// ---------- the goal ----------

test('adds up today by page and every day for the total', () => {
  const p = progress({ '2026-10-01': { listen: 3600 }, '2026-10-02': { player: 2400, listen: 1920 } }, '2026-10-02');
  assert.deepEqual(p.today, { player: 2400, listen: 1920 });
  assert.equal(p.total, 7920);
});

test('the pace leaves today out and starts at the first day counted', () => {
  const days = { '2026-09-29': { listen: 7200 }, '2026-10-01': { player: 3600 }, '2026-10-02': { listen: 36_000 } };
  const p = progress(days, '2026-10-02');
  assert.equal(p.pace, 3600); // 2 h, 0 h and 1 h over the three days before today
  assert.equal(p.reach, '2029-06-15'); // 1000 h less 13 h already heard, at 1 h a day
});

test('the pace is the last seven days, with a day of nothing as nothing', () => {
  const days = { '2026-09-01': { listen: 360_000 }, '2026-10-01': { listen: 25_200 } };
  assert.equal(progress(days, '2026-10-02').pace, 3600);
});

test('the first day has no pace to reach the goal by', () => {
  assert.equal(progress({ '2026-10-02': { player: 600 } }, '2026-10-02').reach, null);
  assert.equal(progress({}, '2026-10-02').total, 0);
});

// ---------- days ----------

test('counts the days in a row, and today not listened on yet does not break them', () => {
  const days = { '2026-09-28': { listen: 600 }, '2026-09-30': { player: 61 }, '2026-10-01': { listen: 3000 } };
  assert.equal(streak(days, '2026-10-01'), 2);
  assert.equal(streak(days, '2026-10-02'), 2);
  assert.equal(streak(days, '2026-10-03'), 0);
  assert.equal(streak({ ...days, '2026-10-02': { player: 30 } }, '2026-10-02'), 2); // half a minute is not a day yet
  assert.equal(streak({}, '2026-10-02'), 0);
});

test('counts the days listened on, from a minute', () => {
  assert.equal(listenedDays({ '2026-09-30': { player: 61 }, '2026-10-01': { listen: 59 }, '2026-10-02': { player: 30, listen: 30 } }), 2);
});

test('lays out the days up to today with their hours, chapters studied and words', () => {
  const rows = dayRows({
    days: { '2026-10-02': { player: 600 }, '2026-09-30': { listen: 60 } },
    studied: [studied('E517', 0, ['2026-09-30', '2026-10-02']), studied('E517', 100, ['2026-10-02'])],
    words: { '2026-10-02': 8, '2026-09-01': 3 },
    today: '2026-10-02',
    count: 3,
  });
  assert.deepEqual(rows, [
    { day: '2026-09-30', player: 0, listen: 60, chapters: 1, words: 0 },
    { day: '2026-10-01', player: 0, listen: 0, chapters: 0, words: 0 },
    { day: '2026-10-02', player: 600, listen: 0, chapters: 2, words: 8 },
  ]);
  assert.equal(dayRows({ days: {}, studied: [], words: {}, today: '2026-03-01', count: 2 })[0].day, '2026-02-28');
});

// ---------- chapters ----------

test('a chapter heard is the one starting within half a second, so a re-cut keeps its time', () => {
  const list = [heard('E517', 70.62, 100), heard('E517', 70.9, 50), heard('E517', 158, 10), heard('CC2', 70.62, 7)];
  assert.deepEqual(heardTotals(list, 'E517', 70.62), { seconds: 150, audio: 150 });
});

test('passes are the audio heard over the length, so a pass at 2x is still one', () => {
  assert.equal(passes(270, 90), 3);
  const [fast] = chapterRows({ heard: [heard('A', 0, 45, '2026-10-01', 1, 90)], studied: [], chaptersOf: { A: [chapter(0, 90)] } });
  assert.deepEqual([fast.seconds, fast.passes], [45, 1]);
  assert.equal(passes(45, 90), 0.5);
  assert.equal(passes(10, 0), 0);
});

test('lists the chapters heard for more than a skim, and every one studied', () => {
  const rows = chapterRows({
    heard: [heard('E517', 0, 120, '2026-10-01', 2), heard('E517', 70, 20), heard('E517', 160, 29.9)],
    studied: [studied('E517', 70, ['2026-09-20']), studied('E062', 5, ['2026-09-25'])],
    chaptersOf: { E517: [chapter(0, 60), chapter(70, 160), chapter(160, 250)] },
  });
  assert.deepEqual(rows.map((r) => [r.ep, r.n, r.start, r.seconds, r.passes, r.studied.length]), [
    ['E517', 0, 0, 120, 2, 0],
    ['E517', 1, 70, 20, 20 / 90, 1],
    ['E062', null, 5, 0, 0, 1], // its episode's chapters were not loaded, but it was studied
  ]);
  assert.equal(rows[0].heardDays, 2);
  assert.equal(rows[1].last, '2026-10-01'); // heard after it was studied
  assert.equal(rows[2].last, '2026-09-25');
});

test('orders chapters by the latest, or by passes with the latest first among equals', () => {
  const rows = chapterRows({
    heard: [heard('A', 0, 900, '2026-09-30'), heard('A', 100, 90, '2026-10-02'), heard('A', 200, 90, '2026-10-01')],
    studied: [],
    chaptersOf: { A: [chapter(0, 90), chapter(100, 190), chapter(200, 290)] },
  });
  assert.deepEqual(sortChapters(rows, 'recent').map((r) => r.start), [100, 200, 0]);
  assert.deepEqual(sortChapters(rows, 'most').map((r) => r.start), [0, 100, 200]);
  assert.deepEqual(sortChapters(rows, 'least').map((r) => r.start), [100, 200, 0]);
});

test('sums each episode: chapters studied of all, time heard, the latest day', () => {
  const rows = chapterRows({
    heard: [heard('E517', 0, 120, '2026-10-01'), heard('E062', 0, 60, '2026-10-02')],
    studied: [studied('E517', 0, ['2026-09-30'])],
    chaptersOf: { E517: [chapter(0, 90), chapter(100, 190)], E062: [chapter(0, 90)] },
  });
  assert.deepEqual(episodeRows({ rows, chaptersOf: { E517: [chapter(0, 90), chapter(100, 190)], E062: [chapter(0, 90)] }, titles: { E517: 'E517.三本' } }), [
    { ep: 'E062', title: 'E062', chapters: 1, studied: 0, seconds: 60, last: '2026-10-02' },
    { ep: 'E517', title: 'E517.三本', chapters: 2, studied: 1, seconds: 120, last: '2026-10-01' },
  ]);
});

// ---------- the chart ----------

test('ticks step by a quarter, half, one, two or four hours, to past the tallest day', () => {
  assert.deepEqual(hourTicks(0), [0, 900]);
  assert.deepEqual(hourTicks(3000), [0, 900, 1800, 2700, 3600]);
  assert.deepEqual(hourTicks(8640), [0, 3600, 7200, 10_800]);
  assert.deepEqual(hourTicks(7200), [0, 1800, 3600, 5400, 7200]);
  assert.equal(hourTicks(20 * 3600).at(-1), 72_000);
  assert.deepEqual([900, 3600, 5400].map(formatTick), ['15 phút', '1 giờ', '1,5 giờ']);
});

// ---------- saying it ----------

test('names a day the way the lists do', () => {
  assert.deepEqual(['2026-10-02', '2026-10-01', '2026-09-27'].map((day) => shortDay(day, '2026-10-02')), ['Hôm nay', 'Hôm qua', 'CN 27/9']);
  assert.equal(weekday('2026-10-01'), 'T5');
});

test('says a duration in hours and minutes, hours to a decimal, and passes to a tenth while small', () => {
  assert.deepEqual([59, 2700, 4320, 7200].map(formatDuration), ['0 phút', '45 phút', '1 giờ 12 phút', '2 giờ']);
  assert.equal(formatHours(135_000), '37,5');
  assert.deepEqual([0.44, 3.46, 12.4].map(formatPasses), ['0,4 lượt', '3,5 lượt', '12 lượt']);
});

test('splits today by page only when both were used', () => {
  assert.equal(todayLine({ today: { player: 2400, listen: 1920 }, total: 0, pace: 0, reach: null }),
    'Hôm nay nghe 1 giờ 12 phút (học 40 phút, nghe lại 32 phút)');
  assert.equal(todayLine({ today: { listen: 1920 }, total: 0, pace: 0, reach: null }), 'Hôm nay nghe 32 phút');
});

test('says the total against the goal, and when it is reached at the pace', () => {
  assert.equal(goalLine({ today: {}, total: 135_000, pace: 7500, reach: '2028-03-14' }),
    'Tổng 37,5/1000 giờ · TB 2 giờ 5 phút/ngày · đủ 1000 giờ khoảng tháng 3/2028');
  assert.equal(goalLine({ today: {}, total: 600, pace: 0, reach: null }), 'Tổng 0,2/1000 giờ');
  assert.equal(goalLine({ today: {}, total: 3_600_000, pace: 3600, reach: null }), 'Tổng 1.000/1000 giờ · đã đủ mục tiêu');
});
