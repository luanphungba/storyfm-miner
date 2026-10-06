// @ts-check
// A chapter's tapped words heard in the lines they were tapped in, one after another and round again,
// to let the hard ones of a chapter sink in; a line not caught loops on its own while its word is read
// (wordlist.js plays them).

/** @typedef {{ start: number, end: number, text: string }} Line  A cue, as the episode file has it. */

/**
 * The line `word` was tapped in: of the lines saying it, the one starting nearest `at`, where the line
 * tapped in started. Nearest rather than at: lines recut since the tap start elsewhere, and the word
 * may have gone to the one before or after.
 * @param {Line[]} lines  the episode's
 * @param {string} word
 * @param {number} at
 * @returns {Line | null}  null when no line says it
 */
export function lineOf(lines, word, at) {
  /** @type {Line | null} */
  let nearest = null;
  for (const line of lines) {
    if (!line.text.includes(word)) continue;
    if (!nearest || Math.abs(line.start - at) < Math.abs(nearest.start - at)) nearest = line;
  }
  return nearest;
}

/**
 * The word after the `k`th that has a line, round to the first after the last; -1 when none has.
 * @param {(Line | null)[]} lines  each word's
 * @param {number} k  -1 for the first word with a line
 */
export function nextWithLine(lines, k) {
  for (let step = 1; step <= lines.length; step += 1) {
    const j = (k + step) % lines.length;
    if (lines[j]) return j;
  }
  return -1;
}
