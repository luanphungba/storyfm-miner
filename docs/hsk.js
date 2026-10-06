// @ts-check
// A word's HSK level as the reader is shown it, from the band tools/build_tokens.py files on each of
// its spans. The level says how much of spoken Chinese a word buys: band 1 words are 50% of everything
// said, band 7-9 words are the long tail. A word on no list is not a failure to know it — 播客 and
// 面试官 are ordinary speech that the syllabus simply does not cover — so it says so plainly.

/** The band the syllabus files 7, 8 and 9 under together. */
const ADVANCED = 7;

/** What a word's level is called: its HSK band, a name, or a word the syllabus does not cover. */
export const levelLabel = (/** @type {number} */ band, /** @type {boolean} */ isName) =>
  isName ? 'tên riêng' : band ? `HSK ${band === ADVANCED ? '7-9' : band}` : 'ngoài HSK';

/**
 * The level of `word` as an episode's spans file it, from the first span of it; null when no span is it.
 * @param {string[]} texts each line's Chinese
 * @param {(number[])[][]} tokens each line's word spans, `[start, length, band, count, isName]` as the .tok.json sidecar has them
 * @param {string} word
 */
export function levelOf(texts, tokens, word) {
  for (const [line, spans] of tokens.entries()) {
    for (const [start, length, band = 0, , isName = 0] of spans ?? []) {
      if (length === word.length && texts[line]?.startsWith(word, start)) return levelLabel(band, Boolean(isName));
    }
  }
  return null;
}
