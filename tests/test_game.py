"""Alibi's game server, tested with no AI (bots fall back to plain lines) and the clock sped up.

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

os.environ.pop("OPENAI_API_KEY", None)                   # after the app's load_dotenv: no AI calls in tests


def expire(g):
    if g["deadline"] is not None:
        g["deadline"] = 0
    if g.get("start_at") is not None:
        g["start_at"] = 0
    d = game.today(g)
    if d:
        for plan in d.get("bot_plan", []) + d.get("vote_plan", []):
            plan["at"] = 0


def run_out(g, steps=400):
    """Let a room play itself to the end: every clock expires at once."""
    seen = []
    for _ in range(steps):
        if g["phase"] == "over":
            break
        expire(g)
        with mock.patch.object(game.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args))):
            game.tick(g)
        seen.append(g["phase"])
    return seen


class Rules(unittest.TestCase):
    def test_a_bots_game_plays_to_the_end(self):
        for _ in range(12):
            g = game.new_game()
            for _ in range(6):
                game.add_bot(g)
            game.start(g)
            phases = run_out(g)
            self.assertEqual(g["phase"], "over", phases[-10:])
            self.assertIn(g["winner"], ("guests", "killers"))
            self.assertIn("move", phases)
            self.assertIn("room", phases)

    def test_one_killer_up_to_six_two_from_seven(self):
        for n, k in ((4, 1), (6, 1), (7, 2), (8, 2)):
            g = game.new_game()
            for _ in range(n):
                game.add_bot(g)
            game.start(g)
            self.assertEqual(sum(p["role"] == "killer" for p in g["players"]), k)

    def test_a_kill_needs_a_weapon_and_being_alone(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        game.new_day(g)
        d = game.today(g)
        for beat in d["beats"]:
            beat.update(fx=None)                                   # no dark rooms or rain in this test
        def hour(moves, acts):
            d["moves"] = {p["pid"]: r for p, r in moves}
            game.resolve_move(g)
            if g["phase"] != "room":
                return
            d["acts"] = {p["pid"]: a for p, a in acts}
            game.resolve_room(g)
        hour([(k, "kitchen"), (a, "kitchen"), (b, "garden"), (c, "study")], [(k, {"take": "kitchen knife", "strike": a["pid"]}), (a, {}), (b, {}), (c, {})])
        self.assertIsNone(d["kill"], "no weapon yet when the hour began")
        self.assertEqual(g["carry"][k["pid"]], "kitchen knife")
        hour([(k, "garden"), (a, "garden"), (b, "garden"), (c, "study")], [(k, {"strike": a["pid"]}), (a, {}), (b, {"act": "look"}), (c, {})])
        self.assertIsNone(d["kill"], "a witness")
        self.assertIn("Ann", d["hours"][-1]["looks"][b["pid"]] + " Ann")
        hour([(k, "study"), (c, "study"), (a, "garden"), (b, "library")], [(k, {"strike": c["pid"]}), (c, {}), (a, {}), (b, {})])
        self.assertEqual(d["kill"]["victim"], c["pid"])
        self.assertFalse(c["alive"])
        hour([(k, "kitchen"), (a, "study"), (b, "library")], [])
        self.assertEqual(g["phase"], "body")
        self.assertEqual(d["found"]["by"], [a["pid"]])
        self.assertIn("kitchen knife", d["missing"])

    def test_a_dark_room_hides_who_is_there(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        game.new_day(g)
        d = game.today(g)
        d["beats"][0] = {"text": "dark", "fx": "dark", "room": "cellar"}
        d["moves"] = {a["pid"]: "cellar", b["pid"]: "cellar", c["pid"]: "study", k["pid"]: "study"}
        game.resolve_move(g)
        v = game.view(g, a)
        self.assertTrue(v["here"]["dark"])
        self.assertEqual(v["here"]["people"], [])
        self.assertEqual(v["here"]["count"], 1)

    def test_views_never_leak_roles(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        for _ in range(5):
            game.add_bot(g)
        game.start(g)
        v = game.view(g, me)
        others = [p for p in v["players"] if p["pid"] != me["pid"]]
        if me["role"] == "guest":
            self.assertTrue(all("role" not in p for p in others))
        self.assertEqual(v["me"]["role"], me["role"])

    def test_the_vote_ejects_the_most_voted_and_ties_eject_nobody(self):
        g = game.new_game()
        ps = [game.add_player(g, n) for n in ("A", "B", "C", "D", "E")]
        game.start(g)
        game.new_day(g)
        d = game.today(g)
        d["votes"] = {ps[0]["pid"]: ps[1]["pid"], ps[2]["pid"]: ps[1]["pid"], ps[3]["pid"]: "skip"}
        game.tally(g)
        self.assertFalse(ps[1]["alive"])
        game.new_day(g)
        d = game.today(g)
        d["votes"] = {ps[0]["pid"]: ps[2]["pid"], ps[2]["pid"]: ps[0]["pid"]}
        game.tally(g)
        self.assertTrue(ps[0]["alive"] and ps[2]["alive"])


class Api(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()

    def test_page(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])

    def test_family_room_starts_when_everyone_is_ready(self):
        host = self.c.post("/api/play", json={"mode": "create", "name": "Mum"}).get_json()
        kid = self.c.post("/api/play", json={"mode": "join", "code": host["code"].lower(), "name": "Sam"}).get_json()
        g = game.GAMES[host["code"]]
        self.assertEqual(len(g["players"]), 2)
        for who in (host, kid):
            self.c.post(f"/api/game/{host['code']}", json={"pid": who["pid"], "token": who["token"], "type": "ready", "on": True})
        self.assertTrue(g["start_at"])
        g["start_at"] = 0
        v = self.c.get(f"/api/game/{host['code']}", query_string={"pid": kid["pid"], "token": kid["token"]}).get_json()
        self.assertEqual(v["phase"], "roles")
        self.assertEqual(len(v["players"]), 4, "filled up to four with bots")
        late = self.c.post("/api/play", json={"mode": "join", "code": host["code"], "name": "Late"})
        self.assertEqual(late.status_code, 409)

    def test_wrong_token_is_refused(self):
        me = self.c.post("/api/play", json={"mode": "create", "name": "Ann"}).get_json()
        r = self.c.get(f"/api/game/{me['code']}", query_string={"pid": me["pid"], "token": "nope"})
        self.assertEqual(r.status_code, 403)

    def test_queue_fills_with_bots(self):
        game.QUEUE["code"] = None
        a = self.c.post("/api/play", json={"mode": "queue", "name": "A"}).get_json()
        b = self.c.post("/api/play", json={"mode": "queue", "name": "B"}).get_json()
        self.assertEqual(a["code"], b["code"])
        g = game.GAMES[a["code"]]
        g["start_at"] = 0
        self.c.get(f"/api/game/{a['code']}", query_string={"pid": a["pid"], "token": a["token"]})
        self.assertEqual(g["phase"], "roles")
        self.assertEqual(len(g["players"]), game.QUEUE_SIZE)

    def test_the_day_meeting_rooms_messages_and_voice(self):
        me = self.c.post("/api/play", json={"mode": "bots", "name": "Ann"}).get_json()
        url, auth = f"/api/game/{me['code']}", {"pid": me["pid"], "token": me["token"]}
        g = game.GAMES[me["code"]]
        g["deadline"] = 0
        self.c.get(url, query_string=auth)
        self.assertEqual(g["phase"], "move")
        self.assertEqual(self.c.post(url, json={**auth, "type": "chat", "text": "hi"}).status_code, 400, "no meeting yet")
        game.today(g)["beats"][0].update(fx=None)
        self.assertEqual(self.c.post(url, json={**auth, "type": "move", "room": "garden"}).status_code, 200)
        self.assertEqual(g["phase"], "room", "everyone human has moved, bots move at once")
        v = self.c.post(url, json={**auth, "type": "room", "text": "Hello?"}).get_json()
        self.assertEqual(v["roomchat"][-1]["text"], "Hello?")
        bot = next(p for p in g["players"] if p["bot"])
        v = self.c.post(url, json={**auth, "type": "dm", "to": bot["pid"], "text": "Where were you?"}).get_json()
        self.assertTrue(any(m["text"] == "Where were you?" for m in v["dms"]))
        self.assertEqual(self.c.post(url, json={**auth, "type": "signal", "to": bot["pid"], "data": {}}).status_code, 400, "bots have no voice")
        v = self.c.post(url, json={**auth, "type": "do", "act": "look", "take": "rope"}).get_json()
        self.assertEqual(g["phase"], "move")


if __name__ == "__main__":
    unittest.main()
