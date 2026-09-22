#!/usr/bin/env node
// @ts-check
// Two things happen here, and only one of them costs tokens.
//
// The deterministic pass runs every time, for free: it fixes the Latin-glue bug and any known
// recurring boilerplate mistake (scripts/known-fixes.json) across the whole episode, no model
// involved. That part is always safe to run and always correct — see findGlueFixes() below for why.
//
// The rest of this script's job is to hand a model the whole transcript to read, not a filtered
// slice. Filtering to only AssemblyAI's low-confidence words sounds efficient, but the ASR is
// often *confident* and *wrong* — it heard "执法" (law enforcement) clearly, it just wasn't what
// was said in an episode about 植发 (hair transplants). Catching that needs someone to actually
// read the sentence against the episode's own subject, not a confidence score. So this script
// prints every cue, with low-confidence words marked as a hint (worth a second look, not the only
// look), and leaves the actual reading to whichever model runs the SKILL.md workflow. What *is*
// worth skipping is re-reading an episode that's already had a full pass with nothing changed
// since — that's what data/corrections/<id>.json's fullyReviewed flag is for.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..', '..', '..', '..');

const paths = {
  raw: (/** @type {string} */ id) => join(ROOT, 'data', 'raw', `${id}.json`),
  episode: (/** @type {string} */ id) => join(ROOT, 'docs', 'data', `${id}.json`),
  corrections: (/** @type {string} */ id) => join(ROOT, 'data', 'corrections', `${id}.json`),
  knownFixes: join(SCRIPT_DIR, 'known-fixes.json'),
};

/** Below this the ASR itself is unsure — worth flagging as a hint, never a filter. */
const LOW_CONFIDENCE = 0.5;

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
const isAsciiAlpha = (/** @type {string} */ text) => /^[A-Za-z]+$/.test(text);

