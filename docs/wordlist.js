// @ts-check
// A chapter's tapped words in a dialog, to read through before hearing it again: the ones tapped on
// the most days first, each with its reading, Hán Việt and meaning as the player's word card gives
// them, the line it was tapped in, and its stroke order a tap away. Opened from Nghe lại and from the
// player's chapter headings, each page carrying the dialog's markup (#words-dialog) and its audio
// (#audio). Reading the list is not a tap: only a word tapped in the player says it was not caught.
//
// ▶ Nghe plays the lines one after another and round again (wordplay.js), the word playing lit and
// kept in view; a tap on a word plays on from its line. A line's ↻ loops it, to hear it again while its
// word is read; ↻ again plays on.

import { strokeToggle } from './strokes.js';
import { STUBBORN_DAYS, byStubbornness } from './taps.js';
import { lineOf, nextWithLine } from './wordplay.js';

/** @typedef {import('./taps.js').TappedWord} TappedWord */
/** @typedef {import('./wordplay.js').Line} Line */
/** @typedef {{ ep: string, episode: string, n: number, zh: string }} Chapter  As a studied chapter carries it. */
/** @typedef {{ audio: { m4a?: string, mp3?: string }, cues: Line[] }} Episode  As its file has it, what the lines need. */

/** Between two lines played in a row, so one sentence is not heard running into the next. */
const GAP_MS = 700;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const dialog = /** @type {HTMLDialogElement} */ ($('words-dialog'));
const playButton = /** @type {HTMLButtonElement} */ ($('words-play'));
/** The page's, paused while a line plays and read for the speed it is set to. */
const pageAudio = /** @type {HTMLAudioElement} */ ($('audio'));
/** The lines play on an audio element of their own: the page keeps its place in what it plays. */
const lineAudio = new Audio();
lineAudio.preload = 'none';
/** The chapter the dialog shows, so files arriving after another was opened are dropped. */
/** @type {Chapter | null} */
let open = null;
/** The open list, once its files are in: each word's item and line, and the audio the lines are in. */
/** @type {{ items: HTMLElement[], lines: (Line | null)[], src: string } | null} */
let shown = null;
/** The word whose line is playing, and whether it loops rather than plays on. */
/** @type {{ k: number, loop: boolean } | null} */
let playing = null;
let gap = 0;

/** Each episode's word glosses, the same the player's word card reads, and each episode's file. */
/** @type {Map<string, Promise<any>>} */
const fetched = new Map();

function fetchOnce(/** @type {string} */ url, /** @type {any} */ fallback) {
  if (!fetched.has(url)) fetched.set(url, fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback));
  return fetched.get(url);
}

const glossOf = (/** @type {string} */ ep) =>
  /** @type {Promise<Record<string, string[]>>} */ (fetchOnce(`data/${encodeURIComponent(ep)}.gloss.json`, {}));
const episodeOf = (/** @type {string} */ ep) =>
  /** @type {Promise<Episode | null>} */ (fetchOnce(`data/${encodeURIComponent(ep)}.json`, null));

/** Opens the dialog on `tapped`, the words tapped in `chapter`. */
export async function showWords(/** @type {Chapter} */ chapter, /** @type {TappedWord[]} */ tapped) {
  stop();
  const words = byStubbornness(tapped);
  open = chapter;
  shown = null;
  playButton.disabled = true;
  $('words-title').textContent = chapter.zh;
  $('words-note').textContent = `${chapter.episode || chapter.ep} · chương ${chapter.n + 1} · ${words.length} từ, từ tra nhiều ngày nhất ở trên`;
  $('words-list').replaceChildren();
  dialog.showModal();
  const [gloss, episode] = await Promise.all([glossOf(chapter.ep), episodeOf(chapter.ep)]);
  if (!dialog.open || open !== chapter) return;
  // The audio the player plays, as it picks it.
  const src = episode?.audio.m4a ?? episode?.audio.mp3 ?? '';
  const lines = words.map(({ word, at }) => (episode && src ? lineOf(episode.cues, word, at) : null));
  const items = words.map(({ word, days }, k) => {
    const [reading, hanviet, meaning] = gloss[word] ?? [];
    const item = document.createElement('li');
    item.className = 'wd-item';
    const head = document.createElement('div');
    head.className = 'wd-head';
    const zh = document.createElement('span');
    zh.className = 'wd-word';
    zh.lang = 'zh-Hans';
    zh.textContent = word;
    const strokes = strokeToggle(word, { remember: false });
    const count = document.createElement('span');
    count.className = days >= STUBBORN_DAYS ? 'wd-days is-stubborn' : 'wd-days';
    count.textContent = `${days} ngày`;
    head.append(zh, ...(strokes ? [strokes.button] : []), count);
    item.append(head);
    const line = (/** @type {string} */ className, /** @type {string} */ text) => {
      const element = document.createElement('div');
      element.className = className;
      element.textContent = text;
      item.append(element);
    };
    if (reading || hanviet) line('wd-reading', [reading, hanviet?.toUpperCase()].filter(Boolean).join('   ·   '));
    line(meaning ? 'wd-meaning' : 'wd-meaning is-empty', meaning || 'chưa có nghĩa');
    const said = lines[k];
    if (said) item.append(sentence(said, word));
    if (strokes) item.append(strokes.panel);
    return item;
  });
  $('words-list').replaceChildren(...items);
  shown = { items, lines, src };
  playButton.disabled = nextWithLine(lines, -1) < 0;
}

