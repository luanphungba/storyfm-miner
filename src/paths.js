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
  /** The Bilibili videos added, the counterpart of feed.xml — see src/bilibili.js. */
  bilibili: join(ROOT, 'data', 'bilibili.json'),
  /** Downloaded Bilibili audio, published to Cloudflare Pages and kept out of git. */
  audio: (/** @type {string} */ id) => join(ROOT, 'data', 'audio', `${id}.m4a`),
  episode: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.json`),
  /** What the page loads of the translation — see src/translations.js. */
  vi: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.vi.json`),
  index: join(ROOT, 'docs', 'data', 'index.json'),
};
