// Checks the built word data against sources that were not used to build it.
//
// Every field the player shows has already been wrong once: the HSK level came from a model that
// misremembered it, the pinyin came from a dictionary's first entry and gave 说 as shuì, the word
// spans came from a segmenter that called 孝顺 a proper noun. So each one is re-derived here from a
// different direction and the disagreements are printed rather than assumed away.
//
// Usage: node tools/audit.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');
const bundle = { exports: {} };
new Function('module', 'exports', readFileSync(join(ROOT, 'tools/vendor/pinyin-pro.js'), 'utf8'))(bundle, bundle.exports);
const { pinyin } = bundle.exports;

const BANDS = JSON.parse(readFileSync(join(ROOT, 'tools/hsk-bands.json'), 'utf8'));
const AUTHORED = JSON.parse(readFileSync(join(ROOT, 'tools/gloss-vi.json'), 'utf8'));
const HAN = /^[\u3400-\u9fff]+$/;

// CC-CEDICT, read only as a second opinion: its readings check the pinyin and its capitalisation
// says which words it considers proper nouns.
const cedict = { reading: new Map(), proper: new Set(), common: new Set() };
const cedictPath = join(ROOT, 'tools/.cache/cedict.txt');
if (existsSync(cedictPath)) {
  for (const line of readFileSync(cedictPath, 'utf8').split('\n')) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) \[([^\]]+)\]/);
    if (!m) continue;
    const [, , word, reading] = m;
    if (!cedict.reading.has(word)) cedict.reading.set(word, []);
    cedict.reading.get(word).push(reading.toLowerCase().replace(/u:/g, 'v'));
    (reading[0] === reading[0].toUpperCase() && /[A-Z]/.test(reading[0]) ? cedict.proper : cedict.common).add(word);
  }
}

const MARKS = { 'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'v': 'ǖǘǚǜ' };

/** "téng tòng" → "teng2 tong4", so a tone-marked reading can be held against cedict's digits. */
function toNumbers(reading) {
  return reading.split(/\s+/).map((syllable) => {
    let tone = 0;
    let plain = '';
    for (const character of syllable.replace(/ü/g, 'v')) {
      let found = false;
      for (const [base, marked] of Object.entries(MARKS)) {
        const at = marked.indexOf(character);
        if (at >= 0) { tone = at + 1; plain += base; found = true; break; }
      }
      if (!found) plain += character;
    }
    return plain + tone;
  }).join(' ');
}

/** Two readings of the same word, allowing for the two places where the dictionary and real speech
 * legitimately disagree: the neutral tone is written 0 by one and 5 by the other, and 一 and 不
 * change tone before certain syllables — a shift the dictionary's citation form does not show but a
 * learner reading along does need to hear. */
function sameReading(listed, ours) {
  const strip = (s) => s.replace(/([a-z]+)[05]\b/g, '$1').replace(/\s+/g, ' ').trim();
  const a = strip(listed);
  const b = strip(toNumbers(ours));
  if (a === b) return true;
  const sandhi = (s) => s.replace(/\byi[1-4]\b/g, 'yi').replace(/\bbu[1-4]\b/g, 'bu');
  return sandhi(a) === sandhi(b);
}

const problems = {};
const note = (kind, detail) => (problems[kind] ||= []).push(detail);

const episodes = readdirSync(DATA).filter((f) => /^E[^.]*\.json$/.test(f)).sort();
const seen = new Map();

for (const file of episodes) {
  const id = file.replace('.json', '');
  const episode = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(DATA, `${id}.tok.json`), 'utf8')).cues;
  const gloss = JSON.parse(readFileSync(join(DATA, `${id}.gloss.json`), 'utf8'));

  episode.cues.forEach((cue, index) => {
    const spans = tokens[index] ?? [];
    let at = 0;
    let rebuilt = '';
    for (const [start, length, band, count, isName] of spans) {
      const word = cue.text.slice(start, start + length);
      if (start < at) note('span chồng lên nhau', `${id} dòng ${index}: ${word}`);
      rebuilt += cue.text.slice(at, start) + word;
      at = start + length;

      if (!HAN.test(word)) note('span không phải chữ Hán', `${id}: ${JSON.stringify(word)}`);
      if ((BANDS[word] ?? 0) !== band) note('cấp HSK lệch danh sách', `${id}: ${word} ghi ${band}, danh sách ${BANDS[word] ?? 0}`);
      if (isName && cedict.common.has(word)) note('gắn tên riêng nhưng từ điển coi là từ thường', `${word}`);
      if (isName && BANDS[word]) note('gắn tên riêng nhưng có trong HSK', `${word}`);
      if (!gloss[word]) note('token không có mục gloss', `${id}: ${word}`);

      const entry = seen.get(word) ?? { count: 0, band, isName };
      entry.count += 1;
      if (entry.band !== band) note('cùng một từ, cấp HSK khác nhau giữa các tập', word);
      if (entry.isName !== isName) note('cùng một từ, lúc là tên riêng lúc không', word);
      seen.set(word, entry);
    }
    if (rebuilt + cue.text.slice(at) !== cue.text) note('ghép span lại không ra câu gốc', `${id} dòng ${index}`);
  });

  // Pinyin: compare the reading built from context with what the dictionary lists for the word.
  for (const [word, entry] of Object.entries(gloss)) {
    const reading = entry[0] ?? '';
    if (!reading) { note('thiếu pinyin', `${id}: ${word}`); continue; }
    if (reading.split(/\s+/).length !== [...word].length) {
      note('số âm tiết pinyin không khớp số chữ', `${id}: ${word} → ${reading}`);
    }
    const listed = cedict.reading.get(word);
    if (!listed) continue;
    // Compare what actually shipped — read in context — not a fresh reading of the isolated word.
    if (!listed.some((r) => sameReading(r, reading))) {
      note('pinyin khác từ điển', `${word}: dựng "${reading}" · từ điển ${listed.map((r) => `"${r}"`).join(', ')}`);
    }
  }
}

