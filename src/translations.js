// @ts-check
// The Vietnamese translation, one entry per spoken sentence, and the summary shown above the
// transcript.
//
// A sentence here is a unit: the sentence, or a run of sentences data/cuts/ joined because the ASR
// broke one thought in two. That is the thing a reader understands or doesn't, so it is what gets
// translated — never a single line, which is cut for mining and often ends mid-clause.
//
// Each translation keeps the Chinese it was written for. A transcript fix or a re-cut can change a
// sentence under it, and a translation of words no longer on the page is worse than none: the reader
// trusts it and learns the wrong thing. So a stale one is dropped from the page and reported, never
// carried over.

/**
 * @typedef {{ s: number, u?: number, text: string, speaker: string, role: string }} Line
 * @typedef {{ unit: number, text: string, speaker: string, role: string }} Sentence
 * @typedef {{ summary?: string[], sentences?: Record<string, { zh: string, vi: string }> }} Ledger
 */

/** Whitespace is how the ASR glued English words in, not something a translation depends on. */
const same = (/** @type {string} */ a, /** @type {string} */ b) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/**
 * The episode's lines regrouped into the sentences a translation is written against.
 * @param {Line[]} lines
 * @returns {Sentence[]}
 */
export function sentencesOf(lines) {
  /** @type {Sentence[]} */
  const sentences = [];
  for (const line of lines) {
    const unit = line.u ?? line.s;
    const last = sentences[sentences.length - 1];
    if (last?.unit === unit) last.text += line.text;
    else sentences.push({ unit, text: line.text, speaker: line.speaker, role: line.role });
  }
  return sentences;
}

/**
 * What the page loads: the summary, and each sentence's translation indexed by unit, or null where
 * there is none that still matches the Chinese.
 * @param {Line[]} lines
 * @param {Ledger} ledger
 */
export function buildSidecar(lines, ledger) {
  const sentences = sentencesOf(lines);
  /** @type {number[]} */
  const missing = [];
  /** @type {number[]} */
  const stale = [];
  /** @type {Record<string, string>} */
  const byUnit = {};
  for (const { unit, text } of sentences) {
    const entry = ledger.sentences?.[unit];
    if (!entry?.vi) missing.push(unit);
    else if (!same(entry.zh, text)) stale.push(unit);
    else byUnit[unit] = entry.vi;
  }
  const units = new Set(sentences.map((sentence) => String(sentence.unit)));
  const orphaned = Object.keys(ledger.sentences ?? {}).filter((unit) => !units.has(unit)).map(Number);
  return { sidecar: { summary: ledger.summary ?? [], vi: byUnit }, missing, stale, orphaned };
}
