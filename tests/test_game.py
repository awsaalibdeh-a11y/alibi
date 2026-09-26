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
            self.assertIn("day", phases)

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
        def hour(choices):
            d["choices"] = {p["pid"]: {"room": r, "act": "", "take": t, "put": None, "strike": s} for p, r, t, s in choices}
            game.resolve_hour(g)
        hour([(k, "kitchen", "kitchen knife", True), (a, "kitchen", None, False), (b, "garden", None, False), (c, "study", None, False)])
        self.assertIsNone(d["kill"], "no weapon yet at the start of the hour")
        self.assertEqual(g["carry"][k["pid"]], "kitchen knife")
        hour([(k, "garden", None, True), (a, "garden", None, False), (b, "garden", None, False), (c, "study", None, False)])
        self.assertIsNone(d["kill"], "two witnesses")
        hour([(k, "study", None, True), (c, "study", None, False), (a, "garden", None, False), (b, "library", None, False)])
        self.assertEqual(d["kill"]["victim"], c["pid"])
        self.assertFalse(c["alive"])
        hour([(k, "kitchen", None, False), (a, "study", None, False), (b, "library", None, False)])
        self.assertEqual(g["phase"], "body")
        self.assertEqual(d["found"]["by"], [a["pid"]])
        self.assertIn("kitchen knife", d["missing"])

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

    def test_no_chat_for_the_living_during_the_day(self):
        me = self.c.post("/api/play", json={"mode": "bots", "name": "Ann"}).get_json()
        g = game.GAMES[me["code"]]
        g["deadline"] = 0
        self.c.get(f"/api/game/{me['code']}", query_string={"pid": me["pid"], "token": me["token"]})
        self.assertEqual(g["phase"], "day")
        r = self.c.post(f"/api/game/{me['code']}", json={"pid": me["pid"], "token": me["token"], "type": "chat", "text": "hi"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post(f"/api/game/{me['code']}", json={"pid": me["pid"], "token": me["token"], "type": "choose", "room": "garden", "take": "rope"})
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