async function readJson(/** @type {string} */ path, /** @type {unknown} */ fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/** Single write, via a temp file — matches src/build.js so a crash mid-write can't corrupt it. */
async function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

/**
 * AssemblyAI sometimes splits one Latin word or acronym into fragment tokens with a 0ms gap
 * between them ("F"+"M", "W"+"ord"). segment.js's glue() then inserts a space between any two
 * Latin tokens, producing "F M", "W ord" in the transcript. Checked against every episode in this
 * corpus: 100% of zero-gap Latin-Latin pairs are a split single word, never two real ones, so this
 * is safe to auto-fix. (segment.js itself is left untouched — its own glue() is a pure, tested
 * function and changing it risks the "996 is hard" case where two real words happen to abut.)
 */
function findGlueFixes(/** @type {any[]} */ words) {
  /** @type {Map<string, string>} */
  const fixes = new Map();
  for (let i = 1; i < words.length; i += 1) {
    const prev = words[i - 1];
    const cur = words[i];
    if (isAsciiAlpha(prev.text) && isAsciiAlpha(cur.text) && cur.start - prev.end <= 0) {
      fixes.set(`${prev.text} ${cur.text}`, `${prev.text}${cur.text}`);
    }
  }
  return fixes;
}

function applyGlueFixes(/** @type {string} */ text, /** @type {Map<string, string>} */ fixes) {
  let result = text;
  for (const [wrong, right] of fixes) result = result.split(wrong).join(right);
  return result;
}

function applyKnownFixes(/** @type {string} */ text, /** @type {any[]} */ knownFixes) {
  let result = text;
  for (const fix of knownFixes) {
    if (!result.includes(fix.wrong)) continue;
    if (fix.matchContext && !new RegExp(fix.matchContext).test(result)) continue;
    result = result.split(fix.wrong).join(fix.right);
  }
  return result;
}

/** Finds the differing middle span between two strings that match everywhere else. */
function diffSpan(/** @type {string} */ before, /** @type {string} */ after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { before: before.slice(prefix, before.length - suffix), after: after.slice(prefix, after.length - suffix) };
}

/** Best-effort: which cue a word's timestamp falls into, for marking the low-confidence hint. */
function cueForWord(/** @type {any[]} */ cues, /** @type {any} */ word) {
  const seconds = word.start / 1000;
  return (
    cues.find((cue) => seconds >= cue.start - 0.02 && seconds <= cue.end + 0.02) ??
    cues.reduce((closest, cue) =>
      Math.abs(cue.start - seconds) < Math.abs(closest.start - seconds) ? cue : closest
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const recheck = args.includes('--recheck');
  if (!id) {
    console.error('Dùng: node find-candidates.js <EpisodeId> [--recheck], ví dụ E077');
    process.exit(1);
  }
  if (!existsSync(paths.raw(id)) || !existsSync(paths.episode(id))) {
    console.error(`Không tìm thấy data/raw/${id}.json hoặc docs/data/${id}.json.`);
    process.exit(1);
  }

  const raw = await readJson(paths.raw(id));
  const episode = await readJson(paths.episode(id));
  const knownFixes = await readJson(paths.knownFixes, []);
  const ledger = await readJson(paths.corrections(id), {
    episode: id,
    fullyReviewed: false,
    fullyReviewedAt: null,
    fixes: [],
    flagged: [],
  });

  // --- Deterministic pass: always runs, always free, always safe. ---
  const glueFixes = findGlueFixes(raw.words ?? []);
  const alreadyFixed = new Set(ledger.fixes.map((f) => `${f.cueIndex}:${f.before}:${f.after}`));
  let changed = false;

  for (const cue of episode.cues) {
    const original = cue.text;
    let text = applyGlueFixes(original, glueFixes);
    text = applyKnownFixes(text, knownFixes);
    if (text !== original) {
      const { before, after } = diffSpan(original, text);
      const key = `${cue.i}:${before}:${after}`;
      if (!alreadyFixed.has(key)) {
        ledger.fixes.push({
          cueIndex: cue.i,
          before,
          after,
          source: glueFixes.has(before) ? 'glue-bug' : 'known-phrase',
          reason: glueFixes.has(before)
            ? 'AssemblyAI split one Latin word/acronym into fragments; joined back together.'
            : 'Matches a known recurring mistake in the show\'s fixed script (scripts/known-fixes.json).',
          appliedAt: new Date().toISOString().slice(0, 10),
        });
        alreadyFixed.add(key);
      }
      cue.text = text;
      changed = true;
    }
  }

  if (changed) {
    await writeJson(paths.episode(id), episode);
  }
  await writeJson(paths.corrections(id), ledger);

  // --- The part that costs tokens: only printed when a full read hasn't happened yet. ---
  if (ledger.fullyReviewed && !recheck) {
    console.log(
      `${id}: đã review toàn bộ transcript trước đó (${ledger.fullyReviewedAt}). ` +
        `${ledger.fixes.length} lỗi đã sửa, ${ledger.flagged.length} chỗ còn nghi vấn chưa xác định được. ` +
        `Dùng --recheck nếu muốn đọc lại từ đầu (ví dụ sau khi segment.js hoặc known-fixes.json đổi).`
    );
    return;
  }

  const lowConfidenceByCue = new Map();
  (raw.words ?? []).forEach((word) => {
    if (word.confidence >= LOW_CONFIDENCE) return;
    const cue = cueForWord(episode.cues, word);
    if (!cue) return;
    const list = lowConfidenceByCue.get(cue.i) ?? [];
    list.push({ word: word.text, confidence: Math.round(word.confidence * 100) / 100 });
    lowConfidenceByCue.set(cue.i, list);
  });

  const transcript = episode.cues.map((cue) => ({
    i: cue.i,
    speaker: cue.speaker,
    text: cue.text,
    lowConfidenceHint: lowConfidenceByCue.get(cue.i) ?? undefined,
  }));

  console.log(
    `${id}: ${ledger.fixes.length} lỗi đã tự động sửa (glue-bug / known-phrase). ` +
      `Chưa review toàn bộ — in ra ${transcript.length} cue để model đọc hết, ` +
      `trong đó ${lowConfidenceByCue.size} cue có từ AssemblyAI báo confidence thấp (chỉ là gợi ý, không phải bộ lọc).`
  );
  console.log(JSON.stringify({ episode: id, title: episode.title, transcript }, null, 2));
}

main();
