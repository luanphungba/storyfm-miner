// @ts-check
// The Vietnamese translation, one entry per line on the page, and the summary shown above the
// transcript.
//
// The Chinese a translation is checked against is the unit: the sentence, or a run of sentences
// data/cuts/ joined because the ASR broke one thought in two. That is what the translator reads, so a
// line is translated knowing the whole thought. But what gets written is one translation per line,
// because a translation is read right after hearing a line — a paragraph under the last line of a
// thirteen-line sentence is not read at all. Two lines share one only where Vietnamese word order
// can't be split between them; never more than two.
//
// Each translation keeps the Chinese it was written for. A transcript fix or a re-cut can change a
// sentence under it, and a translation of words no longer on the page is worse than none: the reader
// trusts it and learns the wrong thing. So a stale one is dropped from the page and reported, never
// carried over.

/**
 * @typedef {{ s: number, u?: number, text: string, speaker: string, role: string }} Line
 * @typedef {{ unit: number, text: string, speaker: string, role: string, lines: number[] }} Sentence
 * @typedef {{ zh: string, vi: string }} Part
 * @typedef {{ zh: string, vi?: string, parts?: Part[] }} Entry
 *   `parts` tile `zh` in order, one per line or pair of lines. A bare `vi` is the whole unit at once,
 *   fine for a one-line unit and what every unit was before lines were translated one by one.
 * @typedef {{ summary?: string[], sentences?: Record<string, Entry> }} Ledger
 */

/** A part may cover at most this many lines. */
export const MAX_LINES = 2;

/** Whitespace is how the ASR glued English words in, not something a translation depends on. */
const bare = (/** @type {string} */ text) => text.replace(/\s+/g, '');
const same = (/** @type {string} */ a, /** @type {string} */ b) => bare(a) === bare(b);

/**
 * The episode's lines regrouped into the sentences a translation is written against, each with the
 * indexes of its lines.
 * @param {Line[]} lines
 * @returns {Sentence[]}
 */
export function sentencesOf(lines) {
  /** @type {Sentence[]} */
  const sentences = [];
  for (const [index, line] of lines.entries()) {
    const unit = line.u ?? line.s;
    const last = sentences[sentences.length - 1];
    if (last?.unit === unit) {
      last.text += line.text;
      last.lines.push(index);
    } else {
      sentences.push({ unit, text: line.text, speaker: line.speaker, role: line.role, lines: [index] });
    }
  }
  return sentences;
}

/**
 * Where each part of an entry sits: under the line its last character is on. `aligned` is false when
 * a part ends mid-line — a re-cut moved the lines under it — and `widest` is the most lines one part
 * covers.
 * @param {Line[]} lines
 * @param {Sentence} sentence
 * @param {Part[]} parts
 */
function place(lines, sentence, parts) {
  /** @type {{ index: number, vi: string }[]} */
  const placed = [];
  let aligned = true;
  let widest = 0;
  let end = 0;
  let from = 0;
  for (const part of parts) {
    end += bare(part.zh).length;
    let reach = 0;
    let k = 0;
    for (; k < sentence.lines.length; k += 1) {
      reach += bare(lines[sentence.lines[k]].text).length;
      if (reach >= end) break;
    }
    k = Math.min(k, sentence.lines.length - 1);
    if (reach !== end) aligned = false;
    widest = Math.max(widest, k - from + 1);
    from = reach === end ? k + 1 : k;
    placed.push({ index: sentence.lines[k], vi: part.vi });
  }
  return { placed, aligned, widest };
}

/**
 * What the page loads: the summary, and each line's translation indexed by the line, where it has
 * one that still matches the Chinese. `unsplit` names the units of several lines still translated as
 * a whole, `misaligned` those whose parts a re-cut moved off the line ends — both still shown, but
 * to be translated again line by line.
 * @param {Line[]} lines
 * @param {Ledger} ledger
 */
export function buildSidecar(lines, ledger) {
  const sentences = sentencesOf(lines);
  /** @type {number[]} */
  const missing = [];
  /** @type {number[]} */
  const stale = [];
  /** @type {number[]} */
  const unsplit = [];
  /** @type {number[]} */
  const misaligned = [];
  /** @type {Record<string, string>} */
  const byLine = {};
  for (const sentence of sentences) {
    const entry = ledger.sentences?.[sentence.unit];
    if (!entry?.vi && !entry?.parts?.length) missing.push(sentence.unit);
    else if (!same(entry.zh, sentence.text)) stale.push(sentence.unit);
    else if (entry.parts && !same(entry.parts.map((part) => part.zh).join(''), entry.zh)) stale.push(sentence.unit);
    else {
      const parts = entry.parts ?? [{ zh: entry.zh, vi: /** @type {string} */ (entry.vi) }];
      const { placed, aligned, widest } = place(lines, sentence, parts);
      if (!entry.parts && sentence.lines.length > 1) unsplit.push(sentence.unit);
      else if (!aligned || widest > MAX_LINES) misaligned.push(sentence.unit);
      for (const { index, vi } of placed) byLine[index] = byLine[index] ? `${byLine[index]} ${vi}` : vi;
    }
  }
  const units = new Set(sentences.map((sentence) => String(sentence.unit)));
  const orphaned = Object.keys(ledger.sentences ?? {}).filter((unit) => !units.has(unit)).map(Number);
  return { sidecar: { summary: ledger.summary ?? [], lines: byLine }, missing, stale, unsplit, misaligned, orphaned };
}
