// @ts-check
// How much of a chapter is understood, counted in words said: a word said nine times stops the ear
// nine times, so each time it is said counts. Before a chapter is studied this is foretold from the
// words understood so far (vocab.js). Once studied, it is measured by the words tapped in it on the
// day it was first studied: what hearing it fresh missed, as on a later day its lines are remembered.
// Over the 15 chapters first studied 2026-10-09 to 10-11 the two were 3.2 points apart on average.
//
// A tap names the span of the transcript it landed on, which may be a phrase: a tap on 历史课 misses
// 历史课 where it is said, not every 历史 and 课 heard on their own. Pure, so test/coverage.test.js
// covers it.

import { addDays } from './progress.js';
import { dayLabel } from './studied.js';

/** Taps are logged from the player from this day. Before it only the words given a card were
 * (seed-taps), so a chapter first studied earlier has nothing to be measured by. */
export const TAPS_FROM = '2026-10-06';

/** @typedef {{ word: string, span: string }} Said  A word as the vocabulary counts it, and the span it is said in. */
/** @typedef {{ text: string, title: string, measured: boolean }} Coverage  What a chapter's heading says. */

/**
 * The words each line says, in order, each with its span.
 * @param {{ start: number, text: string }[]} cues
 * @param {(number[])[][]} tokens  each line's spans, `[start, length, band, count, isName]` (.tok.json)
 * @param {[number, string][]} counted  each line's start and the words it counts as, spaced (.vocab.json)
 * @returns {Said[][]}
 */
export function wordsSaid(cues, tokens, counted) {
  /** @type {Map<number, string[][]>} */
  const waiting = new Map();
  for (const [start, words] of counted) waiting.set(start, [...(waiting.get(start) ?? []), words.split(' ')]);
  return cues.map(({ start, text }, line) => {
    // Lines can start together (a run of collapsed timestamps), and the words are filed by start:
    // each of them takes the words its own spans hold.
    const lists = waiting.get(start) ?? [];
    const tries = lists.map((words) => place(words, text, tokens[line] ?? []));
    const best = tries.reduce((b, said, k) => (said.length > (tries[b]?.length ?? 0) ? k : b), -1);
    if (best < 0) return [];
    lists.splice(best, 1);
    return tries[best];
  });
}

/** The words found in a line's spans, in order. A span counts as itself or as the words it is made
 * of, in order (学法语 → 学 法语), and a name as none, even one holding a word (刘 in 刘哥). */
function place(/** @type {string[]} */ words, /** @type {string} */ text, /** @type {number[][]} */ spans) {
  /** @type {Said[]} */
  const said = [];
  let k = 0;
  for (const [at, length, , , isName] of spans) {
    if (isName) continue;
    const span = text.slice(at, at + length);
    let found = 0;
    while (k < words.length && (found = span.indexOf(words[k], found)) >= 0) {
      said.push({ word: words[k], span });
      found += words[k].length;
      k += 1;
    }
  }
  return said;
}

/** The share of `said` understood, `missed` taken out; null for a chapter with no word to count. */
const share = (/** @type {Said[]} */ said, /** @type {Said[]} */ missed) => (said.length ? 1 - missed.length / said.length : null);

/**
 * How much of a chapter should be understood, from the words understood so far.
 * @param {Said[]} said
 * @param {Set<string>} understood
 * @returns {{ share: number | null, unknown: number }}  `unknown`: the different words not understood yet
 */
export function foretell(said, understood) {
  const missed = said.filter(({ word }) => !understood.has(word));
  return { share: share(said, missed), unknown: new Set(missed.map(({ word }) => word)).size };
}

/**
 * How much of a chapter was understood, by the spans tapped in it: a word is missed where the span
 * it is said in was tapped, and wherever it is said once it was tapped on its own.
 * @param {Said[]} said
 * @param {string[]} tapped
 * @returns {number | null}
 */
export function measure(said, tapped) {
  const spans = new Set(tapped);
  return share(said, said.filter(({ word, span }) => spans.has(span) || spans.has(word)));
}

const percent = (/** @type {number} */ s) => `${Math.floor(s * 100)}%`;

/**
 * What a chapter's heading says of how much of it is understood: measured once it was first studied
 * on a day the taps were logged, foretold otherwise. A chapter studied but not measured is foretold
 * as it stood the day before, as its own words have been learned since.
 * @param {Said[]} said
 * @param {{ dates: string[], tappedOn: Record<string, string[]> | null,
 *   understoodOn: ((day: string) => Set<string>) | null, today: string }} chapter
 *   dates — the days it was studied, none if it was not; tappedOn — the spans tapped in it each day,
 *   null when the server does not say; understoodOn — the words understood on the evening of a day,
 *   null without the vocabulary
 * @returns {Coverage | null}
 */
export function chapterCoverage(said, { dates, tappedOn, understoodOn, today }) {
  const first = [...dates].sort()[0];
  const before = first && understoodOn ? foretell(said, understoodOn(addDays(first, -1))).share : null;
  if (first && first >= TAPS_FROM && tappedOn) {
    const tapped = tappedOn[first] ?? [];
    const measured = measure(said, tapped);
    if (measured === null) return null;
    const foretold = before === null ? '' : ` · dự đoán trước khi học ≈${percent(before)}`;
    return {
      text: percent(measured),
      title: `Hiểu ${percent(measured)} lượt từ, đo bằng ${tapped.length} từ đã tra ngày học đầu tiên (${dayLabel(first, today)})${foretold}`,
      measured: true,
    };
  }
  if (first) {
    if (before === null) return null;
    return { text: `≈${percent(before)}`, title: `Dự đoán trước khi học: hiểu ≈${percent(before)} lượt từ`, measured: false };
  }
  if (!understoodOn) return null;
  const { share: now, unknown } = foretell(said, understoodOn(today));
  if (now === null) return null;
  return { text: `≈${percent(now)}`, title: `Dự đoán: hiểu ≈${percent(now)} lượt từ, ${unknown} từ chưa hiểu khi nghe`, measured: false };
}
