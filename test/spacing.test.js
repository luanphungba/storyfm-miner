// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_WORDS, REVIEW_SECONDS, dueLabel, freshDue, heardThrough, missedWords, planDay, pullsBack, schedule, spacedPlaylist, tappedOf,
  wordsSaid, worthBy,
} from '../docs/spacing.js';

const studied = (ep, start, dates, end = start + 100) => ({ ep, episode: '', audio: 'https://a/x.m4a', n: 0, zh: '', vi: '', start, end, dates });
const heard = (ep, start, byDay) => ({ ep, start, seconds: 0, audio: 0, days: 0, last: '', byDay });
const tappedIn = (ep, start, byDay, words = Object.values(byDay).flat()) =>
  ({ ep, start, days: Object.keys(byDay), words: words.map((word) => ({ word, at: start, days: 1 })), byDay });
/** Each word's HSK band (0 off the list) and the episodes of the library it is said in. */
const reaches = (/** @type {Record<string, [number, number]>} */ table) =>
  new Map(Object.entries(table).map(([word, [band, episodes]]) => [word, { band, isName: false, episodes }]));
const noReach = new Map();

test('a word is due the day after it was first tapped', () => {
  assert.deepEqual(schedule({ from: '2026-10-06', heard: ['2026-10-06'], tapped: ['2026-10-06'] }), { due: '2026-10-07', interval: 1 });
});

test('taps bring a word back daily, then each day heard without one doubles the wait', () => {
  // The worked example the user was shown: 尴尬 tapped three days running, then understood.
  const days = { from: '2026-10-06', heard: [], tapped: ['2026-10-06', '2026-10-07', '2026-10-08'] };
  assert.equal(schedule(days).due, '2026-10-09');
  const heardOn = ['2026-10-09', '2026-10-11', '2026-10-15'];
  assert.deepEqual(heardOn.map((_, k) => schedule({ ...days, heard: heardOn.slice(0, k + 1) }).due), ['2026-10-11', '2026-10-15', '2026-10-23']);
});

test('a tap sets a long wait back to a day', () => {
  const base = { from: '2026-10-01', heard: ['2026-10-02', '2026-10-04', '2026-10-08'] };
  assert.deepEqual(schedule({ ...base, tapped: [] }), { due: '2026-10-16', interval: 8 });
  assert.deepEqual(schedule({ ...base, tapped: ['2026-10-08'] }), { due: '2026-10-09', interval: 1 });
});

test('heard every day it holds at two days, and heard early it keeps its wait, counted from then', () => {
  const daily = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  assert.deepEqual(schedule({ from: '2026-10-01', heard: daily, tapped: [] }), { due: '2026-10-07', interval: 2 });
  // Waiting 8 days from 10-08, heard on 10-10 instead: still 8, from 10-10.
  const early = ['2026-10-02', '2026-10-04', '2026-10-08', '2026-10-10'];
  assert.deepEqual(schedule({ from: '2026-10-01', heard: early, tapped: [] }), { due: '2026-10-18', interval: 8 });
});

test('heard late and still without a tap, it doubles the wait it really survived', () => {
  assert.deepEqual(schedule({ from: '2026-10-01', heard: ['2026-10-02', '2026-10-12'], tapped: [] }), { due: '2026-11-01', interval: 20 });
});

test('what happened before a word was first tapped does not count', () => {
  assert.deepEqual(schedule({ from: '2026-10-05', heard: ['2026-10-01'], tapped: ['2026-09-20'] }), { due: '2026-10-06', interval: 1 });
});

test('a chapter comes back the day after it was studied, until heard through since', () => {
  const s = studied('CC4', 0, ['2026-10-01', '2026-10-08']);
  assert.equal(freshDue(s, []), '2026-10-09');
  assert.equal(freshDue(s, ['2026-10-03', '2026-10-08']), '2026-10-09'); // heard the day it was studied: not since
  assert.equal(freshDue(s, ['2026-10-03', '2026-10-11']), null);
});

