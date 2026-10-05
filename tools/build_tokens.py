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

Usage: python3 tools/build_tokens.py [EPISODE_ID ...]     (default: every episode in docs/data)
Only the episodes named are cut again; every other one has its counts brought up to date, and the
lines are filed again from all of them.
"""
import json
import pathlib
import re
import sys
from collections import Counter

import jieba
import jieba.posseg as pseg

# Where jieba joins two words across their boundary, the card would gloss a word that is not there.
# The dictionary can be talked out of some (上将 "general" in 在此设备上将其打开, 会调 in 会调暗)...
jieba.suggest_freq(("上", "将"), tune=True)
for word in ("调暗", "轻扫", "墙纸"):
    jieba.suggest_freq(word, tune=True)
# A name its dictionary lacks is scattered too (奥/朗德 for Hollande); added as one, tagged a name.
jieba.add_word("奥朗德", tag="nr")
# ...the rest its HMM puts back together whatever the dictionary says (中和 "neutralize" in App中和任何,
# 上向 in 屏幕上向左轻扫, 隔/空投/送 for 隔空投送), so they are cut again after it, token by token. The
# same table puts back words it scatters (小组/件 for 小组件 "widget", 帧/率 for 帧率, 本/机 for 本机), and
# takes the Latin off a word jieba glued it to (SIM卡), since only Chinese is tapped.
RECUT = {
    "中和": ("中", "和"), "上向": ("上", "向"), "隔空投送": ("隔空", "投送"), "已连": ("已", "连"),
    "存至": ("存", "至"), "可让": ("可", "让"), "天前": ("天", "前"), "周后": ("周", "后"), "屏幕墙纸": ("屏幕", "墙纸"),
    "访问控制中心": ("访问", "控制中心"), "更大字体": ("更大", "字体"),
    "小组件": ("小组件",), "锁屏": ("锁屏",), "帧率": ("帧率",), "本机": ("本机",), "内建": ("内建",),
    "调高": ("调高",), "连拍": ("连拍",), "SIM卡": ("SIM", "卡"),
}

ROOT = pathlib.Path(__file__).resolve().parent.parent
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
# overrule, all of them electronics jargon from BV1HQTs6FEos: 连锡 a solder bridge, 上锡 to tin a
# pad, 千欧 kiloohm, 上拉 pull-up (resistor), and 孔中 cut out of 固定孔中 "into the mounting holes".
NOT_NAMES = {"连锡", "上锡", "千欧", "上拉", "孔中"}
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
    """[(word, pos, offset)] for the word-like pieces of one cue, in order."""
    out, at = [], 0
    for word, pos in pseg.cut(text):
        start = text.index(word, at)
        at = start + len(word)
        if HAN(word):
            out.append((word, pos, start))
    return recut(out)


def recut(tokens):
    """RECUT applied: a run of up to three adjacent tokens spelling a key becomes its parts."""
    out, k = [], 0
    while k < len(tokens):
        for span in (3, 2, 1):
            run = tokens[k:k + span]
            joined = "".join(word for word, _, _ in run)
            adjacent = all(run[j + 1][2] == run[j][2] + len(run[j][0]) for j in range(len(run) - 1))
            if len(run) == span and adjacent and joined in RECUT:
                at = run[0][2]
                for part in RECUT[joined]:
                    if HAN(part):   # SIM in SIM卡 is not a tap target
                        out.append((part, "x", at))
                    at += len(part)
                k += span
                break
        else:
            out.append(tokens[k])
            k += 1
    return out


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
    main() to fill in once every episode is cut. Also returns the words a line cut runs through."""
    cues = [[] for _ in episode["cues"]]
    straddling = []
    for text, lines in units(episode["cues"]):
        bounds = [offset for _, offset in lines] + [len(text)]
        for word, pos, start in cut(text):
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
    return cues, straddling


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


def main(ids):
    listed = episodes()
    paths = listed + [DATA / f"{i}.json" for i in ids if DATA / f"{i}.json" not in listed]
    rebuild = {DATA / f"{i}.json" for i in ids} if ids else set(paths)
    proper = names(paths)

    built = []
    for path in paths:
        episode = json.loads(path.read_text())
        out = path.with_suffix(".tok.json")
        if path in rebuild or not out.exists():
            cues, straddling = tokenize(episode, proper)
            for straddled in straddling:
                print(f"  · {episode['id']}: chỗ cắt tách {straddled} — thường là jieba ghép sai; nếu đó thật là một từ thì dời chỗ cắt")
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


if __name__ == "__main__":
    main(sys.argv[1:])
