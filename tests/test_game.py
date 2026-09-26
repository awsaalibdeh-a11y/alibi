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

    def test_more_guests_open_more_rooms(self):
        for n, rooms in ((4, 3), (5, 4), (6, 4), (7, 5), (8, 6)):
            g = game.new_game()
            for _ in range(n):
                game.add_bot(g)
            self.assertEqual(len(game.rooms_of(g)), rooms, n)

    def test_people_are_the_killer_more_often_than_bots(self):
        human_killer, trials = 0, 400
        for _ in range(trials):
            g = game.new_game()
            me = game.add_player(g, "Ann")
            for _ in range(5):
                game.add_bot(g)
            game.start(g)
            human_killer += me["role"] == "killer"
        self.assertGreater(human_killer / trials, 1 / 6 + 0.05, "better than the plain one-in-six")
        self.assertLess(human_killer / trials, 0.6, "but not every game")

    def test_a_quiet_take_is_only_seen_by_someone_looking_around(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        game.new_day(g)
        d = game.today(g)
        for beat in d["beats"]:
            beat.update(fx=None)
        d["moves"] = {p["pid"]: "kitchen" for p in (a, b, k)} | {c["pid"]: "garden"}
        game.resolve_move(g)
        d["acts"] = {k["pid"]: {"act": "Bake bread", "take": "kitchen knife", "sneak": True}, a["pid"]: {"act": "Bake bread"}, b["pid"]: {"act": "look"}}
        game.resolve_room(g)
        seen = lambda p: " ".join(game.my_day(g, p, d)[-1]["events"])
        self.assertNotIn("knife", seen(a), "busy baking: didn't notice")
        self.assertIn("Kay quietly took the kitchen knife", seen(b), "looking around: caught it")
        self.assertIn("You quietly took the kitchen knife", seen(k))
        self.assertEqual(g["carry"][k["pid"]], "kitchen knife")

    def test_a_killers_story_only_lies_where_it_matters(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        game.new_day(g)
        d = game.today(g)
        for beat in d["beats"]:
            beat.update(fx=None)
        def hour(moves, acts):
            d["moves"] = {p["pid"]: r for p, r in moves}
            game.resolve_move(g)
            d["acts"] = {p["pid"]: x for p, x in acts}
            game.resolve_room(g)
        hour([(k, "library"), (a, "garden"), (b, "kitchen"), (c, "garden")], [])
        hour([(k, "kitchen"), (a, "garden"), (b, "garden"), (c, "garden")], [(k, {"take": "kitchen knife"})])
        hour([(k, "garden"), (c, "garden"), (a, "library"), (b, "library")], [(k, {"strike": c["pid"]})])
        self.assertEqual(d["kill"]["victim"], c["pid"])
        with mock.patch.object(game, "BOT_LIAR_SKILL", 1):              # a careful liar: only lies nobody alive can catch
            claim = game.claim_for(g, k)
            self.assertEqual(claim["0"], "library", "nothing to hide at 9 AM")
            self.assertEqual(claim["1"], "library", "the one room nobody was in when it picked up the knife")
            self.assertEqual(claim["2"], "kitchen", "the one room nobody was in during the murder")
        with mock.patch.object(game, "BOT_LIAR_SKILL", 0):              # a clumsy one: just moves itself away from the murder
            claim = game.claim_for(g, k)
            self.assertEqual(claim["1"], "kitchen")
            self.assertNotEqual(claim["2"], "garden")

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

    def sync(self):
        return mock.patch.object(game.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args)))

    def test_bots_open_the_meeting_and_answer_at_once(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        for _ in range(3):
            game.add_bot(g)
        game.start(g)
        game.new_day(g)
        game.begin_talk(g)
        d = game.today(g)
        opener = next(x for x in d["bot_plan"] if x["kind"] == "open")
        self.assertLess(opener["at"] - game.now(), 2, "somebody breaks the silence within a couple of seconds")
        bot = next(p for p in g["players"] if p["bot"])
        before = len(d["chat"])
        with self.sync():
            self.c.post(f"/api/game/{g['code']}", json={"pid": me["pid"], "token": me["token"], "type": "chat", "text": f"{bot['name']}, where were you?"})
        self.assertTrue(any(m["pid"] == bot["pid"] for m in d["chat"][before:]), "the bot you named answers straight away")

    def test_a_dead_bot_answers_a_ghost(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        bots = [game.add_bot(g) for _ in range(3)]
        game.start(g)
        game.new_day(g)
        me["alive"] = bots[0]["alive"] = False
        bots[0]["killed"] = {"day": 1, "hour": 0, "room": "library", "by": bots[1]["pid"], "weapon": "rope"}
        with self.sync():
            v = self.c.post(f"/api/game/{g['code']}", json={"pid": me["pid"], "token": me["token"], "type": "dm", "to": bots[0]["pid"], "text": "Who got you?"}).get_json()
        self.assertTrue(any(m["from"] == bots[0]["pid"] for m in v["dms"]))

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
        self.assertEqual(g["phase"], "room", "choosing what to do doesn't end the hour: you can stay and talk")
        self.c.post(url, json={**auth, "type": "leave_room"})
        self.assertEqual(g["phase"], "move", "everyone human has left the room")


if __name__ == "__main__":
    unittest.main()