test('every word tapped is reviewed, in one chapter or more, from the day it was first tapped', () => {
  // The user's case: 建议 tapped only in CC5's second chapter, on two days, came back for nothing.
  const tapped = [
    tappedIn('CC4', 0, { '2026-10-03': ['尴尬', '户籍'], '2026-10-05': ['尴尬'] }),
    tappedIn('CC4', 100, { '2026-10-04': ['户籍'], '2026-10-07': ['尴尬'] }),
    tappedIn('CC5', 64.84, { '2026-10-06': ['建议'], '2026-10-13': ['建议'] }),
  ];
  assert.deepEqual([...missedWords(tapped)], [
    ['尴尬', { from: '2026-10-03', tapped: ['2026-10-03', '2026-10-05', '2026-10-07'] }],
    ['户籍', { from: '2026-10-03', tapped: ['2026-10-03', '2026-10-04'] }],
    ['建议', { from: '2026-10-06', tapped: ['2026-10-06', '2026-10-13'] }],
  ]);
});

test('a word said to be known since its last tap is not reviewed', () => {
  // The server lists such a word under no chapter's words, only under the days it was tapped on.
  const tapped = [tappedIn('CC4', 0, { '2026-10-03': ['户籍'] }, []), tappedIn('CC4', 100, { '2026-10-04': ['户籍'] }, [])];
  assert.equal(missedWords(tapped).size, 0);
});

test('a tap is on the span tapped, not on the words it is made of', () => {
  // The user's case: 段 tapped alone in CC5, then 整段 in CC19, underlined 整段 the next day as 段.
  const tapped = [tappedIn('CC5', 64.84, { '2026-10-06': ['段'] }), tappedIn('CC19', 589.37, { '2026-10-11': ['整段'] })];
  assert.deepEqual([...missedWords(tapped)], [
    ['段', { from: '2026-10-06', tapped: ['2026-10-06'] }],
    ['整段', { from: '2026-10-11', tapped: ['2026-10-11'] }],
  ]);
});

test('a chapter says the words on the lines it plays, each as its line is cut', () => {
  const cues = [
    { start: 0, end: 4, text: '有一整段的时间' },
    { start: 4, end: 9, text: '然后放松一下。' },
    { start: 9, end: 12, text: '无法接受' },
  ];
  const tokens = [
    [[0, 1, 2, 900, 0, 30], [1, 1, 1, 5000, 0, 34], [2, 2, 0, 1, 0, 1], [4, 1, 1, 7000, 0, 34], [5, 2, 1, 800, 0, 33]],
    [[0, 2, 2, 400, 0, 30], [2, 2, 4, 60, 0, 20], [4, 2, 2, 300, 0, 31]],
    [[0, 2, 4, 16, 0, 8], [2, 2, 3, 40, 0, 15]],
  ];
  const first = studied('CC19', 0, ['2026-10-11'], 9);
  const last = studied('CC19', 9, ['2026-10-11'], 12);
  const later = studied('CC19', 20, ['2026-10-11'], 30);
  const { said, reach } = wordsSaid(cues, tokens, [first, last, later]);
  assert.deepEqual([...(said.get(first) ?? [])], [['有', 0], ['一', 0], ['整段', 0], ['的', 0], ['时间', 0], ['然后', 4], ['放松', 4], ['一下', 4]]);
  assert.deepEqual([...(said.get(last) ?? [])], [['无法', 9], ['接受', 9]]);
  assert.equal(said.get(later)?.size, 0);
  assert.deepEqual(reach.get('整段'), { band: 0, isName: false, episodes: 1 });
  assert.deepEqual(reach.get('无法'), { band: 4, isName: false, episodes: 8 });
});

test('a word brings chapters back if common, or said across more than two episodes', () => {
  const reachOf = reaches({ 段: [2, 1], 薄弱: [5, 1], 概率: [7, 1], 昵称: [0, 2], 淘宝: [0, 3], 有所不同: [7, 3] });
  assert.deepEqual(
    ['段', '薄弱', '概率', '昵称', '淘宝', '有所不同', '没见过'].map((word) => pullsBack(reachOf.get(word))),
    [true, true, false, false, true, true, true],
  );
  assert.equal(pullsBack({ band: 0, isName: true, episodes: 2 }), false); // a name, heard in two stories
});

