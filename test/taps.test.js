// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUBBORN_DAYS, forStudy, tapNote, tappedByDay, tappedElsewhere, unknownWords, wordsLabel } from '../docs/taps.js';

test('the card says the days a word was tapped, and from the third that it may be worth a card', () => {
  assert.deepEqual(tapNote({ days: 1, inAnki: false }, true), { text: 'đã tra 1 ngày', stubborn: false });
  assert.deepEqual(tapNote({ days: STUBBORN_DAYS, inAnki: false }, true), { text: 'đã tra 3 ngày · nên ＋ Anki', stubborn: true });
});

test('a word with a card already, or from an app interface, is never pushed toward Anki', () => {
  assert.deepEqual(tapNote({ days: 5, inAnki: true }, true), { text: 'đã tra 5 ngày · có trong Anki', stubborn: false });
  assert.deepEqual(tapNote({ days: 5, inAnki: false }, false), { text: 'đã tra 5 ngày', stubborn: false });
});

test('a chapter lists its words lowest level first, in a level the ones tapped on the most days, then as said', () => {
  const words = [{ word: '清楚', at: 70.6, days: 1 }, { word: '尴尬', at: 120.2, days: 3 }, { word: '哭', at: 90, days: 1 },
    { word: '面子', at: 150, days: 3 }, { word: '播客', at: 60, days: 4 }];
  const ranks = new Map([['清楚', 3], ['尴尬', 6], ['哭', 3], ['面子', 3], ['播客', 8]]);
  const rank = (/** @type {string} */ word) => ranks.get(word) ?? 8;
  assert.deepEqual(forStudy(words, rank).map((w) => w.word), ['面子', '清楚', '哭', '尴尬', '播客']);
  assert.equal(words[0].word, '清楚');
});

test('counts the words tapped on each day, a word once a day however often it was tapped', () => {
  assert.deepEqual(tappedByDay({ 清楚: ['2026-10-08', '2026-10-09'], 尴尬: ['2026-10-09'], 面子: ['2026-10-07'] }),
    { '2026-10-07': 1, '2026-10-08': 1, '2026-10-09': 2 });
  assert.deepEqual(tappedByDay({}), {});
});

test('counts the words left to learn once, however many chapters they were tapped in', () => {
  const chapters = [
    { words: [{ word: '清楚', at: 70.6, days: 2 }, { word: '尴尬', at: 120.2, days: 1 }] },
    { words: [{ word: '清楚', at: 300, days: 2 }] },
    { words: [] },
  ];
  assert.equal(unknownWords(chapters), 2);
  assert.equal(unknownWords([]), 0);
});

test('a chapter takes in the words tapped elsewhere that it says, heard on its own first line saying them', () => {
  // CC4 ch8 says 具体 and 公平; 具体 was tapped in ch5, 公平 in ch5 and in CC2, 试卷 in ch8 itself.
  const tapped = [
    { ep: 'CC4', start: 322.81, words: [{ word: '具体', at: 346.94, days: 2 }, { word: '公平', at: 330, days: 3 }, { word: '户籍', at: 340, days: 1 }] },
    { ep: 'CC2', start: 100, words: [{ word: '公平', at: 120, days: 3 }] },
    { ep: 'CC4', start: 518.71, words: [{ word: '试卷', at: 518.71, days: 2 }] },
  ];
  const own = [{ word: '试卷', at: 518.71, days: 2 }];
  const said = new Map([['具体', 518.71], ['试卷', 518.71], ['公平', 580.2], ['这个', 518.71]]);
  const name = (/** @type {{ ep: string, start: number }} */ c) => `${c.ep}@${c.start}`;
  assert.deepEqual(tappedElsewhere(tapped, own, said, name), [
    { word: '具体', at: 518.71, days: 2, from: ['CC4@322.81'] },
    { word: '公平', at: 580.2, days: 3, from: ['CC4@322.81', 'CC2@100'] },
  ]);
  assert.deepEqual(tappedElsewhere(tapped, own, new Map(), name), []); // a chapter whose spans are not in yet
});

test("a chapter's button counts its own words, then + the ones tapped elsewhere", () => {
  assert.equal(wordsLabel(11, 8, 'từ'), '11 từ · +8');
  assert.equal(wordsLabel(11, 0, 'từ'), '11 từ');
  assert.equal(wordsLabel(0, 8, 'từ đã tra'), '+8 từ đã tra');
  assert.equal(wordsLabel(0, 0, 'từ'), '');
});
