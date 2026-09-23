---
name: add-episode
description: >
  Add a new 故事FM transcript to storyfm-miner end-to-end, starting from a
  小宇宙 (xiaoyuzhoufm.com) episode link (or an episode id like E757, or a
  故事FM episode name). Covers everything from resolving the link to an
  episode id, transcribing it, checking transcript quality, through staging
  the result for commit. Use this whenever the user says something like
  "thêm cho tôi podcast này: https://www.xiaoyuzhoufm.com/episode/...",
  "add this episode", "transcribe E910", or pastes a xiaoyuzhoufm.com/episode
  link and asks for it to be added — even if they don't spell out the steps.
  Do not just run `storyfm add` directly for a xiaoyuzhoufm link without this
  skill's id-resolution and quality-check steps.
---

# Adding a 故事FM episode

storyfm-miner transcribes 故事FM episodes with AssemblyAI. The user drives this by pasting a
listening-app link (usually 小宇宙/xiaoyuzhoufm.com, since that's where they listen) rather than an
episode id, so the first job is turning that link into the id the project's own tooling expects.

Read `README.md` first if it's not already in context — it documents `bin/storyfm.js`'s commands
and the project's own conventions (raw ASR responses live in `data/raw/`, built transcripts in
`docs/data/`, `add` never commits).

## 1. Resolve the episode id

`storyfm add` takes an id like `E910` (or `YYYYMMDD` for un-numbered specials), never a xiaoyuzhoufm
URL — there's no code in this repo that talks to xiaoyuzhoufm directly, and 故事FM's own RSS feed
(`data/feed.xml`) is the only source of truth for which episodes exist and what their ids are.

1. If the user gave a xiaoyuzhoufm.com/episode/... link, `WebFetch` it for the episode title and
   publish date. Most titles open with `E<number>` (e.g. "E757.成为安宁疗护志愿者后...") — that's
   the id directly.
2. Run `node bin/storyfm.js sync` to refresh `data/feed.xml` (fast, no cost — it's just fetching
   the RSS feed).
3. Confirm the id actually exists in the feed and get its full title:
   `node bin/storyfm.js list --limit 1000 | grep -i E<number>` (or grep by a distinctive title
   substring if there's no leading number). Check the title and pubDate roughly match what
   xiaoyuzhoufm showed you.
4. If nothing matches — the episode isn't in 故事FM's feed yet, or the titles disagree enough that
   you're not sure — **stop and ask the user** rather than guessing an id. A wrong id transcribes
   the wrong episode and costs real AssemblyAI money to undo.
5. Check whether it already has a transcript: `ls data/raw/<id>.json docs/data/<id>.json`. If both
   exist, tell the user and ask whether they want `--force` (which redoes the transcription and
   spends AssemblyAI credit again) rather than silently skipping or silently redoing.

## 2. Transcribe

```
node bin/storyfm.js add <ID>
```

This costs real AssemblyAI money (~$0.06 for 13 minutes of audio) and takes anywhere from a few
seconds to a couple minutes depending on episode length — it's not instant, so don't assume it
hung. Pass `--narrator B` only if the user tells you the wrong speaker was picked as host, and
`--force` only per step 1.5 above.

The command reports the share of cues ending in 。！？ as a punctuation-quality signal. **Under 50%
means the ASR barely punctuated and the episode needs a look** before going further — tell the user
and ask whether to continue rather than pushing ahead silently.

## 3. Check transcript quality

Invoke the `verify-transcript` skill for this episode id. It does its own full read of the
transcript against the raw ASR response and has its own confidence bar for what counts as a
genuine fix versus something to flag — don't duplicate or second-guess its judgment here, just
chain into it and relay what it reports back (fixes made, and anything it flagged as uncertain).

## 4. Stage, summarize, confirm — don't commit or push on your own

`add` and `verify-transcript` together touch: `data/raw/<id>.json`, `docs/data/<id>.json`,
`docs/data/index.json`, and `data/corrections/<id>.json`. Run `git status --short` to show exactly
what changed, then give the user a short summary:

- episode id + title
- punctuation-quality % (and whether it's a concern)
- how many fixes verify-transcript made, and — this is the important part — every `flagged` entry
  by name, since those are the spots where the transcript might not match the audio

Committing is a visible, shared action (it goes into the user's git history), and pushing publishes
it to GitHub Pages, so **do not commit or push without the user explicitly saying to.** Once they
confirm, commit with a message naming the episode (e.g. `Add transcript for E757`), then separately
ask before pushing — same as any other git push in this project.
