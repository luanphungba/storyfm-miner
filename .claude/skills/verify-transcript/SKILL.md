---
name: verify-transcript
description: Verify and fix wrong words in a storyfm-miner episode transcript (docs/data/EXXX.json) against its raw AssemblyAI response (data/raw/EXXX.json). Use whenever the user asks to check, verify, proofread, or improve the quality of a 故事FM transcript, asks whether a transcript is accurate, or asks to fix mis-transcribed words in an episode — for one episode id (e.g. "check E517", "kiểm tra E062 xem có từ nào sai không") or across all of them. Reads the whole transcript rather than trusting AssemblyAI's confidence scores alone — the ASR is often confidently wrong. Only touches text the model is genuinely confident is wrong; never rewrites for style and never touches timestamps.
---

# Verify a storyfm-miner transcript

故事FM episodes are transcribed by AssemblyAI, not translated, and the ASR is right almost all of
the time — but it makes two kinds of mistakes worth catching:

1. **A mechanical bug**: AssemblyAI sometimes splits one Latin word or acronym into fragment
   tokens with a 0ms gap between them ("F"+"M", "W"+"ord"). `src/segment.js`'s `glue()` then
   inserts a space between any two Latin tokens it sees, producing "F M", "W ord" in the
   transcript. This is 100% mechanical and safe to auto-fix — see `scripts/find-candidates.js`.
2. **Genuine mis-hearings**: a character or phrase that sounds similar to the right one but changes
   the meaning — e.g. an entire episode about 植发 (hair transplant) where the ASR heard 执法 (law
   enforcement) several times, or the host's own name (爱哲) coming out as 艾哲.

**Read the whole transcript for (2), not just AssemblyAI's low-confidence words.** An earlier
version of this skill only looked at words under 50% confidence, to save tokens. That missed real
errors: the ASR was 100% confident it heard "执法" — it just wasn't what was said. Confidence scores
are a genuinely useful *hint* (a low-confidence word is worth a second look), but they are not a
substitute for reading the sentence against what the episode is actually about. A full read of one
episode costs a few thousand tokens; a wrong "fix" that goes uncorrected costs the user's trust in
every transcript this tool touches. Quality comes first — cost only in how you get there (see
"Where the free lunch actually is" below).

## Workflow

### 1. Run the script

```bash
node .claude/skills/verify-transcript/scripts/find-candidates.js <EpisodeId>
```

