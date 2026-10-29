"""The house map and hide and seek: every game is played on a floor plan now. You walk one door an hour (the killer and the
seekers also know the secret passages), you see who you pass in a doorway, and in hide and seek the seekers hunt the hiders
room by room; whoever they find joins the hunt, and the hiders win if anyone is still hidden at dawn.

    python -m unittest discover tests
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import game  # noqa: E402
from app import app  # noqa: E402

os.environ.pop("OPENAI_API_KEY", None)
from tests.test_game import run_out  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()

    def post(self, g, p, **body):
        return self.c.post(f"/api/game/{g['code']}", json={"pid": p["pid"], "token": p["token"], **body})

    def hide_game(self):
        """Ann, Ben and Cat hide; Hal seeks. All people, on a quiet night."""
        g = game.new_game(mode="hide")
        a, b, c, h = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Hal"))
        game.start(g)
        for p in (a, b, c):
            p["role"] = "hider"
        h["role"] = "hunter"
        game.new_night(g)
        return g, (a, b, c, h)

    def hour(self, g, moves, acts=()):
        """Everyone picks a room through the API (the last pick moves the house on), then what they do in it, then the hour ends."""
        d = game.today(g)
        for p, room in moves:
            self.assertEqual(self.post(g, p, type="move", room=room).status_code, 200, (p["name"], room, game.reach(g, p)))
        if g["phase"] == "move":
            (game.resolve_hide_move if game.hiding(g) else game.resolve_move)(g)
        for p, a in acts:
            d["acts"][p["pid"]] = a
        if g["phase"] == "room":
            (game.resolve_hide_room if game.hiding(g) else game.resolve_room)(g)


class HouseMap(Base):
    def test_you_see_who_you_pass_in_a_doorway_but_not_in_a_secret_passage(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p.update(role="guest", job=None)
        k["role"] = "killer"
        game.new_day(g)
        for beat in game.today(g)["beats"]:
            beat.update(fx=None)
        self.hour(g, [(a, "library"), (b, "hall"), (c, "dining"), (k, "library")])
        self.hour(g, [(a, "hall"), (b, "library"), (c, "dining"), (k, "study")])        # Ann and Ben swap through the library door; Kay slips behind the bookcase
        d = game.today(g)
        self.assertEqual(d["hours"][1]["passed"].get(a["pid"]), [b["pid"]])
        self.assertIn("you passed Ben in the doorway", " ".join(game.my_day(g, a, d)[1]["events"]))
        self.assertNotIn(k["pid"], sum(d["hours"][1]["passed"].values(), []), "nobody sees the secret passage used")
        self.assertEqual(self.post(g, a, type="move", room="cellar").status_code, 400, "the cellar is not next door to the hall")

    def test_the_plan_shows_secret_passages_only_to_the_killer(self):
        g = game.new_game()
        a, k = game.add_player(g, "Ann"), game.add_player(g, "Kay")
        game.start(g)
        a["role"], k["role"] = "guest", "killer"
        self.assertEqual(game.view(g, a)["plan"]["secrets"], [])
        self.assertEqual(len(game.view(g, k)["plan"]["secrets"]), len(game.SECRETS))
        self.assertEqual(len(game.view(g, a)["plan"]["cells"]), 10)

    def test_bot_games_play_to_the_end_with_every_room_open(self):
        for mid in game.MAPS:
            g = game.new_game(map_id=mid)
            for _ in range(6):
                game.add_bot(g)
            game.start(g)
            run_out(g)
            self.assertEqual(g["phase"], "over", mid)
            for d in g["days"]:                                     # nobody ever walked through a wall (bar the killer's passages)
                for i, hr in enumerate(d["hours"]):
                    prev = d["hours"][i - 1]["where"] if i else {}
                    for pid, room in hr["where"].items():
                        frm = prev.get(pid, game.START_ROOM)
                        secret = game.player(g, pid)["role"] == "killer"
                        self.assertTrue(room == frm or room in game.neighbours(frm, secret), (mid, frm, room))


class HideAndSeek(Base):
    def test_the_seekers_count_first_and_everyone_knows_who_seeks(self):
        g, (a, b, c, h) = self.hide_game()
        self.assertEqual(game.reach(g, h), ["hall"], "counting to a hundred")
        self.assertEqual(set(game.reach(g, a)), {"hall"} | game.neighbours("hall"))
        v = game.view(g, a)
        self.assertEqual({p["name"]: p["role"] for p in v["players"]}["Hal"], "hunter")
        self.assertEqual(v["hours"], game.NIGHT)
        self.assertTrue(game.view(g, h)["hide"]["counting"])
        for n, hunters in ((4, 1), (6, 1), (7, 2), (8, 2)):
            g = game.new_game(mode="hide")
            for _ in range(n):
                game.add_bot(g)
            game.start(g)
            self.assertEqual(sum(p["role"] == "hunter" for p in g["players"]), hunters)
            self.assertFalse(any(p.get("job") or p.get("mission") for p in g["players"]), "no special roles or missions")

    def test_seekers_run_two_rooms_search_two_places_and_hear_cramped_legs(self):
        g, (a, b, c, h) = self.hide_game()
        self.hour(g, [(a, "dining"), (b, "bedroom"), (c, "library"), (h, "hall")], [(a, {"spot": "door"}), (b, {"spot": "under"}), (c, {"spot": "shadows"})])
        self.assertIn("kitchen", game.reach(g, h), "hall to dining to kitchen: a seeker runs two rooms")
        self.assertNotIn("kitchen", game.reach(g, b), "a hider walks one: Ben is upstairs in the bedroom")
        self.post(g, h, type="move", room="dining")
        for p in (a, b, c):
            self.post(g, p, type="move", room=game.came_from(g, p))
        self.post(g, h, type="do", search=["under", "door", "shadows"])
        self.assertEqual(game.today(g)["acts"][h["pid"]]["search"], ["under", "door"], "two places, no more")
        d = game.today(g)
        self.assertFalse(game.audible(g, d, b["pid"]), "Ben has kept still for an hour: silent")
        game.resolve_hide_room(g)
        self.assertEqual(a["role"], "hunter", "Ann was behind the door")
        self.assertEqual(g["hour"], 2)
        self.assertTrue(game.audible(g, d, b["pid"]), "two hours in one spot: his legs cramp and he can be heard")
        self.assertTrue(game.view(g, b)["hide"]["cramp"])

    def test_nobody_is_found_while_the_seeker_counts(self):
        g, (a, b, c, h) = self.hide_game()
        self.hour(g, [(a, "hall"), (b, "library"), (c, "dining"), (h, "hall")], [(a, {}), (h, {"search": "door"})])
        self.assertEqual((a["role"], game.today(g)["catches"]), ("hider", []), "Ann stayed in the hall, in the open, but Hal's eyes were shut")

    def test_found_in_the_open_or_in_the_spot_they_search(self):
        g, (a, b, c, h) = self.hide_game()
        self.hour(g, [(a, "library"), (b, "library"), (c, "library"), (h, "hall")], [(a, {"spot": "door"}), (b, {"spot": "under"}), (c, {})])
        self.assertEqual(g["hour"], 1)
        self.assertEqual(set(game.today(g)["hidden"]), {a["pid"], b["pid"]})
        d = game.today(g)
        for p, room in ((h, "library"), (a, "library"), (b, "library"), (c, "library")):
            self.post(g, p, type="move", room=room)
        self.assertEqual(g["phase"], "room")
        seen = game.view(g, h)["here"]
        self.assertEqual([x["name"] for x in seen["people"]], ["Cat"], "Ann and Ben kept still: Hal walks in and can't see them")
        self.assertTrue(seen["breathing"])
        self.post(g, h, type="do", search="door")
        game.resolve_hide_room(g)
        self.assertEqual({x["who"] for x in d["catches"]}, {a["pid"], c["pid"]}, "Cat was in the open, Ann behind the door")
        self.assertEqual((a["role"], b["role"], c["role"]), ("hunter", "hider", "hunter"), "found: you join the hunt")
        self.assertIn("Hal found you 🚪 behind the door", " ".join(game.my_day(g, a, d)[-1]["events"]))
        self.assertIn("You stayed hidden", " ".join(game.my_day(g, b, d)[-1]["events"]))
        self.assertNotIn("Ben", game.my_day(g, h, d)[-1]["saw"], "Hal never saw Ben")

    def test_footsteps_and_noises_next_door(self):
        g, (a, b, c, h) = self.hide_game()
        self.hour(g, [(a, "library"), (b, "ballroom"), (c, "dining"), (h, "hall")], [(a, {"spot": "door"}), (b, {}), (c, {"spot": "under"})])
        heard = {x["room"]: x for x in game.view(g, h)["next"]}
        self.assertEqual((heard["library"]["count"], heard["ballroom"]["count"]), (0, 1), "the still ones make no sound")
        self.assertTrue({x["room"]: x for x in game.view(g, a)["next"]}["hall"]["hunter"], "Ann hears heavy footsteps in the hall")

    def test_talking_gives_you_away(self):
        g, (a, b, c, h) = self.hide_game()
        self.hour(g, [(a, "dining"), (b, "library"), (c, "library"), (h, "hall")], [(a, {"spot": "shadows"})])
        for p, room in ((a, "dining"), (h, "dining"), (b, "library"), (c, "library")):
            self.post(g, p, type="move", room=room)
        self.assertEqual(game.view(g, h)["here"]["people"], [])
        self.post(g, a, type="room", text="psst")
        self.assertEqual([x["name"] for x in game.view(g, h)["here"]["people"]], ["Ann"], "a voice from the shadows")
        self.assertIsNone(game.view(g, a)["hide"]["spot"])

    def test_the_hiders_win_at_dawn_or_the_hunt_wins(self):
        g, (a, b, c, h) = self.hide_game()
        g["hour"] = len(game.NIGHT) - 1                                 # skip to the last hour of the night
        game.today(g)["hours"] = [{"where": {a["pid"]: "attic", b["pid"]: "attic", c["pid"]: "attic", h["pid"]: "cellar"}, "acts": {}, "looks": {}, "idle": [],
                                   "events": {r: [] for r in game.ROOM}, "beat": {"text": "", "fx": None}, "passed": {}} for _ in range(g["hour"])]
        self.hour(g, [(a, "attic"), (b, "attic"), (c, "attic"), (h, "cellar")], [(a, {"spot": "door"}), (b, {"spot": "door"}), (c, {"spot": "door"})])
        self.assertEqual((g["phase"], g["winner"]), ("over", "hiders"))
        self.assertTrue(game.my_stats(g, a)["won"])
        self.assertFalse(game.my_stats(g, h)["won"])
        g, (a, b, c, h) = self.hide_game()
        for p in (b, c):
            p["role"] = "hunter"
        self.hour(g, [(a, "library"), (h, "hall")], [(a, {})])
        g["hour"] = 1
        self.hour(g, [(a, "library"), (h, "library")], [(a, {"spot": "under"}), (h, {"search": "under"})])
        self.assertEqual((g["phase"], g["winner"]), ("over", "hunters"))
        v = game.view(g, h)
        self.assertEqual(v["catches"][0]["who"], "Ann")
        self.assertTrue(any(x["title"] == "First found" for x in v["highlights"]))
        self.assertTrue(game.my_stats(g, h)["won"] and game.my_stats(g, h)["catches"] == 1)

    def test_whole_nights_with_bots_on_every_map(self):
        for mid in game.MAPS:
            for n in (4, 8):
                g = game.new_game(map_id=mid, mode="hide")
                for _ in range(n):
                    game.add_bot(g)
                game.start(g)
                run_out(g)
                self.assertEqual(g["phase"], "over", (mid, n))
                hiders = [p for p in g["players"] if p["role"] == "hider"]
                self.assertEqual(g["winner"], "hiders" if hiders else "hunters")
                self.assertLessEqual(len(game.today(g)["hours"]), len(game.NIGHT))

    def test_the_host_picks_hide_and_seek(self):
        host = self.c.post("/api/play", json={"mode": "create", "name": "Mum"}).get_json()
        kid = self.c.post("/api/play", json={"mode": "join", "code": host["code"], "name": "Sam"}).get_json()
        g = game.GAMES[host["code"]]
        self.assertEqual(g["mode"], "murder", "the murder weekend unless the host says otherwise")
        self.assertEqual(self.post(g, kid, type="mode", mode="hide").status_code, 409, "only the host")
        self.assertEqual(self.post(g, game.player(g, host["pid"]), type="mode", mode="classic").status_code, 400, "the old free-roaming game is gone")
        v = self.post(g, game.player(g, host["pid"]), type="mode", mode="hide").get_json()
        self.assertEqual(v["mode"], "hide")
        game.start(g)
        self.assertEqual(sorted(p["role"] for p in g["players"]), ["hider", "hider", "hider", "hunter"])
        bots = self.c.post("/api/play", json={"mode": "bots", "name": "Ann", "game": "hide"}).get_json()
        self.assertEqual(game.GAMES[bots["code"]]["mode"], "hide")


if __name__ == "__main__":
    unittest.main()
