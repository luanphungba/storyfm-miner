// @ts-check
// Readings the word card gets wrong in context, fixed by phrase.
//
// tools/build_gloss.mjs reads each sentence with pinyin-pro, then takes CC-CEDICT's tones for a word
// the dictionary lists only one way. Both are right almost always, and both fail the same way: a
// polyphone read in the wrong sense. pinyin-pro read 我们行里 (at the bank) as xíng lǐ and 没有当成记者
// as dàng chéng; CC-CEDICT lists 种种 only as zhǒng zhǒng "all kinds of", so 种种花 (planting flowers,
// zhòng zhòng) took that. tools/readings.json holds, per episode, the phrase as it stands there and
// how it is said there.
//
// Those readings are typed by hand, and a hand-typed field is how 189 Anki cards once got a wrong
// HSK level. So every syllable must be one CC-CEDICT lists for its character, and a mistyped tone
// fails the build instead of reaching a card. What the check cannot catch is picking the wrong one of
// two listed readings; that is the judgement each entry records, with its reason.

const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ' };

/** "zhǎng" → "zhang3", "le" → "le5", "lǜ" → "lv4": the form CC-CEDICT writes, with ü as v. */
export function toNumbered(/** @type {string} */ syllable) {
  let tone = 5;
  let letters = '';
  for (const character of syllable.toLowerCase().replace(/ü/g, 'v')) {
    const base = Object.keys(MARKS).find((b) => MARKS[/** @type {keyof MARKS} */ (b)].includes(character));
    if (base) {
      tone = MARKS[/** @type {keyof MARKS} */ (base)].indexOf(character) + 1;
      letters += base;
    } else {
      letters += character;
    }
  }
  return letters + tone;
}

/** 一 and 不 change tone with what follows (yí ge, bú shì), which the citation form never shows. */
const SANDHI = new Set(['一', '不']);

/**
 * Why a hand-written reading cannot ship, or [] when it can.
 * @param {string} phrase
 * @param {string} reading  Tone marks, one syllable per character: "zhǎng cháng le".
 * @param {(character: string) => string[]} listed  CC-CEDICT's readings of one character, numbered.
 * @returns {string[]}
 */
export function checkReading(phrase, reading, listed) {
  const characters = [...phrase];
  const syllables = reading.trim().split(/\s+/);
  if (syllables.length !== characters.length) {
    return [`"${phrase}": ${characters.length} chữ nhưng ${syllables.length} âm "${reading}"`];
  }
  const problems = [];
  characters.forEach((character, i) => {
    const ours = toNumbered(syllables[i]);
    const letters = ours.slice(0, -1);
    const options = listed(character).map((r) => r.toLowerCase().replace(/u:/g, 'v'));
    // The neutral tone belongs to the word, not the character, so a character is never listed with
    // it; the syllable itself must still be one the character has.
    const fits = ours.endsWith('5') || SANDHI.has(character)
      ? options.some((r) => r.slice(0, -1) === letters)
      : options.includes(ours);
    if (!fits) {
      problems.push(`"${phrase}": ${character} đọc "${syllables[i]}" không có trong CC-CEDICT (${options.join(', ') || 'không có mục nào'})`);
    }
  });
  return problems;
}

/**
 * Writes each phrase's reading over the contextual one wherever the phrase occurs in `text`.
 * @param {string} text  One unit, read whole.
 * @param {string[]} readings  One reading per character of `text`, changed in place.
 * @param {Record<string, [string, string]>} entries  phrase → [reading, reason]
 * @returns {{ fixed: boolean[], used: Set<string> }}  Which characters now carry a hand reading, and
 *   which phrases were found.
 */
export function applyReadings(text, readings, entries) {
  const fixed = new Array(text.length).fill(false);
  const used = new Set();
  for (const [phrase, [reading]] of Object.entries(entries)) {
    const syllables = reading.trim().split(/\s+/);
    for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
      syllables.forEach((syllable, i) => {
        readings[at + i] = syllable;
        fixed[at + i] = true;
      });
      used.add(phrase);
    }
  }
  return { fixed, used };
}

/**
 * Every word inside a phrase, with the reading the phrase gives it, so a check that holds a word's
 * reading against the dictionary can tell a deliberate reading from a wrong one.
 * @param {Record<string, [string, string]>} entries
 * @returns {Map<string, string>}  word → reading
 */
export function readingsWithin(entries) {
  const within = new Map();
  for (const [phrase, [reading]] of Object.entries(entries)) {
    const characters = [...phrase];
    const syllables = reading.trim().split(/\s+/);
    for (let from = 0; from < characters.length; from += 1) {
      for (let to = from + 1; to <= characters.length; to += 1) {
        within.set(characters.slice(from, to).join(''), syllables.slice(from, to).join(' '));
      }
    }
  }
  return within;
}
