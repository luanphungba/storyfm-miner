"""Cuts an episode's lines into words, so a tap on the transcript lands on a whole word.

The page cannot do this itself: browser word segmentation splits Chinese compounds wrongly (互联网
into 互/联/网, 面试官 into 面试/官), and shipping a segmenter plus the 11000-word HSK list to a
phone to redo the same work on every page load would be wasteful. So the cutting happens once, here,
and the player only reads spans.

Each token also carries what the card shows under the meaning: the word's HSK band, whether it is a
proper noun, and how often it is said across every episode we have. The transcript itself stays
unmarked — colouring words by band was tried and measured, and marking every word at HSK 1-3 lit up
three quarters of the page, because almost everything spoken is common vocabulary.

It also files every line a word is said in under that word (docs/data/words/), for the card's list of
them: a word the ear keeps missing is easier to catch heard in other sentences and other voices.

And it writes the words each line counts as toward the vocabulary (EXXX.vocab.json, docs/vocab.js):
dictionary words only, as the goal of ten thousand is counted in, so a phrase jieba kept whole
(学法语, 五十万, 是因为) counts as the words it is made of, and a name as none.

Usage: python3 tools/build_tokens.py [EPISODE_ID ...]     (default: every episode in docs/data)
Only the episodes named are cut again; every other one has its counts brought up to date, and the
lines are filed again from all of them.
"""
import json
import math
import pathlib
import re
import sys
from collections import Counter

import jieba
import jieba.posseg as pseg

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Where jieba joins two words across their boundary, the card would gloss a word that is not there.
# The dictionary can be talked out of some (上将 "general" in 在此设备上将其打开, 会调 in 会调暗)...
jieba.suggest_freq(("上", "将"), tune=True)
for word in ("调暗", "轻扫", "墙纸"):
    jieba.suggest_freq(word, tune=True)
# ...and the rest are written down in tools/segmentation.json, each with the episode and the line it
# was seen in, since a mis-cut fragment on the card (双十 out of 双十一) teaches a word nobody said. A
# name its dictionary lacks, which it scatters (史祥/莆, 奥/朗德), is added to it as one, tagged as the
# name it is. Every other mis-cut is cut again after jieba, token by token: its HMM puts some words back
# together whatever the dictionary says (中和 "neutralize" in App中和任何), and most cuts depend on the
# words around them (等/于是 is 等于/是, but 于是 alone is right), which a run of tokens spells out
# and a dictionary weight does not. The same table puts back words it scatters (小组/件 for 小组件
# "widget"), and takes the Latin off a word jieba glued it to (SIM卡), since only Chinese is tapped.
SEGMENTATION = json.loads((ROOT / "tools" / "segmentation.json").read_text(encoding="utf-8"))
for name, (tag, _episode, _seen) in SEGMENTATION["names"].items():
    jieba.add_word(name, tag=tag)
for run, (cut, _episode, seen) in SEGMENTATION["recut"].items():
    if cut.replace("/", "") != run or run not in seen:
        sys.exit(f"tools/segmentation.json: {run} → {cut} ({seen}) — bỏ dấu / phải ra đúng {run}, và câu phải có {run}")
RECUT = {run: tuple(cut.split("/")) for run, (cut, _episode, _seen) in SEGMENTATION["recut"].items()}
# The most tokens a RECUT key is spelled over: a number read out digit by digit is cut into many
# (三/十二点/七六/八千/赫兹 for 三十二点七六八千赫兹, 32.768 kHz).
LONGEST_RUN = 5

