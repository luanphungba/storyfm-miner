"""Tests for the listening log in miner.py: what it accepts, and that it only ever adds up.

    python3 -m unittest discover -s server

Where Anki is not installed it is stood in for, as nothing here opens a collection.
"""

import importlib.util
import math
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path

if importlib.util.find_spec("anki") is None:
    for name, attributes in {
        "anki": {},
        "anki.collection": {"Collection": object},
        "anki.sync": {"SyncAuth": object, "SyncOutput": object},
    }.items():
        sys.modules[name] = types.ModuleType(name)
        sys.modules[name].__dict__.update(attributes)

os.environ["TZ"] = "Asia/Ho_Chi_Minh"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import miner  # noqa: E402


def entry(session, seconds, day="2026-10-02", ep="E517", start=70.62, page="player", audio=None):
    return {"session": session, "day": day, "page": page, "ep": ep, "start": start, "seconds": seconds,
            "audio": seconds if audio is None else audio}


class ListeningLogTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.log = miner.ListeningLog(self.folder / "listening.db")
        self.api = miner.Api(None, None, self.log)

    def send(self, *entries):
        return self.api.listening({"entries": list(entries)})["days"]

    def chapters(self):
        return {(c["ep"], c["start"]): c for c in self.api.listened({})["chapters"]}

    def test_a_read_sends_nothing_and_writes_nothing(self):
        self.assertEqual(self.api.listening({}), {"days": {}})
        self.assertEqual(self.log.db.execute("SELECT COUNT(*) FROM listened").fetchone()[0], 0)

    def test_a_count_sent_twice_counts_once(self):
        self.send(entry("a", 60))
        self.assertEqual(self.send(entry("a", 60)), {"2026-10-02": {"player": 60.0}})

    def test_two_devices_add_up(self):
        self.send(entry("phone", 600, page="listen"))
        days = self.send(entry("laptop", 300), entry("laptop", 120, start=None))
        self.assertEqual(days, {"2026-10-02": {"player": 420.0, "listen": 600.0}})
        self.assertEqual(self.chapters()[("E517", 70.62)]["seconds"], 900.0)

    def test_a_late_or_smaller_count_never_lowers_or_removes_one(self):
        self.send(entry("a", 600, audio=900))
        self.send(entry("a", 300, audio=300), entry("a", 0, audio=0))
        row = self.log.db.execute("SELECT seconds, audio FROM listened").fetchall()
        self.assertEqual(row, [(600.0, 900.0)])

    def test_a_growing_count_raises_its_row(self):
        for seconds in (60, 120, 180):
            days = self.send(entry("a", seconds))
        self.assertEqual(days, {"2026-10-02": {"player": 180.0}})
        self.assertEqual(self.log.db.execute("SELECT COUNT(*) FROM listened").fetchone()[0], 1)

    def test_time_between_chapters_counts_for_the_day_but_no_chapter(self):
        self.send(entry("a", 30, start=None), entry("a", 90))
        self.send(entry("a", 45, start=None))
        self.assertEqual(self.send(), {"2026-10-02": {"player": 135.0}})
        self.assertEqual(list(self.chapters()), [("E517", 70.62)])

    def test_a_chapter_sums_its_days_and_says_the_last(self):
        self.send(entry("a", 90, day="2026-09-30", audio=180), entry("b", 90, day="2026-10-01", page="listen"), entry("b", 45, day="2026-10-02", page="listen"))
        chapter = self.chapters()[("E517", 70.62)]
        self.assertEqual((chapter["seconds"], chapter["audio"], chapter["days"], chapter["last"]), (225.0, 315.0, 3, "2026-10-02"))

    def test_keeps_everything_across_a_restart(self):
        self.send(entry("a", 600))
        reopened = miner.Api(None, None, miner.ListeningLog(self.folder / "listening.db"))
        self.assertEqual(reopened.listening({"entries": [entry("b", 60)]})["days"], {"2026-10-02": {"player": 660.0}})

    def test_reports_at_the_same_time_from_two_devices_lose_nothing(self):
        def device(name):
            for seconds in range(1, 101):
                self.send(entry(name, seconds), entry(name, seconds / 2, start=None))

        threads = [threading.Thread(target=device, args=(name,)) for name in ("phone", "laptop", "tablet")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(self.send(), {"2026-10-02": {"player": 450.0}})

    def test_a_report_with_one_bad_entry_writes_none_of_it(self):
        with self.assertRaises(miner.ApiError):
            self.send(entry("a", 60), entry("a", 60, page="anki"))
        self.assertEqual(self.send(), {})

    def test_a_report_failing_halfway_writes_none_of_it(self):
        good = miner.listened_entry(entry("a", 60))
        with self.assertRaises(Exception):
            self.log.record([good, {**good, "session": "b", "page": None}])  # NOT NULL fails on the second
        self.assertEqual(self.send(), {})


class ListenedEntryTest(unittest.TestCase):
    def test_accepts_a_page_count(self):
        checked = miner.listened_entry(entry("a", 60.04, audio=90.06))
        self.assertEqual((checked["seconds"], checked["audio"], checked["start"]), (60.0, 90.1, 70.62))
        self.assertIsNone(miner.listened_entry(entry("a", 1, start=None))["start"])

    def test_turns_away_what_no_page_sends(self):
        bad = [
            "not an entry", ["a"], {"session": "a"}, entry("a", 1, day="2026-13-01"), entry("a", 1, day="hôm nay"),
            entry("a", 1, page="anki"), entry("a", -1), entry("a", miner.DAY_S + 1), entry("a", math.nan),
            entry("a", math.inf), entry("a", 1, audio=miner.MAX_RATE * miner.DAY_S + 1), entry("a", 1, start=-1),
            entry("a", 1, start="x"),
        ]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(miner.ApiError) as raised:
                miner.listened_entry(body)
            self.assertEqual(raised.exception.status, 400)

    def test_a_report_must_be_a_list(self):
        with self.assertRaises(miner.ApiError):
            miner.Api(None, None, None).listening({"entries": "x"})


class WordsTest(unittest.TestCase):
    def test_counts_the_notes_of_each_day_turning_at_four(self):
        def note_id(text):
            return int(time.mktime(time.strptime(text, "%Y-%m-%d %H:%M")) * 1000)

        anki = miner.Anki.__new__(miner.Anki)
        anki.col = types.SimpleNamespace(find_notes=lambda query: [
            note_id("2026-10-02 03:59"), note_id("2026-10-02 04:00"), note_id("2026-10-02 23:00"),
        ])
        self.assertEqual(anki.added_days("Chinese::Mining"), {"2026-10-01": 1, "2026-10-02": 2})


if __name__ == "__main__":
    unittest.main()
