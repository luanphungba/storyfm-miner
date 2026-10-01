#!/usr/bin/env node
// @ts-check
// Where an episode is cut into chapters. The add-episode skill reads the episode and decides where
// each topic starts; this keeps each start next to the Chinese it was written against and rebuilds
// what the page loads. See src/chapters.js.
//
//   node tools/chapters.mjs show E517            the episode a sentence at a time: "<n> <m:ss> <who> <text>",
//                                                with the chapters already written as "## " lines
//   node tools/chapters.mjs apply E517 ch.txt    "<n> <tiêu đề Trung> | <tiêu đề Việt>", one line per
//                                                chapter, in order, the first at the first sentence;
//                                                a last "<n> -" ends the last chapter before sentence n
//                                                (the outro credits). Replaces data/chapters/E517.json
//   node tools/chapters.mjs build E517|all       rebuild docs/data/E517.chapters.json and say what is off

import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../src/paths.js';
import { sentencesOf } from '../src/translations.js';
import { buildChapters, entryAt, MAX_SECONDS, MIN_SECONDS } from '../src/chapters.js';
import { rebuildChapters } from '../src/build.js';

const readJson = async (/** @type {string} */ path, /** @type {any} */ fallback) =>
  existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : fallback;

async function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

const clock = (/** @type {number} */ seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const who = (/** @type {{ speaker: string, role: string }} */ s) => `${s.speaker}${s.role === 'narrator' ? '·dẫn' : '·kể'}`;

async function load(/** @type {string} */ id) {
  const episode = await readJson(paths.episode(id), null);
  if (!episode) throw new Error(`Không có docs/data/${id}.json.`);
  const ledger = await readJson(paths.chapters(id), { episode: id, chapters: [] });
  return { episode, lines: episode.cues, ledger };
}

/** One chapter as a line of the report: number, stretch, length, titles, and what is off about it. */
function describe(/** @type {import('../src/chapters.js').Chapter} */ chapter, /** @type {number} */ n) {
  const length = chapter.end - chapter.start;
  const flag = length > MAX_SECONDS ? ' ⚠ quá 2 phút' : length < MIN_SECONDS ? ' · ngắn' : '';
  return `## ${n + 1} · ${clock(chapter.start)}–${clock(chapter.end)} (${clock(length)}) ${chapter.zh} | ${chapter.vi}${flag}`;
}

async function show(/** @type {string} */ id) {
  const { episode, lines, ledger } = await load(id);
  const { sidecar } = buildChapters(lines, ledger);
  const startsAt = new Map(sidecar.chapters.map((chapter, n) => [chapter.from, n]));
  const last = sidecar.chapters.at(-1);
  console.log(`# ${episode.title} (${clock(lines.at(-1).end)})`);
  for (const sentence of sentencesOf(lines)) {
    const first = sentence.lines[0];
    const n = startsAt.get(first);
    if (n !== undefined) console.log(describe(sidecar.chapters[n], n));
    if (last && first === last.to + 1) console.log('## — hết chương: phần còn lại không thuộc chương nào');
    console.log(`${sentence.unit} ${clock(lines[first].start)} ${who(sentence)} ${sentence.text}`);
  }
}

async function apply(/** @type {string} */ id, /** @type {string} */ file) {
  const { lines } = await load(id);
  const sentences = sentencesOf(lines);
  const errors = [];
  /** @type {import('../src/chapters.js').Entry[]} */
  const entries = [];
  /** @type {{ from: number, first: string } | undefined} */
  let end;
  for (const [n, raw] of (await readFile(file, 'utf8')).split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const stop = line.match(/^(\d+)\s+-$/);
    if (stop) {
      const at = entryAt(lines, Number(stop[1]), '', '');
      if (!at || !entries.length || at.from <= entries[entries.length - 1].from) {
        errors.push(`  dòng ${n + 1}: "${stop[1]} -" phải là một câu sau câu đầu của chương cuối`);
      } else end = { from: at.from, first: at.first };
      continue;
    }
    if (end) {
      errors.push(`  dòng ${n + 1}: không có chương nào sau dòng "<n> -"`);
      continue;
    }
    const match = line.match(/^(\d+)\s+(.+?)\s*\|\s*(.+)$/);
    const entry = match && entryAt(lines, Number(match[1]), match[2].trim(), match[3].trim());
    if (!match || !entry) {
      errors.push(`  dòng ${n + 1}: ${match ? `không có câu ${match[1]}` : 'cần "<số câu> <tiêu đề Trung> | <tiêu đề Việt>"'}`);
      continue;
    }
    if (entries.length && entry.from <= entries[entries.length - 1].from) {
      errors.push(`  dòng ${n + 1}: câu ${entry.from} không đứng sau câu ${entries[entries.length - 1].from}`);
      continue;
    }
    entries.push(entry);
  }
  if (entries.length && entries[0].from !== sentences[0].unit) {
    errors.push(`  chương đầu phải bắt đầu ở câu ${sentences[0].unit}, câu đầu tập`);
  }
  const result = buildChapters(lines, { chapters: entries, end });
  for (const n of result.long) {
    const chapter = result.sidecar.chapters[n];
    errors.push(`  chương ${n + 1} (${chapter.zh}) dài ${clock(chapter.end - chapter.start)}, quá ${clock(MAX_SECONDS)}`);
  }
  if (!entries.length) errors.push('  không có chương nào');
  if (errors.length) throw new Error(`Không ghi gì cả:\n${errors.join('\n')}`);

  await writeJson(paths.chapters(id), { episode: id, chapters: entries, ...(end && { end }) });
  await build(id);
}

async function build(/** @type {string} */ id) {
  const { lines } = await load(id);
  const result = await rebuildChapters(id, lines);
  if (!result) throw new Error(`Chưa có data/chapters/${id}.json.`);
  const { chapters } = result.sidecar;
  const lengths = chapters.map((chapter) => chapter.end - chapter.start);
  console.log(`${id}: ${chapters.length} chương · ${clock(Math.min(...lengths))}–${clock(Math.max(...lengths))} mỗi chương`);
  for (const [n, chapter] of chapters.entries()) console.log(`  ${describe(chapter, n).slice(3)}`);
  if (result.lost.length) console.log(`  ⚠ câu đầu chương không còn: ${result.lost.join(', ')}`);
  if (result.changed.length) console.log(`  ⚠ câu đầu chương đã đổi chữ, xem lại tiêu đề: ${result.changed.join(', ')}`);
  const finished = !result.lost.length && !result.long.length && !result.uncovered;
  if (!finished) process.exitCode = 1;
}

const [command, id, ...rest] = process.argv.slice(2);
try {
  if (!id) throw new Error('Cần mã tập, ví dụ E517.');
  if (command === 'show') await show(id);
  else if (command === 'apply') await apply(id, rest[0]);
  else if (command === 'build' && id === 'all') {
    const ids = existsSync(dirname(paths.chapters('x'))) ? await readdir(dirname(paths.chapters('x'))) : [];
    for (const name of ids.filter((n) => n.endsWith('.json'))) await build(name.slice(0, -5));
  } else if (command === 'build') await build(id);
  else throw new Error('Lệnh: show | apply | build');
} catch (error) {
  console.error(/** @type {Error} */ (error).message);
  process.exitCode = 1;
}
