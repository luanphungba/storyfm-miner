// @ts-check
// Every path is resolved from the repo root rather than the process's cwd, so the CLI behaves the
// same whether it is run from the repo, from docs/, or through an absolute path.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: ROOT,
  feed: join(ROOT, 'data', 'feed.xml'),
  /** Raw ASR response, kept so a re-run never has to pay for transcription twice. */
  raw: (/** @type {string} */ id) => join(ROOT, 'data', 'raw', `${id}.json`),
  /** Transcript fixes, keyed by sentence — replayed on every build. */
  corrections: (/** @type {string} */ id) => join(ROOT, 'data', 'corrections', `${id}.json`),
  /** Where each sentence is cut into lines — see src/cuts.js. */
  cuts: (/** @type {string} */ id) => join(ROOT, 'data', 'cuts', `${id}.json`),
  /** Where words the ASR collapsed really start, found in the audio — see tools/onsets.mjs. */
  onsets: (/** @type {string} */ id) => join(ROOT, 'data', 'onsets', `${id}.json`),
  /** The Vietnamese translation and summary, each sentence with the Chinese it was written for. */
  translations: (/** @type {string} */ id) => join(ROOT, 'data', 'translations', `${id}.json`),
  /** Where each chapter starts and its titles, each with the Chinese it starts at — see src/chapters.js. */
  chapters: (/** @type {string} */ id) => join(ROOT, 'data', 'chapters', `${id}.json`),
  /** The Bilibili videos added, the counterpart of feed.xml — see src/bilibili.js. */
  bilibili: join(ROOT, 'data', 'bilibili.json'),
  /** The other podcasts added and a snapshot of each one's episodes — see src/podcasts.js. */
  podcasts: join(ROOT, 'data', 'podcasts.json'),
  /** The YouTube channels added and the videos added from each — see src/youtube.js. */
  youtube: join(ROOT, 'data', 'youtube.json'),
  /** The app interfaces added as episodes — see src/ui.js. */
  ui: join(ROOT, 'data', 'ui.json'),
  /** The episodes of each topic, in the order to study them — see src/topics.js. */
  topics: join(ROOT, 'data', 'topics.json'),
  /** One app interface as its device shows it, page by page, line by line — see src/ui.js. */
  uiContent: (/** @type {string} */ id) => join(ROOT, 'data', 'ui', `${id}.json`),
  /** Where each line of an interface episode sits on its screen — see src/ui.js. */
  shots: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.shots.json`),
  /** The screenshots an interface episode shows, its owner's details covered. */
  shotImages: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.shots`),
  /** Each piece of an interface episode as the voice read it, kept so a rebuild never pays twice. */
  tts: join(ROOT, 'tools', '.cache', 'tts'),
  /** Audio hosted on the storyfm-audio Worker (Bilibili's, YouTube's, other podcasts'), kept out of git. */
  audio: (/** @type {string} */ id) => join(ROOT, 'data', 'audio', `${id}.m4a`),
  episode: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.json`),
  /** What the page loads of the translation — see src/translations.js. */
  vi: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.vi.json`),
  /** What the page loads of the chapters: each one's lines and audio — see src/chapters.js. */
  chaptersPage: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.chapters.json`),
  index: join(ROOT, 'docs', 'data', 'index.json'),
};
