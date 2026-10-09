// @ts-check
// "Nghe lại": the chapters marked studied in the player, played one after another for passive
// listening. By default they play by their schedule (spacing.js): the ones due today first, each
// episode's together and in story order, then the ones due soonest. "7 ngày" and "Tất cả" play each
// episode whole instead, the one studied latest first. The list lives on the server (server/miner.py),
// so a chapter studied on the laptop plays on the phone. Any of these can be kept to one episode, or to
// one topic's (topics.js): a subject heard again chapter after chapter, its words coming back each time.
//
// Each chapter lists the words tapped in it, the lowest HSK level first, to read through before hearing
// it again. Reading the list is not a tap: only a word tapped in the player says it was not caught.
//
// One audio element plays everything. A chapter of another episode swaps its source rather than
// start a second player, so a phone with its screen off keeps a single media session going.

import { formatTime } from './card.js';
import { meterListening, showHours } from './meter.js';
import { formatPasses, heardTotals, passes } from './progress.js';
import { call, savedConnection } from './server.js';
import { dueLabel, heardThrough, schedule, spacedPlaylist, tappedOf } from './spacing.js';
import { ceilTenth, chapterLink, dayLabel, floorTenth, lastStudied, playlist, shuffledByEpisode } from './studied.js';
import { showWords } from './wordlist.js';

/** @typedef {import('./studied.js').Studied} Studied */
/** @typedef {import('./progress.js').Heard} Heard */
/** @typedef {import('./spacing.js').Tapped} Tapped */
/** @typedef {import('./topics.js').Topic} Topic */
/** @typedef {{ due: boolean, days: number | null, ep: string, topic: string, shuffle: boolean, times: number }} Settings
 *   `due` plays by the schedule; otherwise `days` filters by the day studied. `ep` or `topic`, at most
 *   one of them, keeps it to one episode or one topic's. */

const RECENT_DAYS = 7;
/** The filter, shuffle and repeats chosen last time, remembered in this browser. */
const SETTINGS_KEY = 'ci-listen-settings';
/** The player's own key, so a speed chosen there carries over. */
const SPEED_STORAGE_KEY = 'ci-playback-rate';
/** The player's own key too, so a chapter's words read at the size its lines are read at there. */
const FONT_STORAGE_KEY = 'ci-zh-font-size';
/** ⏮ this soon after a chapter starts goes to the one before; later, back to its start. */
const RESTART_WINDOW_S = 3;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const audio = /** @type {HTMLAudioElement} */ ($('audio'));
const list = $('playlist');
const meta = $('meta');
const episodeFilter = /** @type {HTMLSelectElement} */ ($('filter-episode'));
/** The filter's value for a topic; an episode's is its id, which never starts this way. */
const TOPIC_VALUE = 'topic:';

/** @type {Studied[]} */
let all = [];
/** How much of each chapter has been heard, for its passes in the list and its schedule. */
/** @type {Heard[]} */
let heard = [];
/** The words tapped in each chapter, for its schedule and its list of words. */
/** @type {Tapped[]} */
let tapped = [];
/** The day each chapter is next due. */
/** @type {Map<Studied, string>} */
let dueDays = new Map();
/** Today as the server counts it: Anki's day, turning at 4:00. */
let today = '';
/** @type {Settings} */
let settings = { due: true, days: RECENT_DAYS, ep: '', topic: '', shuffle: false, times: 1 };
/** Every topic, from the index. */
/** @type {Topic[]} */
let topics = [];
/** The chapters as shown, in order: a tap on the list plays one of these. By the schedule, the due
 * ones come first and `sections` says where the rest begin; a shuffle keeps each part to itself. */
/** @type {Studied[]} */
let shown = [];
/** @type {Studied[][]} */
let sections = [];
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

function applyReadingSize() {
  const size = Number(localStorage.getItem(FONT_STORAGE_KEY));
  if (size) document.documentElement.style.setProperty('--zh-size', `${size}px`);
}

function applySpeed() {
  const rate = Number(localStorage.getItem(SPEED_STORAGE_KEY)) || 1;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
}