DATA = ROOT / "docs" / "data"
BANDS = json.loads((ROOT / "tools" / "hsk-bands.json").read_text())
# The lines a word is said in, split over this many files by the sum of the word's code points
# (docs/examples.js picks the file the same way): all of them in one file is half a megabyte on
# a phone, for one word's few lines.
WORDS = DATA / "words"
BUCKETS = 64
# A word said thousands of times needs a handful of lines to be heard in, not all of them.
LINES_PER_WORD = 20
# jieba's tags for person, place and organisation names. nz ("other proper noun") and nrt are left
# out on purpose: between them they called 孝顺, 普通, 聊天, 保安, 英语 and 默契 proper nouns, which
# is worse than missing a name — the card then tells the reader not to bother learning an ordinary word.
NAME_TAGS = {"nr", "ns", "nt"}
# Words jieba calls names often enough to win the vote that neither the syllabus nor CC-CEDICT can
# overrule. Electronics jargon from BV1HQTs6FEos: 连锡 a solder bridge, 上锡 to tin a pad, 千欧
# kiloohm, 上拉 pull-up (resistor). From E080: 高三 the last year of high school, and 祝你们 "wishing
# you". From SCN20200604: 二本 and 三本 the second and third tier of universities, 托关系 "pull strings",
# 鸭嘴 a duck's bill. From DMP20250404: 新闻台 a news channel. From CC19: 扁平化 "flattening", of a
# company with few levels of hierarchy.
NOT_NAMES = {"连锡", "上锡", "千欧", "上拉", "高三", "祝你们", "二本", "三本", "托关系", "鸭嘴", "新闻台", "扁平化"}
# A number spelled out (三十, 十四) is not a word to learn once its digits are known, so a word of
# these alone counts as none, unless the syllabus teaches it (万一 "in case").
NUMERALS = set("零〇一二三四五六七八九十百千万亿两几")
# The bands a learner is taken to know before listening, so they count toward the vocabulary unheard.
BASE_BANDS = {1, 2}
# The longest dictionary word a phrase is split into.
LONGEST_PART = 6
# Where a sentence that stops on one of these ends, the next one starts a word of its own.
SENTENCE_END = re.compile(r"[。，、？！：；…—”\"》）),.?!]\s*$")
def HAN(text):
    """Does this piece contain Chinese at all? Punctuation and digits are not tap targets."""
    return any("\u3400" <= character <= "\u9fff" for character in text)


def episodes():
    """Every built episode — 故事FM, Bilibili and the other podcasts alike — as the index lists them."""
    listed = json.loads((DATA / "index.json").read_text(encoding="utf-8"))["episodes"]
    return [DATA / f"{episode['id']}.json" for episode in listed]


def units(cues):
    """The runs of lines that were one sentence before the page cut them short.

    Words are cut over a whole unit, never a single line: jieba reads a sentence differently once it
    is chopped up (迷迷糊 | 糊的 gave 迷迷糊 and 糊), so cutting per line would change the word list —
    and turn up words with no meaning written — every time the lines are re-cut. Yields
    (unit text, [(cue index, offset of that line in the unit)]).
    """
    run, text = [], ""
    for index, cue in enumerate(cues):
        key = cue.get("u", cue.get("s", cue["i"]))
        if run and key != run_key:
            yield text, run
            run, text = [], ""
        run_key = key
        run.append((index, len(text)))
        text += cue["text"]
    if run:
        yield text, run


def cut(text):
    """[(word, pos, offset)] for the word-like pieces of one cue, in order, and the RECUT runs cut
    again in it."""
    out, at = [], 0
    for word, pos in pseg.cut(text):
        start = text.index(word, at)
        at = start + len(word)
        if HAN(word):
            out.append((word, pos, start))
    return recut(out)


def recut(tokens):
    """RECUT applied: a run of up to LONGEST_RUN adjacent tokens spelling a key becomes its parts.
    Also returns the keys that matched."""
    out, matched, k = [], set(), 0
    while k < len(tokens):
        for span in range(LONGEST_RUN, 0, -1):
            run = tokens[k:k + span]
            joined = "".join(word for word, _, _ in run)
            adjacent = all(run[j + 1][2] == run[j][2] + len(run[j][0]) for j in range(len(run) - 1))
            if len(run) == span and adjacent and joined in RECUT:
                at = run[0][2]
                for part in RECUT[joined]:
                    if HAN(part):   # SIM in SIM卡 is not a tap target
                        out.append((part, "x", at))
                    at += len(part)
                matched.add(joined)
                k += span
                break
        else:
            out.append(tokens[k])
            k += 1
    return out, matched


