// @ts-check
// The listening page: audio at the bottom, transcript above it, the line being spoken lit up.
//
// It also broadcasts its cues over postMessage for a local browser extension that turns a selected
// word into a flashcard. That extension is site-agnostic — it drives a bare media element and takes
// cues over this same message shape elsewhere — so answering these messages is the whole
// integration. It selects on the .cue/.zh markup below and maps a selection back to a cue by DOM
// position, so the rendered order must always match the cues array. Filtering therefore hides cues
// with CSS rather than removing them.

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
/** @type {{ start: number, end: number, left: number, button: HTMLElement | null } | null} */
let loop = null;
let currentIndex = -1;
let lastManualScrollAt = 0;

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

  const episode = await response.json();
  cues = episode.cues;

  document.title = episode.title;
  $('title').textContent = episode.title;
  $('meta').textContent = `${episode.pubDate} · ${formatTime(episode.duration)} · ${cues.length} câu`;

  audio.src = episode.audio.m4a ?? episode.audio.mp3;
  render();
  announce('cues', { lang: CUE_LANG, cues });
  applyDeepLink();
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
