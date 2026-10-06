// @ts-check
// The words tapped in the player for their meaning, kept by the server (server/miner.py) by day. A
// word that needs its meaning on three different days has not stuck from listening and is worth a
// card; a chapter with a word tapped in it comes back the next day in Nghe lại (see spacing.js).
//
// A tap waits in this browser until the server has it, so one made with the network down still
// counts, with the next tap. The server keeps a tap sent twice once.

import { studyDay } from './listening.js';
import { call } from './server.js';

/** From this many days a word is stubborn: listening has not taught it, a card might. */
export const STUBBORN_DAYS = 3;
const UNSENT_KEY = 'ci-taps-unsent';
/** The longest word the server takes. A longer one is never kept: one tap it turns away would hold
 * back every tap after it. */
const MAX_WORD = 40;
/** The taps kept while the server cannot be reached, at most: past it the oldest go. */
const MAX_UNSENT = 500;

/** @typedef {{ day: string, word: string, ep: string, at: number }} Tap  `at` is the start of the line tapped in. */
/** @typedef {{ days: number, inAnki: boolean }} TapCount */
/** @typedef {{ word: string, at: number, days: number }} TappedWord  As the server lists a chapter's. */

/** @returns {Tap[]} */
function readUnsent() {
  try {
    const unsent = JSON.parse(localStorage.getItem(UNSENT_KEY) ?? '[]');
    return Array.isArray(unsent) ? unsent : [];
  } catch {
    return [];
  }
}

function writeUnsent(/** @type {Tap[]} */ unsent) {
  try {
    localStorage.setItem(UNSENT_KEY, JSON.stringify(unsent));
  } catch {
    // Storage blocked: a tap that fails to send is lost, and nothing else is.
  }
}

const tapKey = (/** @type {Tap} */ t) => `${t.day} ${t.word} ${t.ep} ${t.at}`;

/**
 * Sends the tap of `word` in the line starting at `at`, with any an earlier page could not send, and
 * returns how many days the word has been tapped on and whether it has a card.
 * @param {import('./server.js').Connection} connection
 * @param {{ word: string, ep: string, at: number }} tap
 * @returns {Promise<TapCount | null>}  null for a tap the server would not take
 */
export async function recordTap(connection, { word, ep, at }) {
  if (!word || [...word].length > MAX_WORD || !ep) return null;
  const sent = [...readUnsent(), { day: studyDay(new Date()), word, ep, at }].slice(-MAX_UNSENT);
  writeUnsent(sent);
  /** @type {TapCount} */
  const count = await call(connection, '/tap', { taps: sent, word });
  // Dropped only as they were sent: a tap made while the request was out goes with the next one.
  const done = new Set(sent.map(tapKey));
  writeUnsent(readUnsent().filter((t) => !done.has(tapKey(t))));
  return count;
}

/**
 * What the word card says of a word's taps. A word worth a card is said so only where cards are the
 * plan: the words of an app's interface are read in place and never go to Anki.
 * @param {TapCount} count
 * @param {boolean} cardsWanted
 * @returns {{ text: string, stubborn: boolean }}
 */
export function tapNote({ days, inAnki }, cardsWanted) {
  const text = `đã tra ${days} ngày`;
  if (inAnki) return { text: `${text} · có trong Anki`, stubborn: false };
  const stubborn = cardsWanted && days >= STUBBORN_DAYS;
  return { text: stubborn ? `${text} · nên ＋ Anki` : text, stubborn };
}

/** A chapter's words as its list shows them: the ones tapped on the most days first, the rest in
 * the order they are said. */
export const byStubbornness = (/** @type {TappedWord[]} */ words) =>
  [...words].sort((a, b) => b.days - a.days || a.at - b.at);
