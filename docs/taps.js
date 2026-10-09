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

/** @typedef {{ day: string, word: string, ep: string, at: number, ms?: number }} Tap  `at` is the start of the
 *   line tapped in; `ms`, when, so the server can tell a tap after the word was said to be known from one
 *   before it that day. A tap kept unsent by an older page has none. */
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

const tapKey = (/** @type {Tap} */ t) => `${t.day} ${t.word} ${t.ep} ${t.at} ${t.ms}`;

/**
 * Sends the tap of `word` in the line starting at `at`, with any an earlier page could not send, and
 * returns how many days the word has been tapped on and whether it has a card.
 * @param {import('./server.js').Connection} connection
 * @param {{ word: string, ep: string, at: number }} tap
 * @returns {Promise<TapCount | null>}  null for a tap the server would not take
 */
export async function recordTap(connection, { word, ep, at }) {
  if (!word || [...word].length > MAX_WORD || !ep) return null;
  const now = new Date();
  const sent = [...readUnsent(), { day: studyDay(now), word, ep, at, ms: now.getTime() }].slice(-MAX_UNSENT);
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

/**
 * A chapter's words in the order they are best learned: by `rank`, the place of each word's level
 * (hsk.js), the lowest band first; in a level the ones tapped on the most days first, then in the
 * order they are said.
 * @param {TappedWord[]} words
 * @param {(word: string) => number} rank
 */
export const forStudy = (words, rank) =>
  [...words].sort((a, b) => rank(a.word) - rank(b.word) || b.days - a.days || a.at - b.at);

/**
 * How many words were tapped on each day, from every day each word was tapped on, as the server
 * keeps them (/vocab).
 * @param {Record<string, string[]>} daysOf
 * @returns {Record<string, number>}
 */
export function tappedByDay(daysOf) {
  /** @type {Record<string, number>} */
  const count = {};
  for (const days of Object.values(daysOf)) {
    for (const day of days) count[day] = (count[day] ?? 0) + 1;
  }
  return count;
}

/**
 * How many words are left to learn of the chapters given: each word tapped in one and not said to be
 * known since, once however many it was tapped in. The server lists no known word (/tapped).
 */
export const unknownWords = (/** @type {{ words: TappedWord[] }[]} */ chapters) =>
  new Set(chapters.flatMap((c) => c.words.map((w) => w.word))).size;
