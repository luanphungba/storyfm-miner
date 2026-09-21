// @ts-check
// 故事FM runs two registers in one episode, and they are not equally useful to a learner.
//
// 爱哲 narrates from a script — the feed credits a 文案整理, a script editor — so his lines are 书面语:
// dense, written vocabulary. The 讲述者 speaks off the cuff: colloquial, repetitive, much easier to
// follow. Labelling them lets the page filter down to the half worth listening to.
//
// The show's shape does the work. The narrator always opens the episode, so whoever holds the most
// speaking time in the first few minutes is him.

/** @typedef {import('./segment.js').Cue} Cue */
/** @typedef {Cue & { role: 'narrator' | 'storyteller' }} RoledCue */

const NARRATOR_WINDOW_SEC = 180;

/**
 * Seconds spoken per speaker inside the opening window.
 * @param {Cue[]} cues
 * @returns {Map<string, number>}
 */
function openingTimeBySpeaker(cues) {
  const totals = new Map();

  for (const cue of cues) {
    if (cue.start >= NARRATOR_WINDOW_SEC) break;
    const counted = Math.min(cue.end, NARRATOR_WINDOW_SEC) - cue.start;
    totals.set(cue.speaker, (totals.get(cue.speaker) ?? 0) + counted);
  }
  return totals;
}

/**
 * @param {Cue[]} cues
 * @param {string} [forcedNarrator]  Overrides the guess, for episodes that open differently.
 * @returns {RoledCue[]}
 */
export function assignRoles(cues, forcedNarrator) {
  const speakers = new Set(cues.map((cue) => cue.speaker));

  // One speaker means diarization found nothing to split. Calling all of it narrator would hide the
  // whole episode behind the page's filter, so it is all storyteller instead — the filter then shows
  // everything rather than nothing.
  if (!forcedNarrator && speakers.size < 2) {
    return cues.map((cue) => ({ ...cue, role: /** @type {const} */ ('storyteller') }));
  }

  const narrator = forcedNarrator ?? dominantSpeaker(openingTimeBySpeaker(cues));
  return cues.map((cue) => ({
    ...cue,
    role: cue.speaker === narrator ? /** @type {const} */ ('narrator') : /** @type {const} */ ('storyteller'),
  }));
}

/** Ties go to whoever spoke first, so the result never depends on Map iteration luck. */
function dominantSpeaker(/** @type {Map<string, number>} */ totals) {
  let best = '';
  let bestSeconds = -1;

  for (const [speaker, seconds] of totals) {
    if (seconds > bestSeconds) {
      best = speaker;
      bestSeconds = seconds;
    }
  }
  return best;
}
