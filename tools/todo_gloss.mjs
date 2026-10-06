// Lists the words of an episode whose Vietnamese meaning still has to be written, or read against
// the sentences this episode says them in, with everything needed to do it: the reading that will
// ship, the HSK band, whether it was tagged a name, the meaning so far, the senses CC-CEDICT gives,
// and each sentence the word is said in.
//
// The meaning is written from the dictionary sense that fits those sentences rather than from
// memory. This is the same rule the rest of the pipeline follows — a lookup is looked up — and it is
// the only check available while writing, because tools/audit.mjs can verify every other field
// against a second source but has nothing to hold a Vietnamese meaning against.
//
// A meaning is shared by every episode, so a word written for another episode is listed too, until
// it has been read against this one (src/meanings.js says why). Where its meaning misses the sense
// said here, add that sense after a `;`, never replacing one another episode relies on. Once every
// listed word has a meaning that fits, --checked records the whole list in tools/gloss-checked.json.
//
// Words are ordered by how often they are said, so a half-finished pass still covers most taps.
// Note that the reader taps what they do NOT know, which skews rare: finishing an episode matters
// more than the percentage suggests.
//
// Usage: node tools/todo_gloss.mjs E757 [E001-2 ...] [--limit 350 | --checked]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRead } from '../src/meanings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');
const CHECKED = join(ROOT, 'tools/gloss-checked.json');

/** Enough of CC-CEDICT's senses to find the one a sentence uses, without a screen per word. */
const SENSES_SHOWN = 160;

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const record = args.includes('--checked');
// --checked vouches for every word listed, so it must not follow a list cut short by --limit.
if (record && limitAt >= 0) throw new Error('--checked ghi cả danh sách, không dùng cùng --limit');
const ids = args.filter((a, i) => !a.startsWith('--') && !(limitAt >= 0 && i === limitAt + 1));
const episodes = ids.length ? ids : JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8')).episodes.map((/** @type {{id: string}} */ e) => e.id);

const authored = JSON.parse(readFileSync(join(ROOT, 'tools/gloss-vi.json'), 'utf8'));
const hasMeaning = (/** @type {string} */ word) => Boolean(authored[word]);
/** @type {Record<string, string[]>} episode → words whose meaning has been read against it */
const checked = existsSync(CHECKED) ? JSON.parse(readFileSync(CHECKED, 'utf8')) : {};

// Only as a reference for whoever writes the meaning — none of it is shipped.
/** @type {Map<string, Set<string>>} */
const senses = new Map();
const cedict = join(ROOT, 'tools/.cache/cedict.txt');
if (existsSync(cedict)) {
  for (const line of readFileSync(cedict, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^\S+ (\S+) \[[^\]]+\] \/(.+)\/$/);
    if (m) senses.set(m[1], new Set([...(senses.get(m[1]) ?? []), ...m[2].split('/')]));
  }
} else {
  console.log('(chưa có tools/.cache/cedict.txt — chạy `node tools/build_gloss.mjs` trước để tải)');
}

const need = new Map();
for (const id of episodes) {
  const lines = JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8')).cues;
  const tokens = JSON.parse(readFileSync(join(DATA, `${id}.tok.json`), 'utf8')).cues;
  const gloss = JSON.parse(readFileSync(join(DATA, `${id}.gloss.json`), 'utf8'));
  const pending = toRead(lines, tokens, hasMeaning, new Set(checked[id]));

  if (record) {
    const read = [...pending.keys()].filter(hasMeaning);
    checked[id] = [...new Set([...(checked[id] ?? []), ...read])].sort();
    console.log(`${id}: ghi ${read.length} từ đã đọc nghĩa trong câu, còn ${pending.size - read.length} từ chưa có nghĩa`);
    continue;
  }
  for (const [word, { band, isName, said, contexts }] of pending) {
    const entry = need.get(word) ?? { band, isName, reading: gloss[word][0], said: 0, contexts: [] };
    entry.said += said;
    entry.contexts.push(...contexts.map((context) => `${id}\t${context}`));
    need.set(word, entry);
  }
}

if (record) {
  writeFileSync(CHECKED, `${JSON.stringify(Object.fromEntries(Object.entries(checked).sort()), null, 1)}\n`);
} else {
  const rows = [...need].sort((a, b) => b[1].said - a[1].said).slice(0, limit);
  for (const [word, { band, isName, reading, contexts }] of rows) {
    const level = isName ? 'TÊN' : band ? `H${band === 7 ? '7-9' : band}` : '—';
    const meaning = authored[word]?.[1] ?? '(chưa có nghĩa)';
    console.log(`${word}\t${reading}\t${level}\t${meaning}\t${[...(senses.get(word) ?? [])].join('; ').slice(0, SENSES_SHOWN)}`);
    for (const context of contexts) console.log(`\t${context}`);
  }
  const unwritten = [...need.keys()].filter((word) => !hasMeaning(word)).length;
  console.log(`--- ${rows.length} / ${need.size} từ cần viết hoặc đọc lại nghĩa, ${unwritten} trong đó chưa có nghĩa (${episodes.join(', ')})`);
}
