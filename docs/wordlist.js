// @ts-check
// A chapter's tapped words in a dialog, to read through before hearing it again: the lowest HSK level
// first, as the most of speech it buys (taps.js), each with its level, reading, Hán Việt and meaning as
// the player's word card gives them, the line it was tapped in, and its stroke order a tap away. Opened
// from Nghe lại and from the player's chapter headings, each page carrying the dialog's markup
// (#words-dialog) and its audio (#audio). Reading the list is not a tap: only a word tapped in the
// player says it was not caught.
//
// ▶ Nghe plays the lines one after another and round again (wordplay.js), the word playing lit and
// kept in view; a tap on a word plays on from its line. A line's ↻ loops it, to hear it again while its
// word is read; ↻ again plays on.
//
// Nghĩa, off as the dialog opens, shows every word's reading, meaning and line; off, a word shows only
// itself and its level, so it is recalled rather than recognised from the Vietnamese beside it. A tap on
// a word turns that one over and plays its line once, to check the reading recalled against the speech
// without the next word's line giving that one away; a tap on it once turned plays on as before.
//
// ✓ Thuộc tells the server a word is known: it leaves every chapter's list until it is tapped again,
// that day or later. The dialog then fires `known` with the word, for the page to drop it from its counts.

import { levelLabel, levelOf, levelRank } from './hsk.js';
import { studyDay } from './listening.js';
import { call, savedConnection } from './server.js';
import { strokeToggle } from './strokes.js';
import { STUBBORN_DAYS, forStudy } from './taps.js';
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
const gistButton = /** @type {HTMLButtonElement} */ ($('words-gist'));
const wordsList = $('words-list');
/** The page's, paused while a line plays and read for the speed it is set to. */
const pageAudio = /** @type {HTMLAudioElement} */ ($('audio'));
/** The lines play on an audio element of their own: the page keeps its place in what it plays. */
const lineAudio = new Audio();
lineAudio.preload = 'none';
/** The chapter the dialog shows, so files arriving after another was opened are dropped. */
/** @type {Chapter | null} */
let open = null;
/** The open list, once its files are in: its words in order, each one's item and line (none once it is
 * known), and the audio the lines are in. */
/** @type {{ words: TappedWord[], items: HTMLElement[], lines: (Line | null)[], src: string } | null} */
let shown = null;
/** The word whose line is playing, that line, and what follows it: the line again, the next word's, or nothing. */
/** @type {{ k: number, line: Line, then: 'loop' | 'next' | 'stop' } | null} */
let playing = null;
let gap = 0;

/** Each episode's word glosses and word spans, the same the player's word card reads, and each episode's file. */
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
const tokensOf = (/** @type {string} */ ep) =>
  /** @type {Promise<{ cues: (number[])[][] } | null>} */ (fetchOnce(`data/${encodeURIComponent(ep)}.tok.json`, null));

const note = (/** @type {Chapter} */ chapter, /** @type {number} */ count) =>
  `${chapter.episode || chapter.ep} · chương ${chapter.n + 1} · ${count} từ, HSK thấp ở trên`;

/** Opens the dialog on `tapped`, the words tapped in `chapter`. */
export async function showWords(/** @type {Chapter} */ chapter, /** @type {TappedWord[]} */ tapped) {
  stop();
  open = chapter;
  shown = null;
  showPlaying();
  $('words-title').textContent = chapter.zh;
  $('words-note').textContent = note(chapter, tapped.length);
  wordsList.replaceChildren();
  showGist(false);
  dialog.showModal();
  const [gloss, episode, tok] = await Promise.all([glossOf(chapter.ep), episodeOf(chapter.ep), tokensOf(chapter.ep)]);
  if (!dialog.open || open !== chapter) return;
  const texts = episode?.cues.map((cue) => cue.text) ?? [];
  const levels = new Map(tapped.map(({ word }) => [word, levelOf(texts, tok?.cues ?? [], word)]));
  const words = forStudy(tapped, (word) => levelRank(levels.get(word) ?? null));
  // The audio the player plays, as it picks it.
  const src = episode?.audio.m4a ?? episode?.audio.mp3 ?? '';
  const lines = words.map(({ word, at }) => (episode && src ? lineOf(episode.cues, word, at) : null));
  const items = words.map(({ word, days }, k) => {
    const [reading, hanviet, meaning] = gloss[word] ?? [];
    const item = document.createElement('li');
    item.className = 'wd-item';
    const head = document.createElement('div');
    head.className = 'wd-head';
    const zh = element('span', 'wd-word', word);
    zh.lang = 'zh-Hans';
    head.append(zh);
    const strokes = strokeToggle(word, { remember: false });
    if (strokes) head.append(strokes.button);
    const level = levels.get(word);
    if (level) head.append(element('span', 'wd-level', levelLabel(level.band, level.isName)));
    head.append(element('span', days >= STUBBORN_DAYS ? 'wd-days is-stubborn' : 'wd-days', `${days} ngày`));
    item.append(head);
    if (reading || hanviet) item.append(element('div', 'wd-reading', [reading, hanviet?.toUpperCase()].filter(Boolean).join('   ·   ')));
    const gist = document.createElement('div');
    gist.className = 'wd-gist';
    const known = element('button', 'chip wd-know', '✓ Thuộc');
    known.setAttribute('type', 'button');
    known.title = 'Đã thuộc: bỏ khỏi danh sách của mọi chương, tới khi tra lại nó';
    gist.append(element('div', meaning ? 'wd-meaning' : 'wd-meaning is-empty', meaning || 'chưa có nghĩa'), known);
    item.append(gist);
    const said = lines[k];
    if (said) item.append(sentence(said, word));
    if (strokes) item.append(strokes.panel);
    return item;
  });
  wordsList.replaceChildren(...items);
  shown = { words, items, lines, src };
  showPlaying();
}

