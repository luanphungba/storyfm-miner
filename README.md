# storyfm-miner

Listen to the Mandarin podcast [故事FM](https://storyfm.cn) with a transcript that follows the audio,
then select a word to turn it into an Anki card with the
[CI Chinese](../youtube-chinese-miner) browser extension.

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
storyfm add E077 --narrator B # override which speaker is the host

npm test                      # unit tests
npm run serve                 # http://localhost:8080
```

`add` does not commit. Review the result, then commit `docs/data` and `data/raw` yourself.

## How it works

```
RSS (data/feed.xml)
  └─ enclosure URL ──► AssemblyAI (audio_url — their servers fetch it, nothing is uploaded)
                          └─ words[] ──► segment.js ──► roles.js ──► docs/data/E077.json
                                                                        │
                            docs/player.html ◄───────────────────────────┘
                                 └─ postMessage cues ──► CI Chinese extension ──► Anki
```

| | |
|---|---|
| `src/feed.js` | Fetch and parse the RSS feed — the source of truth for ids, titles and audio URLs |
| `src/asr.js` | AssemblyAI: submit `audio_url`, poll until done |
| `src/segment.js` | Cut the word list into sentences. Pure, tested |
| `src/roles.js` | Guess which speaker is the host 爱哲. Pure, tested |
| `src/build.js` | Assemble the episode file and index. Written once, via a temp file |
| `docs/` | GitHub Pages root. Vanilla HTML/CSS/JS, no build step |

## Notes

- **No LLM re-punctuates the text.** The ASR already punctuates, and letting a model rewrite it
  would put every timestamp at risk — and the highlight, the loop button and the Anki card all rest
  on timestamps. `add` reports the share of cues ending in 。！？ instead; under 50% means the ASR
  barely punctuated and the episode needs a look.
- **Raw ASR responses are committed** to `data/raw/`, so adding word-level features later never
  costs a second transcription.
- **`.cue` DOM order must match the `cues` array.** The extension maps a selection back to a cue by
  position, which is why the storyteller filter hides cues with CSS instead of removing them.
- **Do not use `static.storyfm.cn`.** Measured: 198 KB/s, and a referer ACL that 403s every other
  site, including requests that send no referer. The CDN in the RSS feed is 7× faster and allows
  CORS.
- `docs/data/DEMO.json` is a fake transcript for eyeballing the player; it is gitignored.