/** A topic's "Nghe lại chủ đề" opens the page on it: it is kept to that topic, and stays so next time. */
function openedOnTopic() {
  const topic = new URLSearchParams(location.search).get('topic');
  if (!topic) return;
  settings = { ...settings, topic, ep: '' };
  saveSettings();
  history.replaceState(null, '', location.pathname);
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
  const taps = call(connection, '/tapped').catch(() => null);
  const index = fetch('data/index.json').then((r) => r.json()).catch(() => null);
  try {
    ({ chapters: all, today } = await call(connection, '/studied'));
  } catch (error) {
    meta.textContent = /** @type {Error} */ (error).message;
    return;
  }
  heard = (await listened)?.chapters ?? [];
  tapped = (await taps)?.chapters ?? [];
  dueDays = new Map(all.map((s) => [s, schedule({
    studied: s.dates, heard: heardThrough(heard, s), tapped: tappedOf(tapped, s)?.days ?? [],
  }).due]));
  topics = (await index)?.topics ?? [];
  const episodes = new Map(all.map((s) => [s.ep, s.episode]));
  const option = (/** @type {string} */ value, /** @type {string} */ text) => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = text;
    return element;
  };
  const group = (/** @type {string} */ label, /** @type {HTMLOptionElement[]} */ options) => {
    const element = document.createElement('optgroup');
    element.label = label;
    element.append(...options);
    return element;
  };
  episodeFilter.append(
    ...(topics.length ? [group('Chủ đề', topics.map((t) => option(`${TOPIC_VALUE}${t.id}`, `${t.vi} · ${inTopic(t).length} đoạn`)))] : []),
    group('Tập', [...episodes].sort(([a], [b]) => a.localeCompare(b)).map(([ep, title]) => option(ep, shorten(title || ep)))),
  );
  if (!episodes.has(settings.ep)) settings.ep = '';
  if (!topics.some((t) => t.id === settings.topic)) settings.topic = '';
  $('filters').hidden = false;
  $('play-options').hidden = false;
  render();
}

const NOTHING_STUDIED = 'Chưa có chương nào. Học xong một chương trong player thì bấm "✓ Học xong".';
const NOTHING_IN_TOPIC = 'Chưa học chương nào trong chủ đề này. Học xong một chương của nó trong player thì bấm "✓ Học xong".';
const inTopic = (/** @type {Topic} */ t) => all.filter((s) => t.episodes.includes(s.ep));
const dueOf = (/** @type {Studied} */ s) => dueDays.get(s) ?? today;
const minutesOf = (/** @type {Studied[]} */ chapters) => Math.round(chapters.reduce((sum, s) => sum + s.end - s.start, 0) / 60);
const wordsOf = (/** @type {Studied} */ s) => tappedOf(tapped, s)?.words ?? [];

function render() {
  const topic = topics.find((t) => t.id === settings.topic);
  const pool = topic ? inTopic(topic) : all;
  const nothing = topic ? NOTHING_IN_TOPIC : NOTHING_STUDIED;
  if (settings.due) {
    const { due, upcoming } = spacedPlaylist(pool, { today, ep: settings.ep, dueOf });
    sections = [due, upcoming];
    meta.textContent = due.length ? `${due.length} đoạn đến hạn · ${minutesOf(due)} phút`
      : upcoming.length ? 'Hôm nay không còn đoạn nào đến hạn. Phát thì nghe trước những đoạn sắp đến hạn.'
        : nothing;
  } else {
    sections = [playlist(pool, { today, days: settings.days, ep: settings.ep })];
    const [chapters] = sections;
    meta.textContent = chapters.length ? `${chapters.length} đoạn · ${minutesOf(chapters)} phút`
      : pool.length ? 'Không có đoạn nào trong khoảng này.' : nothing;
  }
  shown = sections.flat();

  const headed = settings.due ? ['Đến hạn', 'Sắp đến hạn'] : [];
  let offset = 0;
  list.replaceChildren(...sections.flatMap((chapters, k) => {
    const items = chapters.flatMap((s, j) => {
      const item = chapterItem(s, offset + j);
      return s.ep === chapters[j - 1]?.ep ? [item] : [episodeHeading(s), item];
    });
    offset += chapters.length;
    return items.length && headed[k] ? [sectionHeading(headed[k]), ...items] : items;
  }));

  $('due').setAttribute('aria-pressed', String(settings.due));
  for (const chip of document.querySelectorAll('[data-days]')) {
    const days = /** @type {HTMLElement} */ (chip).dataset.days;
    chip.setAttribute('aria-pressed', String(!settings.due && (days ? Number(days) : null) === settings.days));
  }
  for (const chip of document.querySelectorAll('[data-times]')) {
    chip.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (chip).dataset.times) === settings.times));
  }
  $('shuffle').setAttribute('aria-pressed', String(settings.shuffle));
  episodeFilter.value = settings.topic ? `${TOPIC_VALUE}${settings.topic}` : settings.ep;
  /** @type {HTMLButtonElement} */ ($('play-all')).disabled = !shown.length;
  markPlaying();
}

