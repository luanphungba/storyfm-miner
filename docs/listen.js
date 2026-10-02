// @ts-check
// "Nghe lại": the chapters marked studied in the player, played one after another for passive
// listening, each episode whole and in story order, the one studied latest first. The list lives on the server
// (server/miner.py), so a chapter studied on the laptop plays on the phone.
//
// One audio element plays everything. A chapter of another episode swaps its source rather than
// start a second player, so a phone with its screen off keeps a single media session going.

import { formatTime } from './card.js';
import { meterListening, showHours } from './meter.js';
import { formatPasses, heardTotals, passes } from './progress.js';
import { call, savedConnection } from './server.js';
import { ceilTenth, chapterLink, dayLabel, floorTenth, lastStudied, playlist, shuffledByEpisode } from './studied.js';

/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {import('./progress.js').Heard} Heard */
/** @typedef {{ days: number | null, ep: string, shuffle: boolean, times: number }} Settings */

const RECENT_DAYS = 7;
/** The filter, shuffle and repeats chosen last time, remembered in this browser. */
const SETTINGS_KEY = 'ci-listen-settings';
/** The player's own key, so a speed chosen there carries over. */
const SPEED_STORAGE_KEY = 'ci-playback-rate';
/** ⏮ this soon after a chapter starts goes to the one before; later, back to its start. */
const RESTART_WINDOW_S = 3;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const audio = /** @type {HTMLAudioElement} */ ($('audio'));
const list = $('playlist');
const meta = $('meta');
const episodeFilter = /** @type {HTMLSelectElement} */ ($('filter-episode'));

/** @type {Studied[]} */
let all = [];
/** How much of each chapter has been heard, for its passes in the list. */
/** @type {Heard[]} */
let heard = [];
/** Today as the server counts it: Anki's day, turning at 4:00. */
let today = '';
/** @type {Settings} */
let settings = { days: RECENT_DAYS, ep: '', shuffle: false, times: 1 };
/** The chapters as shown, in order: a tap on the list plays one of these. */
/** @type {Studied[]} */
let shown = [];
/** What plays: the queue as it stood when play was pressed, where in it, and which pass of the chapter. */
/** @type {Studied[]} */
let queue = [];
let index = -1;
let pass = 1;
/** Bumped on every chapter change, so a source still loading for an earlier one is ignored. */
let ticket = 0;

// ---------- settings ----------

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    // Storage blocked or garbled: the defaults do.
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

function applySpeed() {
  const rate = Number(localStorage.getItem(SPEED_STORAGE_KEY)) || 1;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
}

// ---------- the list ----------

