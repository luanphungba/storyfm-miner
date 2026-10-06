// Stroke order for the looked-up word (Hanzi Writer, the same build the CI Miner extension ships).
// Nothing here loads until the reader asks for it: the library on first open, each character's
// stroke data (2-5 KB from jsdelivr) as that character is drawn.

const HAN = /\p{Script=Han}/u;
const OPEN_KEY = 'storyfm.strokes';
const DATA_URL = (/** @type {string} */ char) =>
  `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(char)}.json`;

/** @type {Promise<any> | null} */
let libLoaded = null;

function loadLib() {
  libLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/hanzi-writer.min.js';
    script.onload = () => resolve(/** @type {any} */ (window).HanziWriter);
    script.onerror = () => { libLoaded = null; reject(new Error('hanzi-writer')); };
    document.head.append(script);
  });
  return libLoaded;
}

/** Stroke data per character, kept for the session so a word looked up twice is not fetched twice. */
const charData = new Map();

function loadChar(/** @type {string} */ char) {
  if (!charData.has(char)) {
    const pending = fetch(DATA_URL(char)).then((r) => {
      if (!r.ok) throw new Error(char);
      return r.json();
    });
    pending.catch(() => charData.delete(char));
    charData.set(char, pending);
  }
  return charData.get(char);
}

function rememberOpen(/** @type {boolean} */ on) {
  try { localStorage.setItem(OPEN_KEY, on ? '1' : ''); } catch {}
}

function wasOpen() {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/**
 * The ✍ button beside the headword and the panel it opens. Open stays open for the next word too:
 * someone practising characters wants every lookup drawn, someone just listening never sees it.
 * A list of words passes `remember: false`, as every word in it open at once would draw them all.
 * @param {string} word
 * @param {{ remember?: boolean }} [options]
 * @returns {{ button: HTMLButtonElement, panel: HTMLElement } | null}
 */
export function strokeToggle(word, { remember = true } = {}) {
  const chars = [...word].filter((c) => HAN.test(c));
  if (!chars.length) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g-strokes-toggle';
  button.textContent = '✍';
  button.title = 'Thứ tự nét';
  button.setAttribute('aria-label', 'Thứ tự nét');

  const panel = document.createElement('div');
  panel.className = 'g-strokes';
  panel.hidden = true;

  const set = (/** @type {boolean} */ on) => {
    button.setAttribute('aria-pressed', String(on));
    panel.hidden = !on;
    if (on && !panel.childElementCount) draw(panel, chars);
  };
  button.onclick = () => {
    const on = panel.hidden;
    if (remember) rememberOpen(on);
    set(on);
  };
  set(remember && wasOpen());
  return { button, panel };
}

/** @param {HTMLElement} panel @param {string[]} chars */
async function draw(panel, chars) {
  const row = document.createElement('div');
  row.className = 's-row';
  const tools = document.createElement('div');
  tools.className = 's-tools';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.textContent = '▶ Xem lại';
  const practise = document.createElement('button');
  practise.type = 'button';
  practise.textContent = '✍ Tự viết';
  const note = document.createElement('span');
  note.className = 's-note';
  tools.append(replay, practise, note);
  panel.append(row, tools);

  let HanziWriter;
  try {
    HanziWriter = await loadLib();
  } catch {
    note.textContent = 'Không tải được thư viện vẽ nét.';
    return;
  }

  const css = getComputedStyle(panel);
  const color = (/** @type {string} */ name) => css.getPropertyValue(name).trim();
  const size = 96;
  /** @type {any[]} */
  const writers = chars.map((char) => {
    const box = document.createElement('div');
    box.className = 's-char';
    box.title = 'Bấm để xem lại';
    row.append(box);
    const writer = HanziWriter.create(box, char, {
      width: size,
      height: size,
      padding: 4,
      showCharacter: false,
      showOutline: true,
      strokeColor: color('--fg'),
      outlineColor: color('--line'),
      highlightColor: color('--accent'),
      drawingColor: color('--accent'),
      radicalColor: null,
      strokeAnimationSpeed: 1.5,
      delayBetweenStrokes: 120,
      charDataLoader: (/** @type {string} */ c, /** @type {any} */ onLoad, /** @type {any} */ onError) =>
        loadChar(c).then(onLoad, onError),
      onLoadCharDataError: () => {
        writer.failed = true;
        box.classList.add('is-missing');
        box.textContent = char;
      },
    });
    box.onclick = () => { if (!quizzing && !writer.failed) writer.animateCharacter(); };
    return writer;
  });

  let run = 0;
  let quizzing = false;

  /** Characters one after another, so a two-character word reads left to right as it is written. */
  const animateAll = () => {
    const mine = ++run;
    quizzing = false;
    note.textContent = '';
    writers.forEach((w) => { if (!w.failed) { w.cancelQuiz(); w.hideCharacter(); } });
    const next = (/** @type {number} */ i) => {
      if (i >= writers.length || mine !== run || !panel.isConnected) return;
      if (writers[i].failed) return next(i + 1);
      writers[i].animateCharacter({ onComplete: () => next(i + 1) });
    };
    next(0);
  };

  /** Write each character in turn; a stroke drawn wrong three times is shown as a hint. */
  const quizAll = () => {
    const mine = ++run;
    quizzing = true;
    writers.forEach((w) => { if (!w.failed) { w.cancelQuiz(); w.hideCharacter(); } });
    const next = (/** @type {number} */ i) => {
      if (mine !== run || !panel.isConnected) return;
      if (i >= writers.length) {
        quizzing = false;
        note.textContent = 'Xong!';
        return;
      }
      if (writers[i].failed) return next(i + 1);
      note.textContent = chars.length > 1 ? `Viết chữ ${i + 1}/${chars.length}` : 'Viết vào ô';
      writers[i].quiz({ showHintAfterMisses: 3, onComplete: () => next(i + 1) });
    };
    next(0);
  };

  replay.onclick = animateAll;
  practise.onclick = quizAll;
  animateAll();
}
