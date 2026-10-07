"""Adds Anki cards from the player on a phone, where the CI Miner extension cannot run.

The extension talks to Anki desktop on the same machine. A phone has neither, so this keeps a copy
of the collection on a server, adds notes to it, and syncs it through AnkiWeb like any other device.

    python server/miner.py login       # once: AnkiWeb account, then the first download
    python server/miner.py serve       # the API the player calls
    python server/miner.py seed-taps   # once, server stopped: the cards added so far count as taps

Settings come from the environment (see server/.env.example).

Sync rule: this copy only ever *downloads* a full collection, never uploads one. It holds nothing
that is not already on AnkiWeb — every write here is synced straight away — so when Anki asks for a
full sync the answer is always "take AnkiWeb's", and the reviews done on other devices are never at
risk. A full upload from here would be the one way to lose them, so there is no code path to it.
"""

import getpass
import hmac
import html
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from anki.collection import Collection
from anki.sync import SyncAuth, SyncOutput

ROOT = Path(__file__).resolve().parent.parent

# Must match the extension: cards from the phone and from the desktop are the same note type in the
# same deck. The note type is the desktop's — this server fills it in and never creates or edits it.
MODEL_NAME = "CI-Chinese-YouTube"
CONTEXT_FIELDS = ["Sentence", "SentencePinyin", "SentenceMeaning", "VideoTitle", "VideoLink"]

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

# A wrong token is answered with 401 until an address has missed this many times inside the window,
# then with 429 until the window passes. The token is long enough that this is not what keeps it
# safe; it only stops a scanner from hammering the collection lock.
MAX_FAILURES = 10
FAILURE_WINDOW_S = 15 * 60


def load_env_file(path):
    """KEY=value lines, for running by hand; values already in the environment win."""
    if path.exists():
        for line in path.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.strip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip())


load_env_file(ROOT / "server/.env")
# Anki turns the day at 4:00 by the clock of the machine it runs on, and a server's is not the
# learner's: measured with TZ=UTC, "today" began at 11:00 in Vietnam, and every scheduler call
# rewrote the synced localOffset to UTC's. Read before the collection opens, TZ fixes both.
time.tzset()


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None:
        sys.exit(f"Missing {name}. See server/.env.example.")
    return value


# ---------- HSK ----------

# The same 2021 syllabus the player's word card reads, so a word shows one level on both.
# Band 7 is levels 7-9, which the syllabus lists as one.
HSK_BANDS = json.loads((ROOT / "tools/hsk-bands.json").read_text(encoding="utf-8"))


def hsk_level(word):
    band = HSK_BANDS.get(word.strip())
    if not band:
        return {"level": "ngoài HSK", "levelTag": "HSK::none"}
    name = "7-9" if band == 7 else str(band)
    return {"level": f"HSK {name}", "levelTag": f"HSK::{name}"}


# ---------- DeepSeek ----------

# Copied from the extension (youtube-chinese-miner/src/background.js, promptZh with Vietnamese), so a
# word looked up on the phone is explained the same way as on the desktop.
LOOKUP_PROMPT = """You are a Mandarin Chinese tutor helping a Vietnamese-speaking learner who studies from YouTube videos.

You receive:
- marked_sentence: one caption line in which the learner's selection is wrapped in 【】. Captions are auto-generated: no punctuation, possible speech-recognition errors, filler words and stutters.
- context: neighbouring caption lines.
The selection comes from the browser's double-click word breaker, so it may be wrong (too short, too long, or spanning two words).

Tasks:
1. Identify the word or fixed expression the learner means: the natural dictionary unit (word, chengyu, idiom, slang) overlapping the selection at that position. If the selection is already a sensible unit, keep it.
2. Explain it as used in THIS context.

Reply with a single JSON object and nothing else:
{
  "word": "simplified Chinese",
  "traditional": "traditional form (same as word if identical)",
  "pinyin": "tone marks, syllables separated by spaces, the reading used in this context",
  "hanViet": "Hán Việt reading in UPPERCASE, one syllable per character, e.g. CỤC XÚC; \\"\\" if unsure",
  "pos": "part of speech, in Vietnamese",
  "meaning": "short meaning in Vietnamese as used here (max ~12 words)",
  "otherMeanings": ["up to 3 other common meanings in Vietnamese; [] if none"],
  "notes": "in Vietnamese: slang/idiom origin, register, or common confusion; \\"\\" if nothing useful",
  "sentence": "the SAME caption line, cleaned up: add punctuation, fix obvious speech-recognition slips (homophones, digits heard as characters, e.g. 五幺/五牙 -> 51, 本科 -> 本套), drop stutters and fillers. Stay inside the line: do NOT add words that were not spoken in it, do NOT merge in neighbouring lines, and if the line is only a fragment leave it a fragment. If nothing is wrong, return it unchanged. Must contain word",
  "sentenceTranslation": "natural Vietnamese translation of sentence",
  "example": {
    "zh": "a new short easy sentence (HSK 1-3 vocabulary apart from word) that uses word naturally",
    "translation": "Vietnamese translation"
  }
}"""