def broken_words(episode, known):
    """Words the ASR broke across two sentences (…甚至是麻 | 烦。), often where it heard the speaker
    change in the wrong place: jieba, given the two run together, cuts a word some dictionary has
    across the boundary, and the first does not end in punctuation. Cut apart, the card would gloss
    two halves. Returns (word, the sentence to join onto the next, the text either side)."""
    found = []
    pairs = list(units(episode["cues"]))
    for (before, _), (after, lines) in zip(pairs, pairs[1:]):
        if SENTENCE_END.search(before):
            continue
        # The sentence just before the one the next unit starts with, which a join of its own may
        # have folded into an earlier sentence's line.
        first = episode["cues"][lines[0][0]]
        last = first.get("u", first["s"]) - 1
        words, _ = cut(before + after)
        for word, _, start in words:
            if start < len(before) < start + len(word) and word in known:
                found.append((word, last, f"{before[-8:]} | {after[:8]}"))
    return found


def unmatched(episode, cues, matched):
    """The fixes tools/segmentation.json says were seen in this episode that are not on its page: a
    run jieba no longer cuts the way its key spells, or a name it still scatters."""
    words = {word for word, _, _ in said(episode, cues)}
    names = [name for name, (_, seen_in, _) in SEGMENTATION["names"].items() if seen_in == episode["id"] and name not in words]
    runs = [run for run, (_, seen_in, _) in SEGMENTATION["recut"].items() if seen_in == episode["id"] and run not in matched]
    return names + runs


def cedict_proper():
    """Words CC-CEDICT itself treats as proper nouns, by the capital letter it puts on their pinyin.

    Returns (proper, common). A word listed with a lowercase reading is ordinary vocabulary whatever
    jieba tagged it: that is what rescues 显微镜, 毛毛虫, 哈欠, 胡同 and 折寿, none of which the HSK
    syllabus contains, so the HSK check below cannot reach them.
    """
    path = ROOT / "tools" / ".cache" / "cedict.txt"
    if not path.exists():
        print("(chưa có tools/.cache/cedict.txt — bỏ qua lớp kiểm tên riêng bằng từ điển)")
        return set(), set()
    proper, common = set(), set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        match = re.match(r"^\S+ (\S+) \[([^]]+)\]", line)
        if not match:
            continue
        word, reading = match.groups()
        (proper if reading[:1].isupper() else common).add(word)
    return proper, common


def names(paths):
    """Words to mark as names, after two checks that jieba on its own does not make.

    A tag is assigned per occurrence, so the same word can come back nr in one line and an ordinary
    verb in the next; a word is only a name if the name reading wins across the whole corpus. And a
    word the HSK syllabus lists is never a name — syllabuses do not teach people's names — which is
    what rules out 东西, 老公, 哥哥, 阿姨 and 城市, all of them tagged ns or nr somewhere.
    """
    tags = {}
    for path in paths:
        for text, _ in units(json.loads(path.read_text())["cues"]):
            for word, pos in pseg.cut(text):
                if HAN(word):
                    counts = tags.setdefault(word, Counter())
                    counts[pos in NAME_TAGS] += 1
    proper, common = cedict_proper()
    # Biased against flagging: a wrong "tên riêng" tells the reader not to bother learning an
    # ordinary word, while a missed name only costs a label. So a word has to survive every check —
    # and one jieba invented out of a run of ordinary words (刚刚开始, 努力学习) is refused the
    # benefit of the doubt unless a dictionary backs it up.
    return {
        word: True
        for word, counts in tags.items()
        if counts[True] > counts[False]
        and word not in BANDS
        and word not in common
        and word not in NOT_NAMES
        and (word in proper or len(word) <= 3)
    }


def tokenize(episode, proper):
    """Each cue's word spans, [start, length, band, count, is name], with the count left at 0 for
    main() to fill in once every episode is cut. Also returns the words a line cut runs through, and
    the RECUT runs cut again."""
    cues = [[] for _ in episode["cues"]]
    straddling, matched = [], set()
    for text, lines in units(episode["cues"]):
        bounds = [offset for _, offset in lines] + [len(text)]
        words, recut_here = cut(text)
        matched |= recut_here
        for word, pos, start in words:
            end = start + len(word)
            # A word the cut runs through is split at it. Usually jieba is the one that erred —
            # it glued 是因为 or 心理师王洋 across a clause — and the pieces are the real words.
            pieces = [(max(start, lo), min(end, hi), n) for n, (lo, hi) in enumerate(zip(bounds, bounds[1:])) if lo < end and start < hi]
            if len(pieces) > 1:
                straddling.append(word)
            for lo, hi, n in pieces:
                piece = text[lo:hi]   # the word itself, or its part on this line
                cues[lines[n][0]].append([
                    lo - bounds[n],
                    hi - lo,
                    BANDS.get(piece, 0),          # 0 = not on the HSK list at all
                    0,                             # occurrences across every episode, filled in by main()
                    1 if piece in proper else 0,   # a name is worth reading, rarely worth a card
                ])
    return cues, straddling, matched