/** Where the due chapters, or the ones after them, begin. */
function sectionHeading(/** @type {string} */ text) {
  const item = document.createElement('li');
  item.className = 'pl-section';
  item.textContent = text;
  return item;
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
      `chương ${s.n + 1}`, formatTime(s.end - s.start),
      settings.due ? dueLabel(dueOf(s), today) : dayLabel(lastStudied(s), today),
      formatPasses(passes(heardTotals(heard, s.ep, s.start).audio, s.end - s.start)),
    ].join(' · ')),
  );
  item.append(button);
  const count = wordsOf(s).length;
  if (count) {
    const words = document.createElement('button');
    words.className = 'chip pl-words';
    words.type = 'button';
    words.dataset.i = String(i);
    words.textContent = `${count} từ`;
    words.title = 'Các từ đã tra trong chương này';
    item.append(words);
  }
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
  queue = settings.shuffle ? sections.flatMap((chapters) => shuffledByEpisode(chapters, first)) : [...shown];
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

function showNowWords(/** @type {Studied} */ chapter) {
  const count = wordsOf(chapter).length;
  $('now-words').hidden = !count;
  $('now-words').textContent = `${count} từ`;
}

function showNow(/** @type {Studied} */ chapter) {
  $('now').hidden = false;
  $('now-zh').textContent = chapter.zh;
  $('now-sub').textContent = `${chapter.vi} · ${chapter.ep}`;
  /** @type {HTMLAnchorElement} */ ($('open-chapter')).href = chapterLink(chapter);
  showNowWords(chapter);
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
  const target = /** @type {HTMLElement} */ (event.target);
  const words = /** @type {HTMLElement | null} */ (target.closest('.pl-words'));
  if (words) {
    const s = shown[Number(words.dataset.i)];
    showWords(s, wordsOf(s));
    return;
  }
  const button = /** @type {HTMLElement | null} */ (target.closest('.pl-item'));
  if (button) play(shown[Number(button.dataset.i)]);
});

$('due').addEventListener('click', () => {
  settings.due = true;
  saveSettings();
  render();
});

for (const chip of document.querySelectorAll('[data-days]')) {
  chip.addEventListener('click', () => {
    const days = /** @type {HTMLElement} */ (chip).dataset.days;
    settings.due = false;
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
  const { value } = episodeFilter;
  settings.topic = value.startsWith(TOPIC_VALUE) ? value.slice(TOPIC_VALUE.length) : '';
  settings.ep = settings.topic ? '' : value;
  saveSettings();
  render();
});

$('shuffle').addEventListener('click', () => {
  settings.shuffle = !settings.shuffle;
  saveSettings();
  render();
});

$('play-all').addEventListener('click', () => play(undefined));
$('now-words').addEventListener('click', () => { if (queue[index]) showWords(queue[index], wordsOf(queue[index])); });
// A word known in a chapter's list leaves every chapter's count.
$('words-dialog').addEventListener('known', (event) => {
  const word = /** @type {CustomEvent<string>} */ (event).detail;
  for (const chapter of tapped) chapter.words = chapter.words.filter((w) => w.word !== word);
  render();
  if (queue[index]) showNowWords(queue[index]);
});
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
openedOnTopic();
applyReadingSize();
await load();
