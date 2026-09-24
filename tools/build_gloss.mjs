// Builds the per-episode gloss the player shows when a word is tapped.
//
// Split by where the truth comes from, which is the lesson the HSK levels taught: a reading is a
// lookup, so it is looked up, never recalled. The Hán Việt reading and the Vietnamese meaning are
// written by hand into tools/gloss-vi.json and accumulate across episodes — a word is authored once
// and then belongs to every episode that uses it.
//
// The pinyin comes from pinyin-pro rather than from a dictionary keyed by word, because the reading
// of a Chinese word is not a property of the word alone. Reading CC-CEDICT's first entry per word
// gave 说 as shuì, 都 as dū, 那 as nā, 还 as huán and 个 as gě — each of them a surname or a rare
// sense that happens to be listed first. pinyin-pro reads the whole line and picks by context.
//
// Unihan's kVietnamese was tried for the Hán Việt readings and abandoned: it covers 55% of the
// characters in these transcripts and is systematically wrong on simplified forms that merged two
// traditional characters (安宁 comes out AN TRỮ, where the reading is AN NINH). A table that is 80%
// right is worse than none, so those readings are authored rather than derived.
//
// Usage: node tools/build_gloss.mjs [EPISODE_ID ...]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');

// pinyin-pro ships as a UMD bundle, so it is handed a module object rather than imported.
const bundle = { exports: {} };
new Function('module', 'exports', readFileSync(join(ROOT, 'tools/vendor/pinyin-pro.js'), 'utf8'))(bundle, bundle.exports);
const { pinyin } = bundle.exports;

const authored = JSON.parse(readFileSync(join(ROOT, 'tools/gloss-vi.json'), 'utf8'));

// pinyin-pro reads tones in context but does not mark the neutral tone of common words: it gives
// 朋友 as "péng yǒu" where it is said "péng you", and 时候, 眼睛, 名字, 晚上 the same way — 248 words
// across these transcripts. CC-CEDICT marks the neutral tone (its tone 5) but lists words out of
// context, which is what made it give 说 as shuì. So each supplies what the other lacks: a word the
// dictionary lists exactly once takes the dictionary's tones, and the syllables 一 and 不 keep
// pinyin-pro's, because those two change tone with what follows and the citation form hides it.
const TONES = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ' };

function toMarks(syllable) {
  const m = syllable.toLowerCase().replace(/u:/g, 'v').match(/^([a-zv]+)([1-5])$/);
  if (!m) return syllable;
  const [, letters, tone] = m;
  if (tone === '5') return letters.replace(/v/g, 'ü');
  const target = 'aoe'.split('').find((c) => letters.includes(c))
    ?? [...letters].reverse().find((c) => TONES[c]);
  if (!target) return letters.replace(/v/g, 'ü');
  return letters.replace(target, TONES[target][Number(tone) - 1]).replace(/v/g, 'ü');
}

function dictionary() {
  const path = join(ROOT, 'tools/.cache/cedict.txt');
  if (!existsSync(path)) {
    console.log('(chưa có tools/.cache/cedict.txt — bỏ qua bước chỉnh thanh nhẹ)');
    return new Map();
  }
  const readings = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^\S+ (\S+) \[([^\]]+)\]/);
    if (!m) continue;
    const [, word, reading] = m;
    const set = readings.get(word) ?? new Set();
    set.add(reading.toLowerCase());
    readings.set(word, set);
  }
  return readings;
}

const LISTED = dictionary();

/** 一 and 不 are the two syllables whose tone depends on what follows, so pinyin-pro always wins
 * there: the dictionary lists 一个 as yi1 ge5 where it is said yí ge. */
const isSandhi = (syllable) => /^(yi|bu)$/.test(syllable.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/** The reading that ships: pinyin-pro's, corrected by the dictionary where the dictionary is the
 * better authority. One listed reading means the word is read one way, so its tones are taken
 * wholesale. Several listed readings mean the choice belongs to context — pinyin-pro's job — and
 * only the syllables every reading agrees are unstressed are taken, which is how 起来 becomes
 * qǐ lai without guessing between qi3 and qi5. */
function settle(word, contextual) {
  const entries = [...(LISTED.get(word) ?? [])]
    .map((reading) => reading.split(/\s+/))
    .filter((parts) => parts.length === contextual.length);
  if (!entries.length) return contextual;

  return contextual.map((syllable, i) => {
    if (isSandhi(syllable)) return syllable;
    if (entries.length === 1) return toMarks(entries[0][i]);
    const neutral = entries.every((parts) => parts[i].endsWith('5'));
    return neutral ? toMarks(entries[0][i].replace(/[1-5]$/, '5')) : syllable;
  });
}

/** One reading per character of a line, indexed the same way the line is.
 *
 * pinyin-pro is asked for each run of Chinese characters on its own rather than for the whole line:
 * with nonZh 'consecutive' it collapses a run of punctuation or digits into a single array entry,
 * so one line like 从二零一六年七月开始，母亲 silently shifts every reading after it — 摄影 came out
 * as "yǐng ，". Runs contain nothing but Chinese, so their length is guaranteed, and the assert
 * below turns any future surprise into a failed build instead of a wrong reading on a card.
 * Context still reaches every polyphone that needs it: tone choice depends on neighbouring
 * characters, which punctuation separates anyway. */
function readLine(text) {
  const readings = new Array(text.length).fill('');
  for (const run of text.matchAll(/[\u3400-\u9fff]+/g)) {
    const parts = pinyin(run[0], { type: 'array', toneType: 'symbol' });
    if (parts.length !== run[0].length) {
      throw new Error(`pinyin lệch: "${run[0]}" → ${parts.length} âm cho ${run[0].length} chữ`);
    }
    parts.forEach((reading, offset) => { readings[run.index + offset] = reading; });
  }
  return readings;
}

const ids = process.argv.slice(2);
const files = ids.length
  ? ids.map((id) => `${id}.tok.json`)
  : readdirSync(DATA).filter((f) => f.endsWith('.tok.json')).sort();

for (const file of files) {
  const episode = JSON.parse(readFileSync(join(DATA, file.replace('.tok', '')), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
  const gloss = {};
  let written = 0;

  episode.cues.forEach((cue, index) => {
    const readings = readLine(cue.text);
    for (const [start, length] of tokens.cues[index] ?? []) {
      const word = cue.text.slice(start, start + length);
      if (gloss[word]) continue;
      const reading = settle(word, readings.slice(start, start + length)).join(' ');
      const hand = authored[word];
      if (hand) written++;
      gloss[word] = hand ? [reading, ...hand] : [reading];
    }
  });

  const out = join(DATA, file.replace('.tok.json', '.gloss.json'));
  writeFileSync(out, JSON.stringify(gloss));
  const total = Object.keys(gloss).length;
  console.log(`${episode.id}: ${total} từ — ${written} đã có nghĩa Việt, ${total - written} chưa`);
}