def deepseek_lookup(marked, context, title):
    body = {
        "model": env("DEEPSEEK_MODEL", "deepseek-flash"),
        "stream": False,
        # Thinking is on by default for DeepSeek V4 models; a dictionary lookup doesn't need it.
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": LOOKUP_PROMPT},
            {"role": "user", "content": json.dumps(
                {"marked_sentence": marked, "context": context, "video_title": title}, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
        "max_tokens": 1200,
    }
    request = urllib.request.Request(
        DEEPSEEK_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {env('DEEPSEEK_API_KEY')}"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content = json.load(response)["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        raise ApiError(502, f"DeepSeek trả về không phải JSON: {content[:200]}")


# ---------- Anki ----------

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Anki:
    """The server's copy of the collection. One request touches it at a time."""

    def __init__(self, folder):
        folder.mkdir(parents=True, exist_ok=True)
        self.auth_file = folder / "auth.json"
        self.col = Collection(str(folder / "collection.anki2"))
        self.lock = threading.Lock()
        self.last_sync = None

    # --- sync ---

    def auth(self):
        if not self.auth_file.exists():
            return None
        saved = json.loads(self.auth_file.read_text())
        # An empty endpoint means AnkiWeb's default. Passed as "" rather than left unset, Anki reads
        # it as a server address and refuses it.
        return SyncAuth(hkey=saved["hkey"], endpoint=saved.get("endpoint") or None)

    def login(self, username, password):
        auth = self.col.sync_login(username=username, password=password, endpoint=None)
        self.auth_file.write_text(json.dumps({"hkey": auth.hkey, "endpoint": auth.endpoint}))
        self.auth_file.chmod(0o600)

    def sync(self):
        """A normal sync, or a full download when Anki says the two copies cannot be merged."""
        auth = self.auth()
        if auth is None:
            return  # a local copy for testing, never logged in to AnkiWeb
        out = self.col.sync_collection(auth, sync_media=False)
        if out.new_endpoint:
            auth.endpoint = out.new_endpoint
            self.auth_file.write_text(json.dumps({"hkey": auth.hkey, "endpoint": auth.endpoint}))
        if out.required == SyncOutput.FULL_UPLOAD:
            raise ApiError(409, "AnkiWeb đang trống. Sync từ Anki desktop trước; server không bao giờ upload đè.")
        if out.required in (SyncOutput.FULL_DOWNLOAD, SyncOutput.FULL_SYNC):
            self.col.close_for_full_sync()
            try:
                self.col.full_upload_or_download(auth=auth, server_usn=out.server_media_usn, upload=False)
            finally:
                self.col.reopen(after_full_sync=True)
        self.last_sync = time.time()

    # --- notes ---

    def model(self):
        model = self.col.models.by_name(MODEL_NAME)
        if not model:
            raise ApiError(409, f"Collection chưa có note type {MODEL_NAME}. Thêm một thẻ bằng extension trên máy tính rồi sync.")
        return model

    def notes_with_word(self, word):
        """Notes of any type whose first field is word — the field Anki itself checks for duplicates."""
        found = []
        for model in self.col.models.all():
            first = model["flds"][0]["name"]
            query = f'"note:{escape(model["name"])}" "{escape(first)}:{escape(word)}"'
            found += [self.col.get_note(note_id) for note_id in self.col.find_notes(query)]
        return found

    def status(self, word):
        return [{"noteId": note.id, "model": note.note_type()["name"]} for note in self.notes_with_word(word)]

    def saved_card(self, word):
        """Our own note for word, as field name -> value, or None."""
        for note in self.notes_with_word(word):
            if note.note_type()["name"] == MODEL_NAME:
                return dict(note.items())
        return None

    def add(self, fields, tags, deck):
        model = self.model()
        note = self.col.new_note(model)
        for name, value in fields.items():
            if name in note:
                note[name] = value
        note.tags = tags
        if self.notes_with_word(note.fields[0]):
            raise ApiError(409, "Từ này đã có trong Anki.")
        self.col.add_note(note, self.col.decks.id(deck))
        return note.id

    def relearn(self, word, fields, tags):
        """Looking a known word up again means it was forgotten: answer its cards Again, so they come
        back today with their history kept, and give our own notes the sentence just met."""
        notes = self.notes_with_word(word)
        if not notes:
            raise ApiError(404, "Không còn thấy từ này trong Anki.")
        ours = [note for note in notes if note.note_type()["name"] == MODEL_NAME]
        if fields:
            for note in ours:
                for name in CONTEXT_FIELDS:
                    note[name] = fields.get(name, "")
                note.tags = sorted(set(note.tags) | set(tags))
                self.col.update_note(note)
        cards = [card_id for note in notes for card_id in note.card_ids()]
        self.col.sched.unsuspend_cards(cards)
        for card_id in cards:
            card = self.col.get_card(card_id)
            card.start_timer()
            self.col.sched.answerCard(card, 1)
        return {"updated": len(ours) if fields else 0, "kept": not fields}

    # --- today ---

    def today(self, deck):
        """New cards added to deck today, the deck's new cards per day, and the new cards still waiting
        to be studied: what the player warns with before it spends a lookup on another word. "Today"
        is Anki's day by this machine's clock, which is why TZ is set (see load_env_file)."""
        deck_id = self.col.decks.id_for_name(deck)
        if deck_id is None:
            return None
        in_deck = f'"deck:{escape(deck)}"'
        return {
            "added": len(self.col.find_cards(f"{in_deck} added:1")),
            "limit": self.col.decks.config_dict_for_deck_id(deck_id)["new"]["perDay"],
            "waiting": len(self.col.find_cards(f"{in_deck} is:new -is:suspended -is:buried")),
        }

    def added_days(self, deck):
        """How many notes went into deck on each day. A note's id is the moment it was made, in
        milliseconds, so this needs nothing but the ids."""
        days = {}
        for note_id in self.col.find_notes(f'"deck:{escape(deck)}"'):
            day = study_day(note_id / 1000)
            days[day] = days.get(day, 0) + 1
        return days

    def player_taps(self, deck):
        """Each card in deck added from the player, as the tap it took to add it: its word, tapped on the
        day the card was made, in the line its link plays. The cards made before taps were kept."""
        taps = []
        for note_id in self.col.find_notes(f'"deck:{escape(deck)}" "note:{escape(MODEL_NAME)}"'):
            note = self.col.get_note(note_id)
            line = player_line(note["VideoLink"])
            if line:
                taps.append({"day": study_day(note_id / 1000), "word": html.unescape(note["Word"]).strip(),
                             "ep": line[0], "at": line[1]})
        return taps


def escape(text):
    return "".join("\\" + c if c in '\\"*_' else c for c in str(text))


# ---------- studied chapters ----------

# A studied chapter is matched to the one tapped by its episode and where it starts; this much apart
# is still the same chapter, after a re-cut nudged its first line.
SAME_START_S = 0.5


def study_day(moment=None):
    """Today as Anki counts it, turning at 4:00, so a chapter finished after midnight counts for the
    evening it was studied in, as its new cards do. Or the day of another moment, in epoch seconds."""
    return time.strftime("%Y-%m-%d", time.localtime((time.time() if moment is None else moment) - 4 * 3600))


class Studied:
    """Chapters marked studied in the player, each with the days it was studied, for the list played
    back later on any device. Not in the collection: it is not Anki's, and a full download from AnkiWeb
    would wipe it. A small JSON file beside it, read whole and written whole through a temp file."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def read(self):
        return json.loads(self.path.read_text()) if self.path.exists() else {"chapters": []}

    def write(self, data):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        temporary.replace(self.path)

    @staticmethod
    def find(chapters, ep, start):
        return next((c for c in chapters if c["ep"] == ep and abs(c["start"] - start) < SAME_START_S), None)

    def mark(self, chapter):
        """Studied today: added with today's date, or today's date added to it."""
        with self.lock:
            data = self.read()
            found = self.find(data["chapters"], chapter["ep"], chapter["start"])
            today = study_day()
            if found:
                dates = found["dates"]
                found.update(chapter)
                found["dates"] = dates if today in dates else [*dates, today]
            else:
                data["chapters"].append({**chapter, "dates": [today]})
            self.write(data)
            return data

    def unmark(self, ep, start):
        """Takes back today's mark, and the chapter with it if today was its only day."""
        with self.lock:
            data = self.read()
            found = self.find(data["chapters"], ep, start)
            if found:
                found["dates"] = [d for d in found["dates"] if d != study_day()]
                if not found["dates"]:
                    data["chapters"].remove(found)
                self.write(data)
            return data


def studied_chapter(body):
    """The chapter as the player sends it, checked: it is played back later exactly as stored."""
    try:
        chapter = {
            "ep": str(body["ep"])[:40],
            "episode": str(body.get("episode", ""))[:200],
            "audio": str(body["audio"])[:500],
            "n": int(body.get("n", 0)),
            "zh": str(body.get("zh", ""))[:60],
            "vi": str(body.get("vi", ""))[:120],
            "start": float(body["start"]),
            "end": float(body["end"]),
        }
    except (KeyError, TypeError, ValueError):
        raise ApiError(400, "Thiếu thông tin chương.")
    if not chapter["audio"].startswith("https://") or chapter["end"] <= chapter["start"]:
        raise ApiError(400, "Chương không hợp lệ.")
    return chapter


# ---------- listening hours ----------

LISTENING_PAGES = {"player", "listen"}
DAY_S = 24 * 3600
# The player's fastest speed, so a day of listening holds at most twice a day of audio.
MAX_RATE = 2


class ListeningLog:
    """The time the pages played audio (see docs/meter.js), toward a goal of a thousand hours, and the
    chapter it was spent on. Each page load sends its running totals, one row per day and chapter it
    played, and a row is only ever raised to what is sent, never lowered or removed: two devices
    playing at once each add rows of their own, and a report sent twice, or overtaken by a later one,
    counts once.

    SQLite, where the studied chapters are a JSON file: these rows grow by the minute, and a report
    should write only its own rows, all of them or none."""

    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS listened (
                    session TEXT NOT NULL,  -- one page load
                    day TEXT NOT NULL,      -- YYYY-MM-DD, as study_day counts it
                    page TEXT NOT NULL,     -- player or listen
                    ep TEXT NOT NULL,
                    start REAL,             -- the chapter's start; NULL between chapters
                    seconds REAL NOT NULL,  -- time spent listening
                    audio REAL NOT NULL     -- audio heard: that time times the speed
                )"""
            )
            self.db.execute("CREATE INDEX IF NOT EXISTS listened_by_session ON listened (session, day)")

    def record(self, entries):
        """Raises each row to what was sent, adds the rows not seen before, and returns the hours per day.
        One page load can count a chapter as both: the player studies it, and hears it again once it was
        studied on an earlier day."""
        with self.lock:
            with self.db:
                for entry in entries:
                    raised = self.db.execute(
                        "UPDATE listened SET seconds = MAX(seconds, :seconds), audio = MAX(audio, :audio)"
                        " WHERE session = :session AND day = :day AND page = :page AND ep = :ep AND start IS :start",
                        entry,
                    ).rowcount
                    if not raised:
                        self.db.execute(
                            "INSERT INTO listened VALUES (:session, :day, :page, :ep, :start, :seconds, :audio)", entry
                        )
            return self.days()

    def days(self):
        """Seconds spent listening per day and page: {"2026-10-02": {"player": 2400.0, "listen": 1920.0}}.
        The caller holds the lock."""
        days = {}
        for day, page, seconds in self.db.execute("SELECT day, page, SUM(seconds) FROM listened GROUP BY day, page"):
            days.setdefault(day, {})[page] = round(seconds, 1)
        return days

    def summary(self):
        """What the dashboard shows: the days, and each chapter heard with how long, how much of its audio
        (its passes, whatever the speed) and on how many days. Nghe lại also needs the audio of it heard
        on each day, to tell the days it was heard through from the days it was skimmed."""
        with self.lock:
            chapters = {
                (ep, start): {"ep": ep, "start": start, "seconds": round(seconds, 1), "audio": round(audio, 1),
                              "days": days, "last": last, "byDay": {}}
                for ep, start, seconds, audio, days, last in self.db.execute(
                    "SELECT ep, start, SUM(seconds), SUM(audio), COUNT(DISTINCT day), MAX(day) FROM listened"
                    " WHERE start IS NOT NULL GROUP BY ep, start"
                )
            }
            for ep, start, day, audio in self.db.execute(
                "SELECT ep, start, day, SUM(audio) FROM listened WHERE start IS NOT NULL GROUP BY ep, start, day"
            ):
                chapters[(ep, start)]["byDay"][day] = round(audio, 1)
            return {"days": self.days(), "chapters": list(chapters.values())}


def listened_entry(entry):
    """One page load's count for one day and chapter, as the page sends it, checked."""
    try:
        checked = {
            "session": str(entry["session"])[:64],
            "day": str(entry["day"]),
            "page": str(entry["page"]),
            "ep": str(entry.get("ep", ""))[:40],
            "start": None if entry.get("start") is None else float(entry["start"]),
            "seconds": round(float(entry["seconds"]), 1),
            "audio": round(float(entry["audio"]), 1),
        }
        time.strptime(checked["day"], "%Y-%m-%d")
    except (AttributeError, KeyError, TypeError, ValueError):
        raise ApiError(400, "Thiếu thông tin giờ nghe.")
    if (
        checked["page"] not in LISTENING_PAGES
        or not 0 <= checked["seconds"] <= DAY_S
        or not 0 <= checked["audio"] <= MAX_RATE * DAY_S
        or (checked["start"] is not None and not 0 <= checked["start"] <= DAY_S)
    ):
        raise ApiError(400, "Giờ nghe không hợp lệ.")
    return checked


# ---------- words tapped ----------

class TapLog:
    """The words tapped in the player for their meaning, by day and line. A word tapped on three
    different days has not stuck from listening and is worth a card; a chapter with a word tapped in it
    comes back the next day in Nghe lại. Only ever added to: a tap sent twice, or the same one from two
    devices, is one row, so a page resends whatever it is unsure went through.

    A word said to be known is listed under no chapter until it is tapped again on a later day: a tap
    says it was not caught after all. Its taps stay, and so do the days its chapters were tapped in,
    which space them."""

    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS tapped (
                    day TEXT NOT NULL,  -- YYYY-MM-DD, as study_day counts it
                    word TEXT NOT NULL,
                    ep TEXT NOT NULL,
                    at REAL NOT NULL,   -- the start of the line the word was tapped in
                    PRIMARY KEY (day, word, ep, at)
                )"""
            )
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS known (
                    day TEXT NOT NULL,  -- YYYY-MM-DD, as study_day counts it
                    word TEXT NOT NULL,
                    PRIMARY KEY (day, word)
                )"""
            )

    def record(self, taps):
        with self.lock, self.db:
            self.db.executemany("INSERT OR IGNORE INTO tapped VALUES (:day, :word, :ep, :at)", taps)

    def know(self, word, day):
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO known VALUES (?, ?)", (day, word))

    def days(self, word):
        """How many different days word was tapped on, anywhere."""
        with self.lock:
            return self.db.execute("SELECT COUNT(DISTINCT day) FROM tapped WHERE word = ?", (word,)).fetchone()[0]

    def history(self):
        """Every day each word was tapped on, and was said to be known on, in order, for the vocabulary
        day by day (docs/vocab.js): {"tapped": {word: [day, …]}, "known": {word: [day, …]}}."""
        with self.lock:
            return {
                table: {
                    word: sorted(days.split(","))
                    for word, days in self.db.execute(f"SELECT word, GROUP_CONCAT(DISTINCT day) FROM {table} GROUP BY word")
                }
                for table in ("tapped", "known")
            }

    def chapters(self, chapters):
        """For each chapter given ({ep, start, end}) that had anything tapped in it: the days it did, and
        each word tapped in it with the line it was first tapped in and the days it was tapped on
        anywhere, since a word missed in one story is as missed in the next. A word known since it was
        last tapped is left out of the words, not the days."""
        with self.lock:
            word_days = dict(self.db.execute("SELECT word, COUNT(DISTINCT day) FROM tapped GROUP BY word"))
            known = {word for (word,) in self.db.execute(
                """SELECT known.word FROM known JOIN tapped USING (word)
                   GROUP BY known.word HAVING MAX(known.day) >= MAX(tapped.day)"""
            )}
            by_episode = {}
            for ep, at, word, day in self.db.execute("SELECT ep, at, word, day FROM tapped ORDER BY at"):
                by_episode.setdefault(ep, []).append((at, word, day))
        found = []
        for chapter in chapters:
            inside = [
                (at, word, day) for at, word, day in by_episode.get(chapter["ep"], [])
                if chapter["start"] - SAME_START_S <= at < chapter["end"]
            ]
            if not inside:
                continue
            first = {}
            for at, word, _day in inside:
                first.setdefault(word, at)
            found.append({
                "ep": chapter["ep"],
                "start": chapter["start"],
                "days": sorted({day for _at, _word, day in inside}),
                "words": [
                    {"word": word, "at": at, "days": word_days[word]} for word, at in first.items() if word not in known
                ],
            })
        return found


def tap_entry(entry):
    """One tap as the player sends it, checked."""
    try:
        checked = {
            "day": str(entry["day"]),
            "word": str(entry["word"]).strip(),
            "ep": str(entry["ep"])[:40],
            "at": float(entry["at"]),
        }
        time.strptime(checked["day"], "%Y-%m-%d")
    except (AttributeError, KeyError, TypeError, ValueError):
        raise ApiError(400, "Thiếu thông tin từ đã tra.")
    if not 0 < len(checked["word"]) <= 40 or not checked["ep"] or not 0 <= checked["at"] <= DAY_S:
        raise ApiError(400, "Từ đã tra không hợp lệ.")
    return checked


def known_word(body):
    """A word a page says is known, and the day it says so, checked."""
    word, day = body.get("word"), body.get("day")
    if not isinstance(word, str) or not isinstance(day, str):
        raise ApiError(400, "Thiếu thông tin từ đã thuộc.")
    try:
        time.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise ApiError(400, "Ngày không hợp lệ.")
    word = word.strip()
    if not 0 < len(word) <= 40:
        raise ApiError(400, "Từ đã thuộc không hợp lệ.")
    return word, day


def tapped_chapter(entry):
    """A chapter a page asks for the taps of, checked."""
    try:
        chapter = {"ep": str(entry["ep"])[:40], "start": float(entry["start"]), "end": float(entry["end"])}
    except (KeyError, TypeError, ValueError):
        raise ApiError(400, "Thiếu thông tin chương.")
    if not chapter["end"] > chapter["start"]:
        raise ApiError(400, "Chương không hợp lệ.")
    return chapter


def player_line(link):
    """The episode and line start of a card's link back to the player, or None for a link elsewhere
    (a YouTube card from the extension)."""
    match = re.search(r'href="([^"]+)"', link)
    if not match:
        return None
    url = urllib.parse.urlparse(html.unescape(match.group(1)))
    query = urllib.parse.parse_qs(url.query)
    if not url.path.endswith("/player.html") or "ep" not in query or "start" not in query:
        return None
    try:
        return query["ep"][0], float(query["start"][0])
    except ValueError:
        return None


# ---------- HTTP ----------

class Api:
    def __init__(self, anki, studied, listening_log, tap_log):
        self.anki = anki
        self.studied_chapters = studied
        self.listening_log = listening_log
        self.tap_log = tap_log
        self.deck = env("ANKI_DECK", "Chinese::Mining")

    def health(self, _body):
        with self.anki.lock:
            self.anki.sync()
            self.anki.model()
            return {"deck": self.deck, "notes": self.anki.col.note_count(), "synced": self.anki.auth() is not None}

    def lookup(self, body):
        # Synced while DeepSeek is thinking, so "already in Anki" also sees a card added on another
        # device a minute ago — at no cost in time, since the model takes longer than the sync.
        syncing = threading.Thread(target=self.sync_quietly)
        syncing.start()
        result = deepseek_lookup(body.get("marked", ""), body.get("context", []), body.get("title", ""))
        result.update(hsk_level(result.get("word", "")))
        syncing.join()
        with self.anki.lock:
            result["existing"] = self.anki.status(result.get("word") or body.get("selected", ""))
        return result

    def peek(self, body):
        """The saved card for the tapped word, so a known word is shown without asking DeepSeek, and
        today's count, so a new word past the day's limit can be stopped before DeepSeek is asked."""
        self.sync_quietly()
        with self.anki.lock:
            return {"card": self.anki.saved_card(body.get("word", "")), "today": self.anki.today(self.deck)}

    def sync_quietly(self):
        """A sync that only reads ahead: failing it must not fail a read, as every write syncs again."""
        with self.anki.lock:
            try:
                self.anki.sync()
            except Exception as err:  # noqa: BLE001
                print(f"sync before lookup failed: {err!r}", file=sys.stderr)

    def add(self, body):
        with self.anki.lock:
            self.anki.sync()
            note_id = self.anki.add(body["fields"], body.get("tags", []), self.deck)
            self.anki.sync()
            return {"id": note_id, "deck": self.deck, "today": self.anki.today(self.deck)}

    def relearn(self, body):
        with self.anki.lock:
            self.anki.sync()
            result = self.anki.relearn(body["word"], body.get("fields"), body.get("tags", []))
            self.anki.sync()
        return result

    # The studied chapters never touch the collection, so they skip its lock and its sync.

    def studied(self, _body):
        return {**self.studied_chapters.read(), "today": study_day()}

    def study(self, body):
        return {**self.studied_chapters.mark(studied_chapter(body)), "today": study_day()}

    def unstudy(self, body):
        try:
            ep, start = str(body["ep"]), float(body["start"])
        except (KeyError, TypeError, ValueError):
            raise ApiError(400, "Thiếu thông tin chương.")
        return {**self.studied_chapters.unmark(ep, start), "today": study_day()}

    def listening(self, body):
        """Records what the pages heard, if they send any, and returns the hours per day."""
        entries = body.get("entries", [])
        if not isinstance(entries, list):
            raise ApiError(400, "Thiếu thông tin giờ nghe.")
        return {"days": self.listening_log.record([listened_entry(entry) for entry in entries])}

    def listened(self, _body):
        return self.listening_log.summary()

    def tap(self, body):
        """Records the taps a page sends, and says of `word`, the one just tapped, how many days it has
        been tapped on and whether it has a card already: what the line on its card says."""
        taps = body.get("taps", [])
        if not isinstance(taps, list):
            raise ApiError(400, "Thiếu thông tin từ đã tra.")
        self.tap_log.record([tap_entry(tap) for tap in taps])
        word = str(body.get("word", "")).strip()
        if not word:
            return {"days": 0, "inAnki": False}
        with self.anki.lock:
            in_anki = bool(self.anki.notes_with_word(word))
        return {"days": self.tap_log.days(word), "inAnki": in_anki}

    def tapped(self, body):
        """The words tapped in each chapter a page names, for the player's chapter headings, or else in
        each studied chapter, for Nghe lại."""
        chapters = body.get("chapters")
        if chapters is None:
            return {"chapters": self.tap_log.chapters(self.studied_chapters.read()["chapters"])}
        if not isinstance(chapters, list):
            raise ApiError(400, "Thiếu thông tin chương.")
        return {"chapters": self.tap_log.chapters([tapped_chapter(chapter) for chapter in chapters])}

    def know(self, body):
        """Takes a word off the lists of words tapped, until it is tapped again on a later day."""
        self.tap_log.know(*known_word(body))
        return {}

    def vocab(self, _body):
        return self.tap_log.history()

    def words(self, _body):
        """The notes added each day, for the dashboard; synced first, so a word added on the desktop
        counts too."""
        self.sync_quietly()
        with self.anki.lock:
            return {"days": self.anki.added_days(self.deck), "today": self.anki.today(self.deck)}


def serve():
    token = env("MINER_TOKEN")
    if len(token) < 32:
        sys.exit("MINER_TOKEN is too short: use `openssl rand -base64 32`.")
    origins = set(env("ALLOWED_ORIGINS", "https://luanphungba.github.io").split(","))
    folder = Path(env("ANKI_DIR", str(ROOT / "server/data")))
    api = Api(Anki(folder), Studied(folder / "studied.json"), ListeningLog(folder / "listening.db"), TapLog(folder / "taps.db"))
    routes = {
        "/health": api.health,
        "/peek": api.peek,
        "/lookup": api.lookup,
        "/add": api.add,
        "/relearn": api.relearn,
        "/studied": api.studied,
        "/study": api.study,
        "/unstudy": api.unstudy,
        "/listening": api.listening,
        "/listened": api.listened,
        "/tap": api.tap,
        "/tapped": api.tapped,
        "/know": api.know,
        "/vocab": api.vocab,
        "/words": api.words,
    }
    failures = {}  # address -> times of recent wrong tokens

    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.reply(204, None)

        def do_POST(self):
            address = self.client_address[0]
            if address == "127.0.0.1":  # behind the reverse proxy, the caller is in the header
                address = self.headers.get("X-Forwarded-For", address).split(",")[0].strip()
            recent = [t for t in failures.get(address, []) if time.time() - t < FAILURE_WINDOW_S]
            failures[address] = recent
            if len(recent) >= MAX_FAILURES:
                return self.reply(429, {"error": "Sai token quá nhiều lần. Thử lại sau 15 phút."})

            given = self.headers.get("Authorization", "").removeprefix("Bearer ")
            if not hmac.compare_digest(given.encode(), token.encode()):
                recent.append(time.time())
                return self.reply(401, {"error": "Sai token."})

            route = routes.get(self.path)
            if not route:
                return self.reply(404, {"error": "Không có endpoint này."})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                self.reply(200, route(body))
            except ApiError as err:
                self.reply(err.status, {"error": str(err)})
            except Exception as err:  # noqa: BLE001 — the phone shows the message, the log keeps the rest
                self.log_error("%s failed: %r", self.path, err)
                self.reply(500, {"error": str(err)})

        def reply(self, status, payload):
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "POST")
                self.send_header("Vary", "Origin")
            if payload is None:
                self.end_headers()
                return
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    host, port = env("HOST", "127.0.0.1"), int(env("PORT", "8787"))
    print(f"Listening on http://{host}:{port} · Anki's day by {time.strftime('%Z (UTC%z)')}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


def login():
    anki = Anki(Path(env("ANKI_DIR", str(ROOT / "server/data"))))
    anki.login(input("AnkiWeb email: "), getpass.getpass("AnkiWeb password: "))
    print("Logged in. Downloading the collection from AnkiWeb…")
    anki.sync()
    print(f"Done: {anki.col.note_count()} notes.")


def seed_taps():
    """Once, with the server stopped (it holds the collection): every card already added from the
    player counts as a tap of its word, so the words studied before taps were kept start counted."""
    folder = Path(env("ANKI_DIR", str(ROOT / "server/data")))
    deck = env("ANKI_DECK", "Chinese::Mining")
    taps = Anki(folder).player_taps(deck)
    TapLog(folder / "taps.db").record(taps)
    print(f"{len(taps)} cards in {deck} kept as taps.")


if __name__ == "__main__":
    commands = {"serve": serve, "login": login, "seed-taps": seed_taps}
    commands.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
