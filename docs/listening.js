// @ts-check
// How listening is measured: how a second heard is told from a jump, and which day it counts for.
// Pure, so test/listening.test.js covers it; meter.js does the measuring on a page, and progress.js
// adds up what the server keeps.
//
// The count is the time spent listening, not the length of audio heard: an hour at 0.75x is an hour.

/** @typedef {'player' | 'listen'} Page  Counted apart: active study in the player, passive "Nghe lại". */

/** A playhead report can trail the clock a little; this much past what the clock allows still counts. */
const CLOCK_SLACK_S = 0.5;
const SEEK_GAP_S = 1;
const DAY_TURNS_AT_HOUR = 4;

/**
 * Seconds of audio played between two readings of the playhead: how far it moved forward, but never
 * further than the clock allows at this speed, so a jump nobody saw cannot count for more than the
 * time that passed. A playhead that went back, as a loop starting over does, counts nothing.
 * @param {{ position: number, time: number }} from  where the playhead was (s), and when (ms)
 * @param {{ position: number, time: number }} to
 * @param {number} rate
 */
export function played(from, to, rate) {
  const moved = to.position - from.position;
  const allowed = ((to.time - from.time) / 1000) * rate + CLOCK_SLACK_S;
  return Math.max(0, Math.min(moved, allowed));
}

/**
 * Seconds of audio played from a reading until a seek: the playhead has already moved, a loop's
 * start over runs before anything else sees it reach the end, so the clock says what played instead.
 * Capped, because a reading comes at least four times a second while audio plays, and a longer
 * silence means it was not playing.
 * @param {{ position: number, time: number }} from
 * @param {number} time  when the seek was seen (ms)
 * @param {number} rate
 */
export function playedBeforeSeek(from, time, rate) {
  return Math.min(Math.max(0, (time - from.time) / 1000), SEEK_GAP_S) * rate;
}

/** The day a moment counts for, as YYYY-MM-DD: the local date turning at 4:00, as Anki's day and
 * server/miner.py's study_day do, so listening past midnight counts for the evening it began in. */
export function studyDay(/** @type {Date} */ date) {
  const shifted = new Date(date.getTime() - DAY_TURNS_AT_HOUR * 3_600_000);
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${two(shifted.getMonth() + 1)}-${two(shifted.getDate())}`;
}
