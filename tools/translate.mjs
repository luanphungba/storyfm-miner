#!/usr/bin/env node
// @ts-check
// Where the Vietnamese translation is written. The add-episode skill translates; this keeps each
// translation next to the Chinese it was written for and rebuilds what the page loads. See
// src/translations.js for why a sentence whose Chinese changed is dropped rather than kept.
//
//   node tools/translate.mjs show E081 [--todo]   the episode, one sentence a line: "<n> <who> <text>"
//                                                 --todo: only what has no translation, or a stale one
//   node tools/translate.mjs apply E081 vi.txt    "<n> <bản dịch>" per line; "> đoạn" lines replace
//                                                 the summary. Merges into data/translations/E081.json
//   node tools/translate.mjs build E081           rebuild docs/data/E081.vi.json and say what is left

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../src/paths.js';
import { sentencesOf } from '../src/translations.js';
import { rebuildTranslation } from '../src/build.js';

const readJson = async (/** @type {string} */ path, /** @type {any} */ fallback) =>
  existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : fallback;

async function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

async function load(/** @type {string} */ id) {
  const episode = await readJson(paths.episode(id), null);
  if (!episode) throw new Error(`Không có docs/data/${id}.json.`);
  const ledger = await readJson(paths.translations(id), { episode: id, summary: [], sentences: {} });
  return { episode, lines: episode.cues, sentences: sentencesOf(episode.cues), ledger };
}

/** Who is talking matters to the translation: it decides how people are addressed and referred to. */
const who = (/** @type {{ speaker: string, role: string }} */ s) => `${s.speaker}${s.role === 'narrator' ? '·dẫn' : '·kể'}`;

async function show(/** @type {string} */ id, /** @type {string[]} */ flags) {
  const { episode, sentences, ledger } = await load(id);
  const todo = flags.includes('--todo');
  if (!todo) console.log(`# ${episode.title}`);
  for (const sentence of sentences) {
    const entry = ledger.sentences[sentence.unit];
    const fresh = entry?.vi && entry.zh.replace(/\s+/g, '') === sentence.text.replace(/\s+/g, '');
    if (todo && fresh) continue;
    console.log(`${sentence.unit} ${who(sentence)} ${sentence.text}`);
    if (todo && entry?.vi) console.log(`   cũ: ${entry.zh} → ${entry.vi}`);
  }
}

async function apply(/** @type {string} */ id, /** @type {string} */ file) {
  const { lines, sentences, ledger } = await load(id);
  const byUnit = new Map(sentences.map((sentence) => [sentence.unit, sentence]));
  const summary = [];
  const errors = [];
  let count = 0;
  for (const [n, raw] of (await readFile(file, 'utf8')).split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('>')) {
      summary.push(line.slice(1).trim());
      continue;
    }
    const match = line.match(/^(\d+)\s+(.+)$/);
    const sentence = match && byUnit.get(Number(match[1]));
    if (!match || !sentence) {
      errors.push(`  dòng ${n + 1}: ${match ? `không có câu ${match[1]}` : 'cần "<số câu> <bản dịch>"'}`);
      continue;
    }
    ledger.sentences[sentence.unit] = { zh: sentence.text, vi: match[2].trim() };
    count += 1;
  }
  if (errors.length) throw new Error(`Không ghi gì cả:\n${errors.join('\n')}`);
  if (summary.length) ledger.summary = summary;

  await writeJson(paths.translations(id), ledger);
  console.log(`✓ ${count} câu${summary.length ? `, tóm tắt ${summary.length} đoạn` : ''}`);
  await build(id, lines);
}

async function build(/** @type {string} */ id, /** @type {any[] | undefined} */ lines) {
  lines ??= (await load(id)).lines;
  const result = await rebuildTranslation(id, lines);
  if (!result) throw new Error(`Chưa có data/translations/${id}.json.`);
  const total = sentencesOf(lines).length;
  const done = total - result.missing.length - result.stale.length;
  console.log(`${id}: ${done}/${total} câu có bản dịch · tóm tắt ${result.sidecar.summary.length} đoạn`);
  if (result.orphaned.length) console.log(`  bỏ qua bản dịch của câu không còn: ${result.orphaned.join(', ')}`);
  if (!result.sidecar.summary.length) console.log('  ⚠ chưa có tóm tắt');
  process.exitCode = done === total && result.sidecar.summary.length ? 0 : 1;
}

const [command, id, ...rest] = process.argv.slice(2);
try {
  if (!id) throw new Error('Cần mã tập, ví dụ E081.');
  if (command === 'show') await show(id, rest);
  else if (command === 'apply') await apply(id, rest[0]);
  else if (command === 'build') await build(id, undefined);
  else throw new Error('Lệnh: show | apply | build');
} catch (error) {
  console.error(/** @type {Error} */ (error).message);
  process.exitCode = 1;
}
