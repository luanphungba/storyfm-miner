// @ts-check
// The listening page: audio at the bottom, transcript above it, the line being spoken lit up.
//
// It also broadcasts its cues over postMessage for a local browser extension that turns a selected
// word into a flashcard. That extension is site-agnostic — it drives a bare media element and takes
// cues over this same message shape elsewhere — so answering these messages is the whole
// integration. It selects on the .cue/.zh markup below and maps a selection back to a cue by DOM
// position, so the rendered order must always match the cues array. Filtering therefore hides cues
// with CSS rather than removing them.

import { CONTEXT_LINES, markLine } from './card.js';
import { newWords } from './chapterwords.js';
import { initExamples } from './examples.js';
import { chapterShots, framePercent } from './shots.js';
import { meterListening } from './meter.js';
import { initMiner } from './miner.js';
import { call, savedConnection } from './server.js';
import { strokeToggle } from './strokes.js';
import { ceilTenth, findStudied, floorTenth } from './studied.js';

const CUE_LANG = 'zh-Hans';
const CHANNEL = 'ci-timedtext';
const REQUEST = 'ci-timedtext-req';

/** How long autoscroll stays out of the way after the reader scrolls by hand. */
const MANUAL_SCROLL_GRACE_MS = 5_000;

/** How long the copy button shows its result before returning to its label. */
const COPY_FEEDBACK_MS = 1_600;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const audio = /** @type {HTMLAudioElement} */ ($('audio'));
const cueBox = $('cues');

const params = new URLSearchParams(location.search);
const episodeId = params.get('ep');

/** @type {{ i: number, s: number, u?: number, start: number, end: number, text: string, speaker: string, role: string }[]} */
let cues = [];
/** One .cue row per cue, in order. Not cueBox.children: chapter headings sit between the rows. */
/** @type {HTMLElement[]} */
let rows = [];
/** @type {{ id: string, title: string, source: string }} */
let episode = { id: '', title: '', source: '' };

/** Word spans and their glosses, both built offline — see tools/build_tokens.py and build_gloss.py.
 * They arrive after the transcript is already on screen: the page has to be readable without them,
 * because older episodes have no sidecar and a phone on a bad connection should still get the text. */
/** @type {number[][][] | null} */
let tokens = null;
/** @type {Record<string, string[]> | null} */
let gloss = null;
/** @type {{ start: number, end: number, left: number, button: HTMLElement | null } | null} */
let loop = null;
/** Whether the episode starts over when it ends. Off on every load: it is for this sitting. */
let repeatEpisode = false;
let currentIndex = -1;
let lastManualScrollAt = 0;
/** Set when a tapped word paused the audio, so closing its card picks the listening back up. */
let resumeOnClose = false;

