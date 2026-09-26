// @ts-check
// "＋ Anki" on the word card: DeepSeek reads the tapped word in its line, the card shows what it
// found, and one more tap adds it to Anki through the server in server/miner.py. It does on any
// device what the CI Miner extension does on the desktop, and adds the same note.
//
// The server's address and token are typed in once and kept in this browser only.

import { esc, formatTime, highlight, noteData, pickSentence, plainText } from './card.js';

const STORAGE_KEY = 'ci-anki-server';
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * @typedef {{ url: string, token: string }} Connection
 * @typedef {{ word: string, marked: string, context: string[], cue: { start: number, end: number },
 *   episode: { id: string, title: string }, audioSrc: string }} WordContext
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ---------- connection ----------

/** @returns {Connection | null} */
function savedConnection() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved?.url && saved?.token ? saved : null;
  } catch {
    return null;
  }
}

/** POSTs to the server and returns its JSON, or throws with a message worth showing. */
async function call(/** @type {Connection} */ connection, /** @type {string} */ path, body = {}) {
  let response;
  try {
    response = await fetch(connection.url.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('Không kết nối được server Anki.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Server trả lỗi ${response.status}.`);
  return payload;
}

// ---------- pinyin (only fetched once a word is mined: it is the heaviest file on the page) ----------

/** @type {Promise<((text: string) => string)> | null} */
let pinyinLoaded = null;

function loadPinyin() {
  pinyinLoaded ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'vendor/pinyin-pro.js';
    script.onload = () => {
      const { pinyin } = /** @type {any} */ (window).pinyinPro;
      resolve((text) => (/\p{Script=Han}/u.test(text) ? pinyin(text, { nonZh: 'consecutive' }) : ''));
    };
    // A card without pinyin rows beats no card at all.
    script.onerror = () => resolve(() => '');
    document.head.append(script);
  });
  return pinyinLoaded;
}

// ---------- miner ----------

/**
 * @param {{ card: HTMLElement, close: () => void, playLine: (cue: { start: number, end: number }) => void }} options
 */
export function initMiner({ card, close, playLine }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('anki-dialog'));
  const urlInput = /** @type {HTMLInputElement} */ ($('anki-url'));
  const tokenInput = /** @type {HTMLInputElement} */ ($('anki-token'));
  const dialogStatus = $('anki-status');
  const settingsChip = $('anki-settings');
  /** Runs once the dialog has connected, so tapping ＋ before setting up carries straight on. */
  /** @type {(() => void) | null} */
  let afterConnect = null;

  function showConnected() {
    settingsChip.textContent = savedConnection() ? 'Anki ✓' : 'Anki';
  }

  function openDialog(/** @type {(() => void) | null} */ then = null) {
    const saved = savedConnection();
    urlInput.value = saved?.url ?? '';
    tokenInput.value = saved?.token ?? '';
    dialogStatus.textContent = '';
    dialogStatus.className = 'anki-status';
    $('anki-forget').hidden = !saved;
    afterConnect = then;
    dialog.showModal();
  }

  $('anki-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const connection = { url: urlInput.value.trim(), token: tokenInput.value.trim() };
    const save = /** @type {HTMLButtonElement} */ ($('anki-save'));
    save.disabled = true;
    dialogStatus.className = 'anki-status';
    dialogStatus.textContent = 'Đang kiểm tra…';
    try {
      const health = await call(connection, '/health');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
      showConnected();
      dialogStatus.className = 'anki-status is-ok';
      dialogStatus.textContent = `✓ Đã kết nối · ${health.deck} · ${health.notes} thẻ`;
      setTimeout(() => {
        dialog.close();
        afterConnect?.();
      }, 700);
    } catch (err) {
      dialogStatus.className = 'anki-status is-error';
      dialogStatus.textContent = /** @type {Error} */ (err).message;
    } finally {
      save.disabled = false;
    }
  });

  $('anki-cancel').addEventListener('click', () => dialog.close());
  $('anki-forget').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    showConnected();
    dialog.close();
  });
  settingsChip.addEventListener('click', () => openDialog());
  showConnected();

  // ---------- one word ----------

  /** A word already in Anki is shown from its own card, at once and without a token; only a new
   * word goes to DeepSeek. The check uses the word as tapped, so a card saved as a longer phrase is
   * still found, one step later, by the lookup itself. */
  async function mine(/** @type {WordContext} */ ctx) {
    const connection = savedConnection();
    if (!connection) return openDialog(() => mine(ctx));

    const marker = showLoading(ctx, 'Đang xem trong Anki…');
    try {
      const { card: saved } = await call(connection, '/peek', { word: ctx.word });
      if (!card.contains(marker)) return;
      if (saved) showSaved(connection, ctx, saved);
      else await ask(connection, ctx);
    } catch (err) {
      showError(marker, /** @type {Error} */ (err), () => mine(ctx));
    }
  }

  async function ask(/** @type {Connection} */ connection, /** @type {WordContext} */ ctx) {
    const marker = showLoading(ctx, 'DeepSeek đang đọc câu…');
    const pinyin = loadPinyin();
    try {
      const lookup = await call(connection, '/lookup', {
        selected: ctx.word, marked: ctx.marked, context: ctx.context, title: ctx.episode.title,
      });
      const py = await pinyin;
      if (card.contains(marker)) showLookup(connection, ctx, lookup, py);
    } catch (err) {
      showError(marker, /** @type {Error} */ (err), () => ask(connection, ctx));
    }
  }

  /** Returns the element that goes away once the card shows something else — another word, or the
   * answer — so a late reply can tell it has nowhere to go. */
  function showLoading(/** @type {WordContext} */ ctx, /** @type {string} */ message) {
    card.classList.add('is-mining');
    card.innerHTML = `
      ${head(ctx.word)}
      <div class="m-loading">${esc(message)}</div>
      <div class="m-zh">${esc(ctx.marked).replace('【', '<b>').replace('】', '</b>')}</div>`;
    bindClose();
    return card.firstElementChild;
  }

  function showError(/** @type {Element | null} */ marker, /** @type {Error} */ err, /** @type {() => void} */ retry) {
    if (card.contains(marker)) card.querySelector('.m-loading')?.replaceWith(errorLine(err.message, retry));
  }

  /** The saved card, read back. Relearning keeps it as it is; for the line on screen to go onto the
   * card it needs a translation, which is what "Hỏi DeepSeek" is for. */
  function showSaved(/** @type {Connection} */ connection, /** @type {WordContext} */ ctx, /** @type {Record<string, string>} */ fields) {
    const field = (/** @type {string} */ name) => plainText(fields[name] ?? '');
    const word = field('Word');
    const saved = field('Sentence');
    const line = ctx.marked.replace(/[【】]/g, '');
    const strip = (/** @type {string} */ text) => text.replace(/[\s\p{P}]/gu, '');
    const heardHere = strip(saved) === strip(line);

    card.innerHTML = `
      ${head(word, [field('Pinyin'), field('HanViet')].filter(Boolean).join('   ·   '), field('Level'), field('Level') === 'ngoài HSK')}
      <div class="m-meaning">
        ${field('PartOfSpeech') ? `<span class="m-pos">${esc(field('PartOfSpeech'))}</span>` : ''}
        <span>${esc(field('Meaning'))}</span>
      </div>
      ${field('OtherMeanings') ? `<div class="m-other">${esc(field('OtherMeanings'))}</div>` : ''}
      ${field('Notes') ? `<div class="m-notes">💡 ${esc(field('Notes'))}</div>` : ''}
      ${heardHere
        ? section(lineLabel(ctx), saved, word, field('SentencePinyin'), field('SentenceMeaning'))
        : section(lineLabel(ctx), line, word) + (saved ? section('Câu trên thẻ', saved, word, field('SentencePinyin'), field('SentenceMeaning')) : '')}
      ${field('Example') ? section('Ví dụ', field('Example'), word, field('ExamplePinyin'), field('ExampleMeaning')) : ''}
      <div class="m-actions">
        <button class="m-add" type="button">↺ Học lại</button>
        <button class="m-ask" type="button" title="Giải nghĩa theo câu đang nghe và đưa câu này lên thẻ">🔄 Hỏi DeepSeek</button>
        <span class="m-status">📇 Từ thẻ Anki · 0 token</span>
      </div>`;
    bindClose();
    bindPlay(ctx);
    /** @type {HTMLElement} */ (card.querySelector('.m-ask')).onclick = () => ask(connection, ctx);
    bindSave('Đang cập nhật…', async () => {
      await call(connection, '/relearn', { word });
      return ['✓ Đã đưa về học lại', 'Thẻ giữ nguyên câu cũ'];
    });
  }

  function showLookup(/** @type {Connection} */ connection, /** @type {WordContext} */ ctx, /** @type {any} */ d, /** @type {(text: string) => string} */ py) {
    const word = d.word || ctx.word;
    const sentence = pickSentence(d.sentence, ctx.marked, word);
    const example = d.example ?? {};
    const existing = d.existing ?? [];

    card.innerHTML = `
      ${head(word, [d.pinyin || py(word), d.hanViet].filter(Boolean).join('   ·   '), d.level, d.levelTag === 'HSK::none')}
      <div class="m-meaning">
        ${d.pos ? `<span class="m-pos">${esc(d.pos)}</span>` : ''}
        <span class="m-edit" contenteditable="plaintext-only" spellcheck="false" title="Sửa được trước khi thêm">${esc(d.meaning)}</span>
      </div>
      ${d.otherMeanings?.length ? `<div class="m-other">${esc(d.otherMeanings.join('; '))}</div>` : ''}
      ${d.notes ? `<div class="m-notes">💡 ${esc(d.notes)}</div>` : ''}
      ${section(lineLabel(ctx), sentence, word, py(sentence), d.sentenceTranslation)}
      ${example.zh ? section('Ví dụ', example.zh, word, py(example.zh), example.translation) : ''}
      <div class="m-actions">
        <button class="m-add" type="button">${existing.length ? '↺ Học lại + dùng câu này' : '＋ Thêm vào Anki'}</button>
        <span class="m-status">${existing.length ? 'Đã có trong Anki' : ''}</span>
      </div>`;
    bindClose();
    bindPlay(ctx);

    bindSave(existing.length ? 'Đang cập nhật…' : 'Đang thêm…', async () => {
      // The meaning is editable, so the card takes what is on screen, not what came back.
      const meaning = card.querySelector('.m-edit')?.textContent?.trim() || d.meaning || '';
      const note = noteData({ lookup: d, word, meaning, sentence, episode: ctx.episode, cue: ctx.cue, audioSrc: ctx.audioSrc, py });
      if (existing.length) {
        const { updated } = await call(connection, '/relearn', { word, ...note });
        return ['✓ Đã đưa về học lại', updated ? 'Thẻ đã đổi sang câu này' : 'Thẻ ở note type khác nên giữ nguyên'];
      }
      const { deck } = await call(connection, '/add', note);
      return ['✓ Đã thêm vào Anki', deck];
    });
  }

  const lineLabel = (/** @type {WordContext} */ ctx) =>
    `Trong tập · ${formatTime(ctx.cue.start)} <button class="m-play" type="button">▶ Nghe</button>`;

  /** One sentence block: label (trusted markup), the line with word in bold, and its two glosses. */
  function section(/** @type {string} */ label, /** @type {string} */ zh, /** @type {string} */ word, py = '', translation = '') {
    return `
      <section class="m-sec">
        <div class="m-label">${label}</div>
        <div class="m-zh">${highlight(zh, word)}</div>
        ${py ? `<div class="m-py">${esc(py)}</div>` : ''}
        ${translation ? `<div class="m-tr">${esc(translation)}</div>` : ''}
      </section>`;
  }

  function bindPlay(/** @type {WordContext} */ ctx) {
    /** @type {HTMLElement} */ (card.querySelector('.m-play')).onclick = () => playLine(ctx.cue);
  }

  /** Wires the main button to one write to Anki: busy while it runs, then [button text, status]. */
  function bindSave(/** @type {string} */ busy, /** @type {() => Promise<[string, string]>} */ write) {
    const button = /** @type {HTMLButtonElement} */ (card.querySelector('.m-add'));
    const status = /** @type {HTMLElement} */ (card.querySelector('.m-status'));
    button.onclick = async () => {
      const label = button.textContent;
      button.disabled = true;
      button.textContent = busy;
      status.className = 'm-status';
      status.textContent = '';
      try {
        [button.textContent, status.textContent] = await write();
        button.classList.add('is-done');
      } catch (err) {
        button.disabled = false;
        button.textContent = label;
        status.className = 'm-status is-error';
        status.textContent = /** @type {Error} */ (err).message;
      }
    };
  }

  function head(/** @type {string} */ word, reading = '', level = '', offList = false) {
    return `
      <div class="m-head">
        <div class="m-word">${esc(word)}</div>
        ${level ? `<span class="m-level${offList ? ' is-off' : ''}">${esc(level)}</span>` : ''}
        <button class="m-close" type="button" aria-label="Đóng">✕</button>
      </div>
      ${reading ? `<div class="m-reading">${esc(reading)}</div>` : ''}`;
  }

  function bindClose() {
    /** @type {HTMLElement} */ (card.querySelector('.m-close')).onclick = close;
  }

  function errorLine(/** @type {string} */ message, /** @type {() => void} */ retry) {
    const line = document.createElement('div');
    line.className = 'm-status is-error';
    line.textContent = `${message} `;
    const again = document.createElement('button');
    again.className = 'm-retry';
    again.type = 'button';
    again.textContent = 'Thử lại';
    again.onclick = retry;
    line.append(again);
    return line;
  }

  /** The ＋ that sits on the word card and starts all of the above. */
  function button(/** @type {WordContext} */ ctx) {
    const plus = document.createElement('button');
    plus.className = 'g-mine';
    plus.type = 'button';
    plus.textContent = '＋ Anki';
    plus.title = 'DeepSeek giải nghĩa theo câu rồi thêm vào Anki';
    plus.onclick = () => mine(ctx);
    return plus;
  }

  return { button };
}
