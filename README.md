# storyfm-miner

Listen to the Mandarin podcast [故事FM](https://storyfm.cn) with a transcript that follows the audio.

> **Personal use only.** A private study tool for learning Mandarin. It stores transcripts I
> generate for my own listening practice and hosts no audio — playback streams from the publisher's
> own CDN. Not affiliated with 故事FM.

故事FM publishes no transcript anywhere: the RSS feed, storyfm.cn and 小宇宙 all carry show notes
only, and the podcaster has 小宇宙's transcript feature switched off. So this generates them.

## Setup

```bash
cp .env.example .env     # add ASSEMBLYAI_API_KEY
node bin/storyfm.js sync
```

## Commands

```bash
storyfm sync                  # refresh data/feed.xml from the RSS feed
storyfm list --limit 20       # list episodes (✓ = transcript exists)
storyfm add E077              # transcribe one episode (~$0.06 for 13 minutes)
storyfm add E077 --force      # redo an episode that already has one
node tools/onsets.mjs E077    # find in the audio where words the ASR collapsed really start
storyfm add E077 --resegment  # rebuild from data/raw + onsets + corrections + cuts (free, no API call)
storyfm add E077 --narrator B # override which speaker is the host

npm test                      # unit tests
npm run serve                 # http://localhost:8080

python3 tools/build_tokens.py # cut every transcript into tappable words
node tools/build_gloss.mjs    # build the gloss the player shows on a tap
node tools/audit.mjs          # cross-check both against sources that did not build them
```

`add` does not commit. Review the result, then commit `docs/data`, `data/raw`, `data/onsets`, `data/corrections` and `data/cuts` yourself.

## How it works

```
RSS (data/feed.xml)
  └─ enclosure URL ──► AssemblyAI (audio_url — their servers fetch it, nothing is uploaded)
                          └─ words[] ──► onsets.js ──► segment.js ──► cuts.js ──► roles.js ──► docs/data/E077.json
                             data/onsets/ ───┘          (sentences)      ▲
                                                 data/corrections/ ──────┤  fixes, by sentence
                                                 data/cuts/ ─────────────┘  where each sentence is cut into lines
                                                                                                   │
                            docs/player.html ◄─────────────────────────────────────────────────────┘
```

| | |
|---|---|
| `src/feed.js` | Fetch and parse the RSS feed — the source of truth for ids, titles and audio URLs |
| `src/asr.js` | AssemblyAI: submit `audio_url`, poll until done |
| `src/onsets.js` | AssemblyAI gives some words no length and parks them on the next word, so a line starting on one skips its first syllable (就是装修… plays as 装修…). Moves each such word back to the end of the pause before it, as `data/onsets/` says. Pure, tested |
| `tools/onsets.mjs` | Writes `data/onsets/<id>.json` from the episode's audio (downloaded once to `tools/.cache/`, decoded with ffmpeg) |
| `src/segment.js` | Cut the word list into sentences. Pure, tested |
| `src/cuts.js` | Replay the transcript fixes, then cut each sentence into short lines (~13 characters) as `data/cuts/` says. Refuses any cut that would change a character or split audio the ASR stacked on one timestamp. Pure, tested |
| `tools/cuts.mjs` | Where the `split-cues` skill marks cuts: `show`, `apply`, `report` |
| `src/roles.js` | Guess which speaker is the host 爱哲. Pure, tested |
| `src/build.js` | Assemble the episode file and index. Written once, via a temp file |
| `docs/` | GitHub Pages root. Vanilla HTML/CSS/JS, no build step |

## Tap ＋ Anki, get a card — on the phone too

The word card has a **＋ Anki** button. DeepSeek reads the tapped word in its line (and may widen it to
the phrase it belongs to), the card shows what it found — meaning editable — and one more tap adds a
`CI-Chinese-YouTube` note to `Chinese::Mining`: the same note, field for field, as the CI Miner
extension adds on the desktop. A word already in Anki offers **↺ Học lại** instead, as the extension does.

The page talks to `server/miner.py`, which keeps its own copy of the collection and syncs it through
AnkiWeb like any other device. It only ever downloads a full collection, never uploads one, so reviews
done elsewhere cannot be overwritten from it. The first time, the **Anki** chip asks for the server
address and token; the browser remembers them.

```bash
uv venv server/.venv && uv pip install --python server/.venv/bin/python -r server/requirements.txt
cp server/.env.example server/.env        # token, DeepSeek key
server/.venv/bin/python server/miner.py login   # AnkiWeb account, then the first download
server/.venv/bin/python server/miner.py serve   # behind HTTPS (Caddy) in production
```

Not yet: generated word/example audio (the card's link replays the real line instead) and stroke order.

## Tap a word, get its meaning

The player renders each line as word spans and shows a card when one is tapped: reading, Hán Việt,
a one-line Vietnamese meaning, then the HSK band and how often the word is said. Tapping a word pauses
the audio while the card is read, and its ✕ carries on from the same place; tapping anywhere else on
the line still seeks and plays, as it always did. Nothing on the
transcript is marked, because marking was measured and did not pay: colouring every word at HSK 1-3
lit up 73% of the page, since almost everything spoken is common vocabulary.

Each field comes from wherever it can be looked up, and only the last two are written by hand:

| Field | Source |
|---|---|
| word boundaries | jieba, offline — browsers cut 互联网 into 互/联/网 |
| HSK band | `tools/hsk-bands.json`, the 2021 syllabus |
| proper noun | jieba's tag, minus anything the HSK list or CC-CEDICT calls an ordinary word |
| times said | counted across every episode present |
| pinyin | pinyin-pro reading the line, with CC-CEDICT's neutral tones merged in |
| Hán Việt, meaning | `tools/gloss-vi.json`, written by hand, shared by every episode |

Two sidecars are built per episode and fetched after the transcript is already on screen, so a page
with no sidecar — or a phone on a bad connection — still reads: `EXXX.tok.json` (spans) and
`EXXX.gloss.json` (what the card shows).

`tools/audit.mjs` re-derives each field from a direction other than the one that built it and prints
the disagreements. It has caught, in order: the pinyin taken from CC-CEDICT's first entry (说 as
*shuì*), 124 lines whose readings were shifted by a run of digits, 168 ordinary words tagged proper
nouns (孝顺, 东西, 老公), and 248 words whose neutral tone was rendered as a full one (朋友 as
*péng yǒu*). The Vietnamese meanings are the one field it cannot check — there is no second source
to hold them against, so they stay a reading job.

## Notes

- **No LLM re-punctuates the text.** The ASR already punctuates, and letting a model rewrite it
  would put every timestamp at risk — and the highlight, the loop button and the Anki card all rest
  on timestamps. `add` reports the share of cues ending in 。！？ instead; under 50% means the ASR
  barely punctuated and the episode needs a look.
- **Raw ASR responses are committed** to `data/raw/`, so adding word-level features later never
  costs a second transcription.
- **`.cue` DOM order must match the `cues` array.** A text selection is mapped back to a cue by DOM
  position, so the storyteller filter hides cues with CSS rather than removing them.
- **Do not use `static.storyfm.cn`.** Measured: 198 KB/s, and a referer ACL that 403s every other
  site, including requests that send no referer. The CDN in the RSS feed is 7× faster and allows
  CORS.
- `docs/data/DEMO.json` is a fake transcript for eyeballing the player; it is gitignored.
