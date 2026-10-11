"""Hears a sentence again with local whisper, to settle a word the ASR may have misheard.

AssemblyAI is confidently wrong now and then, and reading alone cannot always tell which word was
said: 直接切了 or 直接签了, 大步进砍头 or 大不敬砍头. Two large whisper models listening to the same
stretch of audio are a second and third opinion. On MC20240303 they settled four of eight spots that
whisper medium could not, so medium is not used here: it paraphrases, and writes traditional
characters without a prompt.

Each sentence is heard by large-v3 and large-v3-turbo, each once without a prompt and once with one.
The unprompted run is the honest one; the prompt only steers the output to simplified Mandarin, and
a prompt naming the topic can pull a hearing towards the word you expect. The slice runs from a
little before the sentence to a little after it, because a word cut at its edge is misheard.

Whisper is evidence, not the answer. It drops stutters and fillers (得得 becomes 得), fills a gap
with a stock phrase that was never said (请不吝点赞订阅), and cannot tell homophones apart (首/手,
代/带): read every hearing against the sentence and the episode before changing a character.

Usage: python3 .claude/skills/verify-transcript/scripts/listen.py EPISODE_ID SENTENCE [SENTENCE ...]
SENTENCE is the sentence index the corrections ledger uses (the `s` of the page's lines). The audio
is data/audio/<id>.m4a, or the mp3 tools/onsets.mjs caches in tools/.cache/audio/.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import whisper

ROOT = pathlib.Path(__file__).resolve().parents[4]
MODELS = ("large-v3", "large-v3-turbo")
PROMPT = "以下是普通话的句子。"
BEFORE, AFTER = 1.5, 1.0  # seconds of context around the sentence


def audio_file(episode_id):
    for path in (ROOT / "data" / "audio" / f"{episode_id}.m4a",
                 ROOT / "tools" / ".cache" / "audio" / f"{episode_id}.mp3"):
        if path.exists():
            return path
    sys.exit(f"Không có audio của {episode_id}: chạy node tools/onsets.mjs {episode_id} trước.")


def sentences(episode_id, wanted):
    cues = json.loads((ROOT / "docs" / "data" / f"{episode_id}.json").read_text())["cues"]
    found = {}
    for s in wanted:
        lines = [cue for cue in cues if cue["s"] == s]
        if not lines:
            sys.exit(f"{episode_id} không có câu {s}.")
        found[s] = {"start": lines[0]["start"], "end": lines[-1]["end"],
                    "text": "".join(cue["text"] for cue in lines)}
    return found


def slice_audio(source, start, end, target):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{max(0, start - BEFORE):.2f}",
                    "-to", f"{end + AFTER:.2f}", "-i", str(source), "-ar", "16000", "-ac", "1",
                    str(target)], check=True)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__.split("Usage: ")[1].split("\n")[0])
    episode_id, wanted = sys.argv[1], [int(s) for s in sys.argv[2:]]
    found = sentences(episode_id, wanted)
    source = audio_file(episode_id)
    hearings = {s: [] for s in wanted}
    with tempfile.TemporaryDirectory() as tmp:
        for s, sentence in found.items():
            slice_audio(source, sentence["start"], sentence["end"], pathlib.Path(tmp) / f"{s}.wav")
        for name in MODELS:
            model = whisper.load_model(name)
            for s in wanted:
                for prompt in (None, PROMPT):
                    text = model.transcribe(str(pathlib.Path(tmp) / f"{s}.wav"), language="zh",
                                            fp16=False, temperature=0, initial_prompt=prompt)["text"]
                    hearings[s].append((f"{name}{' +prompt' if prompt else ''}", text.strip()))
            del model
    for s in wanted:
        sentence = found[s]
        print(f"{s} [{sentence['start']:.2f}–{sentence['end']:.2f}] ASR: {sentence['text']}")
        for label, text in hearings[s]:
            print(f"  {label:<24} {text}")


if __name__ == "__main__":
    main()
