// @ts-check
// 故事FM runs two registers in one episode, and they are not equally useful to a learner.
//
// 爱哲 narrates from a script — the feed credits a 文案整理, a script editor — so his lines are 书面语:
// dense, written vocabulary. The 讲述者 speaks off the cuff: colloquial, repetitive, much easier to
// follow. Labelling them lets the page filter down to the half worth listening to.
//
// The format decides it: one guest tells their life story at length, 爱哲 frames it. So the
// narrator is whoever speaks least. E077: host 1:30 against 10:20. E062: host 0:56 against 10:41.
//
// Two earlier guesses were wrong, both for the same reason — they read the opening instead of the
// shape. "Whoever dominates the first three minutes" lost E077, where the host's intro runs 50
// seconds and the guest owns the rest of the window. "Whoever speaks first" lost E062, which
// cold-opens on the guest saying 我是小黑 before the host says a word.
//
// Nothing depends on getting this right: it drives a filter and a text colour, and `narrator`
// overrides it. The caller warns when the split is close enough that the guess is a coin flip.

/** @typedef {import('./segment.js').Cue} Cue */
/** @typedef {Cue & { role: 'narrator' | 'storyteller' }} RoledCue */

/**
 * @param {Cue[]} cues
 * @param {string} [forcedNarrator]  Overrides the guess, for episodes that open differently.
 * @returns {RoledCue[]}
 */
export function assignRoles(cues, forcedNarrator) {
  const times = speakingTime(cues);

  // One speaker means diarization found nothing to split. Calling all of it narrator would hide the
  // whole episode behind the page's filter, so it is all storyteller instead — the filter then shows
  // everything rather than nothing.
  if (!forcedNarrator && times.size < 2) {
    return cues.map((cue) => ({ ...cue, role: /** @type {const} */ ('storyteller') }));
  }

  const narrator = forcedNarrator ?? quietestSpeaker(times);
  return cues.map((cue) => ({
    ...cue,
    role: cue.speaker === narrator ? /** @type {const} */ ('narrator') : /** @type {const} */ ('storyteller'),
  }));
}

/**
 * Seconds of speech per speaker, in order of first appearance.
 * @param {Cue[]} cues
 * @returns {Map<string, number>}
 */
export function speakingTime(cues) {
  const totals = new Map();
  for (const cue of cues) {
    totals.set(cue.speaker, (totals.get(cue.speaker) ?? 0) + (cue.end - cue.start));
  }
  return totals;
}

/** Ties go to whoever spoke first, so the result never depends on Map iteration luck. */
function quietestSpeaker(/** @type {Map<string, number>} */ times) {
  let quietest = '';
  let fewest = Infinity;

  for (const [speaker, seconds] of times) {
    if (seconds < fewest) {
      quietest = speaker;
      fewest = seconds;
    }
  }
  return quietest;
}

/**
 * Share of speech held by the narrator. The format puts the host well under a third; anything
 * near an even split means the roles are a coin flip and want a human to look.
 * @param {RoledCue[]} cues
 */
export function narratorShare(cues) {
  const total = cues.reduce((sum, cue) => sum + (cue.end - cue.start), 0);
  if (!total) return 0;
  const narrated = cues
    .filter((cue) => cue.role === 'narrator')
    .reduce((sum, cue) => sum + (cue.end - cue.start), 0);
  return narrated / total;
}
