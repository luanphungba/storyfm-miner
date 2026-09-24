"""Cuts an episode's cues into words, so a tap on the transcript lands on a whole word.

The page cannot do this itself: browser word segmentation splits Chinese compounds wrongly (互联网
into 互/联/网, 面试官 into 面试/官), and shipping a segmenter plus the 11000-word HSK list to a
phone to redo the same work on every page load would be wasteful. So the cutting happens once, here,
and the player only reads spans.

Each token also carries what the card shows under the meaning: the word's HSK band, whether it is a
proper noun, and how often it is said across every episode we have. The transcript itself stays
unmarked — colouring words by band was tried and measured, and marking every word at HSK 1-3 lit up
three quarters of the page, because almost everything spoken is common vocabulary.

Usage: python3 tools/build_tokens.py [EPISODE_ID ...]     (default: every episode in docs/data)
"""
import json
import pathlib
import re
import sys
from collections import Counter

import jieba.posseg as pseg

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
BANDS = json.loads((ROOT / "tools" / "hsk-bands.json").read_text())
# jieba's tags for person, place and organisation names. nz ("other proper noun") and nrt are left
# out on purpose: between them they called 孝顺, 普通, 聊天, 保安, 英语 and 默契 proper nouns, which
# is worse than missing a name — the card then tells the reader not to bother learning an ordinary word.
NAME_TAGS = {"nr", "ns", "nt"}
def HAN(text):
    """Does this piece contain Chinese at all? Punctuation and digits are not tap targets."""
    return any("\u3400" <= character <= "\u9fff" for character in text)


def episodes():
    """The transcripts themselves — not the sidecars this script and build_gloss.mjs write beside them."""
    return sorted(p for p in DATA.glob("E*.json") if p.name.count(".") == 1)


def cut(text):
    """[(word, pos, offset)] for the word-like pieces of one cue, in order."""
    out, at = [], 0
    for word, pos in pseg.cut(text):
        start = text.index(word, at)
        at = start + len(word)
        if HAN(word):
            out.append((word, pos, start))
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
        for cue in json.loads(path.read_text())["cues"]:
            for word, pos in pseg.cut(cue["text"]):
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
        and (word in proper or len(word) <= 3)
    }


def main(ids):
    files = [DATA / f"{i}.json" for i in ids] if ids else episodes()
    # Frequency is counted over every episode we have, not just the ones being rebuilt: a word is
    # worth learning because it keeps coming back across the show, not because it repeats in one story.
    corpus = Counter()
    for path in episodes():
        for cue in json.loads(path.read_text())["cues"]:
            corpus.update(w for w, _, _ in cut(cue["text"]))
    proper = names(episodes())

    for path in files:
        episode = json.loads(path.read_text())
        cues = []
        for cue in episode["cues"]:
            tokens = []
            for word, pos, start in cut(cue["text"]):
                tokens.append([
                    start,
                    len(word),
                    BANDS.get(word, 0),          # 0 = not on the HSK list at all
                    corpus[word],                 # occurrences across every episode
                    1 if word in proper else 0,   # a name is worth reading, rarely worth a card
                ])
            cues.append(tokens)
        out = path.with_suffix(".tok.json")
        out.write_text(json.dumps({"id": episode["id"], "cues": cues}, separators=(",", ":")))
        size = out.stat().st_size / 1024
        words = [t for c in cues for t in c]
        print(f"{episode['id']}: {len(words)} từ, {out.name} {size:.0f} KB")


if __name__ == "__main__":
    main(sys.argv[1:])
