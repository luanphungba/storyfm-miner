// @ts-check
// Turns the ASR's flat word list into cues — one sentence each, with the exact start and end of the
// words that make it up.
//
// A cue is not just a display unit: whatever lands here is the sentence that ends up on the Anki
// card and the span the loop button replays. One cue per spoken sentence, which is why the only
// guard here is MAX_CHARS — a run of speech the ASR never punctuated would otherwise become a
// single unusable 90-second cue. Short cues are left alone: "你呢？" is a whole sentence, and the
// extension already hands the model the neighbouring cues as context when a card is made.
//
// No LLM is involved. The ASR already punctuates, and having a model rewrite the text would put
// every timestamp at risk for a cosmetic gain.

/**
 * @typedef {object} Word
 * @property {string} text
 * @property {number} start  Milliseconds.
 * @property {number} end    Milliseconds.
 * @property {string} [speaker]
 */

/**
 * @typedef {object} Cue
 * @property {number} i
 * @property {number} start  Seconds.
 * @property {number} end    Seconds.
 * @property {string} text
 * @property {string} speaker
 */

const SENTENCE_END = /[。！？!?]/;
const SOFT_BREAK = /[，、；：,;:]/;

/** Anything in these ranges sits flush against its neighbour; only Latin runs need a space. */
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

/** Past this the cue stops being a sentence a learner can hold in their head, or fit on a card. */
const MAX_CHARS = 42;

const countChars = (/** @type {Word[]} */ words) =>
  words.reduce((total, word) => total + word.text.length, 0);

/** Latin runs keep their spaces ("996 一年后" stays readable); CJK never takes one. */
const glue = (/** @type {string} */ left, /** @type {string} */ right) =>
  CJK.test(left.slice(-1)) || CJK.test(right.slice(0, 1)) ? left + right : `${left} ${right}`;

const joinWords = (/** @type {Word[]} */ words) =>
  words.reduce((text, word, index) => (index === 0 ? word.text : glue(text, word.text)), '');

const round = (/** @type {number} */ ms) => Math.round(ms / 10) / 100;

/** Past this, a word's own (end - start) is almost certainly trailing music or silence the ASR
 * folded into its last word rather than the word itself — real speech never runs this long per
 * word (99% of words across a checked episode ran under 900ms; the rest were forced-alignment
 * artifacts up to 7-8s). Clamping keeps the loop button and Anki cards from replaying that tail. */
const MAX_WORD_MS = 1_200;

/**
 * @param {Word[]} words
 * @returns {Omit<Cue, 'i'>}
 */
function toCue(words) {
  const last = words[words.length - 1];
  const end = last.end - last.start > MAX_WORD_MS ? last.start + MAX_WORD_MS : last.end;
  return {
    start: round(words[0].start),
    end: round(end),
    text: joinWords(words),
    speaker: words[0].speaker ?? 'A',
  };
}

/** Index just past the last comma-ish word, so an over-long run breaks where a listener pauses. */
function lastSoftBreak(/** @type {Word[]} */ words) {
  for (let i = words.length - 2; i > 0; i -= 1) {
    if (SOFT_BREAK.test(words[i].text)) return i + 1;
  }
  return 0;
}

/**
 * @param {Word[]} words  In order, as the ASR returned them.
 * @returns {Cue[]}
 */
export function toCues(words) {
  /** @type {Omit<Cue, 'i'>[]} */
  const cues = [];
  /** @type {Word[]} */
  let buffer = [];

  const flush = () => {
    if (buffer.length) cues.push(toCue(buffer));
    buffer = [];
  };

  for (const [index, word] of words.entries()) {
    buffer.push(word);

    // A cue must never span two speakers: it becomes one sentence on one card.
    const speakerChanges = words[index + 1] && words[index + 1].speaker !== word.speaker;
    if (SENTENCE_END.test(word.text) || speakerChanges) {
      flush();
      continue;
    }

    if (countChars(buffer) >= MAX_CHARS) {
      const cut = lastSoftBreak(buffer);
      const carry = cut > 0 ? buffer.slice(cut) : [];
      if (cut > 0) buffer = buffer.slice(0, cut);
      flush();
      buffer = carry;
    }
  }
  flush();

  return cues.map((cue, i) => ({ i, ...cue }));
}

/**
 * Share of cues that end on real sentence punctuation. The whole approach rests on the ASR
 * punctuating Chinese well; if this comes back low, the cues are hard-split guesses and the episode
 * needs a look before it is trusted.
 * @param {Cue[]} cues
 */
export function punctuationRate(cues) {
  if (!cues.length) return 0;
  const ended = cues.filter((cue) => SENTENCE_END.test(cue.text.slice(-1))).length;
  return ended / cues.length;
}