function element(/** @type {string} */ tag, /** @type {string} */ className, /** @type {string} */ text) {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
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

/** Tells the server the `k`th word is known, and folds it away: its line no longer plays. */
async function know(/** @type {number} */ k) {
  const connection = savedConnection();
  if (!shown || !open || !connection) return;
  const list = shown;
  const chapter = open;
  const { word } = list.words[k];
  const item = list.items[k];
  const button = /** @type {HTMLButtonElement} */ (item.querySelector('.wd-know'));
  button.disabled = true;
  try {
    const now = new Date();
    await call(connection, '/know', { word, day: studyDay(now), ms: now.getTime() });
  } catch (error) {
    button.disabled = false;
    if (shown === list) $('words-note').textContent = /** @type {Error} */ (error).message;
    return;
  }
  dialog.dispatchEvent(new CustomEvent('known', { detail: word }));
  if (shown !== list) return;
  list.lines[k] = null;
  // A line playing as its word is known plays out, and the list plays on past it.
  if (playing?.k === k && playing.then === 'loop') playing.then = 'next';
  item.classList.add('is-known');
  /** @type {HTMLElement} */ (item.querySelector('.wd-days')).textContent = 'đã thuộc';
  $('words-note').textContent = note(chapter, list.items.filter((i) => !i.classList.contains('is-known')).length);
  showPlaying();
}

/** Shows every word's reading, meaning and line, or only the word and its level, none turned over. */
function showGist(/** @type {boolean} */ on) {
  gistButton.setAttribute('aria-pressed', String(on));
  wordsList.classList.toggle('is-quiz', !on);
  for (const item of wordsList.children) item.classList.remove('is-revealed');
}

// ---------- playing the lines ----------

/** Lights the word playing, keeping it in view, and sets the buttons that say what plays. */
function showPlaying() {
  playButton.setAttribute('aria-pressed', String(Boolean(playing)));
  playButton.textContent = playing ? '■ Dừng' : '▶ Nghe';
  playButton.disabled = !playing && nextWithLine(shown?.lines ?? [], -1) < 0;
  shown?.items.forEach((item, k) => {
    const lit = playing?.k === k;
    if (lit && !item.classList.contains('is-playing')) item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.classList.toggle('is-playing', lit);
    item.querySelector('.wd-loop')?.setAttribute('aria-pressed', String(lit && playing?.then === 'loop'));
  });
}

function stop() {
  clearTimeout(gap);
  lineAudio.pause();
  if (!playing) return;
  playing = null;
  showPlaying();
}

/** Plays the `k`th word's line, and then that line again, the next word's, or nothing. */
function play(/** @type {number} */ k, /** @type {'loop' | 'next' | 'stop'} */ then) {
  const line = shown?.lines[k];
  if (!shown || !line) return;
  clearTimeout(gap);
  playing = { k, line, then };
  showPlaying();
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
  if (!playing || lineAudio.paused || lineAudio.currentTime < playing.line.end) return;
  lineAudio.pause();
  gap = window.setTimeout(() => {
    if (!playing || !shown) return;
    const again = playing.then === 'loop' && Boolean(shown.lines[playing.k]);
    const next = again ? playing.k : playing.then === 'stop' ? -1 : nextWithLine(shown.lines, playing.k);
    if (next < 0) stop();
    else play(next, again ? 'loop' : 'next');
  }, GAP_MS);
});

playButton.addEventListener('click', () => (playing ? stop() : play(nextWithLine(shown?.lines ?? [], -1), 'next')));
gistButton.addEventListener('click', () => showGist(gistButton.getAttribute('aria-pressed') !== 'true'));
wordsList.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const item = /** @type {HTMLElement | null} */ (target.closest('.wd-item'));
  if (!item || !shown) return;
  const k = shown.items.indexOf(item);
  // A word not yet turned over is turned over, its line heard once.
  if (wordsList.classList.contains('is-quiz') && !item.matches('.is-revealed, .is-known')) {
    item.classList.add('is-revealed');
    play(k, 'stop');
    return;
  }
  if (target.closest('.wd-know')) {
    know(k);
    return;
  }
  // ↻ loops the line, or lets the one looping play on; it never restarts the line already playing.
  if (target.closest('.wd-loop')) {
    if (playing?.k === k) {
      playing.then = playing.then === 'loop' ? 'next' : 'loop';
      showPlaying();
    } else play(k, 'loop');
    return;
  }
  // A tap on a word plays on from its line; one on its stroke order, or in it, is the stroke order's.
  if (!target.closest('button, .g-strokes')) play(k, 'next');
});
// The page's audio played by hand gives the lines way.
pageAudio.addEventListener('play', stop);
dialog.addEventListener('close', stop);
$('words-close').addEventListener('click', () => dialog.close());
// A tap on the backdrop, outside the dialog's box, closes it too.
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
