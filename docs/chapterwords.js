// @ts-check
// The words a chapter brings in: each word heard in it that no chapter before it had, in the order
// they are heard. An app's interface is studied a page at a time, and a page's new words are what
// that day adds — the rest came with the pages before it.

const HAN = /\p{Script=Han}/u;

/**
 * @param {string[]} texts each line's Chinese
 * @param {(number[])[][]} tokens each line's word spans, `[start, length, …]` as the .tok.json sidecar has them
 * @param {{ from: number, to: number }[]} chapters
 * @returns {{ word: string, line: number, start: number, band: number }[][]} per chapter, its new words, where each
 *   is first heard, and its HSK band (0 when the syllabus does not have it)
 */
export function newWords(texts, tokens, chapters) {
  const seen = new Set();
  return chapters.map(({ from, to }) => {
    /** @type {{ word: string, line: number, start: number, band: number }[]} */
    const found = [];
    for (let line = from; line <= to; line += 1) {
      for (const [start, length, band = 0] of tokens[line] ?? []) {
        const word = texts[line]?.slice(start, start + length) ?? '';
        if (!HAN.test(word) || seen.has(word)) continue;
        seen.add(word);
        found.push({ word, line, start, band });
      }
    }
    return found;
  });
}
