// @ts-check
// Which words of an episode still need their Vietnamese meaning written, or read against the
// sentences the episode says them in.
//
// tools/gloss-vi.json gives a word one meaning, written once and shared by every episode that says
// it. Until now a meaning was only ever read against the episode it was written for: 交代 went in as
// "dặn dò, trăng trối" for E757, where a mother falls ill before she can say what she meant to, and
// CC5 then showed that under 也算是交代一下这个星期的任务 — "hand in this week's work" — because the
// to-do list named only words with no meaning at all. So a meaning counts as done for an episode
// once it has been read against that episode's sentences, and tools/gloss-checked.json records
// which words have been, per episode.
//
// HSK 1-2 is left out of that reading: it is the vocabulary the reader already knows, so those are
// not the cards that get tapped, and re-reading them in every episode would double the work.

import { sentencesOf } from './translations.js';

/** HSK bands the reader already knows. */
const KNOWN_BANDS = new Set([1, 2]);

/** Characters of the sentence kept on each side of the word: enough to tell which sense it is. */
const REACH = 14;

/** Sentences shown per word and episode. A word keeps one sense through one story — 任务 said ten
 * times in an episode is the same 任务 — so two show it, and the rest would bury the words that
 * actually change sense between episodes. */
const SHOWN = 2;

/**
 * @typedef {[start: number, length: number, band: number, said: number, isName: number]} Token
 *   One word of a line, as tools/build_tokens.py writes it; band 0 is off the HSK list.
 * @typedef {{ band: number, isName: boolean, said: number, contexts: string[] }} Pending
 */

/**
 * The words of one episode whose meaning is missing, or written but not yet read against this
 * episode, each with the first sentences it is said in, the word marked 【like this】.
 * @param {import('./translations.js').Line[]} lines
 * @param {Token[][]} tokens  The words of each line, indexed the same way.
 * @param {(word: string) => boolean} hasMeaning
 * @param {Set<string>} checked  Words whose meaning has already been read against this episode.
 * @returns {Map<string, Pending>}
 */
export function toRead(lines, tokens, hasMeaning, checked) {
  /** @type {Map<string, Pending>} */
  const pending = new Map();
  for (const sentence of sentencesOf(lines)) {
    let offset = 0;
    for (const index of sentence.lines) {
      for (const [start, length, band, , isName] of tokens[index] ?? []) {
        const word = lines[index].text.slice(start, start + length);
        if (hasMeaning(word) && (KNOWN_BANDS.has(band) || checked.has(word))) continue;
        const entry = pending.get(word) ?? { band, isName: Boolean(isName), said: 0, contexts: [] };
        const context = around(sentence.text, offset + start, length);
        if (entry.contexts.length < SHOWN && !entry.contexts.includes(context)) entry.contexts.push(context);
        entry.said += 1;
        pending.set(word, entry);
      }
      offset += lines[index].text.length;
    }
  }
  return pending;
}

/** The part of a sentence around one word, the word in 【】 and a cut side marked …. */
function around(/** @type {string} */ text, /** @type {number} */ start, /** @type {number} */ length) {
  const end = start + length;
  const from = Math.max(0, start - REACH);
  const to = Math.min(text.length, end + REACH);
  return `${from > 0 ? '…' : ''}${text.slice(from, start)}【${text.slice(start, end)}】${text.slice(end, to)}${to < text.length ? '…' : ''}`;
}
