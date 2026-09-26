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

    def test_the_manor_is_small(self):
        self.assertEqual(len(game.ROOMS), 4)

    def test_favor_guest_makes_the_human_rarer_as_killer_but_not_impossible(self):
        killer_count, trials = 0, 300
        for _ in range(trials):
            g = game.new_game()
            me = game.add_player(g, "Ann")
            for _ in range(5):
                game.add_bot(g)
            game.start(g, favor_guest=me["pid"])
            killer_count += me["role"] == "killer"
        self.assertLess(killer_count / trials, 1 / 6, "should be rarer than the plain 1-in-6 chance")
        self.assertGreater(killer_count, 0, "should still be possible sometimes")

    def test_one_killer_up_to_six_two_from_seven(self):
        for n, k in ((4, 1), (6, 1), (7, 2), (8, 2)):
            g = game.new_game()
            for _ in range(n):
                game.add_bot(g)
            game.start(g)
            self.assertEqual(sum(p["role"] == "killer" for p in g["players"]), k)

    def test_a_kill_needs_a_weapon_and_the_target_to_actually_be_there(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        game.new_day(g)
        d = game.today(g)
        def hour(choices):
            d["choices"] = {p["pid"]: {"room": r, "act": "", "take": t, "put": None, "strike": s, "target": tg} for p, r, t, s, tg in choices}
            game.resolve_hour(g)
        hour([(k, "kitchen", "kitchen knife", True, c["pid"]), (a, "kitchen", None, False, None), (b, "garden", None, False, None), (c, "kitchen", None, False, None)])
        self.assertIsNone(d["kill"], "no weapon yet at the start of the hour")
        self.assertEqual(g["carry"][k["pid"]], "kitchen knife")
        hour([(k, "garden", None, True, c["pid"]), (a, "garden", None, False, None), (b, "garden", None, False, None), (c, "kitchen", None, False, None)])
        self.assertIsNone(d["kill"], "guessed the wrong room: the target wasn't there")
        hour([(k, "cellar", None, True, c["pid"]), (c, "cellar", None, False, None), (a, "garden", None, False, None), (b, "library", None, False, None)])
        self.assertEqual(d["kill"]["victim"], c["pid"])
        self.assertFalse(c["alive"])
        self.assertEqual(g["phase"], "day", "alone together: nobody saw it happen yet")
        hour([(k, "kitchen", None, False, None), (a, "cellar", None, False, None), (b, "library", None, False, None)])
        self.assertEqual(g["phase"], "body")
        self.assertEqual(d["found"]["by"], [a["pid"]])
        self.assertIn("kitchen knife", d["missing"])

    def test_a_crowded_kill_is_found_on_the_spot(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        game.new_day(g)
        d = game.today(g)
        g["carry"][k["pid"]] = "kitchen knife"
        d["choices"] = {
            k["pid"]: {"room": "kitchen", "act": "", "take": None, "put": None, "strike": True, "target": c["pid"]},
            c["pid"]: {"room": "kitchen", "act": "", "take": None, "put": None, "strike": False, "target": None},
            a["pid"]: {"room": "kitchen", "act": "", "take": None, "put": None, "strike": False, "target": None},
            b["pid"]: {"room": "garden", "act": "", "take": None, "put": None, "strike": False, "target": None},
        }
        game.resolve_hour(g)
        self.assertFalse(c["alive"])
        self.assertEqual(d["kill"]["witnesses"], [a["pid"]])
        self.assertEqual(g["phase"], "body", "a witness right there means the body is found on the spot")
        self.assertEqual(d["found"]["by"], [a["pid"]])

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

    def test_a_quiet_phone_shows_as_away(self):
        g = game.new_game()
        ann = game.add_player(g, "Ann")
        ben = game.add_player(g, "Ben")
        game.add_bot(g)
        game.add_bot(g)
        ann["seen"] -= 60
        v = game.view(g, ben)
        self.assertTrue(next(p for p in v["players"] if p["pid"] == ann["pid"])["away"])
        self.assertFalse(next(p for p in v["players"] if p["pid"] == ben["pid"])["away"])

    def test_decided_list_shows_who_chose_without_revealing_where(self):
        g = game.new_game()
        ann = game.add_player(g, "Ann")
        ben = game.add_player(g, "Ben")
        game.add_bot(g)
        game.add_bot(g)
        game.start(g)
        game.new_day(g)
        d = game.today(g)
        d["choices"][ann["pid"]] = {"room": "garden", "act": "", "take": None, "put": None, "strike": False}
        v = game.view(g, ben)
        self.assertEqual(v["decided"], [ann["pid"]])

    def test_awards_reward_the_most_accused_and_the_chattiest(self):
        g = game.new_game()
        ps = [game.add_player(g, n) for n in ("A", "B", "C", "D")]
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        ps[0]["role"] = "killer"
        game.new_day(g)
        d = game.today(g)
        d["votes"] = {ps[1]["pid"]: ps[0]["pid"], ps[2]["pid"]: ps[0]["pid"]}
        game.say(g, ps[1], "hi")
        game.say(g, ps[1], "again")
        a = game.awards(g)
        self.assertTrue(any(x["title"] == "Prime Suspect" and x["name"] == "A" for x in a))
        self.assertTrue(any(x["title"] == "Best Poker Face" and x["name"] == "A" for x in a))
        self.assertTrue(any(x["title"] == "Chatterbox" and x["name"] == "B" for x in a))

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

    def test_reacting_to_a_chat_message_toggles_and_switches(self):
        g = game.new_game()
        ann = game.add_player(g, "Ann")
        game.add_bot(g)
        game.add_bot(g)
        game.add_bot(g)
        game.start(g)
        game.new_day(g)
        game.set_phase(g, "talk", 30)
        r = self.c.post(f"/api/game/{g['code']}", json={"pid": ann["pid"], "token": ann["token"], "type": "chat", "text": "hello"})
        mid = r.get_json()["chat"][-1]["id"]
        args = dict(pid=ann["pid"], token=ann["token"], type="react", id=mid)
        r = self.c.post(f"/api/game/{g['code']}", json={**args, "emoji": "👍"})
        self.assertEqual(r.get_json()["chat"][-1]["reactions"], {"👍": [ann["pid"]]})
        r = self.c.post(f"/api/game/{g['code']}", json={**args, "emoji": "👍"})           # the same emoji again takes it back
        self.assertEqual(r.get_json()["chat"][-1]["reactions"], {})
        self.c.post(f"/api/game/{g['code']}", json={**args, "emoji": "👍"})
        r = self.c.post(f"/api/game/{g['code']}", json={**args, "emoji": "😂"})            # a different one switches
        self.assertEqual(r.get_json()["chat"][-1]["reactions"], {"😂": [ann["pid"]]})
        r = self.c.post(f"/api/game/{g['code']}", json={**args, "emoji": "🧟"})
        self.assertEqual(r.status_code, 400, "not one of the allowed reactions")

    def test_typing_shows_to_others_but_not_to_yourself(self):
        g = game.new_game()
        ann = game.add_player(g, "Ann")
        ben = game.add_player(g, "Ben")
        game.add_bot(g)
        game.add_bot(g)
        game.start(g)
        game.new_day(g)
        game.set_phase(g, "talk", 30)
        self.c.post(f"/api/game/{g['code']}", json={"pid": ann["pid"], "token": ann["token"], "type": "typing"})
        v = self.c.get(f"/api/game/{g['code']}", query_string={"pid": ben["pid"], "token": ben["token"]}).get_json()
        self.assertIn("Ann", v["typing"])
        v = self.c.get(f"/api/game/{g['code']}", query_string={"pid": ann["pid"], "token": ann["token"]}).get_json()
        self.assertEqual(v["typing"], [])


if __name__ == "__main__":
    unittest.main()
