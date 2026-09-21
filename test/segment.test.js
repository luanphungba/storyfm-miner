// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCues, punctuationRate } from '../src/segment.js';

/** One word per character, 100ms each — enough shape for the splitter, readable in assertions. */
function wordsFrom(/** @type {string} */ text, speaker = 'A', startMs = 0) {
  return [...text].map((character, index) => ({
    text: character,
    start: startMs + index * 100,
    end: startMs + (index + 1) * 100,
    speaker,
  }));
}

const texts = (/** @type {{text: string}[]} */ cues) => cues.map((cue) => cue.text);

test('splits on sentence punctuation', () => {
  const cues = toCues(wordsFrom('我饿了。你呢？走吧！'));
  assert.deepEqual(texts(cues), ['我饿了。', '你呢？', '走吧！']);
});

test('numbers cues in order', () => {
  const cues = toCues(wordsFrom('我饿了。你吃了吗？'));
  assert.deepEqual(cues.map((cue) => cue.i), [0, 1]);
});

test('never lets a cue span two speakers', () => {
  const cues = toCues([...wordsFrom('你去哪儿', 'A'), ...wordsFrom('回家吧', 'B', 1000)]);
  assert.deepEqual(texts(cues), ['你去哪儿', '回家吧']);
  assert.deepEqual(cues.map((cue) => cue.speaker), ['A', 'B']);
});

test('breaks an over-long run at the last comma rather than mid-phrase', () => {
  const cues = toCues(wordsFrom(`${'一'.repeat(19)}，${'二'.repeat(30)}`));
  assert.equal(cues[0].text, `${'一'.repeat(19)}，`);
  assert.ok(cues.length > 1, 'phần còn lại phải thành cue riêng');
});

test('breaks an over-long run with no punctuation at all', () => {
  const cues = toCues(wordsFrom('一'.repeat(90)));
  assert.ok(cues.length >= 2);
  assert.ok(cues.every((cue) => cue.text.length <= 42));
});

test('keeps a short but complete sentence as its own cue', () => {
  assert.deepEqual(texts(toCues(wordsFrom('我吃饱了。啊。'))), ['我吃饱了。', '啊。']);
});

test('takes timestamps from the first and last word, in seconds', () => {
  const [cue] = toCues(wordsFrom('我吃饱了。', 'A', 12400));
  assert.equal(cue.start, 12.4);
  assert.equal(cue.end, 12.9);
});

test('glues CJK but keeps spaces between Latin words', () => {
  const at = (/** @type {string} */ text, /** @type {number} */ i) => ({
    text, start: i * 100, end: (i + 1) * 100, speaker: 'A',
  });
  assert.equal(toCues([at('她在', 0), at('ICU', 1), at('里。', 2)])[0].text, '她在ICU里。');
  assert.equal(toCues([at('996', 0), at('is', 1), at('hard。', 2)])[0].text, '996 is hard。');
});

test('punctuationRate reports how many cues end on a real sentence mark', () => {
  assert.equal(punctuationRate(toCues(wordsFrom('我饿了。你呢？'))), 1);
  assert.equal(punctuationRate([]), 0);
  assert.equal(punctuationRate(toCues(wordsFrom('一'.repeat(90)))), 0);
});
