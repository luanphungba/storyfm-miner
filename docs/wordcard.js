// @ts-check
// A word tapped in a line for its meaning, the same on the player and on Nghe lại: the spans a line is
// cut into, the card that answers the tap, and the tap itself, which the server keeps (taps.js).
//
// Chinese runs together, so a tap has to know where the word it landed in begins and ends. The
// browser cannot work that out: its own segmenter splits 互联网 into 互/联/网 and 面试官 into
// 面试/官. The spans are therefore cut offline by jieba (tools/build_tokens.py) and only rendered here.

import { levelLabel } from './hsk.js';
import { savedConnection } from './server.js';
import { strokeToggle } from './strokes.js';
import { recordTap, tapNote } from './taps.js';

/** @typedef {ReturnType<typeof import('./examples.js').initExamples>} Examples */

/** A line as word spans and the punctuation between them, from its tokens: each [start, length, band,
 * count, isName], as the episode's .tok.json lists them. */
export function wordSpans(/** @type {string} */ text, /** @type {number[][]} */ tokens) {
  /** @type {(HTMLElement | string)[]} */
  const parts = [];
  let at = 0;
  for (const [start, length, band, count, isName] of tokens) {
    if (start > at) parts.push(text.slice(at, start));
    const word = document.createElement('span');
    word.className = 'w';
    word.textContent = text.slice(start, start + length);
    // Carried on the span so the card can answer "how common is this, and is it worth a card?"
    // without going back to the token file for every tap.
    if (band) word.dataset.band = String(band);
    if (isName) word.dataset.name = '1';
    word.dataset.count = String(count);
    parts.push(word);
    at = start + length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/**
 * Fills the card for a tapped word span: the word and its strokes, its reading and Hán Việt, its
 * meaning, how common it is and the other lines it is said in, the days it was tapped on, and beside
 * the word the page's actions and a ✕.
 *
 * The card sits above the audio bar rather than floating by the word: on a phone a tooltip next to
 * the text either covers the line being read or lands off-screen, and the reader is looking down at
 * the controls anyway.
 * @param {HTMLElement} card
 * @param {HTMLElement} span
 * @param {{ gloss: Record<string, string[]> | null, here: { ep: string, cue: number }, examples: Examples,
 *   countTap: () => HTMLElement | null, actions: () => HTMLElement[], close: () => void }} parts
 *   here — the line the word was tapped in; countTap — sends the tap, and gives its line on the card;
 *   actions — the page's own buttons, before the ✕
 */
export function fillCard(card, span, { gloss, here, examples, countTap, actions, close }) {
  const word = span.textContent ?? '';
  const [reading, hanviet, meaning] = gloss?.[word] ?? [];
  card.classList.remove('is-mining');
  card.innerHTML = '';
  const line = (/** @type {string} */ className, /** @type {string} */ text) => {
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
  // Strokes open under the meaning, not after the lines below it: those can run a screen long.
  if (strokes) card.append(strokes.panel);

  // How much of spoken Chinese this word buys (hsk.js).
  const level = levelLabel(Number(span.dataset.band ?? 0), Boolean(span.dataset.name));
  const seen = examples.toggle(word, Number(span.dataset.count), here);
  line('g-meta', `${level} · `);
  card.lastElementChild?.append(seen?.button ?? 'chỉ gặp ở câu này');
  const taps = countTap();
  if (taps) card.append(taps);
  if (seen) card.append(seen.panel);
  const row = document.createElement('div');
  row.className = 'g-actions';
  const closeButton = document.createElement('button');
  closeButton.className = 'g-close';
  closeButton.type = 'button';
  closeButton.textContent = '✕';
  closeButton.setAttribute('aria-label', 'Đóng và nghe tiếp');
  closeButton.onclick = close;
  row.append(...actions(), closeButton);
  // The word and the way out share a row that stays put while the rest of the card scrolls.
  const head = document.createElement('div');
  head.className = 'g-head';
  head.append(/** @type {HTMLElement} */ (card.firstElementChild), row);
  card.prepend(head);
  card.hidden = false;
  card.scrollTop = 0;
}

/**
 * Every tap is a lookup the server keeps: the card says on how many days the word has needed one,
 * and from the third that it may be worth a card. The tap is sent at once and the line filled in when
 * the server has counted it, if the card still shows the word. Without a server there is no line.
 * @param {{ word: string, ep: string, at: number }} tap  `at`, the start of the line tapped in
 * @param {{ cardsWanted: boolean, showing: () => boolean, counted: () => void }} options
 *   cardsWanted — whether a stubborn word is worth a card here (taps.js); counted — once the server has it
 */
export function countedTap(tap, { cardsWanted, showing, counted }) {
  const connection = savedConnection();
  if (!connection) return null;
  const note = document.createElement('div');
  note.className = 'g-taps';
  note.hidden = true;
  recordTap(connection, tap)
    .then((count) => {
      if (count) counted();
      if (!count || !showing()) return;
      const { text, stubborn } = tapNote(count, cardsWanted);
      note.textContent = text;
      note.classList.toggle('is-stubborn', stubborn);
      note.hidden = false;
    })
    .catch(() => {
      // Kept unsent; the next tap sends it.
    });
  return note;
}
