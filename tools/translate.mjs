#!/usr/bin/env node
// @ts-check
// Where the Vietnamese translation is written. The add-episode skill translates; this keeps each
// translation next to the Chinese it was written for and rebuilds what the page loads. See
// src/translations.js for why each line gets its own, and why one whose Chinese changed is dropped.
//
//   node tools/translate.mjs show E081 [--todo]   the episode, a sentence at a time: "<n> <who> <text>",
//                                                 and under a sentence of several lines, each line as
//                                                 "<n>.<k> <line>". --todo: only what has no
//                                                 translation, a stale one, or one not yet line by line
//   node tools/translate.mjs apply E081 vi.txt    "<n> <bản dịch>" for a one-line sentence,
//                                                 "<n>.<k> <bản dịch>" for line k of a longer one,
//                                                 "<n>.<k>-<k+1> <bản dịch>" for two lines that can't be
//                                                 split; "> đoạn" lines replace the summary. Merges into
//                                                 data/translations/E081.json
//   node tools/translate.mjs build E081           rebuild docs/data/E081.vi.json and say what is left

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../src/paths.js';
import { sentencesOf, buildSidecar, MAX_LINES } from '../src/translations.js';
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
  const { episode, lines, sentences, ledger } = await load(id);
  const todo = flags.includes('--todo');
  const { missing, stale, unsplit, misaligned } = buildSidecar(lines, ledger);
  const pending = new Set([...missing, ...stale, ...unsplit, ...misaligned]);
  if (!todo) console.log(`# ${episode.title}`);
  for (const sentence of sentences) {
    if (todo && !pending.has(sentence.unit)) continue;
    const entry = ledger.sentences[sentence.unit];
    console.log(`${sentence.unit} ${who(sentence)} ${sentence.text}`);
    if (sentence.lines.length > 1) {
      for (const [k, index] of sentence.lines.entries()) console.log(`  ${sentence.unit}.${k + 1} ${lines[index].text}`);
    }
    if (todo && entry) {
      const old = entry.parts ? entry.parts.map((part) => part.vi).join(' ') : entry.vi;
      console.log(`   cũ: ${old}`);
    }
  }
}

async function apply(/** @type {string} */ id, /** @type {string} */ file) {
  const { lines, sentences, ledger } = await load(id);
  const byUnit = new Map(sentences.map((sentence) => [sentence.unit, sentence]));
  const summary = [];
  const errors = [];
  /** @type {Map<number, { from: number, to: number, vi: string, n: number }[]>} */
  const pieces = new Map();
  let count = 0;
  for (const [n, raw] of (await readFile(file, 'utf8')).split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('>')) {
      summary.push(line.slice(1).trim());
      continue;
    }
    const match = line.match(/^(\d+)(?:\.(\d+)(?:-(\d+))?)?\s+(.+)$/);
    const sentence = match && byUnit.get(Number(match[1]));
    if (!match || !sentence) {
      errors.push(`  dòng ${n + 1}: ${match ? `không có câu ${match[1]}` : 'cần "<số câu> <bản dịch>" hoặc "<số câu>.<dòng> <bản dịch>"'}`);
      continue;
    }
    const vi = match[4].trim();
    if (!match[2]) {
      if (sentence.lines.length > 1) {
        errors.push(`  dòng ${n + 1}: câu ${sentence.unit} có ${sentence.lines.length} dòng — dịch từng dòng ${sentence.unit}.1 … ${sentence.unit}.${sentence.lines.length}`);
        continue;
      }
      ledger.sentences[sentence.unit] = { zh: sentence.text, vi };
      count += 1;
      continue;
    }
    const from = Number(match[2]);
    const to = Number(match[3] ?? match[2]);
    if (from < 1 || to < from || to > sentence.lines.length || to - from + 1 > MAX_LINES) {
      errors.push(`  dòng ${n + 1}: câu ${sentence.unit} có dòng 1–${sentence.lines.length}, một bản dịch phủ tối đa ${MAX_LINES} dòng`);
      continue;
    }
    pieces.set(sentence.unit, [...(pieces.get(sentence.unit) ?? []), { from, to, vi, n: n + 1 }]);
  }

  for (const [unit, list] of pieces) {
    const sentence = /** @type {import('../src/translations.js').Sentence} */ (byUnit.get(unit));
    let next = 1;
    for (const piece of list) {
      if (piece.from !== next) break;
      next = piece.to + 1;
    }
    if (next !== sentence.lines.length + 1) {
      errors.push(`  câu ${unit}: các dòng phải đủ và theo thứ tự 1–${sentence.lines.length} (dòng ${list.map((p) => p.n).join(', ')} trong file)`);
      continue;
    }
    const textOf = (/** @type {number} */ k) => lines[sentence.lines[k - 1]].text;
    const parts = list.map(({ from, to, vi }) => {
      let zh = '';
      for (let k = from; k <= to; k += 1) zh += textOf(k);
      return { zh, vi };
    });
    ledger.sentences[unit] = { zh: sentence.text, parts };
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
  const { missing, stale, unsplit, misaligned } = result;
  const done = total - missing.length - stale.length;
  const translated = Object.keys(result.sidecar.lines).length;
  console.log(`${id}: ${done}/${total} câu có bản dịch · ${translated}/${lines.length} dòng mang bản dịch · tóm tắt ${result.sidecar.summary.length} đoạn`);
  if (unsplit.length) console.log(`  ⚠ ${unsplit.length} câu nhiều dòng còn dịch gộp cả câu: ${unsplit.join(', ')}`);
  if (misaligned.length) console.log(`  ⚠ ${misaligned.length} câu có bản dịch lệch dòng sau khi cắt lại: ${misaligned.join(', ')}`);
  if (result.orphaned.length) console.log(`  bỏ qua bản dịch của câu không còn: ${result.orphaned.join(', ')}`);
  if (!result.sidecar.summary.length) console.log('  ⚠ chưa có tóm tắt');
  const finished = done === total && !unsplit.length && !misaligned.length && result.sidecar.summary.length;
  process.exitCode = finished ? 0 : 1;
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