def said(episode, cues):
    """(word, cue index, offset in the line) for every word span of an episode, in order."""
    for index, (cue, spans) in enumerate(zip(episode["cues"], cues)):
        for start, length, *_ in spans:
            yield cue["text"][start:start + length], index, start


def bucket(word):
    """Which file of docs/data/words a word is filed in — docs/examples.js works it out the same way."""
    return sum(ord(character) for character in word) % BUCKETS


def spread(groups, limit):
    """Up to limit items, taken from each group in turn, so a common word's lines come from as many
    episodes as there are rather than all from the first one. Kept in their groups' order."""
    taken, depth = [0] * len(groups), 0
    while sum(taken) < limit and any(len(group) > depth for group in groups):
        for k, group in enumerate(groups):
            if sum(taken) < limit and len(group) > depth:
                taken[k] += 1
        depth += 1
    return [item for group, n in zip(groups, taken) for item in group[:n]]


def file_lines(built):
    """Every line each word is said in, by word, for the card's list (docs/examples.js).

    A line is [episode, cue index, offset of the word, start, end, text] — what the list shows, so a
    lookup fetches one small file rather than each episode's transcript. Each episode's title and
    audio go once into episodes.json. Chapters are left to the page, which reads them from the
    episode's own .chapters.json: they are cut after this runs, and recut on their own. A word said
    only once is left out, as the line it is in is the one already on the page.
    """
    by_word, about = {}, {}
    for episode, cues in built:
        for word, index, start in said(episode, cues):
            cue = episode["cues"][index]
            line = [episode["id"], index, start, cue["start"], cue["end"], cue["text"]]
            by_word.setdefault(word, {}).setdefault(episode["id"], []).append(line)
        about[episode["id"]] = {
            "title": episode["title"],
            "audio": episode["audio"].get("m4a") or episode["audio"]["mp3"],
        }

    buckets = [{} for _ in range(BUCKETS)]
    for word, episodes_said in by_word.items():
        if sum(map(len, episodes_said.values())) > 1:
            buckets[bucket(word)][word] = spread(list(episodes_said.values()), LINES_PER_WORD)
    WORDS.mkdir(exist_ok=True)
    for n, words in enumerate(buckets):
        (WORDS / f"{n}.json").write_text(json.dumps(words, ensure_ascii=False, separators=(",", ":")))
    (WORDS / "episodes.json").write_text(json.dumps(about, ensure_ascii=False, separators=(",", ":")))
    size = sum(path.stat().st_size for path in WORDS.iterdir()) / 1024
    print(f"words/: {sum(map(len, buckets))} từ nói ở hơn một câu, {BUCKETS + 1} tệp, {size:.0f} KB")


def countable(word, common):
    """Is this a word that counts toward the vocabulary: in a dictionary as ordinary vocabulary, and
    not a number spelled out."""
    spelled_number = len(word) > 1 and set(word) <= NUMERALS and word not in BANDS
    return (word in common or word in BANDS) and not spelled_number


def counted_parts(span, common, known):
    """The words a span counts as: itself when a dictionary has it as a word; else the dictionary
    words it is made of, as jieba would cut it if it knew no others (学法语 → 学 法语, not 学法 语).
    A name among them (四川 in 四川话) and a character no dictionary has count as nothing. `known` is
    every word a dictionary has, names too, so a name is cut out whole rather than read as characters."""
    if span in common or span in BANDS:
        return [span] if countable(span, common) else []
    total = math.log(jieba.dt.total)
    # best[i]: the most likely cut of span[i:], as (log probability, end of its first piece); a
    # negative end is a character skipped, at a cost no dictionary word comes near.
    best = [(0.0, 0)] * (len(span) + 1)
    for i in range(len(span) - 1, -1, -1):
        options = [
            (math.log(jieba.dt.FREQ.get(span[i:j]) or 1) - total + best[j][0], j)
            for j in range(i + 1, min(len(span), i + LONGEST_PART) + 1)
            if span[i:j] in known
        ]
        best[i] = max([*options, (-100 + best[i + 1][0], -(i + 1))])
    parts, i = [], 0
    while i < len(span):
        end = best[i][1]
        if end > 0 and countable(span[i:end], common):
            parts.append(span[i:end])
        i = abs(end)
    return parts


