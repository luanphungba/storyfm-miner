// @ts-check
// The HSK level the vocabulary reaches, estimated for the stats page. Listening never brings a whole
// band: the podcasts in the app say about half of HSK 4 at all, and a fifth of HSK 7-9. So a word
// heard counts as it stands in the vocabulary (vocab.js: understood, or not), and one not heard yet is
// guessed at: as known at the rate the band's words were understood the first time they were heard,
// before the app could teach them. The rate is taken for the band's common and rare halves apart
// (hsk.json), as the words heard are mostly the common ones, which are known more often.
//
// The rate is what was known before the app, so it holds for any day; the latest first hearings say
// it best. A day before is guessed at today's rate, or a week's change would be the rate's noise from
// fewer hearings rather than the words learned.
//
// A band is reached when LEVEL_SHARE of its words are known, and the level is the highest band
// reached with every band under it. Words of no band (一个, 职场, 播客) are counted beside the bands,
// not toward the level, as they have no size to be a share of; and how much of what is said each band
// is shows what its words are worth to the ear: HSK 1-2 alone are about three words in four.
// hskLevel and speechShares are pure, so test/level.test.js covers them.

import { TAPS_FROM } from './coverage.js';
import { firstHearings, vocabularyWords } from './vocab.js';

/** The share of a band's words known for the band to be reached. */
export const LEVEL_SHARE = 0.8;
/** The first hearings a rate is taken from, at the fewest: with fewer in a half, the band's whole
 * rate is used, and with fewer in the band, no word of it not heard yet counts as known. */
export const MIN_HEARINGS = 20;

/** @typedef {Record<string, { common: string[], rare: string[] }>} Syllabus  hsk.json: each band's words, its common half and its rare half */
/** @typedef {import('./vocab.js').Hearings} Hearings */
/**
 * @typedef {{ band: number, size: number, heard: number, known: number, estimate: number }} BandLevel
 *   heard — the band's words whose state is known: heard, or understood unheard (HSK 1-2, words said
 *   to be known); known — those understood; estimate — known, and the share guessed of the rest
 */
/**
 * @typedef {{ level: number, bands: BandLevel[], outside: { heard: number, known: number } }} Level
 *   level — the highest band reached, 0 for none; outside — the words of no band heard and understood
 */

/**
 * The HSK level on the evening of `day`.
 * @param {{ syllabus: Syllabus, understood: Set<string>, hearings: Hearings, day: string, rateDay?: string }} input
 *   understood — the words understood that evening; hearings — every first hearing, of which those
 *   after `day` are left out, and those after `rateDay` (`day` unless given) left out of the rates
 * @returns {Level}
 */
export function hskLevel({ syllabus, understood, hearings, day, rateDay = day }) {
  const heardBy = (/** @type {string} */ word, /** @type {string} */ by) => {
    const hearing = hearings.get(word);
    return hearing && hearing.day <= by ? hearing : null;
  };
  /** Of a list of words, those first heard with taps logged, and how many of them untapped. */
  const firstTimes = (/** @type {string[]} */ words) => {
    const sample = words.map((w) => heardBy(w, rateDay)).filter((h) => h && h.day >= TAPS_FROM);
    return { heard: sample.length, understood: sample.filter((h) => !h?.tapped).length };
  };
  const rate = (/** @type {{ heard: number, understood: number }} */ s) => s.understood / s.heard;

  const bands = Object.entries(syllabus).map(([band, { common, rare }]) => {
    const whole = firstTimes([...common, ...rare]);
    let heard = 0;
    let known = 0;
    let estimate = 0;
    for (const words of [common, rare]) {
      const half = firstTimes(words);
      const guess = half.heard >= MIN_HEARINGS ? rate(half) : whole.heard >= MIN_HEARINGS ? rate(whole) : 0;
      const halfHeard = words.filter((w) => understood.has(w) || heardBy(w, day)).length;
      const halfKnown = words.filter((w) => understood.has(w)).length;
      heard += halfHeard;
      known += halfKnown;
      estimate += halfKnown + (words.length - halfHeard) * guess;
    }
    return { band: Number(band), size: common.length + rare.length, heard, known, estimate: Math.round(estimate) };
  }).sort((a, b) => a.band - b.band);

  const short = bands.findIndex((b) => b.estimate < LEVEL_SHARE * b.size);
  const level = short < 0 ? bands.at(-1)?.band ?? 0 : short > 0 ? bands[short - 1].band : 0;
  const listed = bandsOf(syllabus);
  const outside = (/** @type {string[]} */ words) => new Set(words.filter((w) => !listed.has(w))).size;
  const heard = [...hearings.keys()].filter((w) => heardBy(w, day));
  return { level, bands, outside: { heard: outside([...understood, ...heard]), known: outside([...understood]) } };
}

/**
 * The share of the words said that each band's words are, and words of no band: each time a word is
 * said counts, as it does in a chapter's share (coverage.js).
 * @param {Map<string, number>} said  each word said, and the times it was (vocab.js timesSaid)
 * @param {Syllabus} syllabus
 * @returns {{ bands: Map<number, number>, outside: number }}  shares from 0 to 1, all 0 with nothing said
 */
export function speechShares(said, syllabus) {
  const bandOf = bandsOf(syllabus);
  const times = new Map(Object.keys(syllabus).map((band) => [Number(band), 0]));
  let outside = 0;
  let total = 0;
  for (const [word, n] of said) {
    const band = bandOf.get(word);
    if (band === undefined) outside += n;
    else times.set(band, (times.get(band) ?? 0) + n);
    total += n;
  }
  const share = (/** @type {number} */ n) => (total ? n / total : 0);
  return { bands: new Map([...times].map(([band, n]) => [band, share(n)])), outside: share(outside) };
}

/** Each word of the syllabus, and its band. */
const bandsOf = (/** @type {Syllabus} */ syllabus) => new Map(Object.entries(syllabus)
  .flatMap(([band, { common, rare }]) => [...common, ...rare].map((word) => /** @type {[string, number]} */ ([word, Number(band)]))));

/**
 * The HSK level as it stood on the evening of any day, from what the vocabulary is counted from: by
 * the rates as they stood then, or as they stand on `rateDay`.
 * @param {import('./vocab.js').VocabInput} input
 * @param {Syllabus} syllabus
 * @returns {(day: string, rateDay?: string) => Level}
 */
export function levelOn(input, syllabus) {
  const wordsOn = vocabularyWords(input);
  const hearings = firstHearings(input);
  return (day, rateDay) => hskLevel({ syllabus, understood: wordsOn(day).understood, hearings, day, rateDay });
}

/** hsk.json, which only the stats page needs. */
export async function fetchSyllabus() {
  const response = await fetch('data/hsk.json');
  if (!response.ok) throw new Error('hsk.json');
  return /** @type {Promise<Syllabus>} */ (response.json());
}
