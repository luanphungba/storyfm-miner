// @ts-check
// Every line a looked-up word is said in, across all the episodes, opened from the card's "gặp N
// lần". A word the ear keeps missing is easier to catch heard again in other sentences and other
// voices, so each line plays right there in the card, and its chapter is one tap away. The lines are
// filed offline by tools/build_tokens.py into docs/data/words/, so a lookup fetches one small file
// rather than every episode's transcript.

import { formatTime } from './card.js';
import { chapterLink } from './studied.js';

/** tools/build_tokens.py spreads the words over this many files, by the same sum. */
const BUCKETS = 64;
const OPEN_KEY = 'storyfm.examples';
/** Between two lines played in a row, so one sentence is not heard running into the next. */
const GAP_MS = 700;

/** @typedef {{ ep: string, cue: number, at: number, start: number, end: number, text: string }} Line */
/** @typedef {{ title: string, audio: string }} Show */
/** @typedef {{ zh: string, start: number, end: number, from: number, to: number }} Chapter */
/** @typedef {{ ep: string, chapters: { n: number | null, lines: Line[] }[] }} EpisodeLines */

/** The file of docs/data/words a word is filed in: the sum of its code points, as the build adds it. */
export const bucket = (/** @type {string} */ word) =>
  [...word].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % BUCKETS;

/** A line as filed, [episode, cue, offset of the word, start, end, text], by name. */
export const toLine = (/** @type {any[]} */ [ep, cue, at, start, end, text]) =>
  /** @type {Line} */ ({ ep, cue, at, start, end, text });

/**
 * The lines as the list shows them: the episode on the page first, then the others as the index
 * lists them; inside each, chapter by chapter in story order. A line in no chapter — an episode
 * not cut into chapters yet — is listed under none.
 * @param {Line[]} lines  as filed: episode by episode, each in story order
 * @param {string} here   the episode on the page
 * @param {Record<string, Chapter[]>} chapters  each episode's, as its .chapters.json lists them
 * @returns {EpisodeLines[]}
 */
export function groupLines(lines, here, chapters) {
  /** @type {EpisodeLines[]} */
  const episodes = [];
  for (const line of lines) {
    let episode = episodes.at(-1);
    if (episode?.ep !== line.ep) episodes.push((episode = { ep: line.ep, chapters: [] }));
    const k = chapters[line.ep]?.findIndex((c) => c.from <= line.cue && line.cue <= c.to) ?? -1;
    const n = k < 0 ? null : k;
    let chapter = episode.chapters.at(-1);
    if (!chapter || chapter.n !== n) episode.chapters.push((chapter = { n, lines: [] }));
    chapter.lines.push(line);
  }
  return [...episodes.filter((e) => e.ep === here), ...episodes.filter((e) => e.ep !== here)];
}

/** What the list says it holds: every line, or the ones kept of a word said too often to list. */
export function countNote(/** @type {number} */ shown, /** @type {number} */ said, /** @type {number} */ episodes) {
  return `${shown < said ? `${shown} trong ${said}` : shown} câu · ${episodes} tập`;
}

function pressAll(/** @type {HTMLElement} */ button, /** @type {boolean} */ on) {
  button.setAttribute('aria-pressed', String(on));
  button.textContent = on ? '■ Dừng' : '▶ Nghe lần lượt';
}

/** Files fetched once a session; a failed one is dropped so the next lookup tries again. */
const fetched = new Map();
function fetchJson(/** @type {string} */ url) {
  if (!fetched.has(url)) {
    const pending = fetch(url).then((r) => {
      if (!r.ok) throw new Error(url);
      return r.json();
    });
    pending.catch(() => fetched.delete(url));
    fetched.set(url, pending);
  }
  return fetched.get(url);
}

function rememberOpen(/** @type {boolean} */ on) {
  try { localStorage.setItem(OPEN_KEY, on ? '1' : ''); } catch {}
}