This always runs the free, deterministic part first: it auto-fixes the Latin-glue bug and any
known recurring boilerplate mistake (the show's fixed intro/outro script — its own name, the
host's name, its tagline — repeats verbatim every episode, so `scripts/known-fixes.json` catches
those for free once they're in the list).

Then:
- If this episode has never had a full read (`data/corrections/<id>.json`'s `fullyReviewed` is not
  `true`), it prints every cue — index, speaker, text — with a `lowConfidenceHint` on any cue
  containing a word AssemblyAI was under 50% confident about. Read all of it, not just the hinted
  cues.
- If it's already been fully reviewed, the script just reports the totals and stops — nothing more
  to read unless you pass `--recheck` (worth doing if `src/segment.js` or `known-fixes.json`
  changed since, or if the user explicitly wants a deeper second pass).

### 2. Read it and judge

Go cue by cue. For most of them there's nothing to say — that's fine, don't manufacture commentary.
Stop and think when something doesn't fit:

- **The episode's own subject.** This is the single best signal and it has nothing to do with
  confidence scores. An episode about hair transplants that suddenly mentions "law enforcement" is
  a red flag regardless of how sure the ASR was.
- **Internal inconsistency.** The same name, place, or term spelled two different ways nearby (a
  producer credit that says one thing in this episode and a phonetically-close real name in
  another; a proper noun that flips mid-sentence).
- **A string that isn't a word but almost is one.** Chinese ASR errors often land one phonetic step
  away from a real word or common idiom — "储柱" isn't a word, "耻辱柱" (pillar of shame) is a common
  idiom and fits. Sound the wrong string out; if a real word or idiom a syllable away fits the
  sentence, that's a strong signal, not a guess.
- **A verifiable real-world fact.** A company name, a public figure — use WebSearch rather than
  memory, and only fix if the search actually confirms it. (This is how 果壳网, 梁科, and the host's
  name 爱哲 got confirmed in this corpus — all checkable, not guessed.)

**Fix it** when one of these gets you to real confidence. **Leave it and note it** when you can't —
an unverifiable name, a low-confidence function word that reads fine either way, a producer credit
with no public record you can find. A wrong "fix" is worse than an honest ASR error: it replaces a
visible uncertainty with a confident-looking mistake, and this project exists so a Mandarin learner
can trust the transcript against the audio. When you're genuinely unsure, say so — that's a useful
result, not a failure to produce one.

### 3. Apply fixes and update the ledger

A fix lives in `data/corrections/<id>.json`, not in `docs/data/<id>.json`. The page file is built
from `data/raw/` + this ledger + `data/cuts/` (how sentences are cut into short lines), so a fix
typed straight into `docs/data` is erased by the next rebuild. The script prints one entry per
spoken **sentence** — its `i` is the `cueIndex` to write, and it is the `s` field on the page's
lines, not their `i` (one sentence is usually two or three lines on the page).

Never touch `data/raw/<id>.json` — it's the untouched AssemblyAI response, kept exactly as returned
so a rebuild never has to pay for transcription again. Only ever substitute characters inside a
sentence: never timing, speaker or role, and never where a sentence is cut — that is the
`split-cues` skill's job.

Then update `data/corrections/<id>.json` (create it if missing):

```json
{
  "episode": "E517",
  "fullyReviewed": true,
  "fullyReviewedAt": "2026-09-22",
  "fixes": [
    { "cueIndex": 170, "before": "储柱", "after": "耻辱柱", "source": "llm-review",
      "reason": "储柱 isn't a word; 耻辱柱 (pillar of shame) is a common idiom that fits.",
      "appliedAt": "2026-09-22" }
  ],
  "flagged": [
    { "cueIndex": 401, "text": "本期节目由野补制作",
      "reason": "野补 doesn't read as a real name and no search turned up a match; unresolved." }
  ]
}
```

Then rebuild, and read what it prints — a fix whose `before` is not in its sentence, or one
that lands across a cut in `data/cuts/`, stops the build and names the sentence:

```bash
node bin/storyfm.js add <id> --resegment
```

If a fix lands across a cut, re-mark that sentence with the `split-cues` skill's tool
(`node tools/cuts.mjs show <id> --all` shows the current cuts) and rebuild.

Set `fullyReviewed: true` and `fullyReviewedAt` once you've read every cue in the episode — that's
what lets a future run skip straight to the summary instead of re-reading everything. `fixes` needs
one entry per correction (`source` is `glue-bug` / `known-phrase` for the deterministic pass, or
`llm-review` for judgment calls); `flagged` is for the genuinely-uncertain spots worth surfacing to
the user, not a log of every cue you read. Keep `reason` short — it's there so a human skimming the
ledger, or you on a future run, understands the call without re-deriving it.

### 4. Report back

Summarize in the user's language: how many cues were auto-fixed mechanically, how many the model
fixed and why, and — this part matters most — the `flagged` ones by name, since those are exactly
the spots where the transcript might say something different from the audio and the user would want
to check by listening.

## Where the free lunch actually is

Not in skipping content — in never redoing the same work twice:

- The glue-bug and known-phrase fixes are free on every run, forever, because they're code, not
  judgment.
- A boilerplate mistake caught once (a producer's name, the show's own tagline) goes into
  `known-fixes.json` and is free on every *other* episode from then on — see "Extending
  known-fixes.json" below.
- A `fullyReviewed` episode is free on every *future* run — the model only reads it again if
  something upstream changed, not "just in case."

The first full read of a new episode is the one part that genuinely costs tokens, and that's
correct — it's the part that actually finds things.

## Extending `known-fixes.json`

If a fix in step 2 is really a recurring piece of the show's fixed script rather than a one-off
content error, add it here instead of just fixing it once — free across every other episode from
then on, past and future. Give it a `matchContext` regex (a string a cue must also contain) if the
wrong substring could plausibly appear correctly in unrelated content — see the existing 艾哲 entry,
scoped to cues that also say 我是 or 主播 so a guest who happens to share the name is never touched.