def count_words(built):
    """Each episode's words as the vocabulary counts them, line by line, in EXXX.vocab.json:
    [line start, "word word …"] for each line with any. And vocab.json beside them: the words taken
    as known before listening, and the parts of every span that counts as other words than itself,
    for the taps and known words, which the server keeps as the span tapped."""
    proper, common = cedict_proper()
    if not common:
        print("(chưa có tools/.cache/cedict.txt — không đếm vốn từ)")
        return
    known = common | proper | BANDS.keys()
    splits = {}
    for episode, cues in built:
        lines = []
        for cue, spans in zip(episode["cues"], cues):
            words = []
            for start, length, _band, _count, is_name in spans:
                span = cue["text"][start:start + length]
                parts = [] if is_name else counted_parts(span, common, known)
                if parts != [span]:
                    splits[span] = parts
                words += parts
            if words:
                lines.append([cue["start"], " ".join(words)])
        out = DATA / f"{episode['id']}.vocab.json"
        out.write_text(json.dumps({"id": episode["id"], "cues": lines}, ensure_ascii=False, separators=(",", ":")))
    base = sorted(word for word, band in BANDS.items() if band in BASE_BANDS and countable(word, common))
    vocab = {"base": base, "splits": dict(sorted(splits.items()))}
    (DATA / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, separators=(",", ":")))
    print(f"vocab: {len(base)} từ HSK 1-2, {len(splits)} cụm đếm thành từ khác")


def main(ids):
    listed = episodes()
    paths = listed + [DATA / f"{i}.json" for i in ids if DATA / f"{i}.json" not in listed]
    rebuild = {DATA / f"{i}.json" for i in ids} if ids else set(paths)
    proper = names(paths)
    known = set().union(*cedict_proper(), BANDS)

    built = []
    for path in paths:
        episode = json.loads(path.read_text())
        out = path.with_suffix(".tok.json")
        if path in rebuild or not out.exists():
            cues, straddling, matched = tokenize(episode, proper)
            for straddled in straddling:
                print(f"  · {episode['id']}: chỗ cắt tách {straddled} — thường là jieba ghép sai; nếu đó thật là một từ thì dời chỗ cắt")
            for fix in unmatched(episode, cues, matched):
                print(f"  ⚠ {episode['id']}: {fix} trong tools/segmentation.json không khớp chỗ nào — viết lại khoá theo đúng cách jieba cắt")
            for word, s, around in broken_words(episode, known):
                print(f"  ⚠ {episode['id']}: ASR ngắt giữa từ {word} ({around}) — nối câu {s} sang câu sau bằng split-cues: + nếu cùng người nói, ++ nếu khác")
        else:
            # An episode not asked for keeps its words: cut again, it could turn up a word its gloss
            # was never written for. Only its counts are brought up to date, below.
            cues = json.loads(out.read_text())["cues"]
        built.append((episode, cues))

    # Frequency is counted over every episode we have, not just the ones being rebuilt: a word is
    # worth learning because it keeps coming back across the show, not because it repeats in one
    # story. It counts the words as tapped, so it is the same number as the lines the card lists.
    counts = Counter(word for episode, cues in built for word, _, _ in said(episode, cues))
    for (episode, cues), path in zip(built, paths):
        for cue, spans in zip(episode["cues"], cues):
            for span in spans:
                span[3] = counts[cue["text"][span[0]:span[0] + span[1]]]
        out = path.with_suffix(".tok.json")
        out.write_text(json.dumps({"id": episode["id"], "cues": cues}, separators=(",", ":")))
        if path in rebuild:
            size = out.stat().st_size / 1024
            words = [t for c in cues for t in c]
            print(f"{episode['id']}: {len(words)} từ, {out.name} {size:.0f} KB")
    file_lines(built)
    count_words(built)


if __name__ == "__main__":
    main(sys.argv[1:])
