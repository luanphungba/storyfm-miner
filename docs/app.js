// @ts-check
// The listening page: audio at the bottom, transcript above it, the line being spoken lit up.
//
// It also speaks the CI Chinese extension's cue protocol. That extension is site-agnostic — it
// already drives a bare media element and takes cues over postMessage, which is exactly how it
// works on bilibili — so answering the same messages here is the whole integration. The .cue/.zh
// markup is what its site adapter selects on, and it maps a selection back to a cue by DOM
// position, so the rendered order must always match the cues array. Filtering therefore hides
// cues with CSS rather than removing them.

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
    row.dataset.i = String(cue.i);
    row.dataset.start = String(cue.start);
    row.dataset.end = String(cue.end);

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

function stopLoop() {
  loop?.button?.setAttribute('aria-pressed', 'false');
  loop = null;
}

audio.addEventListener('timeupdate', () => {
  if (loop && audio.currentTime >= loop.end) {
    if (loop.left <= 1) {
      stopLoop();
      audio.pause();
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

  const start = Number(row.dataset.start);
  const end = Number(row.dataset.end);

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
  audio.addEventListener('loadedmetadata', () => startLoop(start, end, times), { once: true });
}

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