test("a word is worth the episodes it is said in plus its band's average, so a common level rarely said waits", () => {
  // Band 1 averages 6 episodes here, band 4 8, off the list 2; a name earns no band's.
  const reach = reaches({
    电脑: [1, 6], 唱歌: [1, 2], 正在: [1, 13], 汉字: [1, 3], 甚至: [4, 19], 适应: [4, 1], 无法: [4, 8], 缓解: [4, 4], 淘宝: [0, 3], 昵称: [0, 1],
  });
  reach.set('深圳', { band: 0, isName: true, episodes: 5 });
  const worth = worthBy(reach);
  assert.deepEqual(
    ['甚至', '正在', '电脑', '适应', '唱歌', '淘宝', '深圳', '没见过'].map(worth),
    [27, 19, 12, 9, 8, 5, 5, 0],
  );
});

test("a day's plan: chapters studied yesterday, then for each word left the chapter with the most due a minute", () => {
  const fresh = studied('CC19', 0, ['2026-10-11']);
  const shortOne = studied('CC4', 0, ['2026-10-01'], 60);
  const longOne = studied('CC4', 100, ['2026-10-01'], 400);
  const quiet = studied('CC5', 0, ['2026-10-01']);
  const said = new Map([[fresh, ['竞争']], [shortOne, ['户籍', '政治']], [longOne, ['户籍', '政治', '历史']], [quiet, ['外面']]]);
  const words = new Map([
    ['竞争', { from: '2026-10-09', tapped: ['2026-10-09', '2026-10-11'] }], // tapped as CC19 was studied: due today, in it anyway
    ['户籍', { from: '2026-10-10', tapped: ['2026-10-10'] }], // due 10-11
    ['政治', { from: '2026-10-11', tapped: ['2026-10-11'] }], // due today
    ['历史', { from: '2026-10-12', tapped: ['2026-10-12'] }], // due tomorrow
  ]);
  const { due, checks } = planDay({
    chapters: [fresh, shortOne, longOne, quiet],
    heardOf: (s) => (s === fresh ? [] : ['2026-10-02']),
    words,
    wordsIn: (s) => new Set(said.get(s)),
    reach: noReach,
    today: '2026-10-12',
  });
  // Both CC4 chapters hold 户籍 and 政治; the shorter is fewer minutes for them.
  assert.deepEqual([...checks].map(([s, w]) => [`${s.ep}@${s.start}`, w]), [['CC19@0', ['竞争']], ['CC4@0', ['户籍', '政治']]]);
  assert.equal(due.get(fresh), '2026-10-12');
  assert.equal(due.get(shortOne), '2026-10-11');
  // Not played today: back when a word in it falls due after today, or never.
  assert.equal(due.get(longOne), '2026-10-13');
  assert.equal(due.has(quiet), false);
});

test('a chapter studied today waits for tomorrow, and a word in no chapter brings none back', () => {
  const s = studied('CC19', 0, ['2026-10-12']);
  const { due, checks } = planDay({
    chapters: [s],
    heardOf: () => ['2026-10-12'],
    words: new Map([['户籍', { from: '2026-10-01', tapped: ['2026-10-01'] }]]),
    wordsIn: () => new Set(['竞争']),
    reach: noReach,
    today: '2026-10-12',
  });
  assert.equal(due.get(s), '2026-10-13');
  assert.equal(checks.size, 0);
});

test('a word heard in any chapter since it was due counts, wherever it was heard', () => {
  const a = studied('CC4', 0, ['2026-10-01']);
  const b = studied('CC5', 0, ['2026-10-01']);
  const { checks } = planDay({
    chapters: [a, b],
    // Heard through in CC5 on 10-11, the day after it fell due: it now waits two days from then.
    heardOf: (s) => (s === b ? ['2026-10-02', '2026-10-11'] : ['2026-10-02']),
    words: new Map([['户籍', { from: '2026-10-09', tapped: ['2026-10-09'] }]]),
    wordsIn: () => new Set(['户籍']),
    reach: noReach,
    today: '2026-10-12',
  });
  assert.equal(checks.size, 0);
});

