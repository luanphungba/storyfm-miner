---
name: add-episode
description: >
  Add a new 故事FM transcript to storyfm-miner end-to-end, starting from a
  小宇宙 (xiaoyuzhoufm.com) episode link (or an episode id like E757, or a
  故事FM episode name). Covers everything from resolving the link to an
  episode id, transcribing it, checking transcript quality, cutting sentences
  into short mining-sized lines, writing the
  vocabulary gloss the player shows when a word is tapped, translating the
  episode into Vietnamese (a summary plus one translation per line, never a
  whole multi-line sentence at once), cutting it into chapters of one to two
  minutes on one small topic each, through staging the result for commit. Use this whenever the user says something like
  "thêm cho tôi podcast này: https://www.xiaoyuzhoufm.com/episode/...",
  "add this episode", "transcribe E910", or pastes a xiaoyuzhoufm.com/episode
  link and asks for it to be added — even if they don't spell out the steps.
  Also covers other podcasts (瞎扯学中文 Convo Chinese and any show with an
  RSS feed): a Spotify, Apple Podcasts or Firstory episode/show link, or an
  id like CC119.
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
   **A link from Spotify, Apple Podcasts or Firstory is another podcast, not 故事FM** (e.g. 瞎扯学中文
   Convo Chinese). `node bin/storyfm.js podcast <show link>` resolves the show's RSS, snapshots its
   episodes into `data/podcasts.json` and lists them with ids `<prefix><number>` (Convo Chinese is
   `CC`, so "Episode 119 | …" is `CC119`). For a link to a single episode, find its title
   (`WebFetch`, or the Spotify page's `<title>`), run the show link once to sync, and pick the id
   from the list — then continue with `storyfm add CC119` below exactly as for 故事FM. A new show
   takes `--prefix XX` if its title has no Latin words to take initials from; ask the user which
   prefix they want rather than inventing one. (`podcast <episode link>` also transcribes directly,
   but going through the list lets you do step 5's check first.)
   **A xiaoyuzhoufm link can be another show too**: the page names its podcast (TW20200703 was
   不合时宜, not 故事FM). `podcast` cannot read a xiaoyuzhoufm link, so look the show up in Apple's
   directory (`https://itunes.apple.com/search?media=podcast&term=<show>` → `feedUrl`, for these
   usually `feed.xyzfm.space/…`), check the episode's `<guid>` in that feed is the id in the link,
   and run `storyfm podcast <feed>`. An unnumbered episode's id is the prefix plus its pubDate.
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

### Podcast episodes play from our own copy

For a podcast episode (`CC…` and any other show from `storyfm podcast`), `add` first downloads the
feed's mp3, re-encodes it to `data/audio/<id>.m4a` (64k mono AAC — 56k or less only if an episode over ~50 minutes would not fit 25 MiB — not in git), deploys it to the
`storyfm-audio` Worker and records the URL as `m4a` in `data/podcasts.json`. AssemblyAI and the
player both use that copy. This adds a minute or so (the wrangler deploy) — it has not hung.

Never let a podcast episode play from the feed's mp3. Firstory's mp3s carry a VBR "Xing" header,
and Chrome seeks one through its coarse table: on CC2 a tapped line landed anywhere from 3.7s early
to 1.4s late, so the user heard the sentence before (or after) its line lit up, and every loop and
Anki card played the wrong words. The m4a seeks to within 15ms. So after the build, check:

```
node -e 'console.log(JSON.parse(require("fs").readFileSync("docs/data/<ID>.json")).audio)'
```

It must be `{ m4a: 'https://storyfm-audio….workers.dev/<ID>.m4a' }`. If it still says `mp3`, or the
deploy failed (wrangler not logged in, file over 25 MiB), stop and tell the user — do not carry on
with the episode on the mp3. An old podcast episode still on `mp3` moves over with
`storyfm add <ID> --resegment` (free, no AssemblyAI call; it hosts the audio first).

If the user ever says a line plays ahead of or behind its highlight — any source — measure before
blaming the timestamps: seek the real `<audio>` in Chrome, record what it plays and match it to the
file (the "verify the player in real Chrome" memory has the method). Timestamps off by a word are
~0.1s; a whole second or more is the audio file seeking wrong.

The command reports the share of cues ending in 。！？ as a punctuation-quality signal. **Under 50%
means the ASR barely punctuated and the episode needs a look** before going further — tell the user
and ask whether to continue rather than pushing ahead silently.

### Put back the words of lines that skip them

AssemblyAI gives some words no length at all and parks them on the start of the next word, so a line
starting on one plays without its first syllable (E001's 就是装修都很好嘛 looped as 装修都很好嘛). It also
parks whole runs on the end of the word before, then places nothing until a gap later (often exactly
1.92s), so a line ending on the run stops before it is said (CC3's 丹麦，也是进行类似的交换学习这样的。
looped 丹麦也是进行). Right after transcribing, read where they are really said off the audio and rebuild:

```
node tools/onsets.mjs <ID>                      # needs ffmpeg; reads data/audio/<ID>.m4a if hosted, else caches the mp3 in tools/.cache/
node bin/storyfm.js add <ID> --resegment        # free, replays data/onsets/ onto the words
```

It prints how many words were collapsed, how many it moved — across the first five episodes it moved
about one in ten — and how many runs it spread out. It only ever moves a start back to the end of a pause no more than 400ms a character away,
or spreads a run over the gap after it up to the pause before the next word (again at most 400ms a character), and
leaves the rest alone, so there is nothing to review by hand. Every later `--resegment` (corrections,
cuts) replays the same ledger. After a `--force` transcription the ledger is stale and the build
says so: rerun `tools/onsets.mjs`.

## 3. Check transcript quality

Invoke the `verify-transcript` skill for this episode id. It does its own full read of the
transcript against the raw ASR response and has its own confidence bar for what counts as a
genuine fix versus something to flag — don't duplicate or second-guess its judgment here, just
chain into it and relay what it reports back (fixes made, and anything it flagged as uncertain).

## 4. Cut sentences into short lines

Invoke the `split-cues` skill for this episode. The ASR leaves half its sentences at 25+
characters, and every line on the page becomes an Anki card with exactly that line's audio, so
long lines make bad cards. That skill marks where each long sentence is cut (its own rules, its
own checks) and rebuilds the episode. Run it after `verify-transcript`: it cuts the fixed text.
Relay its report: sentences → lines, the longest line, and anything it had to leave long.

## 5. Build the word data and gloss the new vocabulary

The player renders each line as tappable words and shows a card with the reading, Hán Việt, a
one-line Vietnamese meaning and the HSK band. A new episode has none of that until it is built, and
a word with no meaning shows "chưa có nghĩa" — which is what the reader hits, because they tap the
words they do not know, and those are exactly the rare ones. **An episode is not done until every
word has a meaning.** README's "Tap a word, get its meaning" section has the full design.

```
python3 tools/build_tokens.py <ID>   # cut into words (also recounts frequencies across all episodes)
node tools/build_gloss.mjs <ID>      # readings + whatever is already written by hand
node tools/todo_gloss.mjs <ID>       # what is left to write or read
```

`todo_gloss` prints one line per word: the word, the reading that will ship, its HSK band (or `—`
for off-list, `TÊN` for a name), the meaning so far (or `(chưa có nghĩa)`), and CC-CEDICT's senses;
then, indented, the sentences the episode says it in, the word marked 【like this】. Expect **500–800
words with no meaning** for a new episode: `tools/gloss-vi.json` is shared across every episode, so
most vocabulary is already there — and those already-written words are listed too, because a
meaning written for one episode is not yet known to fit this one's sentences (CC5 showed 交代 as
"dặn dò, trăng trối", written for E757's dying mother, under 交代一下这个星期的任务 "hand in this
week's work"). HSK 1-2 words with a meaning are not listed: the reader knows them.

Write entries into `tools/gloss-vi.json` as `"词": ["HÁN VIỆT", "nghĩa tiếng Việt"]`, in batches of
~350, rebuilding after each. Five rules, all of them learned the hard way:

- **Only those two fields are written by hand.** The reading, the HSK band and the name tag are
  looked up by the tools. Never type a pinyin or a band from memory — that is precisely the mistake
  that put a wrong HSK level on 189 of the user's Anki cards.
- **But a looked-up reading that is certainly wrong in its sentence gets fixed, not just reported.**
  The tools read polyphones in the wrong sense now and then (CC118: 我们行里 as xíng lǐ, 没有当成记者
  as dàng chéng, 种种花 as CC-CEDICT's zhǒng zhǒng "all kinds of"). Add the phrase as it stands in
  the episode to `tools/readings.json` with its reading and a reason; the build holds every syllable
  against CC-CEDICT's readings of that character, so a mistyped tone fails instead of shipping. To
  find them, list the episode's words with a polyphonic character (长 发 得 行 当 只 倒 种 舍 会 …)
  next to their first sentence — the card shows the reading of a word's first occurrence.
- **Write the meaning from the CC-CEDICT sense its sentences use**, not from recall, and keep it to
  one short phrase. It is the only field no tool can check afterwards. The meaning is shared by every
  episode, so a word used in an unusual sense here gets its common sense first and this episode's in
  brackets (`"lớp; ca làm (上班: đi làm)"`).
- **Read every already-written meaning against its sentences here.** Where it misses the sense this
  episode uses, add that sense after a `;` (交代: `"bàn giao; dặn dò, trăng trối; báo cáo, có cái để
  nộp"`) — never replace a sense, because another episode's card relies on it. When the whole list
  has a meaning that fits, record it: `node tools/todo_gloss.mjs <ID> --checked` writes the words
  into `tools/gloss-checked.json`, and the next run lists only what is still missing.
- **Leave the Hán Việt as `""` rather than guess.** Interjections and rare colloquialisms often
  have no settled reading; a blank line is harmless, a confident wrong one teaches the user an error.
  Same bar as the transcript: certain, or say nothing.
- **Mis-segmented fragments still get an entry.** jieba sometimes cuts a phrase oddly (了看, 我会);
  gloss it as what it is, e.g. `"(cắt từ chưa chuẩn của 掀了看: lật lên xem)"`, so the card is never
  blank.

Then run `node tools/audit.mjs` and read what it prints **before** reporting anything. It re-derives
every mechanical field from a source other than the one that built it. Leftover items are normally
just polyphonic characters with two legitimate Hán Việt readings (中 TRUNG/TRÚNG, 乐 LẠC/NHẠC) —
check each is assigned correctly rather than assuming.

## 6. Translate the episode into Vietnamese

The page opens with a Vietnamese summary, and every line carries its own Vietnamese translation
hidden behind a **VI** button. The user reads the summary before listening so they already know the
story, and their ear can go to the words they don't know; the per-line translation is for checking a
line right after hearing it — so it has to be short enough to read in that moment. A paragraph under
the last line of a long sentence does not get read (the user said so, about CC2). Both are only worth having if they are right: a smooth sentence that says
something the Chinese does not is worse than no translation, because the reader trusts it.

Run this after `split-cues` and `verify-transcript` — it translates the fixed text, and a later fix
drops the translation of the sentence it touched (the build names it).

```
node tools/translate.mjs show <ID>          # the episode a sentence at a time, its lines numbered under it
node tools/translate.mjs apply <ID> vi.txt  # write translations; merges, so it can be done in batches
node tools/translate.mjs show <ID> --todo   # what is missing, stale, or not yet line by line
```

`show` prints each spoken sentence (or run of sentences `split-cues` joined) as `<n> <speaker·role>
<whole sentence>`, and under a sentence of several lines, each line as `<n>.<k> <line>`. Read the
whole sentence, then translate it **line by line**. Write `vi.txt` in the scratchpad:

- `<n> <bản dịch>` for a sentence that is one line;
- `<n>.<k> <bản dịch>` for line `k` of a longer one — every line `1…k` of the sentence, in order, in
  the same file (`apply` refuses a sentence with a line missing);
- `<n>.<k>-<k+1> <bản dịch>` only where two lines cannot be split without making the Vietnamese wrong
  (never more than two). Prefer reshaping the Vietnamese so each line still says what its Chinese
  says — move a phrase to the line it belongs to, repeat a subject, end on a comma — over pairing;
- `> ` lines for the summary paragraphs (they replace the old summary).

Each line's translation must translate *that* line: a reader checks it against the Chinese just
heard. Vietnamese word order often runs opposite to Chinese (the 的-phrase before a noun, a place or
time first), so a line may carry a reordered piece of the sentence — that is fine as long as the
lines read in order make the sentence. A sentence ASR cut mid-clause stays a fragment.

**Read the whole episode before writing a single line.** The translation has to be right for the
whole piece, not sentence by sentence: who is speaking, who "他/她" is (the ASR often writes 他 for a
woman), what a name refers to, what a joke or callback points back to. Then translate in order:

- **Faithful first, natural second — never fluent at the cost of meaning.** Keep what is said, how
  much is said, and the speaker's register. Chatty speech stays chatty (ờ, ừm, kiểu, tức là); a
  sentence that trails off stays unfinished; one the ASR cut mid-clause is translated as the same
  fragment, so it lines up with its Chinese.
- **Natural Vietnamese, not calqued Chinese.** Word order, particles (mà, đấy, chứ, nhé) and phrasing
  as a Vietnamese speaker would say it. Numbers as digits where a Vietnamese text would use them.
- **One set of names and forms of address for the whole episode**, decided before starting:
  - the host 爱哲 is *Ái Triết*, the show 故事FM is *Cố Sự FM*; the listener is *bạn*; for another
    podcast, take the hosts' names from the episode itself and its show notes (the `link` in the
    episode file), not from the ASR's spelling alone;
  - Chinese people's names in Hán Việt (史祥莆 → Sử Tường Bồ); Western names in their own spelling
    (本杰明 → Benjamin); Korean names and places as Vietnamese press writes them (金正日 → Kim
    Jong-il, 新义州 → Sinuiju, 平壤 → Bình Nhưỡng); Chinese places in Hán Việt (丹东 → Đan Đông);
  - a nickname that is a Chinese name stays Hán Việt (小黑 → Tiểu Hắc, 徐叔 → Từ Thúc); an online
    handle is kept as the speaker's own romanisation with the Chinese once (猫多利 → Maoduoli);
    one person the ASR spells several ways (E001's Sarah/Sharon/萨尔/萨瑞) gets one name throughout;
  - **decide each person's gender from the whole episode, never from 他/她 or the nickname.** The ASR
    writes 他 for nearly everyone, and a name can mislead: E757's 徐叔 ("Uncle Xu") is a woman — her
    mother calls her 我女儿, she has breast cancer and divorces her husband. Then pick *anh ấy / cô ấy
    / cậu ấy / ông ấy / bà* by age and relationship, and keep it.
- **A term the story itself is about stays in Chinese too** — when the speaker is remarking on a
  word (讲政治, 有组织), write the meaning and put the Chinese after it, since that word is the point.
- **Never guess past the ASR.** Where the transcript is garbled and the meaning can't be recovered from
  context, translate only what is certain and keep it vague rather than invent (E081's
  写不断千笔万字火柴 became "mấy món lặt vặt kiểu hộp diêm"). If the gap matters, flag it.

Summary: **5–10 sentences in 1–3 paragraphs**, the story in order — who the speaker is, what
happens, where this episode ends (and that it is one part of a series, if it is). Plain and concrete,
no reviewer tone; it is read right before listening, so it should make the Chinese easier to follow.

`apply` must end with `<n>/<n> câu có bản dịch · <m>/<m> dòng mang bản dịch · tóm tắt k đoạn`
and exit 0 — every line has its translation and no sentence is still translated as a whole. A later
re-cut (`split-cues`) can move a line end inside a translated piece; the build then names the
sentence as "lệch dòng" and `show --todo` lists it to translate again line by line. Then read a stretch of
the page with the translations shown (`npm run serve`, **Hiện dịch**) to see it reads as one text.

## 7. Cut the episode into chapters

The user studies one chapter at a time: a stretch of **one to two minutes on one small topic**,
looped for most of an hour of active listening, then marked studied and played back later with
studied chapters from other episodes. So a chapter has to hold together on its own, and its titles
are how the user picks what to study next. The player shows each chapter as a heading above its first
line and loops it from there.

```
node tools/chapters.mjs show <ID>          # the episode a sentence at a time: "<n> <m:ss> <who> <text>"
node tools/chapters.mjs apply <ID> ch.txt  # write the whole list; refuses a chapter over 2:00
```

Read the whole episode (you already have, from translating), then write `ch.txt` in the scratchpad,
one line per chapter in order: `<n> <tiêu đề Trung> | <tiêu đề Việt>`, where `<n>` is the sentence the
chapter starts at. The first chapter starts at the first sentence. End with `<n> -` when the episode
closes on outro credits and music (故事FM's "你现在正在收听的是…" and after): the last chapter then
stops before sentence `n`, so a loop of it doesn't replay half a minute of credits every pass.

- **Never over 2:00** — `apply` refuses it. Cut a long topic into consecutive parts at a natural turn,
  each with its own title, rather than stretch one chapter.
- **Not under ~1:00** unless the topic really is that short (`apply` marks these `ngắn`): merge a
  fragment into a neighbour instead. A chapter is cut at a sentence, never inside one.
- **Cut where the topic turns**, not where the clock says: a question and its answer, a story's setup
  and its punchline, belong in one chapter. In a two-person podcast a new question is usually the turn.
- **Titles say what happens, short**: Chinese around 5–10 characters in the episode's own words where
  possible (爸爸发现钱少了, 去四川看“胸毛”); Vietnamese natural and short, names and terms as in the
  translation (Ái Triết, 安宁疗护 → chăm sóc cuối đời). Never a title that gives away more than the
  chapter says.

`apply` must print every chapter with none over 2:00 and exit 0. `node tools/chapters.mjs build all`
rechecks every episode; a later fix or join that moves a chapter's first sentence is named there.

## 8. Stage, summarize, confirm — don't commit or push on your own

These steps together touch: `data/raw/<id>.json`, `docs/data/<id>.json`, `docs/data/index.json`,
`data/onsets/<id>.json`, `data/corrections/<id>.json`, `data/cuts/<id>.json`, the sidecars `docs/data/<id>.tok.json`,
`docs/data/<id>.gloss.json` and `docs/data/<id>.vocab.json`, `tools/gloss-vi.json`, `tools/gloss-checked.json`, and the translation `data/translations/<id>.json`
with what the page loads of it, `docs/data/<id>.vi.json`; the chapters `data/chapters/<id>.json` and
`docs/data/<id>.chapters.json`; for a podcast episode also
`data/podcasts.json`, which records the hosted `m4a` (the file itself lives on the Worker, not in
git). Note that `build_tokens.py` recounts word
frequencies across every episode, so the other episodes' `.tok.json` files change too, and it
refiles every line each word is said in, so most of `docs/data/words/` changes as well, and with them `docs/data/vocab.json` — all
expected, not stray edits. Run `git status --short` to show exactly
what changed, then give the user a short summary:

- episode id + title
- punctuation-quality % (and whether it's a concern)
- how many words `tools/onsets.mjs` moved
- sentences → lines from split-cues, and any line it left over 15 characters
- how many fixes verify-transcript made, and — this is the important part — every `flagged` entry
  by name, since those are the spots where the transcript might not match the audio
- how many words were glossed, how many already-written meanings gained this episode's sense, that
  `todo_gloss` now reports 0 left, and what `audit.mjs` printed
- how many sentences were translated, the summary, and any spot where the ASR was too garbled to
  translate with certainty
- how many chapters, their range of lengths, and the list of titles

Committing is a visible, shared action (it goes into the user's git history), and pushing publishes
it to GitHub Pages, so **do not commit or push without the user explicitly saying to.** Once they
confirm, commit with a message naming the episode (e.g. `Add transcript for E757`), then separately
ask before pushing — same as any other git push in this project.
