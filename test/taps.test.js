// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUBBORN_DAYS, forStudy, tapNote } from '../docs/taps.js';

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