test('a rare word brings no chapter back, but is listened for, last, in one played anyway', () => {
  const rareOnly = studied('CC4', 0, ['2026-10-01'], 60);
  const both = studied('CC4', 100, ['2026-10-01']);
  const fresh = studied('CC19', 0, ['2026-10-11']);
  const said = new Map([[rareOnly, ['概率']], [both, ['无法', '概率']], [fresh, ['昵称', '反正']]]);
  const { due, checks, rank } = planDay({
    chapters: [rareOnly, both, fresh],
    heardOf: (s) => (s === fresh ? [] : ['2026-10-02']),
    words: new Map([
      ['概率', { from: '2026-10-10', tapped: ['2026-10-10'] }], // due 10-11, HSK 7-9 in one episode
      ['无法', { from: '2026-10-11', tapped: ['2026-10-11'] }],
      ['昵称', { from: '2026-10-11', tapped: ['2026-10-11'] }], // off HSK, in two episodes
      ['反正', { from: '2026-10-11', tapped: ['2026-10-11'] }],
    ]),
    wordsIn: (s) => new Set(said.get(s)),
    reach: reaches({ 概率: [7, 1], 无法: [4, 8], 昵称: [0, 2], 反正: [3, 11] }),
    today: '2026-10-12',
  });
  assert.deepEqual([...checks].map(([s, w]) => [`${s.ep}@${s.start}`, w]), [['CC19@0', ['反正', '昵称']], ['CC4@100', ['无法', '概率']]]);
  // The day's words go 反正 无法, then the rare 昵称 概率: CC19 holds the worthiest, CC4 the next.
  assert.deepEqual([rank.get(fresh), rank.get(both)], [0, 1]);
  assert.deepEqual([due.get(both), due.get(fresh)], ['2026-10-12', '2026-10-12']);
  assert.equal(due.has(rareOnly), false);
});

test('a chapter is played for its few worthiest due words, a word listened for in one chapter only', () => {
  // The user's case: CC7's two chapters, studied the day before, both say 淘宝; the second says
  // 电脑 意义 庆祝 数据 too, and came back listening for 淘宝 alone.
  const first = studied('CC7', 6.72, ['2026-10-11']);
  const second = studied('CC7', 91.34, ['2026-10-11']);
  const said = new Map([[first, ['淘宝']], [second, ['淘宝', '电脑', '意义', '庆祝', '数据']]]);
  const tappedOn = (/** @type {string} */ day) => ({ from: day, tapped: [day] });
  const { checks } = planDay({
    chapters: [first, second],
    heardOf: () => [],
    words: new Map(['淘宝', '电脑', '意义', '庆祝', '数据'].map((word) => [word, tappedOn('2026-10-11')])),
    wordsIn: (s) => new Set(said.get(s)),
    reach: reaches({ 淘宝: [0, 3], 电脑: [1, 6], 意义: [3, 5], 庆祝: [3, 2], 数据: [4, 4] }),
    today: '2026-10-12',
  });
  assert.equal(FOCUS_WORDS, 3);
  assert.deepEqual([...checks.values()], [['淘宝'], ['电脑', '意义', '数据']]);
});

test('beyond the chapters studied the day before, words bring back REVIEW_SECONDS of chapters a day', () => {
  // Five chapters of five minutes, each saying one due word: two fit, for the two worthiest words.
  const chapters = [0, 1, 2, 3, 4].map((k) => studied('CC4', k * 300, ['2026-10-01'], k * 300 + 300));
  const word = ['政治', '历史', '户籍', '竞争', '资源'];
  const { due, checks } = planDay({
    chapters,
    heardOf: () => ['2026-10-02'],
    words: new Map(word.map((w) => [w, { from: '2026-10-10', tapped: ['2026-10-10'] }])),
    wordsIn: (s) => new Set([word[s.start / 300]]),
    reach: reaches({ 政治: [4, 4], 历史: [3, 9], 户籍: [0, 3], 竞争: [4, 7], 资源: [4, 5] }),
    today: '2026-10-12',
  });
  assert.equal(REVIEW_SECONDS, 600);
  assert.deepEqual([...checks.values()], [['历史'], ['竞争']]);
  // The rest wait for tomorrow.
  assert.deepEqual(chapters.map((s) => due.get(s)), ['2026-10-13', '2026-10-11', '2026-10-13', '2026-10-11', '2026-10-13']);
});

test('a day counts as heard through from nine tenths of the chapter, its rows and pages added up', () => {
  const s = studied('E517', 70.62, ['2026-10-01'], 170.62);
  const rows = [
    heard('E517', 70.62, { '2026-10-02': 60, '2026-10-03': 89, '2026-10-04': 250 }),
    heard('E517', 70.9, { '2026-10-02': 30 }), // the same chapter before a re-cut nudged its start
    heard('E517', 180, { '2026-10-03': 500 }),
    heard('E062', 70.62, { '2026-10-03': 500 }),
    { ...heard('E517', 70.62, {}), byDay: undefined }, // from a server older than byDay
  ];
  assert.deepEqual(heardThrough(rows, s).sort(), ['2026-10-02', '2026-10-04']);
});