/** Episode titles run to forty characters; the filter only has to tell them apart. */
const TITLE_LENGTH = 20;
const shorten = (/** @type {string} */ title) => (title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH)}…` : title);

async function load() {
  const connection = savedConnection();
  if (!connection) {
    meta.innerHTML = 'Chưa kết nối server. Mở <a href="index.html">một tập</a>, bấm nút <b>Anki</b> và nhập địa chỉ server cùng token.';
    return;
  }
  const listened = call(connection, '/listened').catch(() => null);
  try {
    ({ chapters: all, today } = await call(connection, '/studied'));
  } catch (error) {
    meta.textContent = /** @type {Error} */ (error).message;
    return;
  }
  heard = (await listened)?.chapters ?? [];
  const episodes = new Map(all.map((s) => [s.ep, s.episode]));
  episodeFilter.append(...[...episodes].sort(([a], [b]) => a.localeCompare(b)).map(([ep, title]) => {
    const option = document.createElement('option');
    option.value = ep;
    option.textContent = shorten(title || ep);
    return option;
  }));
  if (!episodes.has(settings.ep)) settings.ep = '';
  $('filters').hidden = false;
  $('play-options').hidden = false;
  render();
}

function render() {
  shown = playlist(all, { today, days: settings.days, ep: settings.ep });
  const minutes = Math.round(shown.reduce((sum, s) => sum + s.end - s.start, 0) / 60);
  meta.textContent = shown.length ? `${shown.length} đoạn · ${minutes} phút`
    : all.length ? 'Không có đoạn nào trong khoảng này.'
      : 'Chưa có chương nào. Học xong một chương trong player thì bấm "✓ Học xong".';

  list.replaceChildren(...shown.flatMap((s, i) => (
    s.ep === shown[i - 1]?.ep ? [chapterItem(s, i)] : [episodeHeading(s), chapterItem(s, i)])));

  for (const chip of document.querySelectorAll('[data-days]')) {
    const days = /** @type {HTMLElement} */ (chip).dataset.days;
    chip.setAttribute('aria-pressed', String((days ? Number(days) : null) === settings.days));
  }
  for (const chip of document.querySelectorAll('[data-times]')) {
    chip.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (chip).dataset.times) === settings.times));
  }
  $('shuffle').setAttribute('aria-pressed', String(settings.shuffle));
  episodeFilter.value = settings.ep;
  /** @type {HTMLButtonElement} */ ($('play-all')).disabled = !shown.length;
  markPlaying();
}

/** The episode's title above its chapters: the list plays it as one story. */
function episodeHeading(/** @type {Studied} */ s) {
  const item = document.createElement('li');
  item.className = 'pl-episode';
  item.textContent = `${s.episode || s.ep} · ${s.ep}`;
  return item;
}

/** One chapter, tapped to play from it: `i` is where it stands in the chapters shown. */
function chapterItem(/** @type {Studied} */ s, /** @type {number} */ i) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.className = 'pl-item';
  button.type = 'button';
  button.dataset.i = String(i);
  const line = (/** @type {string} */ className, /** @type {string} */ text) => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
  button.append(
    line('pl-zh', s.zh),
    line('pl-vi', s.vi),
    line('pl-sub', [
      `chương ${s.n + 1}`, formatTime(s.end - s.start), dayLabel(lastStudied(s), today),
      formatPasses(passes(heardTotals(heard, s.ep, s.start).audio, s.end - s.start)),
    ].join(' · ')),
  );
  item.append(button);
  return item;
}

/** The chapter playing, lit in the list if the filter shows it. */
function markPlaying() {
  const playing = queue[index];
  for (const button of list.querySelectorAll('.pl-item')) {
    button.toggleAttribute('aria-current', shown[Number(/** @type {HTMLElement} */ (button).dataset.i)] === playing);
  }
}

// ---------- playing ----------

/** Plays the chapters shown, from `first` (the first of them when not given). */
function play(/** @type {Studied | undefined} */ first) {
  if (!shown.length) return;
  queue = settings.shuffle ? shuffledByEpisode(shown, first) : [...shown];
  index = Math.max(0, first ? queue.indexOf(first) : 0);
  start();
}

/** Starts the chapter at `index`, loading its episode's audio first when it is another one. */
async function start() {
  const chapter = queue[index];
  const mine = ++ticket;
  pass = 1;
  showNow(chapter);
  if (audio.src !== chapter.audio) {
    audio.src = chapter.audio;
    await new Promise((resolve) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', resolve, { once: true });
    });
    if (mine !== ticket) return;
    if (audio.error) {
      $('now-sub').textContent = 'Không tải được audio của tập này.';
      return;
    }
    applySpeed();
  }
  audio.currentTime = chapter.start;
  // A phone may want a tap before it plays; ⏯ is right there.
  await audio.play().catch(() => {});
}

/** Moves through the queue, wrapping at either end: passive listening goes round until stopped. */
function step(/** @type {number} */ delta) {
  if (!queue.length) return;
  index = (index + delta + queue.length) % queue.length;
  start();
}

function previous() {
  const chapter = queue[index];
  if (chapter && audio.currentTime - chapter.start > RESTART_WINDOW_S) audio.currentTime = chapter.start;
  else step(-1);
}

function showNow(/** @type {Studied} */ chapter) {
  $('now').hidden = false;
  $('now-zh').textContent = chapter.zh;
  $('now-sub').textContent = `${chapter.vi} · ${chapter.ep}`;
  /** @type {HTMLAnchorElement} */ ($('open-chapter')).href = chapterLink(chapter);
  showTime();
  markPlaying();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: chapter.zh, artist: chapter.vi, album: chapter.episode });
  }
}

/** Until a new source has loaded, Chrome can still report the position asked of the last one: ⏭
 * twice on a slow network read the last episode's 190 s as the end of the next chapter, and skipped it. */
const loaded = () => audio.readyState >= HTMLMediaElement.HAVE_METADATA;

function showTime() {
  const chapter = queue[index];
  if (!chapter) return;
  const at = loaded() ? Math.max(0, Math.min(audio.currentTime, chapter.end) - chapter.start) : 0;
  const round = settings.times > 1 ? ` · lượt ${pass}/${settings.times}` : '';
  $('now-time').textContent = `${index + 1}/${queue.length} · ${formatTime(at)}/${formatTime(chapter.end - chapter.start)}${round}`;
}

audio.addEventListener('timeupdate', () => {
  const chapter = queue[index];
  if (chapter && loaded() && audio.currentTime >= chapter.end) {
    if (pass < settings.times) {
      pass += 1;
      audio.currentTime = chapter.start;
    } else {
      step(1);
      return;
    }
  }
  showTime();
});

for (const event of ['play', 'pause']) {
  audio.addEventListener(event, () => { $('toggle').textContent = audio.paused ? '▶' : '⏸'; });
}

// ---------- controls ----------

list.addEventListener('click', (event) => {
  const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('.pl-item'));
  if (button) play(shown[Number(button.dataset.i)]);
});

for (const chip of document.querySelectorAll('[data-days]')) {
  chip.addEventListener('click', () => {
    const days = /** @type {HTMLElement} */ (chip).dataset.days;
    settings.days = days ? Number(days) : null;
    saveSettings();
    render();
  });
}

for (const chip of document.querySelectorAll('[data-times]')) {
  chip.addEventListener('click', () => {
    settings.times = Number(/** @type {HTMLElement} */ (chip).dataset.times);
    saveSettings();
    render();
    showTime();
  });
}

episodeFilter.addEventListener('change', () => {
  settings.ep = episodeFilter.value;
  saveSettings();
  render();
});

$('shuffle').addEventListener('click', () => {
  settings.shuffle = !settings.shuffle;
  saveSettings();
  render();
});

$('play-all').addEventListener('click', () => play(undefined));
$('prev').addEventListener('click', previous);
$('next').addEventListener('click', () => step(1));
$('toggle').addEventListener('click', () => {
  if (index < 0) play(undefined);
  else if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('previoustrack', previous);
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  navigator.mediaSession.setActionHandler('play', () => { audio.play().catch(() => {}); });
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
}

// The bar is fixed over the bottom of the page; the page keeps that much room under the last chapter.
const nowBar = $('now');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--player-height', `${nowBar.offsetHeight}px`);
}).observe(nowBar);

meterListening(audio, 'listen', {
  // By the playhead, not the queue: at a switch the queue has moved on while the playhead still
  // stands at the end of the chapter just heard.
  where: (position) => {
    const ep = queue[index]?.ep ?? '';
    const playing = all.find((s) => s.ep === ep && position >= floorTenth(s.start) && position < ceilTenth(s.end));
    return { ep, start: playing?.start ?? null };
  },
  onReport: (days) => showHours($('hours'), days),
});
loadSettings();
await load();
