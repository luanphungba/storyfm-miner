// @ts-check
// Counts the listening on a page's audio element, by day and chapter, and reports it to the server,
// which keeps the hours. It only listens to the element and never touches it, so playback is exactly
// as before.
//
// Each page load counts on its own, under a session id of its own, and keeps its running totals in
// this browser until the server has them: closing the tab, losing the network or not being connected
// yet loses nothing, as the next report from any page here sends them. The server only ever raises a
// row to the total sent, so a count sent twice is counted once, and two devices add up.

import { played, playedBeforeSeek, studyDay } from './listening.js';
import { goalLine, progress, todayLine } from './progress.js';
import { call, savedConnection } from './server.js';

/** @typedef {import('./listening.js').Page} Page */
/** @typedef {import('./progress.js').Days} Days */
/** @typedef {{ ep: string, start: number | null }} Place  The episode playing, and the chapter the playhead is in. */
/** @typedef {{ session: string, day: string, page: Page, ep: string, start: number | null, seconds: number, audio: number }} Entry
 *   One page load's count for one day and chapter (start null between chapters): the seconds spent
 *   listening, and the seconds of audio heard. */

const UNSENT_KEY = 'ci-listening-unsent';
const REPORT_EVERY_MS = 60_000;

/** @returns {Record<string, Entry>} */
function readUnsent() {
  try {
    return JSON.parse(localStorage.getItem(UNSENT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeUnsent(/** @type {Record<string, Entry>} */ unsent) {
  try {
    localStorage.setItem(UNSENT_KEY, JSON.stringify(unsent));
  } catch {
    // Storage blocked: the count lasts as long as the page does.
  }
}

/** Sends what this browser heard that the server does not have yet, and returns the hours per day. */
export async function report(/** @type {import('./server.js').Connection} */ connection) {
  const sent = readUnsent();
  /** @type {{ days: Days }} */
  const { days } = await call(connection, '/listening', { entries: Object.values(sent) });
  // Dropped only as it was sent: an entry that grew while the request was out goes with the next one.
  const unsent = readUnsent();
  for (const [key, entry] of Object.entries(sent)) {
    if (unsent[key]?.seconds === entry.seconds && unsent[key]?.audio === entry.audio) delete unsent[key];
  }
  writeUnsent(unsent);
  return days;
}

/** Shows today's listening, the number looked for, then the goal's, in `element`. */
export function showHours(/** @type {HTMLElement} */ element, /** @type {Days} */ days) {
  const p = progress(days, studyDay(new Date()));
  const today = document.createElement('strong');
  today.textContent = todayLine(p);
  element.replaceChildren(today, document.createElement('br'), goalLine(p));
  element.hidden = false;
}

/**
 * Counts what `audio` plays, and reports it once on load (with whatever an earlier page left
 * unsent), every minute while there is something new, and when the page is hidden.
 * @param {HTMLAudioElement} audio
 * @param {Page} page
 * @param {{ where: (position: number) => Place, onReport?: (days: Days) => void }} options
 *   `where` places a playhead position; `onReport` is given the hours whenever the server sends them.
 */
export function meterListening(audio, page, { where, onReport }) {
  const session = crypto.randomUUID();
  /** This page's count, per day and chapter. */
  /** @type {Map<string, Entry>} */
  const counts = new Map();
  /** The counts grown since they were last kept. */
  const changed = new Set();
  /** Where the playhead was at the last reading, while it plays. */
  /** @type {{ position: number, time: number } | null} */
  let mark = null;

  /** Counts from the last reading to this one, for the chapter it started in, then marks here if the
   * audio plays on. Every pass of a loop counts; the jump back to its start does not: while it seeks
   * there is no mark, and the first reading after it lands sets one. */
  function read() {
    const now = { position: audio.currentTime, time: Date.now() };
    const rate = audio.playbackRate;
    let heard = 0;
    if (mark && !audio.muted && audio.volume > 0) {
      heard = audio.seeking ? playedBeforeSeek(mark, now.time, rate) : played(mark, now, rate);
    }
    if (mark && heard > 0) {
      const day = studyDay(new Date(now.time));
      const { ep, start } = where(mark.position);
      const key = `${day} ${ep} ${start ?? ''}`;
      const count = counts.get(key) ?? { session, day, page, ep, start, seconds: 0, audio: 0 };
      count.audio += heard;
      count.seconds += heard / rate;
      counts.set(key, count);
      changed.add(key);
    }
    mark = audio.paused || audio.seeking ? null : now;
  }
  for (const event of ['playing', 'timeupdate', 'ratechange', 'pause', 'ended', 'seeking', 'seeked', 'emptied']) {
    audio.addEventListener(event, read);
  }

  /** Puts the counts that grew with the unsent ones, where closing the page cannot lose them. */
  function keep() {
    if (!changed.size) return;
    const unsent = readUnsent();
    for (const key of changed) unsent[`${session} ${key}`] = { .../** @type {Entry} */ (counts.get(key)) };
    changed.clear();
    writeUnsent(unsent);
  }

  async function send(always = false) {
    keep();
    const connection = savedConnection();
    if (!connection || (!always && !Object.keys(readUnsent()).length)) return;
    try {
      onReport?.(await report(connection));
    } catch {
      // Still unsent; the next report takes it.
    }
  }

  setInterval(() => send(), REPORT_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) send(); });
  addEventListener('pagehide', keep);
  send(true);
}