test('finds the taps of a chapter, as the server listed it before a re-cut nudged its start', () => {
  const tapped = [{ ep: 'E517', start: 70.62, days: ['2026-10-06'], words: [] }];
  assert.equal(tappedOf(tapped, studied('E517', 70.9, [])), tapped[0]);
  assert.equal(tappedOf(tapped, studied('E517', 160, [])), undefined);
});

test('says how a due day stands from today', () => {
  assert.deepEqual(
    ['2026-10-03', '2026-10-06', '2026-10-07', '2026-10-10'].map((due) => dueLabel(due, '2026-10-06')),
    ['quá hạn 3 ngày', 'đến hạn hôm nay', 'đến hạn mai', 'còn 4 ngày'],
  );
});

test('plays the due chapters first, each episode together in story order, the one due longest ago first', () => {
  const due = {
    'CC1@60': '2026-10-06', 'CC1@6': '2026-10-04', 'CC2@9': '2026-10-05', 'CC2@190': '2026-10-09',
    'E062@0': '2026-10-07', 'E062@90': '2026-10-08', 'CC1@121': '2026-10-08',
  };
  const list = Object.keys(due).map((key) => {
    const [ep, start] = key.split('@');
    return studied(ep, Number(start), ['2026-10-01']);
  });
  const { due: now, upcoming } = spacedPlaylist(list, { today: '2026-10-06', dueOf: (s) => due[`${s.ep}@${s.start}`] });
  const keys = (/** @type {any[]} */ chapters) => chapters.map((s) => `${s.ep}@${s.start}`);
  assert.deepEqual(keys(now), ['CC1@6', 'CC1@60', 'CC2@9']);
  assert.deepEqual(keys(upcoming), ['E062@0', 'CC1@121', 'E062@90', 'CC2@190']);
});

test('the episode played for the worthiest word plays first, in story order; one back only as studied plays after', () => {
  const at = {
    'CC4@0': ['2026-10-04', 2], 'CC4@100': ['2026-10-06', 5],
    'CC19@0': ['2026-10-06', 3], 'CC19@100': ['2026-10-06', 0],
    'CC118@0': ['2026-10-06', 6], 'CC7@0': ['2026-10-05', 6],
  };
  const list = Object.keys(at).map((key) => {
    const [ep, start] = key.split('@');
    return studied(ep, Number(start), ['2026-10-01']);
  });
  const key = (/** @type {any} */ s) => `${s.ep}@${s.start}`;
  const { due } = spacedPlaylist(list, { today: '2026-10-06', dueOf: (s) => at[key(s)][0], rankOf: (s) => at[key(s)][1] });
  assert.deepEqual(due.map(key), ['CC19@0', 'CC19@100', 'CC4@0', 'CC4@100', 'CC7@0', 'CC118@0']);
});

test('a chapter nothing brings back is neither due nor coming', () => {
  const list = [studied('CC1', 0, ['2026-10-01']), studied('CC1', 60, ['2026-10-01'])];
  const { due, upcoming } = spacedPlaylist(list, { today: '2026-10-06', dueOf: (s) => (s.start ? '2026-10-06' : undefined) });
  assert.deepEqual([due.map((s) => s.start), upcoming.length], [[60], 0]);
});

test('among episodes due the same day, the one studied latest goes first; one episode can be picked', () => {
  const list = [studied('E062', 0, ['2026-10-01']), studied('CC3', 0, ['2026-10-03']), studied('CC3', 50, ['2026-10-02'])];
  const dueOf = () => '2026-10-06';
  assert.deepEqual(spacedPlaylist(list, { today: '2026-10-06', dueOf }).due.map((s) => `${s.ep}@${s.start}`), ['CC3@0', 'CC3@50', 'E062@0']);
  assert.deepEqual(spacedPlaylist(list, { today: '2026-10-06', ep: 'E062', dueOf }).due.map((s) => s.ep), ['E062']);
});