const formatTime = (/** @type {number} */ seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// ---------- load ----------

async function load() {
  if (!episodeId) {
    $('title').textContent = 'Thiếu mã tập';
    $('meta').innerHTML = 'Thử <a href="index.html">danh sách tập</a>.';
    return;
  }

  const response = await fetch(`data/${encodeURIComponent(episodeId)}.json`);
  if (!response.ok) {
    $('title').textContent = `Chưa có transcript cho ${episodeId}`;
    $('meta').textContent = `Chạy: storyfm add ${episodeId}`;
    return;
  }

  const data = await response.json();
  cues = data.cues;
  episode = { id: data.id, title: data.title, source: data.source ?? '' };

  document.title = data.title;
  $('title').textContent = data.title;
  $('meta').textContent = `${data.pubDate} · ${formatTime(data.duration)} · ${cues.length} câu`;

  audio.src = data.audio.m4a ?? data.audio.mp3;
  if (data.source === 'bilibili') showBilibili(data);
  if (data.source === 'podcast') showPodcast(data);
  if (data.source === 'ui') showInterface(data);
  render();
  announce('cues', { lang: CUE_LANG, cues });
  applyDeepLink();
  loadWords();
  loadTranslation();
  loadChapters();
  if (data.source === 'ui') loadShots();
}

/** A Bilibili video is heard here but watched there: the meta line links the original under the
 * title, the toolbar link opens it at the second being heard, and the narrator filter has nothing
 * to split, so it goes. A multi-part video's later part carries its own link (…/?p=2); a video's
 * first part is its id alone. */
function showBilibili(/** @type {{ id: string, owner?: string, link?: string }} */ data) {
  const page = data.link ?? `https://www.bilibili.com/video/${data.id}/`;
  const original = document.createElement('a');
  original.href = page;
  original.target = '_blank';
  original.rel = 'noopener';
  original.textContent = 'Xem video gốc trên Bilibili ↗';
  $('meta').prepend(data.owner ? `${data.owner} · ` : '');
  $('meta').append(' · ', original);

  $('filter-all').hidden = true;
  $('filter-storyteller').hidden = true;
  const link = /** @type {HTMLAnchorElement} */ ($('open-bilibili'));
  link.hidden = false;
  const point = () => {
    const at = new URL(page);
    at.searchParams.set('t', String(Math.floor(audio.currentTime)));
    link.href = at.href;
  };
  point();
  link.addEventListener('pointerdown', point);
  link.addEventListener('focus', point);
}

/** Another podcast: the meta line names the show and links the episode's page, whose show notes
 * carry the host's own vocabulary list and transcript. Two people talking have no narrator and
 * storyteller to filter between, so the filter goes; the colours still tell the voices apart. */
function showPodcast(/** @type {{ owner?: string, link?: string }} */ data) {
  $('meta').prepend(data.owner ? `${data.owner} · ` : '');
  if (data.link) {
    const notes = document.createElement('a');
    notes.href = data.link;
    notes.target = '_blank';
    notes.rel = 'noopener';
    notes.textContent = 'Show notes ↗';
    $('meta').append(' · ', notes);
  }
  $('filter-all').hidden = true;
  $('filter-storyteller').hidden = true;
}

/** An app's interface, read aloud: one voice, nobody to filter between, and the app it comes from
 * named where a show's name would be. */
function showInterface(/** @type {{ owner?: string }} */ data) {
  $('meta').prepend(data.owner ? `${data.owner} · ` : '');
  $('filter-all').hidden = true;
  $('filter-storyteller').hidden = true;
}

// ---------- render ----------

function render() {
  rows = cues.map((cue) => {
    const row = document.createElement('div');
    row.className = `cue${cue.role === 'narrator' ? ' is-narrator' : ''}`;
    // ci-start/ci-end, not start/end: the CI extension treats these rows as the native
    // transcript and reads those keys. Without them it falls back to parsing the visible
    // "0:12" (losing the decimals) and to holding each line until the next one starts —
    // which here means looping through the music in the gap.
    row.dataset.i = String(cue.i);
    row.dataset.ciStart = String(cue.start);
    row.dataset.ciEnd = String(cue.end);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(cue.start);

    const text = document.createElement('span');
    text.className = 'zh';
    text.textContent = cue.text;

    const loopButton = document.createElement('button');
    loopButton.className = 'loop';
    loopButton.type = 'button';
    loopButton.textContent = '↻';
    loopButton.title = 'Lặp câu này';
    loopButton.setAttribute('aria-pressed', 'false');

    row.append(time, text, loopButton);
    return row;
  });
  cueBox.replaceChildren(...rows);
}

// ---------- words ----------

/** Chinese runs together, so a tap has to know where the word it landed in begins and ends. The
 * browser cannot work that out: its own segmenter splits 互联网 into 互/联/网 and 面试官 into
 * 面试/官. The spans are therefore cut offline by jieba and only rendered here. */
async function loadWords() {
  const [tok, gl] = await Promise.all([
    fetch(`data/${episodeId}.tok.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`data/${episodeId}.gloss.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!tok || !gl) return;
  tokens = tok.cues;
  gloss = gl;
  decorate();
}

/** Rewrites each line as word spans plus the punctuation between them. The cue order and the
 * .cue/.zh shape stay exactly as they were: the extension maps a selection back to a cue by DOM
 * position, so only the inside of .zh changes. */
function decorate() {
  if (!tokens) return;
  cues.forEach((cue, index) => {
    const spans = tokens[index];
    const host = rows[index]?.querySelector('.zh');
    if (!spans || !host) return;
    const parts = [];
    let at = 0;
    for (const [start, length, band, count, isName] of spans) {
      if (start > at) parts.push(cue.text.slice(at, start));
      const word = document.createElement('span');
      word.className = 'w';
      word.textContent = cue.text.slice(start, start + length);
      // Carried on the span so the card can answer "how common is this, and is it worth a card?"
      // without going back to the token file for every tap.
      if (band) word.dataset.band = String(band);
      if (isName) word.dataset.name = '1';
      word.dataset.count = String(count);
      parts.push(word);
      at = start + length;
    }
    if (at < cue.text.length) parts.push(cue.text.slice(at));
    host.replaceChildren(...parts);
  });
  showNewWords();
}

// ---------- Vietnamese translation ----------

/** Built offline, one entry per line (now and then a pair of lines) — see src/translations.js. Each
 * sits under the line it translates, hidden until asked for: the point is to listen first and check
 * after, and a translation already on screen gets read instead of the Chinese being heard. The
 * summary is the exception, open above everything, because knowing the story going in is what lets
 * the ear spend itself on the words it does not know yet. */
async function loadTranslation() {
  const data = await fetch(`data/${episodeId}.vi.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) return;

  if (data.summary?.length) {
    $('summary-body').replaceChildren(...data.summary.map((/** @type {string} */ text) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return paragraph;
    }));
    $('summary').hidden = false;
  }

  let any = false;
  for (const index of cues.keys()) {
    const text = data.lines?.[index];
    if (!text) continue;
    const row = rows[index];
    const button = document.createElement('button');
    button.className = 'vi-toggle';
    button.type = 'button';
    button.textContent = 'VI';
    button.title = 'Hiện bản dịch dòng này';
    button.setAttribute('aria-pressed', 'false');
    const line = document.createElement('div');
    line.className = 'vi';
    line.lang = 'vi';
    line.textContent = text;
    row.classList.add('has-vi');
    row.append(button, line);
    any = true;
  }
  $('show-vi').hidden = !any;
}

/** Pressed mid-listen, so it opens or closes every translation above the line too, and the line
 * being heard has to stay put rather than be pushed a screen away. */
$('show-vi').addEventListener('click', (event) => {
  const button = /** @type {HTMLElement} */ (event.currentTarget);
  const on = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(on));
  holdLineInPlace(() => {
    cueBox.classList.toggle('show-vi', on);
    // Switching everything off starts clean, rather than leaving the few opened one by one.
    if (!on) {
      for (const row of cueBox.querySelectorAll('.vi-open')) {
        row.classList.remove('vi-open');
        row.querySelector('.vi-toggle')?.setAttribute('aria-pressed', 'false');
      }
    }
  });
});

// ---------- chapters ----------

/** Built offline, one to two minutes each on one small topic — see src/chapters.js. A chapter is what
 * a day of active listening loops: picked by its topic, looped in the loop bar, the lines outside it
 * dimmed. The loop bar holds it rather than some state of its own, so the URL keeps it, ↻ Lặp restarts
 * it, and editing or clearing the fields leaves it. */
/** @type {{ zh: string, vi: string, from: number, to: number, start: number, end: number }[]} */
let chapters = [];
/** The chapter the loop bar holds: which pass of it is playing, and how long it has played this sitting. */
/** @type {{ n: number, pass: number, seconds: number } | null} */
let chapter = null;
/** One heading per chapter, in the transcript above its first line. */
/** @type {HTMLElement[]} */
let headings = [];

const chapterBar = $('chapterbar');

async function loadChapters() {
  const data = await fetch(`data/${episodeId}.chapters.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data?.chapters?.length) return;
  chapters = data.chapters;

  const part = (/** @type {string} */ className, /** @type {string} */ text, lang = '') => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    if (lang) span.lang = lang;
    return span;
  };
  const describe = (/** @type {typeof chapters[number]} */ c, /** @type {number} */ n, /** @type {string} */ className) => {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.dataset.n = String(n);
    const titles = document.createElement('span');
    titles.className = 'ch-titles';
    titles.append(part('ch-zh', c.zh), part('ch-vi', c.vi, 'vi'));
    button.append(part('ch-n', String(n + 1)), titles, part('ch-len', formatTime(c.end - c.start)));
    return button;
  };

  headings = chapters.map((c, n) => {
    const heading = describe(c, n, 'chapter');
    heading.title = 'Lặp chương này';
    rows[c.from]?.before(heading);
    return heading;
  });
  $('chapter-list').replaceChildren(...chapters.map((c, n) => {
    const item = document.createElement('li');
    item.append(describe(c, n, 'toc-item'));
    return item;
  }));
  $('chapters').hidden = false;
  refreshLoopBar(); // a chapter already in the URL
  showStudied();
  loadStudied();
  showNewWords();
  showShots();
}

/** An app's interface is learned a page at a time, so under each chapter's heading go the words that
 * chapter brings in. A tap is a tap on the word where it is first heard: the same card, strokes and
 * ＋ Anki included, with that line as the context. Waits for both the chapters and the word spans. */
let newWordsShown = false;
function showNewWords() {
  if (episode.source !== 'ui' || !tokens || !chapters.length || newWordsShown) return;
  newWordsShown = true;
  newWords(cues.map((cue) => cue.text), tokens, chapters).forEach((words, n) => {
    if (!words.length) return;
    const box = document.createElement('div');
    box.className = 'ch-words';
    box.dataset.n = String(n);
    box.setAttribute('aria-label', 'Từ mới của chương');
    for (const { word, line, band } of words) {
      const chip = document.createElement('button');
      chip.type = 'button';
      // HSK 1-3 is the everyday core the reader already has; it stays listed but steps back.
      chip.className = band && band <= 3 ? 'ch-word is-easy' : 'ch-word';
      chip.textContent = word;
      chip.dataset.line = String(line);
      box.append(chip);
    }
    // Under the chapter's screenshots when they came first, so the screen always shows above its words.
    const strip = headings[n]?.nextElementSibling;
    (strip?.classList.contains('ch-shots') ? strip : headings[n])?.after(box);
  });
}

// ---------- screens (app interfaces) ----------

/** Where each line of an app's interface sits on its screen — see src/ui.js. A chapter of an interface
 * is one screen, so its screenshots sit under its heading. Opened, one shows with a frame around the
 * line being heard, and follows the audio from line to line and from screen to screen. */
/** @type {{ screen: { width: number, height: number }, lines: import('./shots.js').Place[] } | null} */
let shots = null;
/** The chapter and which of its screenshots the viewer shows, while it is open. */
/** @type {{ n: number, k: number } | null} */
let viewing = null;
const viewer = $('shot-viewer');
const shotUrl = (/** @type {string} */ shot) => `data/${encodeURIComponent(episodeId ?? '')}.shots/${shot}.webp`;

async function loadShots() {
  shots = await fetch(`data/${episodeId}.shots.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (shots) $('sv-frame').style.aspectRatio = `${shots.screen.width} / ${shots.screen.height}`;
  showShots();
}

let shotsShown = false;
function showShots() {
  if (!shots || !chapters.length || shotsShown) return;
  shotsShown = true;
  const places = shots.lines;
  chapters.forEach((c, n) => {
    const list = chapterShots(places, c);
    if (!list.length) return;
    const strip = document.createElement('div');
    strip.className = 'ch-shots';
    strip.dataset.n = String(n);
    list.forEach((shot, k) => {
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'ch-shot';
      thumb.dataset.n = String(n);
      thumb.dataset.k = String(k);
      thumb.setAttribute('aria-label', `Xem màn hình ${k + 1}/${list.length}`);
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = '';
      image.src = shotUrl(shot);
      thumb.append(image);
      strip.append(thumb);
    });
    headings[n]?.after(strip);
  });
}

function openShot(/** @type {number} */ n, /** @type {number} */ k) {
  viewing = { n, k };
  viewer.hidden = false;
  drawShot();
}

function closeShot() {
  viewing = null;
  viewer.hidden = true;
}

/** Shows the screenshot the viewer is on, with the frame around the line being heard when it is there. */
function drawShot() {
  if (!viewing || !shots) return;
  const list = chapterShots(shots.lines, chapters[viewing.n]);
  const shot = list[viewing.k];
  /** @type {HTMLImageElement} */ ($('sv-img')).src = shotUrl(shot);
  $('sv-title').textContent = `${chapters[viewing.n].zh} · ${viewing.k + 1}/${list.length}`;
  /** @type {HTMLButtonElement} */ ($('sv-prev')).disabled = viewing.k === 0;
  /** @type {HTMLButtonElement} */ ($('sv-next')).disabled = viewing.k === list.length - 1;
  const place = shots.lines[currentIndex];
  const box = $('sv-box');
  box.hidden = !place || place[0] !== shot;
  if (!place || box.hidden) return;
  const frame = framePercent(place.slice(1), shots.screen);
  Object.assign(box.style, { left: `${frame.left}%`, top: `${frame.top}%`, width: `${frame.width}%`, height: `${frame.height}%` });
  box.scrollIntoView({ block: 'center' });
}

/** While open, the viewer goes wherever the line being heard is. */
function followShot(/** @type {number} */ index) {
  const place = shots?.lines[index];
  if (!viewing || !shots || !place) return;
  const n = chapters.findIndex((c) => index >= c.from && index <= c.to);
  if (n < 0) return;
  viewing = { n, k: chapterShots(shots.lines, chapters[n]).indexOf(place[0]) };
  drawShot();
}

$('sv-prev').addEventListener('click', () => { if (viewing) { viewing.k -= 1; drawShot(); } });
$('sv-next').addEventListener('click', () => { if (viewing) { viewing.k += 1; drawShot(); } });
$('sv-close').addEventListener('click', closeShot);
viewer.addEventListener('click', (event) => { if (event.target === viewer) closeShot(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && viewing) closeShot(); });

/** Puts chapter n in the loop bar and loops it from its start. */
function selectChapter(/** @type {number} */ n) {
  const c = chapters[n];
  if (!c) return;
  hideGloss();
  loopStartInput.value = formatTimeField(floorTenth(c.start));
  loopEndInput.value = formatTimeField(ceilTenth(c.end));
  refreshLoopBar();
  startLoop(floorTenth(c.start), ceilTenth(c.end), Infinity, loopToggle);
  headings[n]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Called with the loop bar's range whenever it changes: a range that is exactly a chapter selects
 * it, anything else leaves chapter mode. */
function syncChapter(/** @type {{ start: number, end: number } | null} */ range) {
  const n = range
    ? chapters.findIndex((c) => Math.abs(floorTenth(c.start) - range.start) < 0.01 && Math.abs(ceilTenth(c.end) - range.end) < 0.01)
    : -1;
  if (n === (chapter?.n ?? -1)) return;
  chapter = n < 0 ? null : { n, pass: 1, seconds: 0 };
  // A chapter loops until told otherwise, even when a link to it started a loop of one pass.
  if (chapter && loop?.button === loopToggle) loop.left = Infinity;

  cueBox.classList.toggle('has-chapter', !!chapter);
  const c = chapter && chapters[chapter.n];
  rows.forEach((row, index) => row.classList.toggle('in-chapter', !!c && index >= c.from && index <= c.to));
  headings.forEach((heading, k) => heading.classList.toggle('is-current', k === chapter?.n));
  for (const extra of cueBox.querySelectorAll('.ch-words, .ch-shots')) {
    extra.classList.toggle('is-current', Number(/** @type {HTMLElement} */ (extra).dataset.n) === chapter?.n);
  }
  for (const item of document.querySelectorAll('.toc-item')) {
    item.toggleAttribute('aria-current', Number(/** @type {HTMLElement} */ (item).dataset.n) === chapter?.n);
  }
  chapterBar.hidden = !chapter;
  // The fields would only repeat the chapter's own start and end; ✕ leaves the chapter and brings them back.
  chapterBar.closest('.player')?.classList.toggle('has-chapter', !!chapter);
  if (c) $('chapter-title').textContent = `${(chapter?.n ?? 0) + 1}/${chapters.length} · ${c.zh}`;
  /** @type {HTMLButtonElement} */ ($('chapter-prev')).disabled = !chapter || chapter.n === 0;
  /** @type {HTMLButtonElement} */ ($('chapter-next')).disabled = !chapter || chapter.n === chapters.length - 1;
  studyButton.hidden = !chapter;
  showChapterStats();
  showStudied();
}

function showChapterStats() {
  if (!chapter) return;
  $('chapter-stats').textContent = `lượt ${chapter.pass} · ${formatTime(chapter.seconds)}`;
}

/** Counts the time the chapter itself is heard: a line of it looped counts, listening on past its end does not. */
setInterval(() => {
  const c = chapter && chapters[chapter.n];
  if (!chapter || !c || audio.paused || audio.currentTime < c.start - 0.5 || audio.currentTime > c.end + 0.5) return;
  chapter.seconds += 1;
  showChapterStats();
}, 1000);

$('chapter-list').addEventListener('click', (event) => {
  const item = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('.toc-item'));
  if (item) selectChapter(Number(item.dataset.n));
});
$('chapter-prev').addEventListener('click', () => chapter && selectChapter(chapter.n - 1));
$('chapter-next').addEventListener('click', () => chapter && selectChapter(chapter.n + 1));
$('chapter-now').addEventListener('click', () => {
  if (chapter) headings[chapter.n]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// ---------- studied chapters ----------

/** "Học xong" puts the chapter on the server's list of studied chapters, which the "Nghe lại" page
 * plays back on any device; the chapters studied carry a ✓ here. Without a server the page works
 * as before and the button asks for one. Pressed again the same day, it takes the mark back. */
/** @type {import('./studied.js').Studied[]} */
let studied = [];
/** Today as the server counts it: Anki's day, turning at 4:00. */
let studyDay = '';

const studyButton = /** @type {HTMLButtonElement} */ ($('chapter-done'));

async function loadStudied() {
  const connection = savedConnection();
  if (!connection) return;
  try {
    applyStudied(await call(connection, '/studied'));
  } catch {
    // No marks until the server answers; pressing the button says what is wrong.
  }
}

function applyStudied(/** @type {{ chapters: import('./studied.js').Studied[], today: string }} */ data) {
  studied = data.chapters.filter((s) => s.ep === episode.id);
  studyDay = data.today;
  showStudied();
}

const studyDialog = /** @type {HTMLDialogElement} */ ($('study-dialog'));

/** One tap would otherwise add or drop a chapter, so the dialog says which way it goes and what
 * happens to the list, and only "confirm" goes through: ✕, Esc and Huỷ all leave it as it was. */
function confirmStudy(/** @type {typeof chapters[number]} */ c, /** @type {boolean} */ undo) {
  const otherDays = (findStudied(studied, episode.id, c.start)?.dates.length ?? 0) > 1;
  $('study-title').textContent = c.zh;
  $('study-note').textContent = !undo
    ? `Đánh dấu đã học hôm nay và thêm chương này vào danh sách Nghe lại. (${c.vi})`
    : otherDays
      ? 'Bỏ đánh dấu hôm nay? Chương vẫn ở trong Nghe lại với những ngày đã học trước.'
      : 'Bỏ đánh dấu hôm nay? Chương sẽ bị gỡ khỏi danh sách Nghe lại.';
  $('study-confirm').textContent = undo ? 'Bỏ đánh dấu' : '✓ Học xong';
  studyDialog.returnValue = '';
  studyDialog.showModal();
  return new Promise((resolve) => {
    studyDialog.addEventListener('close', () => resolve(studyDialog.returnValue === 'confirm'), { once: true });
  });
}

const studiedToday = (/** @type {typeof chapters[number]} */ c) =>
  Boolean(findStudied(studied, episode.id, c.start)?.dates.includes(studyDay));

function showStudied() {
  const done = chapters.map((c) => Boolean(findStudied(studied, episode.id, c.start)));
  headings.forEach((heading, n) => heading.classList.toggle('is-studied', done[n]));
  for (const item of document.querySelectorAll('.toc-item')) {
    item.classList.toggle('is-studied', done[Number(/** @type {HTMLElement} */ (item).dataset.n)]);
  }
  const count = done.filter(Boolean).length;
  $('chapters-label').textContent = `${chapters.length} chương · mỗi chương một chủ đề nhỏ${count ? ` · đã học ${count}` : ''}`;

  const c = chapter && chapters[chapter.n];
  const today = Boolean(c && studiedToday(c));
  studyButton.textContent = today ? '✓ Đã học hôm nay' : '✓ Học xong';
  studyButton.title = today ? 'Bấm lần nữa để bỏ đánh dấu hôm nay' : 'Đưa chương này vào danh sách Nghe lại';
  studyButton.setAttribute('aria-pressed', String(today));
  // Right where the chapter was just added, the way to the list it went into.
  $('open-listen').hidden = !(c && findStudied(studied, episode.id, c.start));
}

async function toggleStudied() {
  const c = chapter && chapters[chapter.n];
  if (!chapter || !c) return;
  const connection = savedConnection();
  if (!connection) {
    miner.connect(toggleStudied);
    return;
  }
  const undo = studiedToday(c);
  if (!(await confirmStudy(c, undo))) return;
  studyButton.disabled = true;
  try {
    applyStudied(undo
      ? await call(connection, '/unstudy', { ep: episode.id, start: c.start })
      : await call(connection, '/study', {
        ep: episode.id, episode: episode.title, audio: audio.src, n: chapter.n, zh: c.zh, vi: c.vi, start: c.start, end: c.end,
      }));
  } catch (error) {
    studyButton.textContent = /** @type {Error} */ (error).message;
    setTimeout(showStudied, COPY_FEEDBACK_MS);
  } finally {
    studyButton.disabled = false;
  }
}

studyButton.addEventListener('click', toggleStudied);

const card = $('gloss');
let openWord = null;

/** The card sits above the audio bar rather than floating by the word: on a phone a tooltip next to
 * the text either covers the line being read or lands off-screen, and the reader is looking down at
 * the controls anyway. */
function showGloss(/** @type {HTMLElement} */ span) {
  const word = span.textContent ?? '';
  const entry = gloss?.[word];
  const [reading, hanviet, meaning] = entry ?? [];
  openWord?.classList.remove('is-open');
  span.classList.add('is-open');
  openWord = span;

  card.classList.remove('is-mining');
  card.innerHTML = '';
  const line = (className, text) => {
    if (!text) return;
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    card.append(element);
  };
  line('g-word', word);
  const strokes = strokeToggle(word);
  if (strokes) card.lastElementChild?.append(strokes.button);
  line('g-reading', [reading, hanviet?.toUpperCase()].filter(Boolean).join('   ·   '));
  // An unauthored word says so. A guess here would be worse than a blank: the reader cannot tell a
  // wrong meaning from a right one, and a wrong one is what ends up on a flashcard.
  line('g-meaning', meaning || 'chưa có nghĩa');
  if (!meaning) card.lastElementChild?.classList.add('is-empty');

  // The level says how much of spoken Chinese this word buys: band 1 words are 50% of everything
  // said, band 7-9 words are the long tail. A word on no list is not a failure to know it — 播客 and
  // 面试官 are ordinary speech that the syllabus simply does not cover — so it says so plainly.
  const band = span.dataset.band;
  const level = span.dataset.name ? 'tên riêng' : band ? `HSK ${band === '7' ? '7-9' : band}` : 'ngoài HSK';
  const here = { ep: episode.id, cue: rows.indexOf(/** @type {HTMLElement} */ (span.closest('.cue'))) };
  const seen = examples.toggle(word, Number(span.dataset.count), here);
  line('g-meta', `${level} · `);
  card.lastElementChild?.append(seen?.button ?? 'chỉ gặp ở câu này');
  if (seen) card.append(seen.panel);
  if (strokes) card.append(strokes.panel);
  const actions = document.createElement('div');
  actions.className = 'g-actions';
  const close = document.createElement('button');
  close.className = 'g-close';
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Đóng và nghe tiếp');
  close.onclick = hideGloss;
  actions.append(miner.button(wordContext(span)), close);
  card.prepend(actions);
  card.hidden = false;
}

/** The tapped word as the miner needs it: its line with the word marked, and the lines around it. */
function wordContext(/** @type {HTMLElement} */ span) {
  const index = rows.indexOf(/** @type {HTMLElement} */ (span.closest('.cue')));
  const cue = cues[index];
  const word = span.textContent ?? '';
  let start = 0;
  for (let node = span.previousSibling; node; node = node.previousSibling) start += node.textContent?.length ?? 0;
  return {
    word,
    cue,
    marked: markLine(cue.text, start, word.length),
    context: cues.slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1).map((c) => c.text),
    episode,
    audioSrc: audio.currentSrc || audio.src,
  };
}

const miner = initMiner({
  card,
  close: hideGloss,
  playLine: (cue) => startLoop(cue.start, cue.end, 1),
});

const examples = initExamples({ audio, openChapter: selectChapter });

function hideGloss() {
  examples.stop();
  card.hidden = true;
  openWord?.classList.remove('is-open');
  openWord = null;
  if (resumeOnClose) audio.play();
  resumeOnClose = false;
}

// Pressing play by hand has already resumed; closing the card later must not replay anything.
audio.addEventListener('play', () => { resumeOnClose = false; });

// ---------- playback ----------

/** Last cue that has already started; gaps between cues keep the previous line lit. */
function indexAt(/** @type {number} */ time) {
  let low = 0;
  let high = cues.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function highlight(/** @type {number} */ index) {
  if (index === currentIndex) return;
  rows[currentIndex]?.classList.remove('is-now');
  currentIndex = index;
  followShot(index);

  const row = rows[index];
  if (!row) return;
  row.classList.add('is-now');

  if (Date.now() - lastManualScrollAt > MANUAL_SCROLL_GRACE_MS) {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/** Runs a change that reflows the lines above, keeping the line being read where it was on screen:
 * the one being heard if it is in view, otherwise the top line in view. */
function holdLineInPlace(/** @type {() => void} */ change) {
  const inView = (/** @type {Element} */ row) => {
    const { top, bottom } = row.getBoundingClientRect();
    return bottom > 0 && top < innerHeight;
  };
  const now = cueBox.querySelector('.cue.is-now');
  const anchor = now && inView(now) ? now : [...cueBox.children].find(inView);
  const before = anchor?.getBoundingClientRect().top;
  change();
  if (anchor && before !== undefined) scrollBy(0, anchor.getBoundingClientRect().top - before);
}

function startLoop(/** @type {number} */ start, /** @type {number} */ end, times = Infinity, button = null) {
  stopLoop();
  loop = { start, end, left: times, button };
  button?.setAttribute('aria-pressed', 'true');
  syncRepeat();
  audio.currentTime = start;
  audio.play();
}

/** Stops the audio too: a loop switched off mid-line otherwise runs on into whatever follows,
 * and on 故事FM that is usually several seconds of outro music before the next line starts. */
function stopLoop() {
  loop?.button?.setAttribute('aria-pressed', 'false');
  loop = null;
  syncRepeat();
  audio.pause();
}

/** The element's own loop does the repeating. It stands down while a line or segment loops: a
 * segment running to the very end would otherwise wrap to 0:00 before timeupdate saw its end. */
function syncRepeat() {
  audio.loop = repeatEpisode && !loop;
}

audio.addEventListener('timeupdate', () => {
  if (loop && audio.currentTime >= loop.end) {
    if (loop.left <= 1) {
      stopLoop();
    } else {
      loop.left -= 1;
      audio.currentTime = loop.start;
      if (chapter && loop.button === loopToggle) {
        chapter.pass += 1;
        showChapterStats();
      }
    }
  }
  highlight(indexAt(audio.currentTime));
});

// ---------- interaction ----------

cueBox.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const thumb = /** @type {HTMLElement | null} */ (target.closest('.ch-shot'));
  if (thumb) {
    openShot(Number(thumb.dataset.n), Number(thumb.dataset.k));
    return;
  }
  const chip = /** @type {HTMLElement | null} */ (target.closest('.ch-word'));
  if (chip) {
    const spans = rows[Number(chip.dataset.line)]?.querySelectorAll('.w') ?? [];
    const span = /** @type {HTMLElement | undefined} */ ([...spans].find((w) => w.textContent === chip.textContent));
    span?.click();
    return;
  }
  const heading = /** @type {HTMLElement | null} */ (target.closest('.chapter'));
  if (heading) {
    selectChapter(Number(heading.dataset.n));
    return;
  }
  const row = /** @type {HTMLElement | null} */ (target.closest('.cue'));
  if (!row) return;

  const start = Number(row.dataset.ciStart);
  const end = Number(row.dataset.ciEnd);

  if (target.classList.contains('vi-toggle')) {
    const open = row.classList.toggle('vi-open');
    target.setAttribute('aria-pressed', String(open));
    return;
  }

  // The translation is for reading, and selecting a phrase of it should not jump the audio.
  if (target.closest('.vi')) return;

  if (target.classList.contains('loop')) {
    if (loop?.button === target) stopLoop();
    else startLoop(start, end, Infinity, target);
    return;
  }

  // Tapping a word is reading, not listening: the audio stops while the card is read, and closing
  // the card carries on from the same place. Playing on would only lose the line, as nobody takes in
  // speech while reading a meaning. The rest of the row still seeks and plays, as it always did.
  // The exception is a loop on some other line: tapping here means you have moved on from it, so
  // the audio waits at the start of this line instead.
  if (target.classList.contains('w')) {
    const wasPlaying = !audio.paused;
    showGloss(target);
    if (loop && !(start < loop.end && loop.start < end)) {
      stopLoop();
      audio.currentTime = start;
    }
    audio.pause();
    resumeOnClose ||= wasPlaying;
    return;
  }

  resumeOnClose = false; // this line plays instead
  hideGloss();
  // A line inside the segment or chapter being drilled plays from there and the loop carries on: it
  // is a jump back to hear one line again, not leaving. A chapter whose loop was stopped picks it
  // back up the same way.
  const segment = loop?.button === loopToggle ? loop : chapter ? loopFieldRange() : null;
  if (segment && start >= segment.start - 0.05 && end <= segment.end + 0.05) {
    if (loop?.button !== loopToggle) startLoop(segment.start, segment.end, Infinity, loopToggle);
    audio.currentTime = start;
    audio.play();
    return;
  }
  stopLoop();
  audio.currentTime = start;
  audio.play();
});

addEventListener('scroll', () => { lastManualScrollAt = Date.now(); }, { passive: true });

// The bar is fixed over the bottom of the page, and its height changes with the screen width and the
// word card. The page keeps exactly that much room under the last line, so no line ends up beneath it.
const playerBar = /** @type {HTMLElement} */ (document.querySelector('.player'));
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--player-height', `${playerBar.offsetHeight}px`);
}).observe(playerBar);

for (const [id, onlyStoryteller] of [['filter-all', false], ['filter-storyteller', true]]) {
  $(/** @type {string} */ (id)).addEventListener('click', () => {
    cueBox.classList.toggle('only-storyteller', /** @type {boolean} */ (onlyStoryteller));
    $('filter-all').setAttribute('aria-pressed', String(!onlyStoryteller));
    $('filter-storyteller').setAttribute('aria-pressed', String(onlyStoryteller));
  });
}

/** Copies what is on screen, so the filter decides whether the narrator's lines come along. */
$('copy').addEventListener('click', async (event) => {
  const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
  const skipNarrator = cueBox.classList.contains('only-storyteller');
  const text = cues
    .filter((cue) => !(skipNarrator && cue.role === 'narrator'))
    .map((cue) => cue.text)
    .join('\n');

  try {
    await navigator.clipboard.writeText(text);
    flash(button, `Đã copy ${text.split('\n').length} câu`);
  } catch {
    // Clipboard access needs https or localhost; opening the file directly lands here.
    flash(button, 'Trình duyệt chặn copy');
  }
});

/** Swaps a button's label for a moment, then puts it back. */
function flash(/** @type {HTMLButtonElement} */ button, /** @type {string} */ message) {
  const original = button.dataset.label ?? button.textContent ?? '';
  button.dataset.label = original;
  button.textContent = message;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => { button.textContent = original; }, COPY_FEEDBACK_MS));
}

/** An Anki card links straight to one sentence: ?ep=…&start=…&end=…&loop=10 */
function applyDeepLink() {
  const start = Number(params.get('start'));
  if (!params.has('start') || Number.isNaN(start)) return;

  const end = Number(params.get('end')) || start + 6;
  const times = Number(params.get('loop')) || 1;

  // Safari and mobile refuse play() without a gesture; the controls are right there if it does.
  audio.addEventListener('loadedmetadata', () => startLoop(start, end, chapter ? Infinity : times, loopToggle), { once: true });
}

// ---------- playback speed (remembered across episodes, for slow-listen study) ----------

const SPEED_STORAGE_KEY = 'ci-playback-rate';
const speedButtons = [...document.querySelectorAll('.speed')];

function setRate(/** @type {number} */ rate) {
  // Loading a source resets the speed to the default one, and the remembered speed is set before
  // the episode's source is: as the default too, it survives the load.
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  for (const button of speedButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === rate));
  }
  localStorage.setItem(SPEED_STORAGE_KEY, String(rate));
}

for (const button of speedButtons) {
  button.addEventListener('click', () => setRate(Number(button.dataset.rate)));
}

const savedRate = Number(localStorage.getItem(SPEED_STORAGE_KEY));
if (savedRate) setRate(savedRate);

// ---------- repeat the whole episode (off by default, never remembered) ----------

$('repeat-episode').addEventListener('click', (event) => {
  repeatEpisode = !repeatEpisode;
  /** @type {HTMLElement} */ (event.currentTarget).setAttribute('aria-pressed', String(repeatEpisode));
  syncRepeat();
});

// ---------- reading size (remembered across episodes, bigger for tired eyes) ----------

const FONT_STORAGE_KEY = 'ci-zh-font-size';
const FONT_SIZES = [15, 17, 19, 22, 25, 29, 33, 38];
const DEFAULT_FONT_SIZE = 19;
const fontSmaller = /** @type {HTMLButtonElement} */ ($('font-smaller'));
const fontLarger = /** @type {HTMLButtonElement} */ ($('font-larger'));
let fontSize = DEFAULT_FONT_SIZE;

function setFontSize(/** @type {number} */ size) {
  fontSize = size;
  document.documentElement.style.setProperty('--zh-size', `${size}px`);
  fontSmaller.disabled = size <= FONT_SIZES[0];
  fontLarger.disabled = size >= FONT_SIZES[FONT_SIZES.length - 1];
  localStorage.setItem(FONT_STORAGE_KEY, String(size));
}

/** Resizing reflows every line above, so keep the line being heard where it was on screen. */
function stepFontSize(/** @type {number} */ step) {
  const index = FONT_SIZES.indexOf(fontSize) + step;
  if (index < 0 || index >= FONT_SIZES.length) return;
  holdLineInPlace(() => setFontSize(FONT_SIZES[index]));
}

fontSmaller.addEventListener('click', () => stepFontSize(-1));
fontLarger.addEventListener('click', () => stepFontSize(1));

const savedFontSize = Number(localStorage.getItem(FONT_STORAGE_KEY));
setFontSize(FONT_SIZES.includes(savedFontSize) ? savedFontSize : DEFAULT_FONT_SIZE);

// ---------- loop segment (hand-picked start/end, kept in the URL to share or bookmark) ----------

const loopStartInput = /** @type {HTMLInputElement} */ ($('loop-start'));
const loopEndInput = /** @type {HTMLInputElement} */ ($('loop-end'));
const loopToggle = /** @type {HTMLButtonElement} */ ($('loop-toggle'));
const loopClear = /** @type {HTMLButtonElement} */ ($('loop-clear'));

/**
 * Accepts "1:23", "1:23.4" or bare seconds. A phone's number pad has no ":", so "." or ","
 * stands in for it: "1.23.4" is 1:23.4, and "1.23" (two digits after) is 1:23 while "83.4"
 * stays 83.4 seconds. Null when the text isn't a time.
 */
function parseTimeField(/** @type {string} */ text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[:.,]/);
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;

  const [first, second, third] = parts;
  if (parts.length === 1) return Number(first);
  if (parts.length === 2 && !trimmed.includes(':') && second.length !== 2) return Number(`${first}.${second}`);

  const seconds = Number(third === undefined ? second : `${second}.${third}`);
  return seconds < 60 ? Number(first) * 60 + seconds : null;
}

/** One decimal place, so a phrase a fraction of a second long can still be trimmed precisely. */
function formatTimeField(/** @type {number} */ seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Null unless both fields hold a real, ordered range. */
function loopFieldRange() {
  const start = parseTimeField(loopStartInput.value);
  const end = parseTimeField(loopEndInput.value);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

/** Re-validates the fields, live-updates a loop already in progress, and syncs the URL. */
function refreshLoopBar() {
  const startText = loopStartInput.value.trim();
  const endText = loopEndInput.value.trim();
  const start = parseTimeField(startText);
  const end = parseTimeField(endText);
  const range = start !== null && end !== null && end > start ? { start, end } : null;

  loopStartInput.setAttribute('aria-invalid', String(startText !== '' && start === null));
  loopEndInput.setAttribute('aria-invalid', String(endText !== '' && (end === null || (start !== null && end <= start))));
  loopToggle.disabled = !range;
  loopClear.hidden = !startText && !endText;
  syncChapter(range);

  if (range && loop?.button === loopToggle) {
    loop.start = range.start;
    loop.end = range.end;
  }

  const url = new URL(location.href);
  if (range) {
    url.searchParams.set('start', String(Math.round(range.start * 10) / 10));
    url.searchParams.set('end', String(Math.round(range.end * 10) / 10));
  } else {
    url.searchParams.delete('start');
    url.searchParams.delete('end');
  }
  history.replaceState(null, '', url);
}

for (const input of [loopStartInput, loopEndInput]) {
  input.addEventListener('change', () => {
    // Echo what was understood, so "1.23" visibly becomes 1:23.0 rather than 1.23 seconds.
    const seconds = parseTimeField(input.value);
    if (seconds !== null) input.value = formatTimeField(seconds);
    refreshLoopBar();
  });
}

$('loop-start-now').addEventListener('click', () => {
  loopStartInput.value = formatTimeField(audio.currentTime);
  refreshLoopBar();
});

$('loop-end-now').addEventListener('click', () => {
  loopEndInput.value = formatTimeField(audio.currentTime);
  refreshLoopBar();
});

loopToggle.addEventListener('click', () => {
  if (loop?.button === loopToggle) {
    stopLoop();
    return;
  }
  const range = loopFieldRange();
  if (range) startLoop(range.start, range.end, Infinity, loopToggle);
});

loopClear.addEventListener('click', () => {
  if (loop?.button === loopToggle) stopLoop();
  loopStartInput.value = '';
  loopEndInput.value = '';
  refreshLoopBar();
});

function initLoopBar() {
  const start = Number(params.get('start'));
  const end = Number(params.get('end'));
  if (params.has('start') && !Number.isNaN(start)) loopStartInput.value = formatTimeField(start);
  if (params.has('end') && !Number.isNaN(end)) loopEndInput.value = formatTimeField(end);
  refreshLoopBar();
}

initLoopBar();

// ---------- extension bridge ----------

function announce(/** @type {string} */ type, /** @type {object} */ payload) {
  postMessage({ __ci: CHANNEL, type, ...payload }, location.origin);
}

const TRACKS = [{ languageCode: CUE_LANG, name: '中文', kind: 'asr' }];

addEventListener('message', (event) => {
  if (event.source !== window || event.data?.__ci !== REQUEST) return;

  if (event.data.type === 'tracks') announce('tracks', { active: CUE_LANG, tracks: TRACKS });
  if (event.data.type === 'resend') announce('cues', { lang: CUE_LANG, cues });
  if (event.data.type === 'setTrack') {
    const ok = event.data.lang === CUE_LANG;
    announce('setTrack', { lang: event.data.lang, ok, reason: ok ? '' : 'Tập này chỉ có bản tiếng Trung.' });
    if (ok) announce('cues', { lang: CUE_LANG, cues });
  }
});

meterListening(audio, 'player', {
  where: (position) => ({
    ep: episode.id,
    start: chapters.find((c) => position >= floorTenth(c.start) && position < ceilTenth(c.end))?.start ?? null,
  }),
});
await load();
