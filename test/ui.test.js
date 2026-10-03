// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { piecesOf, spoken, timeline, planChapters, translationLedger, partsBySentence, SELF_MARK } from '../src/ui.js';
import { buildChapters } from '../src/chapters.js';
import { buildSidecar } from '../src/translations.js';

/** @returns {import('../src/ui.js').UiLine} */
const line = (zh, vi = 'x', extra = {}) => ({ zh, vi, en: 'x', source: 'apple', ...extra });

const pages = [
  { zh: '通用', vi: 'Cài đặt chung', en: 'General', lines: [line('通用'), line('关于本机')] },
  {
    zh: 'Wi-Fi', vi: 'Wi-Fi', en: 'Wi-Fi', lines: [
      line('网络'),
      line('将自动加入已知网络。如果没有已知网络，将通知你有可用网络。', 'Mạng đã biết sẽ tự kết nối. Nếu không có, bạn sẽ được báo.', {
        cuts: ['将自动加入已知网络。', '如果没有已知网络，', '将通知你有可用网络。'],
      }),
    ],
  },
];

test('a line is read as its cuts, each piece keeping the line it belongs to and its page', () => {
  assert.deepEqual(piecesOf(pages).map((p) => [p.text, p.s, p.page]), [
    ['通用', 0, 0], ['关于本机', 1, 0], ['网络', 2, 1],
    ['将自动加入已知网络。', 3, 1], ['如果没有已知网络，', 3, 1], ['将通知你有可用网络。', 3, 1],
  ]);
});

test('cuts that do not spell the line are refused rather than read', () => {
  assert.throws(() => piecesOf([{ zh: 'p', vi: 'p', en: 'p', lines: [line('关于本机', 'x', { cuts: ['关于', '本'] })] }]), /không ghép lại/);
});

test('the voice is given no quotes and no arrows', () => {
  assert.equal(spoken('快速访问“相机”。'), '快速访问相机。');
  assert.equal(spoken('前往“设置”->“Siri与搜索”'), '前往设置，Siri与搜索');
});

test('each piece is read, read again, then left silent for as long as it takes to say back', () => {
  const pieces = piecesOf(pages).slice(0, 3);
  const { cues, plan, duration } = timeline(pieces, [1, 2, 1], { again: 0.5, sayBack: 1, page: 3 });
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.s]), [[0, 2.5, 0], [4.5, 9, 1], [15, 17.5, 2]]);
  assert.deepEqual(plan.slice(0, 4), [{ clip: 0 }, { silence: 0.5 }, { clip: 0 }, { silence: 2 }]);
  assert.ok(plan.some((step) => 'silence' in step && step.silence === 3), 'a new page waits longer');
  assert.equal(duration, 19.5);
});

test('the cues fit the chapter and translation sidecars every other episode uses', () => {
  const pieces = piecesOf(pages);
  const { cues } = timeline(pieces, pieces.map(() => 1));
  const ledger = translationLedger({ id: 'T', title: 't', summary: ['s'], pages });
  const { sidecar, missing, stale, misaligned } = buildSidecar(cues, ledger);
  assert.deepEqual([missing, stale, misaligned], [[], [], []]);
  assert.equal(sidecar.lines[3], 'Mạng đã biết sẽ tự kết nối.', 'the first sentence sits under its own piece');
  assert.equal(sidecar.lines[5], 'Nếu không có, bạn sẽ được báo.');
  const chapters = buildChapters(cues, { chapters: planChapters(pages, [['通用'], ['Wi-Fi']]) });
  assert.deepEqual([chapters.lost, chapters.changed], [[], []]);
  assert.deepEqual(chapters.sidecar.chapters.map((c) => [c.zh, c.from, c.to]), [['通用', 0, 1], ['Wi-Fi', 2, 5]]);
});

test('a chapter is a group of pages that belong together, however long it runs', () => {
  const long = { zh: '隐私', vi: 'Riêng tư', en: 'Privacy', lines: Array.from({ length: 6 }, (_, k) => line(`行${k}`)) };
  const short = { zh: '短', vi: 'Ngắn', en: 'Short', lines: [line('一')] };
  const next = { zh: '下', vi: 'Sau', en: 'Next', lines: [line('二')] };
  assert.deepEqual(planChapters([long, short, next], [['隐私'], ['短', '下']]), [
    { from: 0, zh: '隐私', vi: 'Riêng tư', first: '行0' },
    { from: 6, zh: '短 · 下', vi: 'Ngắn · Sau', first: '一' },
  ]);
  assert.throws(() => planChapters([long, short, next], [['短'], ['隐私', '下']]), /đúng thứ tự/);
});

test('a translation is split by sentence only where the cuts end with the sentences', () => {
  assert.deepEqual(partsBySentence('甲。乙。', 'A. B.', ['甲。', '乙。']), [{ zh: '甲。', vi: 'A.' }, { zh: '乙。', vi: 'B.' }]);
  assert.equal(partsBySentence('甲乙。丙。', 'A. B.', ['甲', '乙。丙。']), null, 'a sentence ends inside a piece');
  assert.equal(partsBySentence('甲。乙。', 'A and B.', ['甲。', '乙。']), null, 'the languages count different sentences');
});

test('a line translated here, not by Apple, is marked as such', () => {
  const ledger = translationLedger({ id: 'T', title: 't', summary: [], pages: [{ zh: 'p', vi: 'p', en: 'p', lines: [line('解锁后自动允许', 'Tự động cho phép', { source: 'self' })] }] });
  assert.deepEqual(ledger.sentences[0], { zh: '解锁后自动允许', vi: `${SELF_MARK}Tự động cho phép` });
});

test('a sentence that runs over more than two pieces keeps its translation whole', () => {
  assert.equal(partsBySentence('甲乙丙。丁。', 'A. B.', ['甲', '乙', '丙。', '丁。']), null);
});