function wasOpen() {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/**
 * The lines play on an audio element of their own, never the page's: the page keeps its place in
 * the episode, and closing the card carries on listening from where the word was tapped.
 * @param {{ audio: HTMLAudioElement, openChapter: (n: number) => void }} options
 *   audio — the page's, paused while a line plays and read for the speed it is set to;
 *   openChapter — loops a chapter of the episode already on the page
 */
export function initExamples({ audio, openChapter }) {
  const preview = new Audio();
  preview.preload = 'none';
  let loaded = '';
  /** @type {{ queue: { line: Line, src: string, button: HTMLElement }[], k: number, all: HTMLElement | null } | null} */
  let playing = null;
  let gap = 0;

  function stop() {
    clearTimeout(gap);
    preview.pause();
    if (!playing) return;
    playing.queue[playing.k].button.classList.remove('is-playing');
    if (playing.all) pressAll(playing.all, false);
    playing = null;
  }

  function playCurrent() {
    if (!playing) return;
    const { line, src, button } = playing.queue[playing.k];
    button.classList.add('is-playing');
    button.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    audio.pause();
    // Set before the file has loaded, the time is where it starts: no jump from 0:00 to the line.
    if (loaded !== src) preview.src = loaded = src;
    preview.currentTime = line.start;
    preview.defaultPlaybackRate = preview.playbackRate = audio.playbackRate;
    preview.play().catch(stop);
  }

  preview.addEventListener('timeupdate', () => {
    // Pausing fires a timeupdate of its own, still at the end of the line just heard: held against
    // the next line's end, it would skip any line earlier in its file than that. So only a line
    // still playing can end, and the next one becomes current only once the gap is over.
    if (!playing || preview.paused || preview.currentTime < playing.queue[playing.k].line.end) return;
    preview.pause();
    const { queue, k, all } = playing;
    queue[k].button.classList.remove('is-playing');
    if (!all || k + 1 >= queue.length) {
      stop();
      return;
    }
    gap = window.setTimeout(() => {
      if (!playing) return;
      playing.k += 1;
      playCurrent();
    }, GAP_MS);
  });
  // The episode played by hand, or resumed by closing the card: the line gives way.
  audio.addEventListener('play', stop);

  /** @param {HTMLElement} panel @param {string} word @param {number} said @param {{ ep: string, cue: number }} here */
  async function fill(panel, word, said, here) {
    const note = document.createElement('div');
    note.className = 'x-note';
    note.textContent = 'Đang tải các câu…';
    panel.replaceChildren(note);

    /** @type {[Record<string, any[][]>, Record<string, Show>]} */
    let files;
    try {
      files = await Promise.all([fetchJson(`data/words/${bucket(word)}.json`), fetchJson('data/words/episodes.json')]);
    } catch {
      note.textContent = 'Không tải được các câu.';
      return;
    }
    const [words, shows] = files;
    const lines = (words[word] ?? []).map(toLine);
    // Chapters come from each episode's own file, as the player reads them: they are cut after the
    // lines are filed, and recut on their own. Without one, the lines are listed all the same.
    const eps = [...new Set(lines.map((line) => line.ep))];
    /** @type {Record<string, Chapter[]>} */
    const chaptersOf = Object.fromEntries(await Promise.all(eps.map(async (ep) => [
      ep,
      await fetchJson(`data/${encodeURIComponent(ep)}.chapters.json`)
        .then((/** @type {{ chapters?: Chapter[] }} */ data) => data.chapters ?? [], () => []),
    ])));
    const groups = groupLines(lines, here.ep, chaptersOf);

    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'x-all';
    all.title = 'Nghe các câu này lần lượt, mỗi câu một lần';
    pressAll(all, false);
    note.textContent = countNote(lines.length, said, groups.length);
    const head = document.createElement('div');
    head.className = 'x-head';
    head.append(all, note);

    /** @type {{ line: Line, src: string, button: HTMLElement }[]} */
    const queue = [];
    const list = document.createElement('div');
    list.className = 'x-list';
    for (const { ep, chapters } of groups) {
      const show = shows[ep];
      if (!show) continue;
      const title = document.createElement('div');
      title.className = 'x-ep';
      title.textContent = ep === here.ep ? 'Tập đang nghe' : show.title;
      title.title = show.title;
      list.append(title);
      for (const { n, lines: inChapter } of chapters) {
        if (n !== null) list.append(chapterLine(ep, n, chaptersOf[ep][n], ep === here.ep));
        for (const line of inChapter) {
          const button = lineButton(line, word, line.ep === here.ep && line.cue === here.cue);
          queue.push({ line, src: show.audio, button });
          list.append(button);
        }
      }
    }

    const start = (/** @type {number} */ k, /** @type {boolean} */ whole) => {
      stop();
      playing = { queue, k, all: whole ? all : null };
      if (whole) pressAll(all, true);
      playCurrent();
    };
    all.onclick = () => (playing?.all === all ? stop() : start(0, true));
    queue.forEach(({ button }, k) => {
      button.onclick = () => (playing?.queue === queue && playing.k === k && !playing.all ? stop() : start(k, false));
    });
    panel.replaceChildren(head, list);
  }

  /** The chapter a run of lines is in, as a way into it: looped right here for the episode on the
   * page, in a tab of its own for another, so the chapter being studied here keeps its place. */
  function chapterLine(/** @type {string} */ ep, /** @type {number} */ n, /** @type {Chapter} */ chapter, /** @type {boolean} */ isHere) {
    const link = document.createElement(isHere ? 'button' : 'a');
    link.className = 'x-ch';
    link.textContent = `§${n + 1} ${chapter.zh}`;
    if (link instanceof HTMLAnchorElement) {
      link.href = chapterLink({ ep, start: chapter.start, end: chapter.end });
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Mở chương này ở tab mới';
      link.append(' ↗');
    } else {
      link.type = 'button';
      link.title = 'Lặp chương này';
      link.onclick = () => openChapter(n);
    }
    return link;
  }

  function lineButton(/** @type {Line} */ line, /** @type {string} */ word, /** @type {boolean} */ isHere) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `x-line${isHere ? ' is-here' : ''}`;
    button.title = 'Nghe câu này';
    const zh = document.createElement('span');
    zh.className = 'x-zh';
    zh.lang = 'zh-Hans';
    const marked = document.createElement('b');
    marked.textContent = word;
    zh.append(line.text.slice(0, line.at), marked, line.text.slice(line.at + word.length));
    const time = document.createElement('span');
    time.className = 'x-time';
    time.textContent = isHere ? 'câu này' : formatTime(line.start);
    button.append(zh, time);
    return button;
  }

  return {
    /**
     * The "gặp N lần" button for the card's meta line and the list it opens, or null for a word said
     * in no other line. Open stays open for the next word too, as the stroke panel does.
     * @param {string} word @param {number} said how often it is said across every episode
     * @param {{ ep: string, cue: number }} here the line it was tapped in
     * @returns {{ button: HTMLButtonElement, panel: HTMLElement } | null}
     */
    toggle(word, said, here) {
      stop();
      if (said < 2) return null;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'g-seen';
      button.textContent = `gặp ${said} lần trong các tập đã có`;
      const panel = document.createElement('div');
      panel.className = 'g-examples';
      const set = (/** @type {boolean} */ on) => {
        button.setAttribute('aria-expanded', String(on));
        panel.hidden = !on;
        if (on && !panel.childElementCount) fill(panel, word, said, here);
        if (!on) stop();
      };
      button.onclick = () => {
        const on = panel.hidden === true;
        rememberOpen(on);
        set(on);
      };
      set(wasOpen());
      return { button, panel };
    },
    stop,
  };
}
