// Lists the words of an episode that still have no Vietnamese meaning, with everything needed to
// write one: the reading that will ship, the HSK band, whether it was tagged a name, and the
// English sense CC-CEDICT gives.
//
// The meaning is written from that sense rather than from memory. This is the same rule the rest of
// the pipeline follows — a lookup is looked up — and it is the only check available while writing,
// because tools/audit.mjs can verify every other field against a second source but has nothing to
// hold a Vietnamese meaning against.
//
// Words are ordered by how often they are said, so a half-finished pass still covers most taps.
// Note that the reader taps what they do NOT know, which skews rare: finishing an episode matters
// more than the percentage suggests.
//
// Usage: node tools/todo_gloss.mjs E757 [E001-2 ...] [--limit 350]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const ids = args.filter((a, i) => !a.startsWith('--') && !(limitAt >= 0 && i === limitAt + 1));
const episodes = ids.length ? ids : readdirSync(DATA).filter((f) => /^E[^.]*\.json$/.test(f)).map((f) => f.replace('.json', ''));

const authored = JSON.parse(readFileSync(join(ROOT, 'tools/gloss-vi.json'), 'utf8'));

// Only as a reference for whoever writes the meaning — none of it is shipped.
const senses = new Map();
const cedict = join(ROOT, 'tools/.cache/cedict.txt');
if (existsSync(cedict)) {
  for (const line of readFileSync(cedict, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^\S+ (\S+) \[[^\]]+\] \/(.+)\/$/);
    if (m && !senses.has(m[1])) senses.set(m[1], m[2].split('/').slice(0, 2).join('; ').slice(0, 46));
  }
} else {
  console.log('(chưa có tools/.cache/cedict.txt — chạy `node tools/build_gloss.mjs` trước để tải)');
}

const need = new Map();
for (const id of episodes) {
  const episode = JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(DATA, `${id}.tok.json`), 'utf8')).cues;
  const gloss = JSON.parse(readFileSync(join(DATA, `${id}.gloss.json`), 'utf8'));
  episode.cues.forEach((cue, index) => {
    for (const [start, length, band, , isName] of tokens[index] ?? []) {
      const word = cue.text.slice(start, start + length);
      if (authored[word]) continue;
      const entry = need.get(word) ?? { band, isName, reading: gloss[word][0], said: 0 };
      entry.said += 1;
      need.set(word, entry);
    }
  });
}

const rows = [...need].sort((a, b) => b[1].said - a[1].said).slice(0, limit);
for (const [word, { band, isName, reading }] of rows) {
  const level = isName ? 'TÊN' : band ? `H${band === 7 ? '7-9' : band}` : '—';
  console.log(`${word}\t${reading}\t${level}\t${senses.get(word) ?? ''}`);
}
console.log(`--- ${rows.length} / ${need.size} từ chưa có nghĩa (${episodes.join(', ')})`);
