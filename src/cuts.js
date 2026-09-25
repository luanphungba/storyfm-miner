// @ts-check
// Splits a spoken sentence into the short lines that end up on the page and on Anki cards.
//
// segment.js cuts where the ASR put 。！？, which leaves half the sentences at 25+ characters —
// too long to mine. Where to cut further is a call about meaning, so a model reading the
// transcript makes it (the split-cues skill) and it is saved in data/cuts/<id>.json. This file
// only checks and applies that plan; it never decides a cut.
//
// A plan is stored as the ASR word each new line starts at, not as text. That keeps it valid when
// a transcript fix lands later, and it means a plan cannot change a character or move a timestamp:
// every line starts where an ASR word starts and takes its timing from that word.
//
// The transcript fixes in data/corrections/ are replayed here too, onto the sentence, before it is
// split — the same sentence index both files use.
//
// A plan can also join a sentence's last line onto the next sentence's first. Where the ASR never
// punctuated, segment.js had to break at a length limit, sometimes mid-word (迷迷糊 | 糊的), and
// no cut inside either sentence can mend that.

import { joinWords, toCue, glue } from './segment.js';

/** @typedef {import('./segment.js').Word} Word */
/** @typedef {{ before: string, after: string }} Fix */

/** Speech runs 150-300ms a character. A line far under that sits in a run of words the ASR
 * collapsed onto one timestamp, and would loop almost no audio. */
const MIN_MS_PER_CHAR = 60;

const PUNCTUATION = /[，。！？、；：,.!?;:“”"‘’《》（）()\s]/g;

/**
 * Applies fixes the way the ledger always has (every occurrence, in order) and remembers, for
 * each character of the result, which character of the original it came from — -1 for a
 * character a fix wrote.
 * @param {string} text
 * @param {Fix[]} fixes
 */
export function applyFixes(text, fixes) {
  let current = text;
  let origin = Array.from({ length: text.length }, (_, k) => k);
  for (const { before, after } of fixes) {
    if (!current.includes(before)) {
      throw new Error(`không tìm thấy "${before}" để sửa thành "${after}"`);
    }
    let out = '';
    /** @type {number[]} */
    const map = [];
    let from = 0;
    for (let at = current.indexOf(before); at !== -1; at = current.indexOf(before, from)) {
      out += current.slice(from, at) + after;
      map.push(...origin.slice(from, at), ...Array(after.length).fill(-1));
      from = at + before.length;
    }
    current = out + current.slice(from);
    origin = [...map, ...origin.slice(from)];
  }
  return { text: current, origin };
}

/** The original offset a cut at `position` of the fixed text stands for. A cut right before a
 * fixed span is still a clean cut: it stands just past the character before it. Inside a fixed
 * span there is no original offset, so -1. */
function originalAt(/** @type {number[]} */ origin, /** @type {number} */ position) {
  if (origin[position] !== -1) return origin[position];
  return origin[position - 1] === -1 ? -1 : origin[position - 1] + 1;
}

/** Where each word starts in joinWords(words), keyed by that offset. */
function wordStarts(/** @type {Word[]} */ words) {
  /** @type {Map<number, number>} */
  const starts = new Map();
  for (let k = 0; k < words.length; k += 1) {
    const joined = joinWords(words.slice(0, k + 1));
    starts.set(joined.length - words[k].text.length, k);
  }
  return starts;
}

const zeroLength = (/** @type {Word} */ word) => word.end === word.start;

/**
 * Turns a sentence marked with "/" at each cut into the plan saved in data/cuts/.
 * @param {Word[]} words
 * @param {Fix[]} fixes
 * @param {string} marked  The fixed sentence, character for character, with a "/" at each cut.
 * @returns {number[]}  Index of the word each new line starts at.
 */
export function planFromMarks(words, fixes, marked) {
  const { text, origin } = applyFixes(joinWords(words), fixes);
  if (marked.replaceAll('/', '') !== text) {
    throw new Error(`bỏ dấu / đi phải ra đúng câu gốc:\n  gốc: ${text}\n  cắt: ${marked}`);
  }
  const starts = wordStarts(words);
  /** @type {number[]} */
  const plan = [];
  let position = 0;
  for (const piece of marked.split('/').slice(0, -1)) {
    position += piece.length;
    const at = originalAt(origin, position);
    if (at === -1) throw new Error(`"${piece.slice(-4)}|" cắt vào giữa một chỗ đã sửa chữ`);
    const word = starts.get(at);
    if (word === undefined || word === 0) {
      throw new Error(`"${piece.slice(-4)}|" không nằm ở chỗ bắt đầu một từ ASR`);
    }
    plan.push(word);
  }
  splitSentence(words, fixes, plan);
  return plan;
}

/**
 * @param {Word[]} words
 * @param {Fix[]} fixes
 * @param {number[]} [plan]  From planFromMarks; none leaves the sentence whole.
 */
export function splitSentence(words, fixes, plan = []) {
  const { text, origin } = applyFixes(joinWords(words), fixes);
  if (!plan.length) return [{ ...toCue(words), text }];

  const starts = wordStarts(words);
  /** Offset in the fixed text where word k starts. */
  const offsetOf = (/** @type {number} */ k) => {
    const raw = [...starts].find(([, index]) => index === k)?.[0];
    for (let at = 1; at < text.length; at += 1) if (originalAt(origin, at) === raw) return at;
    throw new Error(`chỗ cắt ở từ ${k} rơi vào giữa một chỗ đã sửa chữ`);
  };

  const bounds = [0, ...plan, words.length];
  const offsets = [0, ...plan.map(offsetOf), text.length];
  return bounds.slice(0, -1).map((from, n) => {
    const to = bounds[n + 1];
    if (!(to > from)) throw new Error(`thứ tự chỗ cắt sai: ${plan.join(', ')}`);
    // Inside a collapsed run every word shares one timestamp, so the lines on either side of a
    // cut there would split audio that was never told apart.
    if (to < words.length && zeroLength(words[to - 1]) && zeroLength(words[to])) {
      throw new Error(`"${joinWords(words.slice(from, to)).slice(-4)}|" cắt vào giữa một cụm từ ASR dồn chung một thời điểm`);
    }
    const line = { ...toCue(words.slice(from, to)), text: text.slice(offsets[n], offsets[n + 1]) };
    const characters = line.text.replace(PUNCTUATION, '').length;
    if ((line.end - line.start) * 1000 < characters * MIN_MS_PER_CHAR) {
      throw new Error(`"${line.text}" chỉ có ${(line.end - line.start).toFixed(1)}s audio — ASR dồn thời gian ở đây`);
    }
    return line;
  });
}

/**
 * Joins the last line of each listed sentence onto the first line of the one after it.
 * @template {{ s: number, start: number, end: number, text: string, speaker: string }} Line
 * @param {Line[]} lines  In order, every line carrying the sentence it came from.
 * @param {number[]} joins
 * @returns {Line[]}
 */
export function joinSentences(lines, joins) {
  const joined = [...lines];
  for (const s of [...joins].sort((a, b) => b - a)) {
    const at = joined.findLastIndex((line) => line.s === s);
    const next = joined[at + 1];
    if (at === -1 || next?.s !== s + 1) throw new Error(`không có câu ${s + 1} ngay sau câu ${s} để nối`);
    if (next.speaker !== joined[at].speaker) throw new Error(`câu ${s} và ${s + 1} là hai người nói khác nhau`);
    joined.splice(at, 2, { ...joined[at], end: next.end, text: glue(joined[at].text, next.text) });
  }
  return joined;
}