/** The line a word was tapped in, the word picked out, with its ↻. */
function sentence(/** @type {Line} */ line, /** @type {string} */ word) {
  const row = document.createElement('div');
  row.className = 'wd-line';
  const text = document.createElement('span');
  text.className = 'wd-zh';
  text.lang = 'zh-Hans';
  const at = line.text.indexOf(word);
  const marked = document.createElement('b');
  marked.textContent = word;
  text.append(line.text.slice(0, at), marked, line.text.slice(at + word.length));
  const loop = document.createElement('button');
  loop.className = 'wd-loop';
  loop.type = 'button';
  loop.textContent = '↻';
  loop.title = 'Lặp câu này';
  loop.setAttribute('aria-pressed', 'false');
  row.append(text, loop);
  return row;
}

// ---------- playing the lines ----------

/** Lights the word playing, keeping it in view, and presses the buttons that say what plays. */
function showPlaying() {
  playButton.setAttribute('aria-pressed', String(Boolean(playing)));
  playButton.textContent = playing ? '■ Dừng' : '▶ Nghe';
  shown?.items.forEach((item, k) => {
    const lit = playing?.k === k;
    if (lit && !item.classList.contains('is-playing')) item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.classList.toggle('is-playing', lit);
    item.querySelector('.wd-loop')?.setAttribute('aria-pressed', String(lit && Boolean(playing?.loop)));
  });
}

function stop() {
  clearTimeout(gap);
  lineAudio.pause();
  if (!playing) return;
  playing = null;
  showPlaying();
}

/** Plays the `k`th word's line, looping it or playing on from it. */
function play(/** @type {number} */ k, /** @type {boolean} */ loop) {
  if (!shown?.lines[k]) return;
  clearTimeout(gap);
  playing = { k, loop };
  showPlaying();
  playLine();
}

function playLine() {
  const line = playing && shown?.lines[playing.k];
  if (!shown || !line) return;
  pageAudio.pause();
  // Set before the file has loaded, the time is where it starts: no jump from 0:00 to the line.
  if (lineAudio.getAttribute('src') !== shown.src) lineAudio.src = shown.src;
  lineAudio.currentTime = line.start;
  lineAudio.defaultPlaybackRate = lineAudio.playbackRate = pageAudio.playbackRate;
  lineAudio.play().catch(stop);
}

lineAudio.addEventListener('timeupdate', () => {
  // Pausing fires a timeupdate of its own, still at the end of the line just heard: only a line still
  // playing can end. Loop or play on is decided once the gap is over, so a ↻ pressed in it counts.
  const line = playing && shown?.lines[playing.k];
  if (!shown || !line || lineAudio.paused || lineAudio.currentTime < line.end) return;
  lineAudio.pause();
  gap = window.setTimeout(() => {
    if (!playing || !shown) return;
    if (!playing.loop) {
      playing.k = nextWithLine(shown.lines, playing.k);
      showPlaying();
    }
    playLine();
  }, GAP_MS);
});

playButton.addEventListener('click', () => (playing ? stop() : play(nextWithLine(shown?.lines ?? [], -1), false)));
$('words-list').addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const item = /** @type {HTMLElement | null} */ (target.closest('.wd-item'));
  if (!item || !shown) return;
  const k = shown.items.indexOf(item);
  // ↻ loops the line, or lets the one looping play on; it never restarts the line already playing.
  if (target.closest('.wd-loop')) {
    if (playing?.k === k) {
      playing.loop = !playing.loop;
      showPlaying();
    } else play(k, true);
    return;
  }
  // A tap on a word plays on from its line; one on its stroke order, or in it, is the stroke order's.
  if (!target.closest('button, .g-strokes')) play(k, false);
});
// The page's audio played by hand gives the lines way.
pageAudio.addEventListener('play', stop);
dialog.addEventListener('close', stop);
$('words-close').addEventListener('click', () => dialog.close());
// A tap on the backdrop, outside the dialog's box, closes it too.
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
