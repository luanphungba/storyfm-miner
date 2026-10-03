// @ts-check
// An app's interface as an episode: every line a screen shows, read aloud, so the words of a phone
// used all day become something to listen to and loop like any other episode.
//
// The text comes from the device, not from memory. A list written from memory got pages wrong — it
// had items the phone does not show and missed ones it does — so a UI test walks the app on the phone
// and reads each page off the accessibility tree, and every line is matched to the app's own
// localization tables for its English and Vietnamese. data/ui/<id>.json keeps what came out; a line
// those tables do not hold is translated by hand and marked `source: 'self'`.
//
// There is no recording to transcribe, so the audio is made: a TTS voice reads each piece (a line, or
// a long line's cuts) and tools/ui.mjs lays the clips out on one timeline. Each piece is read twice,
// then left silent as long as it takes to say it back — heard, heard again, shadowed.
//
// A chapter is one screen, as it is opened on the phone, and carries that screen's screenshots: each
// line keeps where the walk read it (`at`), so the page can show the screen and frame the line heard.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { paths } from './paths.js';
import { MAX_LINES } from './translations.js';

/** Seconds: between the two readings, added to the piece's own length for saying it back, and before a new page. */
export const PACE = { again: 0.6, sayBack: 0.8, page: 1.5 };

/** A self-translated line says so on the page: Apple's wording is the reference, ours is a stand-in. */
export const SELF_MARK = '✎ ';

/**
 * @typedef {{ shot: string, box: number[] }} Place
 *   The screenshot a line was read from, and its frame there `[x, y, width, height]` in screen points.
 * @typedef {{ zh: string, vi: string, en: string, source: 'apple' | 'self', cuts?: string[], at?: Place }} UiLine
 *   `cuts` tile `zh` in order when the line is too long to mine or loop as one.
 * @typedef {{ zh: string, vi: string, en: string, parent?: string, lines: UiLine[] }} UiPage
 *   `parent` names the screen this one opens from, when that is not Settings itself.
 * @typedef {{ id: string, title: string, summary: string[], screen: { width: number, height: number }, pages: UiPage[] }} UiContent
 * @typedef {{ id: string, title: string, owner: string, pubDate: string, duration: number, m4a?: string }} UiEpisode
 * @typedef {{ text: string, s: number, page: number }} Piece
 *   `s` is the line the piece belongs to — the unit a translation is written against.
 * @typedef {{ i: number, s: number, start: number, end: number, text: string, speaker: string, role: string }} Cue
 * @typedef {{ clip: number } | { silence: number }} Step
 */

/** The interfaces added, as episodes the index and the CLI list with the rest. */
export async function loadUiEpisodes() {
  if (!existsSync(paths.ui)) return [];
  /** @type {{ episodes: UiEpisode[] }} */
  const { episodes } = JSON.parse(await readFile(paths.ui, 'utf8'));
  return episodes.map((episode) => ({ ...episode, guid: episode.id, source: /** @type {const} */ ('ui') }));
}

/** @returns {Promise<UiContent>} */
export async function loadContent(/** @type {string} */ id) {
  return JSON.parse(await readFile(paths.uiContent(id), 'utf8'));
}

/**
 * Every piece read aloud, in order: a line's cuts, or the line itself.
 * @param {UiPage[]} pages
 * @returns {Piece[]}
 */
export function piecesOf(pages) {
  /** @type {Piece[]} */
  const pieces = [];
  let s = 0;
  pages.forEach((page, p) => {
    for (const line of page.lines) {
      if (line.cuts && line.cuts.join('') !== line.zh) throw new Error(`Các đoạn cắt không ghép lại thành "${line.zh}".`);
      for (const text of line.cuts ?? [line.zh]) pieces.push({ text, s, page: p });
      s += 1;
    }
  });
  return pieces;
}

