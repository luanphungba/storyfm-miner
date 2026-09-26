// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { markLine, highlight, pickSentence, noteData } from '../docs/card.js';

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
