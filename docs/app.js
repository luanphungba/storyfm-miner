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
import { initMiner } from './miner.js';

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

/** @type {{ i: number, start: number, end: number, text: string, speaker: string, role: string }[]} */
let cues = [];
/** @type {{ id: string, title: string }} */
let episode = { id: '', title: '' };

/** Word spans and their glosses, both built offline — see tools/build_tokens.py and build_gloss.py.
 * They arrive after the transcript is already on screen: the page has to be readable without them,
 * because older episodes have no sidecar and a phone on a bad connection should still get the text. */
/** @type {number[][][] | null} */
let tokens = null;
/** @type {Record<string, string[]> | null} */
let gloss = null;
/** @type {{ start: number, end: number, left: number, button: HTMLElement | null } | null} */
let loop = null;
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
  episode = { id: data.id, title: data.title };

  document.title = data.title;
  $('title').textContent = data.title;
  $('meta').textContent = `${data.pubDate} · ${formatTime(data.duration)} · ${cues.length} câu`;

  audio.src = data.audio.m4a ?? data.audio.mp3;
  render();
  announce('cues', { lang: CUE_LANG, cues });
  applyDeepLink();
  loadWords();
}

// ---------- render ----------

function render() {
  cueBox.replaceChildren(...cues.map((cue) => {
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
  }));
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
    const host = cueBox.children[index]?.querySelector('.zh');
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
}

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
  const times = Number(span.dataset.count);
  line('g-meta', `${level} · gặp ${times} lần trong các tập đã có`);
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
  const index = [...cueBox.children].indexOf(/** @type {Element} */ (span.closest('.cue')));
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

function hideGloss() {
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
  cueBox.children[currentIndex]?.classList.remove('is-now');
  currentIndex = index;

  const row = cueBox.children[index];
  if (!row) return;
  row.classList.add('is-now');

  if (Date.now() - lastManualScrollAt > MANUAL_SCROLL_GRACE_MS) {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function startLoop(/** @type {number} */ start, /** @type {number} */ end, times = Infinity, button = null) {
  stopLoop();
  loop = { start, end, left: times, button };
  button?.setAttribute('aria-pressed', 'true');
  audio.currentTime = start;
  audio.play();
}

/** Stops the audio too: a loop switched off mid-line otherwise runs on into whatever follows,
 * and on 故事FM that is usually several seconds of outro music before the next line starts. */
function stopLoop() {
  loop?.button?.setAttribute('aria-pressed', 'false');
  loop = null;
  audio.pause();
}

audio.addEventListener('timeupdate', () => {
  if (loop && audio.currentTime >= loop.end) {
    if (loop.left <= 1) {
      stopLoop();
    } else {
      loop.left -= 1;
      audio.currentTime = loop.start;
    }
  }
  highlight(indexAt(audio.currentTime));
});

// ---------- interaction ----------

cueBox.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const row = /** @type {HTMLElement | null} */ (target.closest('.cue'));
  if (!row) return;

  const start = Number(row.dataset.ciStart);
  const end = Number(row.dataset.ciEnd);

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
  stopLoop();
  audio.currentTime = start;
  audio.play();
});

addEventListener('scroll', () => { lastManualScrollAt = Date.now(); }, { passive: true });

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
  audio.addEventListener('loadedmetadata', () => startLoop(start, end, times, loopToggle), { once: true });
}

// ---------- playback speed (remembered across episodes, for slow-listen study) ----------

const SPEED_STORAGE_KEY = 'ci-playback-rate';
const speedButtons = [...document.querySelectorAll('.speed')];

function setRate(/** @type {number} */ rate) {
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
  const anchor = cueBox.querySelector('.cue.is-now');
  const before = anchor?.getBoundingClientRect().top;
  setFontSize(FONT_SIZES[index]);
  if (anchor && before !== undefined) scrollBy(0, anchor.getBoundingClientRect().top - before);
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

/** Accepts "1:23", "1:23.4" or bare seconds; null when the text isn't a time. */
function parseTimeField(/** @type {string} */ text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length > 2 || parts.some((part) => part === '')) return null;

  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;

  return parts.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0];
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
  input.addEventListener('change', refreshLoopBar);
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

await load();
