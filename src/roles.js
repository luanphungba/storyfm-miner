// @ts-check
// 故事FM runs two registers in one episode, and they are not equally useful to a learner.
//
// 爱哲 narrates from a script — the feed credits a 文案整理, a script editor — so his lines are 书面语:
// dense, written vocabulary. The 讲述者 speaks off the cuff: colloquial, repetitive, much easier to
// follow. Labelling them lets the page filter down to the half worth listening to.
//
// The show's shape does the work: every episode opens on 爱哲 framing the story before the guest
// starts talking, so the narrator is simply whoever speaks first.
//
// An earlier version took whoever dominated the first three minutes, which got E077 exactly
// backwards — the host's intro runs 50 seconds and the guest then holds the rest of the window,
// so the guest "won" it. Total speaking time is no better a signal: the host is usually the
// minority voice, but not in the interview-heavy episodes. Who opens is the one thing the format
// guarantees, and `narrator` overrides it when an episode cold-opens on a clip.

/** @typedef {import('./segment.js').Cue} Cue */
/** @typedef {Cue & { role: 'narrator' | 'storyteller' }} RoledCue */

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

  const narrator = forcedNarrator ?? cues[0].speaker;
  return cues.map((cue) => ({
    ...cue,
    role: cue.speaker === narrator ? /** @type {const} */ ('narrator') : /** @type {const} */ ('storyteller'),
  }));
}

/**
 * Seconds of speech per speaker, so a caller can show who was picked and how much each one talks.
 * A narrator holding most of the episode usually means the guess went the wrong way.
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
