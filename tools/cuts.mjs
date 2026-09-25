#!/usr/bin/env node
// @ts-check
// The split-cues skill's hands. The skill decides where a sentence is cut; this checks each cut
// against the ASR and saves it in data/cuts/<id>.json. See src/cuts.js for what a cut may not do.
//
//   node tools/cuts.mjs show E757 [--over 15] [--all]   sentences to cut, one per line: "<s> <text>"
//   node tools/cuts.mjs apply E757 marked.txt           "<s> <text with / at each cut>" per line;
//                                                       a trailing + joins its last line onto the
//                                                       next sentence's first
//   node tools/cuts.mjs report E757                     line lengths as built, and what is still long
//
// After apply, rebuild: node bin/storyfm.js add E757 --resegment

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../src/paths.js';
import { toSentences, joinWords } from '../src/segment.js';
import { applyFixes, planFromMarks, splitSentence } from '../src/cuts.js';

/** A line past this many characters (punctuation not counted) is still too long to mine. */
const LONG = 15;

const readJson = async (/** @type {string} */ path, /** @type {any} */ fallback) =>
  existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : fallback;

async function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

/** Characters a learner reads — punctuation and quote marks don't make a line harder to hold. */
const length = (/** @type {string} */ text) => [...text.replace(/[\s，。！？、；：,.!?;:“”"‘’《》（）()\/+]/g, '')].length;

async function load(/** @type {string} */ id) {
  const raw = await readJson(paths.raw(id), null);
  if (!raw) throw new Error(`Không có data/raw/${id}.json.`);
  const ledger = await readJson(paths.corrections(id), { fixes: [] });
  /** @type {Map<number, {before: string, after: string}[]>} */
  const fixes = new Map();
  for (const fix of ledger.fixes) fixes.set(fix.cueIndex, [...(fixes.get(fix.cueIndex) ?? []), fix]);
  const plan = await readJson(paths.cuts(id), { episode: id, cuts: {}, joins: [] });
  plan.joins ??= [];
  return { sentences: toSentences(raw.words ?? []), fixes, plan };
}

/** The fixed sentence with "/" where the saved plan cuts it. */
function marked(/** @type {any[]} */ words, /** @type {any[]} */ fixes, /** @type {number[]} */ at = []) {
  const { text } = applyFixes(joinWords(words), fixes);
  if (!at.length) return text;
  return splitSentence(words, fixes, at).map((line) => line.text).join('/');
}

async function show(/** @type {string} */ id, /** @type {string[]} */ flags) {
  const over = Number(flags[flags.indexOf('--over') + 1]) || LONG;
  const all = flags.includes('--all');
  const { sentences, fixes, plan } = await load(id);
  for (const [s, words] of sentences.entries()) {
    const text = marked(words, fixes.get(s) ?? [], plan.cuts[s]) + (plan.joins.includes(s) ? '+' : '');
    // --all: every sentence with a line still too long, cut or not. Without it: only uncut ones.
    const tooLong = text.replace(/\+$/, '').split('/').some((line) => length(line) > over);
    if (all ? tooLong : !plan.cuts[s] && length(text) > over) console.log(`${s} ${text}`);
  }
}

async function apply(/** @type {string} */ id, /** @type {string} */ file) {
  const { sentences, fixes, plan } = await load(id);
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim());
  const errors = [];
  let saved = 0;
  for (const line of lines) {
    const match = line.match(/^(\d+) (.+)$/);
    if (!match) {
      errors.push(`không đọc được dòng: ${line}`);
      continue;
    }
    const s = Number(match[1]);
    const joinsNext = match[2].trim().endsWith('+');
    const text = match[2].trim().replace(/\+$/, '');
    const words = sentences[s];
    if (!words) {
      errors.push(`câu ${s}: không có câu này`);
      continue;
    }
    try {
      if (joinsNext && sentences[s + 1]?.[0].speaker !== words[0].speaker) {
        throw new Error(`không nối được sang câu ${s + 1}: khác người nói`);
      }
      const at = planFromMarks(words, fixes.get(s) ?? [], text);
      if (at.length) plan.cuts[s] = at;
      else delete plan.cuts[s];
      plan.joins = plan.joins.filter((/** @type {number} */ j) => j !== s);
      if (joinsNext) plan.joins.push(s);
      saved += 1;
    } catch (error) {
      errors.push(`câu ${s}: ${/** @type {Error} */ (error).message}`);
    }
  }
  plan.cuts = Object.fromEntries(Object.entries(plan.cuts).sort(([a], [b]) => Number(a) - Number(b)));
  plan.joins.sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
  await writeJson(paths.cuts(id), { episode: id, cuts: plan.cuts, joins: plan.joins });
  console.log(`✓ lưu ${saved} câu vào data/cuts/${id}.json`);
  if (errors.length) {
    console.log(`✗ ${errors.length} câu bị từ chối, chưa lưu — cắt lại rồi apply lại:\n${errors.join('\n')}`);
    process.exitCode = 1;
  }
}

async function report(/** @type {string} */ id) {
  const episode = await readJson(paths.episode(id), null);
  if (!episode) throw new Error(`Không có docs/data/${id}.json.`);
  const sizes = episode.cues.map((/** @type {any} */ cue) => length(cue.text)).sort((a, b) => a - b);
  const at = (/** @type {number} */ p) => sizes[Math.floor(p * (sizes.length - 1))];
  const sentences = new Set(episode.cues.map((/** @type {any} */ cue) => cue.s)).size;
  console.log(`${id}: ${sentences} câu → ${sizes.length} dòng · trung vị ${at(0.5)} chữ · 90% ≤ ${at(0.9)} · dài nhất ${sizes.at(-1)} (không tính dấu câu)`);
  const long = episode.cues.filter((/** @type {any} */ cue) => length(cue.text) > LONG);
  for (const cue of long) console.log(`  câu ${cue.s} còn ${length(cue.text)} chữ: ${cue.text}`);
}

const [command, id, ...rest] = process.argv.slice(2);
const commands = { show: () => show(id, rest), apply: () => apply(id, rest[0]), report: () => report(id) };
if (!id || !Object.hasOwn(commands, command)) {
  console.error('Dùng: node tools/cuts.mjs show|apply|report <id> [file]');
  process.exit(1);
}
await commands[/** @type {keyof typeof commands} */ (command)]();
