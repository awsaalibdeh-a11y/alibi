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
        hour([(k, "garden"), (a, "garden"), (b, "library"), (c, "study")], [(k, {}), (a, {}), (b, {"act": "look"}), (c, {})])
        self.assertIsNone(d["kill"], "had the chance, didn't take it")
        hour([(k, "study"), (c, "study"), (a, "garden"), (b, "library")], [(k, {"strike": c["pid"]}), (c, {}), (a, {}), (b, {})])
        self.assertEqual(d["kill"]["victim"], c["pid"])
        self.assertFalse(c["alive"])
        hour([(k, "kitchen"), (a, "study"), (b, "library")], [])
        self.assertEqual(g["phase"], "body")
        self.assertEqual(d["found"]["by"], [a["pid"]])
        self.assertIn("kitchen knife", d["missing"])

    def test_a_kill_in_front_of_someone_is_seen_and_they_say_so(self):
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        b["bot"] = True
        game.new_day(g)
        d = game.today(g)
        for beat in d["beats"]:
            beat.update(fx=None)
        g["carry"][k["pid"]] = "rope"
        d["moves"] = {k["pid"]: "garden", a["pid"]: "garden", b["pid"]: "garden", c["pid"]: "library"}
        game.resolve_move(g)
        d["acts"] = {k["pid"]: {"strike": a["pid"]}}
        game.resolve_room(g)
        self.assertFalse(a["alive"])
        self.assertEqual(d["kill"]["witnesses"], [b["pid"]])
        self.assertEqual(g["phase"], "body", "found on the spot")
        self.assertIn("You SAW Kay kill Ann", " ".join(game.my_day(g, b, d)[-1]["events"]))
        self.assertGreaterEqual(game.suspicion(g, b)[k["pid"]], 20)
        self.assertEqual(game.bot_vote(g, b), k["pid"])
        game.begin_talk(g)
        with mock.patch.object(game.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args))):
            game.bot_speak(g, b["pid"], "open")
        self.assertIn("Kay", d["chat"][-1]["text"], "the witness names the killer")

    def test_whispers_count_and_meetups_are_kept(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        bots = [game.add_bot(g) for _ in range(3)]
        game.start(g)
        game.new_day(g)
        rosa, other = bots[0], bots[1]
        base = game.suspicion(g, rosa)[other["pid"]]
        game.dm(g, me, rosa["pid"], f"I really think {other['name']} is hiding something")
        self.assertGreater(game.suspicion(g, rosa)[other["pid"]], base, "a bot takes a whisper into account")
        self.assertIsNone(game.meetup(g, "I was in the kitchen at 9"), "a story, not a plan")
        plan = game.remember_meet(g, rosa, me, "meet me in the kitchen at 3")
        self.assertEqual((plan["room"], plan["hour"], plan["day"]), ("kitchen", 3, 1))
        g["hour"] = 3
        self.assertEqual(game.bot_move(g, rosa), "kitchen", "she keeps her promise")
        self.assertNotIn(rosa["pid"], g["meets"])

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

    def test_bots_in_your_room_keep_the_conversation_going(self):
        me = self.c.post("/api/play", json={"mode": "bots", "name": "Ann"}).get_json()
        g = game.GAMES[me["code"]]
        url, auth = f"/api/game/{me['code']}", {"pid": me["pid"], "token": me["token"]}
        g["deadline"] = 0
        self.c.get(url, query_string=auth)
        d = game.today(g)
        d["beats"][0].update(fx=None)
        bots = [p for p in g["players"] if p["bot"]]
        d["moves"] = {p["pid"]: "library" for p in g["players"]}
        game.resolve_move(g)
        with self.sync():
            for text in ("Hello?", "Where were you at nine?", "And the candlestick?"):
                self.c.post(url, json={**auth, "type": "room", "text": text})
        said = [m for m in d["roomchat"][f"0:library"] if m["pid"] != me["pid"]]
        self.assertGreaterEqual(len(said), 3, "every message gets an answer, not just the first")

    def test_leaving_mid_game_hands_your_seat_to_a_bot(self):
        me = self.c.post("/api/play", json={"mode": "bots", "name": "Ann"}).get_json()
        g = game.GAMES[me["code"]]
        g["deadline"] = 0
        url, auth = f"/api/game/{me['code']}", {"pid": me["pid"], "token": me["token"]}
        self.c.get(url, query_string=auth)
        self.assertEqual(g["phase"], "move")
        self.c.post(url, json={**auth, "type": "leave"})
        ann = game.player(g, me["pid"])
        self.assertTrue(ann["bot"] and ann["left"])
        self.assertNotEqual(g["phase"], "move", "nobody left to wait for: the bots move on at once")

    def test_reactions_on_chat(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        for _ in range(3):
            game.add_bot(g)
        game.start(g)
        game.new_day(g)
        game.set_phase(g, "talk", 30)
        url, auth = f"/api/game/{g['code']}", {"pid": me["pid"], "token": me["token"]}
        mid = self.c.post(url, json={**auth, "type": "chat", "text": "hello"}).get_json()["chat"][-1]["id"]
        r = self.c.post(url, json={**auth, "type": "react", "id": mid, "emoji": "😂"}).get_json()
        self.assertEqual(next(m for m in r["chat"] if m["id"] == mid)["reactions"], {"😂": [me["pid"]]})
        r = self.c.post(url, json={**auth, "type": "react", "id": mid, "emoji": "😂"}).get_json()
        self.assertEqual(next(m for m in r["chat"] if m["id"] == mid)["reactions"], {}, "tap again to take it back")
        self.assertEqual(self.c.post(url, json={**auth, "type": "react", "id": mid, "emoji": "💩"}).status_code, 400)

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

    def fixed_game(self):
        """Ann, Ben and Cat against Kay the killer, all people, on a quiet day (no storms, no power cuts)."""
        g = game.new_game()
        a, b, c, k = (game.add_player(g, n) for n in ("Ann", "Ben", "Cat", "Kay"))
        game.start(g)
        for p in g["players"]:
            p["role"] = "guest"
        k["role"] = "killer"
        game.new_day(g)
        for beat in game.today(g)["beats"]:
            beat.update(fx=None)
        post = lambda p, **body: self.c.post(f"/api/game/{g['code']}", json={"pid": p["pid"], "token": p["token"], **body})
        return g, (a, b, c, k), post

    def test_the_killer_cuts_the_lights_once_a_day(self):
        g, (a, b, c, k), post = self.fixed_game()
        self.assertEqual(post(a, type="cut", room="kitchen").status_code, 409, "only the killer knows where the fuse box is")
        self.assertEqual(post(k, type="cut", room="garden").status_code, 400)
        v = post(k, type="cut", room="kitchen").get_json()
        self.assertEqual(v["beat"]["fx"], "dark")
        self.assertIn("Kitchen", v["beat"]["text"])
        self.assertFalse(game.view(g, k)["canCut"])
        self.assertEqual(post(k, type="cut", room="library").status_code, 400, "once a day")
        g["carry"][k["pid"]] = "rope"
        d = game.today(g)
        d["moves"] = {k["pid"]: "kitchen", c["pid"]: "kitchen", a["pid"]: "library", b["pid"]: "library"}
        game.resolve_move(g)
        self.assertTrue(game.view(g, c)["here"]["dark"])
        d["acts"] = {k["pid"]: {"strike": "dark"}}
        game.resolve_room(g)
        self.assertFalse(c["alive"], "struck in the dark")
        self.assertEqual(d["kill"]["witnesses"], [])

    def test_searching_pockets_once_a_game(self):
        g, (a, b, c, k), post = self.fixed_game()
        g["carry"][k["pid"]] = "kitchen knife"
        game.set_phase(g, "talk", 60)
        v = post(a, type="search", target=k["pid"]).get_json()
        self.assertEqual(v["searches"], [{"by": "Ann", "target": "Kay", "found": "kitchen knife", "day": 1, "mine": True}])
        self.assertTrue(v["me"]["searched"])
        self.assertEqual(game.view(g, k)["searches"][0]["mine"], False, "Kay knows Ann looked")
        self.assertEqual(game.view(g, b)["searches"], [], "nobody else does")
        self.assertEqual(post(a, type="search", target=b["pid"]).status_code, 400, "once a game")
        self.assertIsNone(post(b, type="search", target=c["pid"]).get_json()["searches"][0]["found"])

    def test_a_ghost_haunts_a_room(self):
        g, (a, b, c, k), post = self.fixed_game()
        c["alive"] = False
        d = game.today(g)
        d["moves"] = {k["pid"]: "kitchen", a["pid"]: "library", b["pid"]: "library"}
        game.resolve_move(g)
        v = game.view(g, c)
        self.assertEqual({x["room"]: x["people"] for x in v["house"]}["library"], ["Ann", "Ben"], "the dead see the whole house")
        self.assertEqual(post(c, type="haunt", room="library", emoji="💩").status_code, 400)
        post(c, type="haunt", room="library", emoji="🔪")
        self.assertEqual(post(c, type="haunt", room="kitchen", emoji="👻").status_code, 400, "once an hour")
        msg = game.view(g, a)["roomchat"][-1]
        self.assertEqual((msg["text"], msg["name"], msg["haunt"]), ("🔪", "Ghost of Cat", True))
        self.assertEqual(game.view(g, k)["roomchat"], [], "only that room feels it")
        self.assertEqual(post(a, type="haunt", room="kitchen", emoji="👻").status_code, 409, "the living can't")

    def test_the_ballots_are_read_out(self):
        g, (a, b, c, k), post = self.fixed_game()
        d = game.today(g)
        game.set_phase(g, "vote", 30)
        d["votes"] = {a["pid"]: k["pid"], b["pid"]: k["pid"], c["pid"]: "skip", k["pid"]: a["pid"]}
        game.tally(g)
        v = game.view(g, a)
        self.assertEqual(v["ballots"], [{"from": "Ann", "to": "Kay"}, {"from": "Ben", "to": "Kay"}, {"from": "Cat", "to": "Skip"}, {"from": "Kay", "to": "Ann"}])
        self.assertEqual(v["ejected"]["role"], "killer")

    def test_secret_missions_count_up(self):
        g, (a, b, c, k), post = self.fixed_game()
        self.assertTrue(all(p["mission"] for p in g["players"]))
        a["mission"] = {"kind": "visit", "room": "kitchen", "n": 2}
        b["mission"] = {"kind": "meet", "with": a["pid"], "n": 1}
        k["mission"] = {"kind": "kill_in", "room": "garden"}
        d = game.today(g)
        g["carry"][k["pid"]] = "rope"
        for hour in range(2):
            d["moves"] = {a["pid"]: "kitchen", b["pid"]: "kitchen", c["pid"]: "garden", k["pid"]: "garden"}
            game.resolve_move(g)
            d["acts"] = {k["pid"]: {"strike": c["pid"]}} if hour == 1 else {}
            game.resolve_room(g)
        self.assertEqual(game.mission(g, a)["prog"], "2/2")
        self.assertTrue(game.mission(g, a)["done"] and game.mission(g, b)["done"] and game.mission(g, k)["done"])
        self.assertEqual(game.view(g, a)["me"]["mission"]["text"], "Spend 2 hours in the Kitchen")
        self.assertNotIn("mission", game.view(g, a)["players"][1], "nobody sees anyone else's until the end")

    def test_the_morning_paper_and_the_dying_clue(self):
        g, (a, b, c, k), post = self.fixed_game()
        d = game.today(g)
        g["carry"][k["pid"]] = "rope"
        d["moves"] = {k["pid"]: "garden", c["pid"]: "garden", a["pid"]: "library", b["pid"]: "library"}
        game.resolve_move(g)
        d["acts"] = {k["pid"]: {"strike": c["pid"]}}
        with mock.patch.object(game.random, "random", return_value=0.1):
            game.resolve_room(g)
        self.assertIn(k["pid"], d["kill"]["clue"])
        d["found"] = {"hour": 0, "by": [a["pid"]]}
        game.set_phase(g, "talk", 60)
        clue = game.view(g, a)["body"]["clue"]
        self.assertIn(game.color_name(g, k["pid"]), clue)
        self.assertEqual(len(game.today(g)["kill"]["clue"]), 3)
        d["ejected"] = k["pid"]
        game.new_day(g)
        paper = game.today(g)["gazette"]
        self.assertIn("THROWN OUT", paper["headline"])
        self.assertIn("a killer after all", " ".join(paper["lines"]))
        self.assertIn("found dead in the Garden", " ".join(paper["lines"]))
        self.assertEqual(game.view(g, a)["gazette"]["day"], 1)

    def test_anonymous_notes_and_jaccuse(self):
        g, (a, b, c, k), post = self.fixed_game()
        b["bot"] = True
        game.set_phase(g, "talk", 60)
        v = post(a, type="note", text="Kay was in the cellar").get_json()
        m = v["chat"][-1]
        self.assertEqual((m["name"], m["text"], m["note"]), ("An anonymous note", "Kay was in the cellar", True))
        self.assertNotIn(a["pid"], str(m), "nothing gives away who wrote it")
        self.assertEqual(post(a, type="note", text="again").status_code, 400, "once a game")
        with self.sync():
            v = post(a, type="accuse", target=b["pid"]).get_json()
        said = [x for x in v["chat"] if x.get("accuse")]
        self.assertEqual(said[-1]["accuse"], "Ben")
        self.assertEqual(v["chat"][-1]["pid"], b["pid"], "the bot answers back")
        self.assertTrue(v["accused"])
        self.assertEqual(post(a, type="accuse", target=c["pid"]).status_code, 400, "once a meeting")

    def test_a_killer_bot_slips_a_note(self):
        g, (a, b, c, k), post = self.fixed_game()
        k["bot"] = True
        d = game.today(g)
        d["kill"] = {"victim": c["pid"], "killer": k["pid"], "room": "garden", "hour": 0, "weapon": "rope", "witnesses": [], "heard": []}
        c["alive"] = False
        game.set_phase(g, "talk", 60)
        with self.sync():
            game.bot_speak(g, k["pid"], "note")
        self.assertTrue(d["chat"][-1]["note"])
        self.assertTrue(k["noted"])

    def test_the_detective_and_the_doctor(self):
        for n, jobs in ((4, 1), (5, 2), (8, 2)):
            g = game.new_game()
            for _ in range(n):
                game.add_bot(g)
            game.start(g)
            got = [p for p in g["players"] if p.get("job")]
            self.assertEqual(len(got), jobs)
            self.assertTrue(all(p["role"] == "guest" for p in got), "the killer never has a job")
        g, (a, b, c, k), post = self.fixed_game()
        a["job"], b["job"] = "detective", "doctor"
        d = game.today(g)
        g["carry"][k["pid"]] = "rope"
        post(b, type="guard", target=c["pid"])
        self.assertEqual(post(b, type="guard", target=a["pid"]).status_code, 400, "one patient a day")
        self.assertEqual(game.view(g, b)["guard"], "Cat")
        # the detective alone with the killer; the killer strikes the doctor's patient in front of nobody
        d["moves"] = {a["pid"]: "library", k["pid"]: "library", b["pid"]: "kitchen", c["pid"]: "kitchen"}
        game.resolve_move(g)
        post(a, type="do", act="act", investigate=k["pid"])
        game.resolve_room(g)
        self.assertEqual(game.view(g, a)["findings"], [{"target": "Kay", "day": 1, "hour": "9 AM", "killer": True}])
        self.assertIn("You investigated Kay: they ARE a killer", " ".join(game.my_day(g, a, d)[-1]["events"]))
        self.assertIn("studying you", " ".join(game.my_day(g, k, d)[-1]["events"]), "the killer gets a hint")
        self.assertGreaterEqual(game.suspicion(g, a)[k["pid"]], 20)
        d["moves"] = {k["pid"]: "garden", c["pid"]: "garden", a["pid"]: "library", b["pid"]: "library"}
        game.resolve_move(g)
        post(a, type="do", act="act", investigate=b["pid"])
        d["acts"][k["pid"]] = {"act": "x", "strike": c["pid"]}
        game.resolve_room(g)
        self.assertTrue(c["alive"], "the Doctor's patient lives")
        self.assertIsNone(d["kill"])
        self.assertEqual(len(g["findings"]), 1, "once a day")
        self.assertIn("attacked you from behind", " ".join(game.my_day(g, c, d)[-1]["events"]))
        self.assertIn("lived, thanks to you", " ".join(game.my_day(g, b, d)[-1]["events"]))

    def test_the_bell_calls_the_meeting(self):
        g, (a, b, c, k), post = self.fixed_game()
        self.assertEqual(post(a, type="bell").status_code, 400, "not at 9 AM")
        d = game.today(g)
        d["moves"] = {q["pid"]: "library" for q in (a, b, c, k)}
        game.resolve_move(g)
        game.resolve_room(g)
        self.assertEqual(g["phase"], "move")
        v = post(a, type="bell").get_json()
        self.assertEqual(v["phase"], "quiet")
        self.assertTrue(v["chat"][-1]["bell"])
        self.assertTrue(a["belled"])

    def test_bots_only_spend_ai_when_someone_is_watching(self):
        g, (a, b, c, k), post = self.fixed_game()
        with mock.patch.object(game, "_ask_json", return_value={"say": "AI line"}) as ask:
            os.environ["OPENAI_API_KEY"] = "test"
            try:
                a["seen"] = game.now()
                self.assertEqual(game._bot_reply(g, "p", "plain"), "AI line")
                a["seen"] = game.now() - 120
                for q in (b, c, k):
                    q["seen"] = game.now()
                    q["bot"] = True
                self.assertEqual(game._bot_reply(g, "p", "plain"), "plain", "nobody watching: no AI")
                a["seen"] = game.now()
                g["ai_calls"] = game.GAME_LIMIT
                self.assertEqual(game._bot_reply(g, "p", "plain"), "plain", "this game has had its share")
            finally:
                os.environ.pop("OPENAI_API_KEY", None)
        self.assertEqual(ask.call_count, 1)


if __name__ == "__main__":
    unittest.main()
