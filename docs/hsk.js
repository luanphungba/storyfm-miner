// @ts-check
// A word's HSK level as the reader is shown it, from the band tools/build_tokens.py files on each of
// its spans. The level says how much of spoken Chinese a word buys: band 1 words are 50% of everything
// said, band 7-9 words are the long tail. A word on no list is not a failure to know it — 播客 and
// 面试官 are ordinary speech that the syllabus simply does not cover — so it says so plainly.

/** @typedef {{ band: number, isName: boolean }} Level  `band` 0 for a word the syllabus does not have. */

/** The band the syllabus files 7, 8 and 9 under together. */
const ADVANCED = 7;
/** Where a word the syllabus does not cover sorts, after its last band; a name sorts after that. */
const NO_BAND_RANK = ADVANCED + 1;
const NAME_RANK = NO_BAND_RANK + 1;

/** What a word's level is called: its HSK band, a name, or a word the syllabus does not cover. */
export const levelLabel = (/** @type {number} */ band, /** @type {boolean} */ isName) =>
  isName ? 'tên riêng' : band ? `HSK ${band === ADVANCED ? '7-9' : band}` : 'ngoài HSK';

/**
 * Where a level sorts among words to learn: the lowest band first, as it buys the most of speech; a
 * word the syllabus does not cover, or whose level is not known, after the last band; a name last, as
 * nothing to learn.
 * @param {Level | null} level
 */
export const levelRank = (level) => (level?.isName ? NAME_RANK : level?.band || NO_BAND_RANK);

/**
 * The level of `word` as an episode's spans file it, from the first span of it; null when no span is it.
 * @param {string[]} texts each line's Chinese
 * @param {(number[])[][]} tokens each line's word spans, `[start, length, band, count, isName]` as the .tok.json sidecar has them
 * @param {string} word
 * @returns {Level | null}
 */
export function levelOf(texts, tokens, word) {
  for (const [line, spans] of tokens.entries()) {
    for (const [start, length, band = 0, , isName = 0] of spans ?? []) {
      if (length === word.length && texts[line]?.startsWith(word, start)) return { band, isName: Boolean(isName) };
    }
  }
  return null;
}
