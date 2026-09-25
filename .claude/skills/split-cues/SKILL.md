---
name: split-cues
description: >
  Cut a storyfm-miner episode's spoken sentences into short, meaningful lines (~8-20 characters)
  so each line works as a sentence-mining card in Anki and as a short loop in the player. Use
  after verify-transcript when adding an episode (the add-episode skill chains into it), and
  whenever the user says lines/sentences on the page are too long, "câu dài quá", "cắt câu ngắn",
  wants to re-cut an episode, or pastes a screenshot of a long line. Marks cuts only — never
  changes a character, a timestamp or a speaker.
---

# Cutting sentences into short lines

The ASR punctuates only where the speaker clearly stops, so a sentence is often 25-45 characters,
and a stretch it never punctuated gets chopped at a length limit, sometimes mid-word
(`迷迷糊 | 糊的`). Each line on the page is what the CI Miner extension puts on an Anki card, with
exactly that line's audio. The user mines these, and a long line makes a bad card. **Aim for lines
of 20 characters or less; treat anything over 22 as needing a cut.** Being careful with grammar is
not a reason to leave a line long. Splitting a long subject off its predicate is fine:

```
今天的讲述者徐叔 / 就是北京海医安宁的一名志愿者。
海淀医院安宁疗护中心 / 也被业内人简称为"海医安宁"。
```

You decide where to cut. `tools/cuts.mjs` checks each cut and saves it in `data/cuts/<id>.json`.
`src/cuts.js` has the full rules. The build then applies the cuts to `data/raw/` together with the
fixes in `data/corrections/`, so a rebuild never loses either.

## 1. List the sentences to cut

```bash
node tools/cuts.mjs show <ID> --over 18      # not cut yet: "<s> <text>" per line
node tools/cuts.mjs show <ID> --over 18 --all  # every long sentence, with current cuts as "/"
```

`<s>` is the sentence index, the same index `data/corrections/` uses. The text shown already has
the transcript fixes applied.

## 2. Mark the cuts

Write a file (in the scratchpad) with one sentence per line, `<s> <text>`, the text unchanged
except for a `/` at each cut:

```
61 你就想一下，/一个人这么孤独的在病房里一个人忍痛，/最后挣扎的不行又被人绑在床上。
```

Rules, in order of how often they matter:

- **Every line is one idea that makes sense on a card by itself.** Cut after a comma between
  clauses, before a connective (然后 / 所以 / 但是 / 因为 / 后来 / 结果), and between a long
  subject and its predicate.
- **Don't leave fragments.** `很正常。`, `我很累，`, `就是没了。` are useless cards, so keep them
  with a neighbour. A short sentence that stands alone (`你呢？`, `嗯。`) is fine. Only fragments
  cut out of a longer sentence are not.
- **Keep a quotation with what introduces it** when both fit (`我跟我妈商量说："咱们说走就走。"`).
  Split before the quote only if together they run long.
- **Stretches the ASR never punctuated** (whole runs with no `，`) need the most cuts. They also
  often end mid-word at the sentence boundary (`…后来他迷迷糊` + `糊的就是说丹阳…`). End such a
  sentence's line with `+` to join its last line onto the next sentence's first line:
  ```
  50 他说一会儿说镇江一会儿说丹阳/然后我就问他/我现在已经在常州/你到底要我去哪里/后来他迷迷糊+
  51 糊的就是说丹阳就这样子/然后我就说好吧那我去丹阳/…
  ```
  gives the line `后来他迷迷糊糊的就是说丹阳就这样子`. A join never crosses a change of speaker.
- **Don't add punctuation** or change any character. The extension's model punctuates the card
  sentence itself.
- A sentence left out of the file keeps its current cuts. A line without any `/` removes its cuts.

## 3. Apply, and handle what it refuses

```bash
node tools/cuts.mjs apply <ID> marked.txt
```

Every accepted sentence is saved. A refused one is not, and the reason is printed:

| Refusal | Meaning | What to do |
|---|---|---|
| `bỏ dấu / đi phải ra đúng câu gốc` | a character changed | copy the text again from `show` |
| `không nằm ở chỗ bắt đầu một từ ASR` | the cut falls inside an ASR word | move it a character or two |
| `cắt vào giữa một cụm từ ASR dồn chung một thời điểm` / `chỉ có 0.Xs audio` | the ASR stacked several words on one timestamp there, so the line would have no audio to loop | cut earlier, or leave that part whole. Timing can't be recovered. |
| `cắt vào giữa một chỗ đã sửa chữ` | the cut falls inside a transcript fix | move it to either edge of the fix |

Fix the refused lines in the same file and apply again. It's safe to re-run.

## 4. Rebuild and check

```bash
node bin/storyfm.js add <ID> --resegment   # docs/data from raw + corrections + cuts
node tools/cuts.mjs report <ID>            # line lengths, and every line still over 22
```

`report` should list only lines you couldn't cut (collapsed timestamps). Anything else over 22
means another pass. Then rebuild the tap-a-word data, because it is indexed by line and goes stale
after a re-cut:

```bash
python3 tools/build_tokens.py <ID>
node tools/build_gloss.mjs <ID>
node tools/todo_gloss.mjs <ID>      # new words a re-cut exposed (迷迷糊 → 迷迷糊糊); gloss them
node tools/audit.mjs
```

Gloss new words by the add-episode skill's rules (meaning from the CC-CEDICT sense, Hán Việt
left blank rather than guessed). If `audit.mjs` lists a gloss no episode uses any more, it is
usually a fragment of the old cut (`不人鬼不鬼`), so delete it. A real word (`迷糊`) can stay.

## 5. Report

Tell the user, in their language: sentences → lines, the median and longest line from `report`,
any line left over 22 and why, and how many new words were glossed. Don't commit. Commits and
pushes wait for the user, as in add-episode.
