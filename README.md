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
storyfm sync                  # refresh data/feed.xml from the RSS feed, and every podcast added
storyfm list --limit 20       # list episodes (✓ = transcript exists)
storyfm add E077              # transcribe one episode (~$0.06 for 13 minutes)
storyfm add E077 --force      # redo an episode that already has one
node tools/onsets.mjs E077    # find in the audio where words the ASR collapsed really start
storyfm add E077 --resegment  # rebuild from data/raw + onsets + corrections + cuts (free, no API call)
storyfm add E077 --narrator B # override which speaker is the host
storyfm podcast <link>        # add another podcast from a Spotify / Apple / Firstory / RSS link and list its
                              # episodes (ids like CC119); a link to one episode transcribes it

npm test                      # unit tests
npm run serve                 # http://localhost:8080

python3 tools/build_tokens.py # cut every transcript into tappable words
node tools/build_gloss.mjs    # build the gloss the player shows on a tap
node tools/audit.mjs          # cross-check both against sources that did not build them
node tools/translate.mjs show E077   # the episode by sentence, lines numbered, to translate line by line
node tools/translate.mjs apply E077 vi.txt  # save translations + summary, rebuild what the page loads
node tools/chapters.mjs show E077    # the episode by sentence, with times, to cut into chapters
node tools/chapters.mjs apply E077 ch.txt   # save the chapters (1–2 minutes, one topic each) and rebuild
node tools/ui.mjs build UI1          # an app's interface read aloud: voice data/ui/UI1.json, lay out the audio, write the episode
node tools/ui.mjs check UI1          # whisper listens to every voiced line and names those that read something else
node tools/ui.mjs publish UI1        # put the interface's audio on the storyfm-audio Worker
```

`add` does not commit. Review the result, then commit `docs/data`, `data/raw`, `data/onsets`, `data/corrections`, `data/cuts`, `data/translations` and `data/chapters` yourself.

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
| `src/podcasts.js` | Other podcasts: turn a Spotify / Apple / Firstory link into the show's RSS, snapshot its episodes into `data/podcasts.json`, id them `<prefix><number>` (CC119) |
| `src/cdn.js` | The `storyfm-audio` Worker (`cdn/`) that serves audio we host: Bilibili's, and every other podcast's re-encoded to m4a — Firstory's mp3s have a VBR Xing header that Chrome seeks up to 4s off |
| `src/asr.js` | AssemblyAI: submit `audio_url`, poll until done |
| `src/onsets.js` | AssemblyAI gives some words no length and parks them on the next word, so a line starting on one skips its first syllable (就是装修… plays as 装修…). Moves each such word back to the end of the pause before it, as `data/onsets/` says. Pure, tested |
| `tools/onsets.mjs` | Writes `data/onsets/<id>.json` from the episode's audio (downloaded once to `tools/.cache/`, decoded with ffmpeg) |
| `src/segment.js` | Cut the word list into sentences. Pure, tested |
| `src/cuts.js` | Replay the transcript fixes, then cut each sentence into short lines (~13 characters) as `data/cuts/` says. Refuses any cut that would change a character or split audio the ASR stacked on one timestamp. Pure, tested |
| `tools/cuts.mjs` | Where the `split-cues` skill marks cuts: `show`, `apply`, `report` |
| `src/roles.js` | Guess which speaker is the host 爱哲. Pure, tested |
| `src/translations.js` | The Vietnamese summary and one translation per line (read against its whole sentence), each kept with the Chinese it was written for; a sentence a fix changed drops off the page until translated again, one a re-cut moved is named. Pure, tested |
| `tools/translate.mjs` | Where translations are written: `data/translations/<id>.json` → `docs/data/<id>.vi.json` |
| `src/chapters.js` | The episode cut into chapters of one to two minutes on one small topic, each starting at a sentence and keeping that sentence's Chinese, so a fix or join that moves it is named. The last can stop before the outro credits. Pure, tested |
| `tools/chapters.mjs` | Where chapters are written: `data/chapters/<id>.json` → `docs/data/<id>.chapters.json` |
| `src/build.js` | Assemble the episode file and index. Written once, via a temp file |
| `src/ui.js` | An app's interface as an episode: each line read twice with room to say it back, laid out on one timeline; a chapter per screen; each line's place on its screenshot; Apple's own Vietnamese as the translation. Pure, tested |
| `tools/ui.mjs` | Voices `data/ui/<id>.json` through Runware (Qwen3-TTS cloning a reference clip), caches each line in `tools/.cache/tts/`, writes the episode, its translation, chapters and screenshot places, and checks the voice with whisper |
| `docs/shots.js` | Which screenshots a chapter shows and where on one a line sits, in percent of the picture. Pure, tested |
| `docs/` | GitHub Pages root. Vanilla HTML/CSS/JS, no build step. `docs/studied.js` (the studied list: recent, in order, rounded links) is pure and tested |

## Study one chapter at a time

Every episode is cut into chapters of one to two minutes, each on one small topic, with a Chinese and
a Vietnamese title (`tools/chapters.mjs`). Each shows as a heading above its first line, and all of
them are listed, collapsed, under the summary. Tapping one puts it in the loop bar and loops it: the
lines outside it dim, and a bar above the loop shows which pass is playing and how long the chapter
has been heard. A line tapped inside the chapter plays from there and the loop carries on; ‹ › move to
the chapter before or after, and ✕ leaves it. The loop bar holds the chapter, so the URL keeps it.

**✓ Học xong** puts the chapter on the list of studied chapters, kept by the server (below) in
`studied.json` beside its collection, not in Anki, so the phone and the laptop share it. The chapters
studied carry a ✓, and the episode list counts them. **Nghe lại** (`listen.html`) plays that list back
for passive listening: the last 7 days or all of it, or one episode. Each episode plays whole and in
story order, even when its chapters were studied days apart, the one studied latest first; a shuffle
moves whole episodes, never the chapters within one. Each chapter plays once to three times, going
round until stopped. One audio
element plays every episode, and the lock screen's ⏮ ⏭ move between chapters.

## An app's interface, read aloud

`data/ui/UI1.json` is every line of iPhone Settings (iOS 26) in Simplified Chinese: page titles, the
description at the top of each page and the notes under its options. It was read off the phone, not
written from memory: a UI test walked Settings on the device and read each page from the
accessibility tree, and each line was matched to Apple's own localization tables for its English and
Vietnamese. A line those tables do not hold is translated by hand and shows on the page marked ✎. Long
lines are cut into pieces of 15 characters or fewer, so each one loops and mines like a podcast line.

There is nothing to transcribe, so the audio is made: `tools/ui.mjs` has a TTS voice read each piece
twice, then leaves a silence as long as the piece to say it back. The clips are laid out sample by
sample, so every line's start is where its first reading begins (measured on the encoded file: speech
starts 0–90 ms after each line's start, never before). A chapter is one screen, as it is opened on the
phone — a screen opened from another is named with it, 通用 › 软件更新 — however long it runs. Under its
heading are the screen's screenshots and the words it brings in. A screenshot opens large with a frame
around the line being heard, and follows the audio from line to line and screen to screen; a word opens
the same card as a tap in the line, strokes and ＋ Anki included. Everything else — ✓ Học xong, Nghe
lại, the stats — is the same as for any episode.

The screenshots are the ones the walk took, and the site is public, so before one is published every
piece of text on it that is not one of Apple's own strings is boxed over — a name, an email, a network,
a phone number, a password — and so are the photos of people (`docs/data/UI1.shots/`).

## Tap ＋ Anki, get a card — on the phone too

The word card has a **＋ Anki** button. DeepSeek reads the tapped word in its line (and may widen it to
the phrase it belongs to), the card shows what it found — meaning editable — and one more tap adds a
`CI-Chinese-YouTube` note to `Chinese::Mining`: the same note, field for field, as the CI Miner
extension adds on the desktop. A word already in Anki offers **↺ Học lại** instead, as the extension does.

Once today's new cards in the deck reach its *New cards/day*, a new word stops before DeepSeek is
asked: the card says how many were added and how many days of new cards are already waiting, and
offers **Nghe tiếp** (close, carry on listening) or **Vẫn thêm** (look it up anyway). "Today" is
Anki's day, which turns at 4:00 by the server's clock, so `TZ` in `server/.env` is the learner's
timezone.

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
| pinyin | pinyin-pro reading the line, with CC-CEDICT's neutral tones merged in; where both read a polyphone in the wrong sense, `tools/readings.json` by phrase, each syllable checked against CC-CEDICT |
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
