// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { markLine, highlight, pickSentence, noteData, plainText, dailyLimit, sentenceSpan, lineLink } from '../docs/card.js';

test('marks the tapped word inside its line', () => {
  assert.equal(markLine('我终于下定决心了', 5, 2), '我终于下定【决心】了');
});

test('bolds the word and escapes the rest', () => {
  assert.equal(highlight('<我>决心', '决心'), '&lt;我&gt;<b>决心</b>');
});

test('keeps the model\'s cleaned-up line when it is the tapped line', () => {
  assert.equal(pickSentence('我终于下定决心了。', '我终于下定【决心】了', '下定决心'), '我终于下定决心了。');
});

test('falls back to the tapped line when the model answers with a neighbouring one', () => {
  assert.equal(pickSentence('他没有决心去做。', '我终于下定【决心】了', '决心'), '我终于下定决心了');
});

test('builds the same note the extension builds for a storyfm line', () => {
  const { fields, tags } = noteData({
    lookup: {
      word: '下定决心', traditional: '下定決心', pinyin: 'xià dìng jué xīn', hanViet: 'HẠ ĐỊNH QUYẾT TÂM',
      pos: 'động từ', otherMeanings: [], sentenceTranslation: 'Cuối cùng tôi đã quyết tâm.',
      example: { zh: '他下定决心学中文。', translation: 'Anh ấy quyết tâm học tiếng Trung.' },
      level: 'HSK 7-9', levelTag: 'HSK::7-9',
    },
    word: '下定决心',
    meaning: 'quyết tâm',
    sentence: '我终于下定决心了。',
    episode: { id: 'E757', title: 'E757.标题' },
    cue: { start: 65.24, end: 67.9 },
    audioSrc: 'https://cdn.example/a.mp3',
    py: (text) => `py(${text})`,
  });
  assert.equal(fields.Sentence, '我终于<b>下定决心</b>了。');
  assert.equal(fields.Example, '他<b>下定决心</b>学中文。');
  assert.equal(fields.SentencePinyin, 'py(我终于下定决心了。)');
  assert.equal(fields.Traditional, '下定決心');
  assert.equal(
    fields.VideoLink,
    '<a href="https://luanphungba.github.io/storyfm-miner/player.html?ep=E757&amp;start=65.2&amp;end=67.9&amp;loop=10&amp;src=https%3A%2F%2Fcdn.example%2Fa.mp3">▶ E757.标题 · 1:05</a>',
  );
  assert.deepEqual(tags, ['storyfm', 'sfm_E757', 'HSK::7-9']);
});

test('reads a saved field back as the text it shows', () => {
  assert.equal(plainText('我终于<b>下定决心</b>了 &amp; &lt;好&gt;'), '我终于下定决心了 & <好>');
});

test('lets a new word through until today\'s new cards fill the day', () => {
  assert.equal(dailyLimit({ added: 9, limit: 10, waiting: 30 }), null);
  assert.deepEqual(dailyLimit({ added: 10, limit: 10, waiting: 25 }), {
    title: 'Hôm nay đã thêm 10/10 thẻ mới',
    detail: '25 thẻ đang chờ học, đủ cho khoảng 3 ngày.',
  });
});

test('says what one more card means when few are waiting', () => {
  assert.equal(dailyLimit({ added: 12, limit: 10, waiting: 4 })?.detail,
    'Anki cho học 10 thẻ mới mỗi ngày, thẻ thêm nữa sẽ chờ sang hôm sau.');
});

test('never stops a word for a server without counts or a deck paused at 0 new cards', () => {
  assert.equal(dailyLimit(undefined), null);
  assert.equal(dailyLimit(null), null);
  assert.equal(dailyLimit({ added: 3, limit: 0, waiting: 3 }), null);
});

// CC3 around 而且要理解它背后: the card showed the whole sentence and replayed only the tapped line.
const around = [
  { start: 202.35, end: 204.13, text: '但是我感觉到很多事情' },
  { start: 204.13, end: 207.39, text: '确实要花一点时间，不仅是适应，' },
  { start: 207.39, end: 208.73, text: '而且要理解它背后' },
  { start: 208.73, end: 210.63, text: '可能有特殊的做事逻辑。' },
  { start: 210.63, end: 212.61, text: '比如说，我最想要跟大家' },
];

test('spans every line the sentence runs over, not just the tapped one', () => {
  assert.deepEqual(sentenceSpan('而且要理解它背后，可能有特殊的做事逻辑。', around, 2), { start: 207.39, end: 210.63 });
  assert.deepEqual(sentenceSpan('可能有特殊的做事逻辑。', around, 3), { start: 208.73, end: 210.63 });
});

test('follows a sentence the model tidied up', () => {
  // E081: the model dropped the 呃 in 英国呃男性.
  const lines = [
    { start: 268.7, end: 270.76, text: '本坐在圆桌中间等着我们。' },
    { start: 271.26, end: 276.3, text: '嗯，他是一个留着这个胡子的' },
    { start: 276.3, end: 278.72, text: '英国呃男性，' },
    { start: 278.72, end: 280.36, text: '后来我知道他比我小一岁，' },
  ];
  assert.deepEqual(sentenceSpan('嗯，他是一个留着这个胡子的英国男性。', lines, 1), { start: 271.26, end: 278.72 });
});

test('does not stretch to a short neighbour that only shares a character or two', () => {
  const lines = [
    { start: 0, end: 1, text: '是的。' },
    { start: 1, end: 3, text: '我觉得是这样的。' },
    { start: 3, end: 4, text: '你的呢？' },
  ];
  assert.deepEqual(sentenceSpan('我觉得是这样的。', lines, 1), { start: 1, end: 3 });
});

test('rounds a link outwards to the tenth, so it never clips its line', () => {
  const link = lineLink({ id: 'CC3', title: '' }, { start: 159.56, end: 163.12 }, '');
  assert.match(link, /start=159\.5&end=163\.2/);
});
