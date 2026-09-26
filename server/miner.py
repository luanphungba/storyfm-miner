"""Adds Anki cards from the player on a phone, where the CI Miner extension cannot run.

The extension talks to Anki desktop on the same machine. A phone has neither, so this keeps a copy
of the collection on a server, adds notes to it, and syncs it through AnkiWeb like any other device.

    python server/miner.py login   # once: AnkiWeb account, then the first download
    python server/miner.py serve   # the API the player calls

Settings come from the environment (see server/.env.example).

Sync rule: this copy only ever *downloads* a full collection, never uploads one. It holds nothing
that is not already on AnkiWeb — every write here is synced straight away — so when Anki asks for a
full sync the answer is always "take AnkiWeb's", and the reviews done on other devices are never at
risk. A full upload from here would be the one way to lose them, so there is no code path to it.
"""

import getpass
import hmac
import json
import os
import sys
import threading
import time
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
        return SyncAuth(**json.loads(self.auth_file.read_text()))

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


def escape(text):
    return "".join("\\" + c if c in '\\"*_' else c for c in str(text))


# ---------- HTTP ----------

class Api:
    def __init__(self, anki):
        self.anki = anki
        self.deck = env("ANKI_DECK", "Chinese::Mining")

    def health(self, _body):
        with self.anki.lock:
            self.anki.sync()
            self.anki.model()
            return {"deck": self.deck, "notes": self.anki.col.note_count(), "synced": self.anki.auth() is not None}

    def lookup(self, body):
        result = deepseek_lookup(body.get("marked", ""), body.get("context", []), body.get("title", ""))
        result.update(hsk_level(result.get("word", "")))
        with self.anki.lock:
            result["existing"] = self.anki.status(result.get("word") or body.get("selected", ""))
        return result

    def add(self, body):
        with self.anki.lock:
            self.anki.sync()
            note_id = self.anki.add(body["fields"], body.get("tags", []), self.deck)
            self.anki.sync()
        return {"id": note_id, "deck": self.deck}

    def relearn(self, body):
        with self.anki.lock:
            self.anki.sync()
            result = self.anki.relearn(body["word"], body.get("fields"), body.get("tags", []))
            self.anki.sync()
        return result


def serve():
    token = env("MINER_TOKEN")
    if len(token) < 32:
        sys.exit("MINER_TOKEN is too short: use `openssl rand -base64 32`.")
    origins = set(env("ALLOWED_ORIGINS", "https://luanphungba.github.io").split(","))
    api = Api(Anki(Path(env("ANKI_DIR", str(ROOT / "server/data")))))
    routes = {"/health": api.health, "/lookup": api.lookup, "/add": api.add, "/relearn": api.relearn}
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
    print(f"Listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


def login():
    anki = Anki(Path(env("ANKI_DIR", str(ROOT / "server/data"))))
    anki.login(input("AnkiWeb email: "), getpass.getpass("AnkiWeb password: "))
    print("Logged in. Downloading the collection from AnkiWeb…")
    anki.sync()
    print(f"Done: {anki.col.note_count()} notes.")


if __name__ == "__main__":
    {"serve": serve, "login": login}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
