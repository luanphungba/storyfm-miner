"""Tests for the listening and tap logs in miner.py: what they accept, and that they only ever add up.

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
        self.api = miner.Api(None, None, self.log, None)

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

    def test_a_chapter_says_the_audio_of_it_heard_on_each_day(self):
        self.send(entry("a", 60, day="2026-10-01"), entry("b", 30, day="2026-10-01", page="listen"), entry("a", 90, day="2026-10-02", audio=180))
        self.assertEqual(self.chapters()[("E517", 70.62)]["byDay"], {"2026-10-01": 90.0, "2026-10-02": 180.0})

    def test_keeps_everything_across_a_restart(self):
        self.send(entry("a", 600))
        reopened = miner.Api(None, None, miner.ListeningLog(self.folder / "listening.db"), None)
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
            miner.Api(None, None, None, None).listening({"entries": "x"})


def tap(word, day="2026-10-06", ep="E517", at=80.5):
    return {"day": day, "word": word, "ep": ep, "at": at}


class FakeAnki:
    """Only what the tap endpoint asks of the collection: whether a word has a note."""

    def __init__(self, words):
        self.lock = threading.Lock()
        self.words = words

    def notes_with_word(self, word):
        return [word] if word in self.words else []


class TapLogTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.studied = miner.Studied(self.folder / "studied.json")
        self.log = miner.TapLog(self.folder / "taps.db")
        self.api = miner.Api(FakeAnki({"尴尬"}), self.studied, None, self.log)

    def study(self, start, end, ep="E517"):
        self.studied.mark({"ep": ep, "episode": "", "audio": "https://a/x.m4a", "n": 0, "zh": "", "vi": "",
                           "start": start, "end": end})

    def send(self, word, *taps):
        return self.api.tap({"taps": list(taps), "word": word})

    def test_counts_the_days_a_word_was_tapped_on_not_the_taps(self):
        self.send("尴尬", tap("尴尬"), tap("尴尬"), tap("尴尬", at=95.1))
        self.assertEqual(self.send("尴尬", tap("尴尬", day="2026-10-07", ep="E062", at=3)), {"days": 2, "inAnki": True})
        self.assertEqual(self.send("面试官", tap("面试官")), {"days": 1, "inAnki": False})

    def test_a_tap_sent_twice_or_from_two_devices_is_one_row(self):
        self.send("尴尬", tap("尴尬"))
        self.send("尴尬", tap("尴尬"), tap("尴尬"))
        self.assertEqual(self.log.db.execute("SELECT COUNT(*) FROM tapped").fetchone()[0], 1)

    def test_taps_from_two_devices_at_once_lose_nothing(self):
        def device(name):
            for k in range(50):
                self.send(name, tap(name, day=f"2026-10-{k % 28 + 1:02d}"))

        threads = [threading.Thread(target=device, args=(name,)) for name in ("手机", "电脑")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual([self.log.days(name) for name in ("手机", "电脑")], [28, 28])

    def test_asks_only_about_a_word_when_one_is_given(self):
        self.assertEqual(self.api.tap({"taps": [tap("尴尬")]}), {"days": 0, "inAnki": False})
        self.assertEqual(self.log.days("尴尬"), 1)

    def test_a_studied_chapter_lists_its_words_by_the_days_each_was_tapped_anywhere(self):
        self.study(70.62, 158.13)
        self.study(160.49, 251.83)
        self.send("", tap("尴尬", at=120.2), tap("尴尬", day="2026-10-08", ep="E062", at=5), tap("清楚", at=70.62),
                  tap("清楚", day="2026-10-07", at=80.1), tap("哭", at=170), tap("别的", ep="E062", at=100))
        self.assertEqual(self.api.tapped({}), {"chapters": [
            {"ep": "E517", "start": 70.62, "days": ["2026-10-06", "2026-10-07"],
             "words": [{"word": "清楚", "at": 70.62, "days": 2}, {"word": "尴尬", "at": 120.2, "days": 2}]},
            {"ep": "E517", "start": 160.49, "days": ["2026-10-06"], "words": [{"word": "哭", "at": 170.0, "days": 1}]},
        ]})

    def test_a_chapter_takes_the_line_a_re_cut_nudged_before_its_start_and_no_line_past_its_end(self):
        self.study(70.62, 158.13)
        self.send("", tap("早", at=70.3), tap("晚", at=158.13))
        self.assertEqual([w["word"] for c in self.api.tapped({})["chapters"] for w in c["words"]], ["早"])

    def test_a_page_can_ask_for_the_taps_of_any_chapters_studied_or_not(self):
        self.study(70.62, 158.13)
        self.send("", tap("清楚", at=80.1), tap("哭", at=170), tap("别的", ep="E062", at=170))
        asked = self.api.tapped({"chapters": [{"ep": "E517", "start": 160.49, "end": 251.83},
                                              {"ep": "E517", "start": 251.83, "end": 300}]})
        self.assertEqual(asked, {"chapters": [
            {"ep": "E517", "start": 160.49, "days": ["2026-10-06"], "words": [{"word": "哭", "at": 170.0, "days": 1}]},
        ]})

    def test_turns_away_chapters_no_page_sends(self):
        bad = ["x", [{"ep": "E517", "start": 1}], [{"ep": "E517", "start": "x", "end": 2}],
               [{"ep": "E517", "start": 2, "end": 1}], [{"ep": "E517", "start": math.nan, "end": 2}], ["E517"]]
        for chapters in bad:
            with self.subTest(chapters=chapters), self.assertRaises(miner.ApiError) as raised:
                self.api.tapped({"chapters": chapters})
            self.assertEqual(raised.exception.status, 400)

    def test_keeps_everything_across_a_restart(self):
        self.send("尴尬", tap("尴尬"))
        self.assertEqual(miner.TapLog(self.folder / "taps.db").days("尴尬"), 1)

    def test_a_report_with_one_bad_tap_writes_none_of_it(self):
        with self.assertRaises(miner.ApiError):
            self.send("尴尬", tap("尴尬"), tap("", day="2026-10-07"))
        self.assertEqual(self.log.days("尴尬"), 0)

    def test_turns_away_what_no_page_sends(self):
        bad = ["x", {"word": "尴尬"}, tap(""), tap("尴" * 41), tap("尴尬", day="hôm nay"), tap("尴尬", ep=""),
               tap("尴尬", at=-1), tap("尴尬", at="x"), tap("尴尬", at=math.nan)]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(miner.ApiError) as raised:
                miner.tap_entry(body)
            self.assertEqual(raised.exception.status, 400)
        with self.assertRaises(miner.ApiError):
            self.api.tap({"taps": "x"})

    def words_of(self):
        return [[w["word"] for w in c["words"]] for c in self.api.tapped({})["chapters"]]

    def test_a_word_known_leaves_every_chapter_s_list_and_no_chapter_s_days(self):
        self.study(70.62, 158.13)
        self.study(160.49, 251.83)
        self.send("", tap("尴尬", at=80.5), tap("清楚", at=90), tap("尴尬", day="2026-10-07", at=170))
        self.assertEqual(self.api.know({"word": "尴尬", "day": "2026-10-08"}), {})
        self.assertEqual(self.words_of(), [["清楚"], []])
        self.assertEqual([c["days"] for c in self.api.tapped({})["chapters"]], [["2026-10-06"], ["2026-10-07"]])

    def test_a_word_known_is_listed_again_once_tapped_on_a_later_day(self):
        self.study(70.62, 158.13)
        self.send("", tap("尴尬"))
        self.api.know({"word": "尴尬", "day": "2026-10-06"})
        self.send("", tap("尴尬", at=95.1))
        self.assertEqual(self.words_of(), [[]])
        self.send("", tap("尴尬", day="2026-10-09"))
        self.assertEqual(self.words_of(), [["尴尬"]])

    def test_a_word_known_twice_or_from_two_devices_is_one_row_and_keeps_its_taps(self):
        self.send("", tap("尴尬"))
        self.api.know({"word": "尴尬", "day": "2026-10-07"})
        self.api.know({"word": "尴尬", "day": "2026-10-07"})
        self.assertEqual(self.log.db.execute("SELECT COUNT(*) FROM known").fetchone()[0], 1)
        self.assertEqual(self.log.days("尴尬"), 1)

    def test_turns_away_a_known_word_no_page_sends(self):
        for body in [{}, {"word": "尴尬"}, {"word": "", "day": "2026-10-07"}, {"word": "尴" * 41, "day": "2026-10-07"},
                     {"word": "尴尬", "day": "hôm nay"}, {"word": ["尴尬"], "day": "2026-10-07"}]:
            with self.subTest(body=body), self.assertRaises(miner.ApiError) as raised:
                self.api.know(body)
            self.assertEqual(raised.exception.status, 400)

    def test_tells_the_vocabulary_every_day_each_word_was_tapped_and_known_in_order(self):
        self.send("", tap("尴尬", day="2026-10-08", at=95.1), tap("尴尬"), tap("尴尬", at=120), tap("清楚", day="2026-10-07"))
        self.api.know({"word": "尴尬", "day": "2026-10-09"})
        self.api.know({"word": "尴尬", "day": "2026-10-07"})
        self.assertEqual(self.api.vocab({}), {
            "tapped": {"尴尬": ["2026-10-06", "2026-10-08"], "清楚": ["2026-10-07"]},
            "known": {"尴尬": ["2026-10-07", "2026-10-09"]},
        })


class PlayerTapsTest(unittest.TestCase):
    def test_reads_the_episode_and_line_of_a_link_back_to_the_player(self):
        link = ('<a href="https://luanphungba.github.io/storyfm-miner/player.html?ep=E001-2&amp;start=68.0&amp;end=71.8'
                '&amp;loop=10&amp;src=https%3A%2F%2Fa%2Fx.m4a">▶ 故事 · 1:08</a>')
        self.assertEqual(miner.player_line(link), ("E001-2", 68.0))
        for elsewhere in ['<a href="https://luanphungba.github.io/youtube-loop/?v=KyWA0i4-rLk&start=1&end=7">▶</a>',
                          '<a href="https://luanphungba.github.io/storyfm-miner/player.html?ep=E1&start=x">▶</a>', "", "▶ 故事"]:
            self.assertIsNone(miner.player_line(elsewhere))

    def test_a_card_from_the_player_is_a_tap_on_the_day_it_was_made(self):
        made = int(time.mktime(time.strptime("2026-09-20 02:00", "%Y-%m-%d %H:%M")) * 1000)
        notes = {
            made: {"Word": "端午", "VideoLink": '<a href="https://x/storyfm-miner/player.html?ep=E001-2&amp;start=12.5">▶</a>'},
            made + 1: {"Word": "大叔", "VideoLink": '<a href="https://x/youtube-loop/?v=a&amp;start=1">▶</a>'},
        }
        anki = miner.Anki.__new__(miner.Anki)
        anki.col = types.SimpleNamespace(find_notes=lambda query: list(notes), get_note=notes.get)
        self.assertEqual(anki.player_taps("Chinese::Mining"), [{"day": "2026-09-19", "word": "端午", "ep": "E001-2", "at": 12.5}])


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
