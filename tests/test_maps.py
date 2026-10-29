"""Every map has to be a complete, playable place: the rules never change, so the data must fit them exactly.

    python -m unittest discover tests
"""

import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import game  # noqa: E402
from app import app  # noqa: E402

os.environ.pop("OPENAI_API_KEY", None)
from tests.test_game import run_out  # noqa: E402


class Maps(unittest.TestCase):
    def test_there_are_several_maps_and_the_original_is_first(self):
        self.assertGreaterEqual(len(game.MAPS), 5)
        self.assertEqual(next(iter(game.MAPS)), "wrenmoor")

    def test_every_map_fits_the_rules(self):
        for mid, m in game.MAPS.items():
            with self.subTest(map=mid):
                self.assertEqual(sorted(r["id"] for r in m["rooms"]), sorted(game.ROOM_ORDER))            # the ten slots of the floor plan
                names = [r["name"] for r in m["rooms"]]
                self.assertEqual(len(set(names)), 10)
                items = [i for r in m["rooms"] for i in r["items"]]
                self.assertEqual(len(items), 20)
                self.assertEqual(len(set(items)), 20)
                self.assertEqual(set(items), set(m["kinds"]))                                         # every thing has a kind
                for kind in ("blunt", "sharp", "cord"):
                    self.assertGreaterEqual(sum(v == kind for v in m["kinds"].values()), 3, kind)    # a killer can always find each kind
                titles = [c[0] for c in m["characters"]]
                self.assertGreaterEqual(len(titles), 12)
                self.assertEqual(len(set(titles)), len(titles))
                self.assertGreaterEqual(len(m["beats"]), 10)
                self.assertGreaterEqual(sum(b["fx"] == "dark" for b in m["beats"]), 2)
                rain = [b for b in m["beats"] if b["fx"] == "rain"]
                self.assertEqual(len(rain), 1)
                self.assertIn(m["rooms"][2]["name"], rain[0]["text"])                                # the weather beat names the outdoor room
                self.assertIn("{room}", [b for b in m["beats"] if b["fx"] == "dark"][0]["text"])
                for key in ("title", "tagline", "prologue", "gazette", "ejected", "quiet_head", "quiet_line", "new_day", "door_label", "place", "prize"):
                    self.assertTrue(m.get(key), key)

    def test_the_floor_plan_joins_every_room(self):
        """One plan for every map: each room has a place, and you can walk from the hall to every room through doors,
        even with the garden locked by the weather."""
        self.assertEqual(set(game.PLAN), set(game.ROOM_ORDER))
        for locked in (None, "garden"):
            seen, todo = {game.START_ROOM}, [game.START_ROOM]
            while todo:
                for n in game.neighbours(todo.pop()):
                    if n not in seen and n != locked:
                        seen.add(n)
                        todo.append(n)
            self.assertEqual(seen | ({locked} if locked else set()), set(game.ROOM_ORDER), locked)
        self.assertGreaterEqual(len(game.neighbours("garden")), 2, "two ways out of the garden")
        cells = {(c, r + k) for c, r, span in game.PLAN.values() for k in range(span)}
        self.assertEqual(len(cells), sum(span for _, _, span in game.PLAN.values()), "no two rooms in the same place")

    def test_a_bots_game_plays_to_the_end_on_every_map(self):
        for mid in game.MAPS:
            for n in (4, 6, 8):
                g = game.new_game(map_id=mid)
                for _ in range(n):
                    game.add_bot(g)
                game.start(g)
                phases = run_out(g)
                self.assertEqual(g["phase"], "over", (mid, n, phases[-8:]))
                self.assertIn(g["winner"], ("guests", "killers"))

    def test_the_phone_is_told_which_map_and_gets_its_words(self):
        for mid, m in game.MAPS.items():
            g = game.new_game(map_id=mid)
            p = game.add_player(g, "Ann")
            for _ in range(5):
                game.add_bot(g)
            game.start(g)
            v = game.view(g, p)
            self.assertEqual(v["map"]["id"], mid)
            self.assertEqual(v["prologue"], m["prologue"])
            self.assertEqual({r["name"] for r in v["rooms"]} <= {r["name"] for r in m["rooms"]}, True)
            self.assertIn(g["players"][0]["char"]["title"], [c[0] for c in m["characters"]])

    def test_two_games_on_different_maps_do_not_leak_into_each_other(self):
        a, b = game.new_game(map_id="wrenmoor"), game.new_game(map_id="helios")
        for g in (a, b):
            for _ in range(5):
                game.add_bot(g)
        pa, pb = game.add_player(a, "Ann"), game.add_player(b, "Bea")
        for _ in range(6):                                                                          # alternate between them, as real requests do
            for g, p, rooms in ((a, pa, "Library"), (b, pb, "Observation Dome")):
                game.tick(g)
                game.start(g) if g["phase"] == "lobby" else None
                v = game.view(g, p)
                self.assertIn(rooms, [r["name"] for r in game.MAPS[g["map"]]["rooms"]])
                self.assertEqual(v["map"]["id"], g["map"])
                self.assertTrue(set(game.HOME) == {i for r in game.MAPS[g["map"]]["rooms"] for i in r["items"]})


class MapRoutes(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()

    def play(self, **body):
        r = self.c.post("/api/play", json={"name": "Host", **body})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return r.get_json()

    def state(self, who):
        return self.c.get(f"/api/game/{who['code']}", query_string={"pid": who["pid"], "token": who["token"]}).get_json()

    def test_the_list_of_maps(self):
        d = self.c.get("/api/maps").get_json()["maps"]
        self.assertEqual([m["id"] for m in d][:1], ["wrenmoor"])
        self.assertTrue({"midnight", "frostline", "marlowe", "helios", "dunes", "pearl"} <= {m["id"] for m in d})
        self.assertTrue(all(m["title"] and m["emoji"] and m["tagline"] for m in d))

    def test_you_pick_a_map_when_you_start_and_the_host_can_change_it(self):
        who = self.play(mode="create", map="helios")
        self.assertEqual(self.state(who)["map"]["id"], "helios")
        r = self.c.post(f"/api/game/{who['code']}", json={"pid": who["pid"], "token": who["token"], "type": "map", "id": "marlowe"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.state(who)["map"]["id"], "marlowe")
        self.c.post(f"/api/game/{who['code']}", json={"pid": who["pid"], "token": who["token"], "type": "map", "id": "nonsense"})
        self.assertEqual(self.state(who)["map"]["id"], "wrenmoor")                                  # an unknown map falls back to the original

    def test_only_the_host_changes_the_map_and_random_picks_one(self):
        who = self.play(mode="create", map="midnight")
        guest = self.c.post("/api/play", json={"name": "Guest", "mode": "join", "code": who["code"]}).get_json()
        self.c.post(f"/api/game/{who['code']}", json={"pid": guest["pid"], "token": guest["token"], "type": "map", "id": "frostline"})
        self.assertEqual(self.state(who)["map"]["id"], "midnight")
        seen = {self.state(self.play(mode="create", map="random"))["map"]["id"] for _ in range(40)}
        self.assertGreater(len(seen), 2)


if __name__ == "__main__":
    unittest.main()
