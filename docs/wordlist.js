// @ts-check
// A chapter's tapped words in a dialog, to read through before hearing it again: the ones tapped on
// the most days first, each with its reading, Hán Việt and meaning as the player's word card gives
// them, and its stroke order a tap away. Opened from Nghe lại and from the player's chapter headings,
// each page carrying the dialog's markup (#words-dialog). Reading the list is not a tap: only a word
// tapped in the player says it was not caught.

import { strokeToggle } from './strokes.js';
import { STUBBORN_DAYS, byStubbornness } from './taps.js';

/** @typedef {import('./taps.js').TappedWord} TappedWord */
/** @typedef {{ ep: string, episode: string, n: number, zh: string }} Chapter  As a studied chapter carries it. */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const dialog = /** @type {HTMLDialogElement} */ ($('words-dialog'));
/** The chapter the dialog shows, so a gloss arriving after another was opened is dropped. */
/** @type {Chapter | null} */
let open = null;
/** Each episode's word glosses, the same the player's word card reads, fetched once a list needs them. */
/** @type {Map<string, Promise<Record<string, string[]>>>} */
const glosses = new Map();

function glossOf(/** @type {string} */ ep) {
  if (!glosses.has(ep)) {
    glosses.set(ep, fetch(`data/${encodeURIComponent(ep)}.gloss.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return /** @type {Promise<Record<string, string[]>>} */ (glosses.get(ep));
}

/** Opens the dialog on `tapped`, the words tapped in `chapter`. */
export async function showWords(/** @type {Chapter} */ chapter, /** @type {TappedWord[]} */ tapped) {
  const words = byStubbornness(tapped);
  open = chapter;
  $('words-title').textContent = chapter.zh;
  $('words-note').textContent = `${chapter.episode || chapter.ep} · chương ${chapter.n + 1} · ${words.length} từ, từ tra nhiều ngày nhất ở trên`;
  $('words-list').replaceChildren();
  dialog.showModal();
  const gloss = await glossOf(chapter.ep);
  if (!dialog.open || open !== chapter) return;
  $('words-list').replaceChildren(...words.map(({ word, days }) => {
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
    if (strokes) item.append(strokes.panel);
    return item;
  }));
}

$('words-close').addEventListener('click', () => dialog.close());
// A tap on the backdrop, outside the dialog's box, closes it too.
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
