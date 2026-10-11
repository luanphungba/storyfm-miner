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
   transcript. This is mechanical and auto-fixed — see `scripts/find-candidates.js` — but check
   what it joined: a two-word name the ASR also abutted gets fused too (step 1).
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

Read the glue fixes it reports. A name of two words fuses as readily as a split one (MC20240303's
"Mandarin Corner" came out "MandarinCorner", like "iPad Pro" before it). Write such a pair apart
again with an `llm-review` fix (`"before": "MandarinCorner", "after": "Mandarin Corner"`); the next
run sees it and leaves the pair apart.

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
- **The host's own transcript, when the show publishes one.** 故事FM doesn't, but 瞎扯学中文 Convo
  Chinese (ids `CC…`) does: the episode's show notes in its RSS (feed URL in `data/podcasts.json`,
  item `<description>`) either hold the transcript itself (early episodes, e.g. CC1) or link it on
  yaya.press (newer ones — that page renders with JavaScript, so read it through the installed
  Chrome, not curl). Read it side by side with the cues. Where it confirms a different word — a
  name, a term, an English word the ASR split — that is a fix. **It is edited, not verbatim**: the
  host drops 嗯/呃 and repeats and sometimes rewords (CC1's sentence 15 adds 能够能够学习到, which
  neither AssemblyAI nor whisper hears). The page must match the audio, so never copy it over
  wholesale; where the two differ by more than a mis-heard word, listen (next point) and keep what
  was said.
- **What the audio says.** Whenever a spot is still in doubt after reading — a word that does not
  fit, a string one sound away from the word that would — listen before deciding whether to fix it
  or flag it. Collect every doubtful sentence and hear them in one run, since loading the models is
  most of the time:
  ```bash
  python3 .claude/skills/verify-transcript/scripts/listen.py <id> <s> [<s> ...]
  ```
  Each sentence is sliced with a second or so of context either side and heard by whisper
  large-v3 and large-v3-turbo, each without and with a prompt (medium is not good enough here: on
  MC20240303 the large models settled four spots it could not). The hearings are evidence, not the
  answer:
  - **Fix** when both large models, at least one of them unprompted, hear the same other word, and
    that word fits the sentence and the episode while the ASR's does not (or the ASR was unsure of
    it). MC20240303: both heard 签了 for 切了, a salesman's order getting signed; 大不敬 for 大步进,
    a phrase the episode says twice more; 吞 for 疼 in 喝不下你得得吞.
  - **Let the sentence decide where the audio cannot**: homophones (首/手, 代/带) sound the same, and
    a speaker's accent moves a word onto its neighbour (one Mandarin Corner speaker says 敬 as jìn,
    so turbo wrote 大不进 where large-v3 heard 大不敬).
  - **Ignore what whisper adds or drops** around the disputed word: it removes stutters and fillers
    (得得 → 得, 直接直接 → 直接), smooths an unfinished sentence into a finished one, and fills audio
    it cannot parse with a stock phrase nobody said (large-v3 heard 请不吝点赞订阅转发 in
    MC20240303's sentence 318).
  - **Flag** when the models disagree or both stay garbled, and write what each one heard into the
    flag's `reason`, so the user knows the spot is worth listening to.

  Name the models in a fix's `reason` too (`whisper large-v3 and turbo both hear 签了`), so the call
  can be checked again later.

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