// The authored half: Hán Việt is per character, so the same character should read the same way
// everywhere it was written by hand. Where it does not, either one of them is a slip or the
// character genuinely has two readings — both worth looking at.
const perChar = new Map();
for (const [word, [hanviet, meaning]] of Object.entries(AUTHORED)) {
  if (!seen.has(word)) note('đã viết nghĩa nhưng từ không xuất hiện trong tập nào', word);
  if (!meaning || !meaning.trim()) note('mục không có nghĩa tiếng Việt', word);
  if (meaning !== meaning?.trim()) note('nghĩa thừa khoảng trắng', word);
  if (!hanviet) continue;
  const syllables = hanviet.trim().split(/\s+/);
  if (syllables.length !== [...word].length) {
    note('số âm Hán Việt không khớp số chữ', `${word} → ${hanviet}`);
    continue;
  }
  [...word].forEach((character, i) => {
    const readings = perChar.get(character) ?? new Map();
    readings.set(syllables[i], [...(readings.get(syllables[i]) ?? []), word]);
    perChar.set(character, readings);
  });
}
for (const [character, readings] of perChar) {
  if (readings.size > 1) {
    const shown = [...readings].map(([reading, words]) => `${reading} (${words.slice(0, 3).join(', ')})`).join('  vs  ');
    note('một chữ, hai âm Hán Việt khác nhau', `${character}: ${shown}`);
  }
}

let total = 0;
for (const [kind, list] of Object.entries(problems).sort((a, b) => b[1].length - a[1].length)) {
  total += list.length;
  console.log(`\n── ${kind}: ${list.length}`);
  const unique = [...new Set(list)];
  unique.slice(0, 30).forEach((d) => console.log(`   ${d}`));
  if (unique.length > 30) console.log(`   … và ${unique.length - 30} nữa`);
}
console.log(`\ntổng số điểm cần xem: ${total}`);
