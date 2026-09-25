// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFixes, planFromMarks, splitSentence, joinSentences } from '../src/cuts.js';

/** One word per piece, 200ms a character — real speech pace, so the audio check stays quiet. */
function wordsFrom(/** @type {string[]} */ pieces, startMs = 0) {
  let at = startMs;
  return pieces.map((text) => {
    const word = { text, start: at, end: at + text.length * 200, speaker: 'A' };
    at = word.end;
    return word;
  });
}

const texts = (/** @type {{text: string}[]} */ lines) => lines.map((line) => line.text);

test('cuts a sentence into lines without changing a character', () => {
  const words = wordsFrom(['我', '很', '累，', '所以', '我', '就', '去', '睡觉', '了。']);
  const plan = planFromMarks(words, [], '我很累，/所以我就去睡觉了。');
  assert.deepEqual(plan, [3]);
  assert.deepEqual(texts(splitSentence(words, [], plan)), ['我很累，', '所以我就去睡觉了。']);
});

test('times each line from its own words', () => {
  const words = wordsFrom(['我', '很', '累，', '所以', '我', '就', '去', '睡觉', '了。'], 10_000);
  const [first, second] = splitSentence(words, [], [3]);
  assert.deepEqual([first.start, first.end], [10, 10.8]);
  assert.deepEqual([second.start, second.end], [10.8, 12.6]);
});

test('leaves a sentence with no plan whole', () => {
  const words = wordsFrom(['你', '呢？']);
  assert.deepEqual(texts(splitSentence(words, [])), ['你呢？']);
});

test('refuses a plan that changes the text', () => {
  const words = wordsFrom(['我', '很', '累，', '所以', '睡觉', '了。']);
  assert.throws(() => planFromMarks(words, [], '我很累，/所以去睡觉了。'), /đúng câu gốc/);
});

test('refuses a cut inside an ASR word', () => {
  const words = wordsFrom(['我', '很', '累，', '所以', '睡觉', '了。']);
  assert.throws(() => planFromMarks(words, [], '我很累，所/以睡觉了。'), /từ ASR/);
});

test('refuses a cut inside a run the ASR collapsed onto one timestamp', () => {
  const words = [
    ...wordsFrom(['我', '会', '好好', '照顾', '他，']),
    { text: '就是', start: 2000, end: 2000, speaker: 'A' },
    { text: '有点', start: 2000, end: 2000, speaker: 'A' },
    { text: '那样。', start: 2000, end: 2000, speaker: 'A' },
  ];
  assert.throws(() => planFromMarks(words, [], '我会好好照顾他，就是/有点那样。'), /dồn chung/);
});

test('refuses a line with almost no audio', () => {
  const words = [
    ...wordsFrom(['虽然', '贴了', '透皮贴，']),
    { text: '然后', start: 1400, end: 1500, speaker: 'A' },
    { text: '她', start: 1500, end: 1500, speaker: 'A' },
    { text: '脚趾', start: 1500, end: 1600, speaker: 'A' },
    { text: '开始', start: 1600, end: 1600, speaker: 'A' },
    { text: '坏死。', start: 1600, end: 1700, speaker: 'A' },
  ];
  assert.throws(() => planFromMarks(words, [], '虽然贴了透皮贴，/然后她脚趾开始坏死。'), /audio/);
});

test('keeps a transcript fix on whichever line it lands in', () => {
  const words = wordsFrom(['欢迎', '收听', '故事', 'F', 'M，', '我', '是', '艾', '哲。']);
  const fixes = [{ before: 'F M', after: 'FM' }, { before: '艾哲', after: '爱哲' }];
  const plan = planFromMarks(words, fixes, '欢迎收听故事FM，/我是爱哲。');
  assert.deepEqual(texts(splitSentence(words, fixes, plan)), ['欢迎收听故事FM，', '我是爱哲。']);
});

test('allows a cut right before a fixed span', () => {
  const words = wordsFrom(['后来', '去', '海', '燕', '宁', '上课。']);
  const fixes = [{ before: '海燕宁', after: '海医安宁' }];
  const plan = planFromMarks(words, fixes, '后来去/海医安宁上课。');
  assert.deepEqual(texts(splitSentence(words, fixes, plan)), ['后来去', '海医安宁上课。']);
});

test('refuses a cut through the middle of a fix', () => {
  const words = wordsFrom(['被', '钉', '在', '储', '柱', '上。']);
  const fixes = [{ before: '储柱', after: '耻辱柱' }];
  assert.throws(() => planFromMarks(words, fixes, '被钉在耻辱/柱上。'), /sửa chữ|từ ASR/);
});

test('a fix that no longer matches the sentence fails loudly instead of vanishing', () => {
  const words = wordsFrom(['我', '是', '爱', '哲。']);
  assert.throws(() => splitSentence(words, [{ before: '艾哲', after: '爱哲' }]), /không tìm thấy/);
});

test('applyFixes maps each character back to the original, -1 where a fix wrote it', () => {
  const { text, origin } = applyFixes('被钉在储柱上', [{ before: '储柱', after: '耻辱柱' }]);
  assert.equal(text, '被钉在耻辱柱上');
  assert.deepEqual(origin, [0, 1, 2, -1, -1, -1, 5]);
});

test('joins a sentence the ASR broke mid-word onto the next one', () => {
  const lines = [
    { s: 0, start: 0, end: 2, text: '然后我就问他', speaker: 'A' },
    { s: 0, start: 2, end: 3, text: '后来他迷迷糊', speaker: 'A' },
    { s: 1, start: 3, end: 4, text: '糊的就是说丹阳', speaker: 'A' },
    { s: 1, start: 4, end: 5, text: '然后我就说好吧', speaker: 'A' },
  ];
  const joined = joinSentences(lines, [0]);
  assert.deepEqual(texts(joined), ['然后我就问他', '后来他迷迷糊糊的就是说丹阳', '然后我就说好吧']);
  assert.deepEqual([joined[1].start, joined[1].end], [2, 4]);
});

test('never joins two speakers into one line', () => {
  const lines = [
    { s: 0, start: 0, end: 1, text: '你去哪儿', speaker: 'A' },
    { s: 1, start: 1, end: 2, text: '回家吧', speaker: 'B' },
  ];
  assert.throws(() => joinSentences(lines, [0]), /người nói/);
});