/** What the voice is given: quotes and arrows are for the eye, and some voices drop what a quote opens. */
export function spoken(/** @type {string} */ text) {
  return text.replace(/[“”"「」『』]/g, '').replace(/\s*->\s*/g, '，').trim();
}

/**
 * Where each piece sits in the episode's audio, given how long each one's clip is. A cue spans both
 * readings; the silence after it belongs to no line, like the pause between two sentences of a
 * podcast, so looping a line repeats what is read and a chapter keeps the room to say it back.
 * @param {Piece[]} pieces
 * @param {number[]} durations seconds of each piece's clip
 * @param {typeof PACE} pace
 * @returns {{ cues: Cue[], plan: Step[], duration: number }}
 */
export function timeline(pieces, durations, pace = PACE) {
  /** @type {Cue[]} */
  const cues = [];
  /** @type {Step[]} */
  const plan = [];
  let t = 0;
  const rest = (/** @type {number} */ seconds) => {
    plan.push({ silence: seconds });
    t += seconds;
  };
  pieces.forEach((piece, i) => {
    if (i > 0 && piece.page !== pieces[i - 1].page) rest(pace.page);
    const length = durations[i];
    const start = t;
    plan.push({ clip: i });
    t += length;
    rest(pace.again);
    plan.push({ clip: i });
    t += length;
    cues.push({ i, s: piece.s, start: round(start), end: round(t), text: piece.text, speaker: 'A', role: 'storyteller' });
    rest(length + pace.sayBack);
  });
  return { cues, plan, duration: round(t) };
}

const round = (/** @type {number} */ seconds) => Math.round(seconds * 100) / 100;


/**
 * One chapter per screen, in the ledger shape src/chapters.js reads. An interface is learned by where
 * things are, so a chapter is what one screen holds however long it runs — the two-minute rule of a
 * podcast's chapters is about keeping a topic in mind, and a screen already is one. A screen opened
 * from another is named with it (通用 › 软件更新), which is also the way to it on the phone.
 * @param {UiPage[]} pages
 * @returns {{ from: number, zh: string, vi: string, first: string }[]}
 */
export function planChapters(pages) {
  const byTitle = new Map(pages.map((page) => [page.zh, page]));
  const chapters = [];
  let s = 0;
  for (const page of pages) {
    const parent = page.parent ? byTitle.get(page.parent) : undefined;
    const name = (/** @type {'zh' | 'vi'} */ key) => (parent ? `${parent[key]} › ${page[key]}` : page[key]);
    if (page.lines.length) chapters.push({ from: s, zh: name('zh'), vi: name('vi'), first: page.lines[0].zh });
    s += page.lines.length;
  }
  return chapters;
}

/**
 * What the page loads to show each line on its screen: per cue, the screenshot and the frame, or null
 * for a line the walk did not place. Cues follow piecesOf, so every piece of a cut line shares its
 * line's place.
 * @param {UiContent} content
 */
export function shotsSidecar(content) {
  const places = content.pages.flatMap((page) => page.lines.flatMap((line) => (line.cuts ?? [line.zh]).map(() => line.at ?? null)));
  return {
    screen: content.screen,
    lines: places.map((at) => (at ? [at.shot, ...at.box] : null)),
  };
}

/**
 * The translation ledger, in the shape src/translations.js reads: each line's Vietnamese, the one the
 * app itself ships where it has one. A line of several sentences cut at their ends gets one part per
 * sentence, so each translation sits under the piece where its sentence ends; any other cut line
 * keeps its translation whole, under its last piece.
 * @param {UiContent} content
 */
export function translationLedger(content) {
  /** @type {Record<string, import('./translations.js').Entry>} */
  const sentences = {};
  let s = 0;
  for (const page of content.pages) {
    for (const line of page.lines) {
      const vi = line.source === 'self' ? SELF_MARK + line.vi : line.vi;
      const parts = line.cuts ? partsBySentence(line.zh, line.vi, line.cuts) : null;
      sentences[s] = parts
        ? { zh: line.zh, parts: parts.map((part, k) => (k === 0 && line.source === 'self' ? { ...part, vi: SELF_MARK + part.vi } : part)) }
        : { zh: line.zh, vi };
      s += 1;
    }
  }
  return { summary: content.summary, sentences };
}

/**
 * One part per sentence when the Chinese and the Vietnamese have as many sentences, every Chinese
 * sentence ends where a cut ends and none runs over more than MAX_LINES cuts; otherwise null, and the
 * translation stays whole under the line's last piece.
 * @param {string} zh
 * @param {string} vi
 * @param {string[]} cuts
 */
export function partsBySentence(zh, vi, cuts) {
  const zhSentences = zh.match(/[^。！？]+[。！？]?/g) ?? [zh];
  const viSentences = vi.split(/(?<=[.!?])\s+/);
  if (zhSentences.join('') !== zh || zhSentences.length < 2 || zhSentences.length !== viSentences.length) return null;
  const cutEnds = new Set();
  let reach = 0;
  for (const cut of cuts) cutEnds.add((reach += cut.length));
  let end = 0;
  let pieces = 0;
  for (const sentence of zhSentences) {
    end += sentence.length;
    if (!cutEnds.has(end)) return null;
    const covered = [...cutEnds].filter((at) => at <= end).length;
    if (covered - pieces > MAX_LINES) return null;
    pieces = covered;
  }
  return zhSentences.map((sentence, k) => ({ zh: sentence, vi: viSentences[k] }));
}
