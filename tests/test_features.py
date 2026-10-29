"""The October 29 update: three new roles (Jester, Tracker, Bodyguard), emotes, the evidence board, the ghosts' view of the house,
end-of-game highlights and stats, open games anyone can join, practice games, lobby chat, badges, and bots that remember.

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


def sync():
    return mock.patch.object(game.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args)))


class Base(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()

    def fixed_game(self, names=("Ann", "Ben", "Cat", "Kay")):
        """People only, the last one the killer, on a quiet day (no storms, no power cuts)."""
        g = game.new_game()
        ps = [game.add_player(g, n) for n in names]
        game.start(g)
        for p in g["players"]:
            p.update(role="guest", job=None)
        ps[-1]["role"] = "killer"
        game.new_day(g)
        for beat in game.today(g)["beats"]:
            beat.update(fx=None)
        post = lambda p, **body: self.c.post(f"/api/game/{g['code']}", json={"pid": p["pid"], "token": p["token"], **body})
        return g, ps, post

    def hour(self, g, moves, acts=None):
        d = game.today(g)
        d["moves"].update({p["pid"]: r for p, r in moves})
        game.resolve_move(g)
        if g["phase"] != "room":
            return
        d["acts"].update({p["pid"]: a for p, a in (acts or [])})
        game.resolve_room(g)


class Cast(Base):
    def test_every_size_keeps_a_plain_guest_and_only_eligible_roles(self):
        for n in range(4, 9):
            for _ in range(15):
                g = game.new_game()
                for _ in range(n):
                    game.add_bot(g)
                game.start(g)
                guests = [p for p in g["players"] if p["role"] == "guest"]
                jobs = [p["job"] for p in guests if p.get("job")]
                self.assertLess(len(jobs), len(guests), "there's always at least one plain guest")
                self.assertEqual(len(jobs), len(set(jobs)), "one of each")
                for j in jobs:
                    self.assertGreaterEqual(n, game.EXTRA_JOBS.get(j, 4), (j, n))

    def test_the_new_roles_turn_up_and_the_host_can_switch_them_off(self):
        seen = set()
        for _ in range(60):
            g = game.new_game()
            for _ in range(8):
                game.add_bot(g)
            game.start(g)
            seen |= {p.get("job") for p in g["players"]}
        self.assertTrue({"jester", "tracker", "bodyguard"} <= seen, seen)
        g = game.new_game()
        host = game.add_player(g, "Ann")
        for _ in range(7):
            game.add_bot(g)
        for role in ("jester", "tracker", "bodyguard"):
            self.c.post(f"/api/game/{g['code']}", json={"pid": host["pid"], "token": host["token"], "type": "roles", "role": role, "on": False})
        for _ in range(10):
            game.start(g)
            self.assertFalse({"jester", "tracker", "bodyguard"} & {p.get("job") for p in g["players"]})

    def test_bot_games_with_every_role_play_to_the_end(self):
        for _ in range(10):
            g = game.new_game()
            for _ in range(8):
                game.add_bot(g)
            game.start(g)
            jobs = ["detective", "doctor", "jester", "tracker", "bodyguard"]
            for p, j in zip([p for p in g["players"] if p["role"] == "guest"], jobs):
                p["job"] = j
            run_out(g)
            self.assertEqual(g["phase"], "over")
            v = game.view(g, g["players"][0])
            self.assertIn("highlights", v)
            self.assertIn("mystats", v)


class Jester(Base):
    def test_the_jester_wins_by_being_voted_out_and_the_game_goes_on(self):
        g, (a, b, c, d_, k), post = self.fixed_game(("Ann", "Ben", "Cat", "Dan", "Kay"))
        b["job"] = "jester"
        d = game.today(g)
        d["votes"] = {a["pid"]: b["pid"], c["pid"]: b["pid"], d_["pid"]: b["pid"], k["pid"]: b["pid"]}
        game.tally(g)
        self.assertFalse(b["alive"])
        self.assertEqual(g["jester"], {"pid": b["pid"], "day": 1})
        v = game.view(g, a)
        self.assertTrue(v["ejected"]["jester"], "everyone sees it was the Jester")
        self.assertEqual(v["ejected"]["role"], "guest")
        game.tick(g)
        self.assertIsNone(game.winner(g), "the killer is still out there")
        game.game_over(g, "killers")
        self.assertTrue(game.my_stats(g, b)["won"], "the Jester won anyway")
        self.assertTrue(game.my_stats(g, b)["jester"])
        self.assertFalse(game.my_stats(g, a)["won"])
        self.assertEqual(game.view(g, a)["jesterWon"], "Ben")
        self.assertTrue(any(h["emoji"] == "🃏" for h in game.highlights(g)))

    def test_a_jester_who_survives_does_not_win(self):
        g, (a, b, c, k), post = self.fixed_game()
        b["job"] = "jester"
        game.game_over(g, "guests")
        self.assertFalse(game.my_stats(g, b)["won"])
        self.assertTrue(game.my_stats(g, a)["won"])

    def test_a_jester_bot_fibs_about_its_day(self):
        g, (a, b, c, k), post = self.fixed_game()
        b.update(job="jester", bot=True)
        for i in range(3):
            self.hour(g, [(a, "library"), (b, "kitchen"), (c, "garden"), (k, "library")])
        lies = 0
        for _ in range(40):
            claim = game.claim_for(g, b)
            lies += any(claim[str(i)] != "kitchen" for i in range(3))
        self.assertGreater(lies, 10, "it lies on purpose, often")
        self.assertIn(game.bot_vote(g, b), [a["pid"], c["pid"], k["pid"]])


class Tracker(Base):
    def test_the_tracker_follows_footprints_once_a_day(self):
        g, (a, b, c, k), post = self.fixed_game()
        a["job"] = "tracker"
        self.assertEqual(post(b, type="track", target=k["pid"]).status_code, 409, "only the Tracker")
        v = post(a, type="track", target=k["pid"]).get_json()
        self.assertEqual(v["tracking"]["name"], "Kay")
        self.assertFalse(v["canTrack"])
        self.assertEqual(post(a, type="track", target=b["pid"]).status_code, 400, "once a day")
        self.hour(g, [(a, "library"), (k, "kitchen"), (b, "kitchen"), (c, "garden")], [(k, {"take": "kitchen knife", "sneak": True})])
        t = g["trails"][0]
        self.assertEqual((t["target"], t["room"], t["with"], t["took"]), (k["pid"], "kitchen", [b["pid"]], "kitchen knife"), "even a quiet take")
        said = " ".join(game.my_day(g, a, game.today(g))[-1]["events"])
        self.assertIn("You followed Kay's footprints: the Kitchen, with Ben. They took the kitchen knife.", said)
        self.assertNotIn("footprints", " ".join(game.my_day(g, b, game.today(g))[-1]["events"]))
        self.assertEqual(game.view(g, a)["trails"][0]["room"], "Kitchen")
        self.assertNotIn("trails", game.view(g, b))

    def test_footprints_see_through_a_borrowed_face(self):
        g, (a, b, c, k), post = self.fixed_game()
        a["job"], k["job"] = "tracker", "shapeshifter"
        post(k, type="shift", target=c["pid"])
        post(a, type="track", target=k["pid"])
        self.hour(g, [(a, "library"), (k, "garden"), (b, "garden"), (c, "kitchen")])
        self.assertEqual(g["trails"][0]["room"], "garden", "the real Kay's steps")

    def test_a_tracker_bot_picks_someone_by_3_pm(self):
        g, (a, b, c, k), post = self.fixed_game()
        b.update(job="tracker", bot=True)
        for _ in range(4):
            self.hour(g, [(a, "library"), (c, "garden"), (k, "library")])
        self.assertIn(b["pid"], game.today(g)["tracks"])
        self.assertTrue(any(t["by"] == b["pid"] for t in g["trails"]))


class Bodyguard(Base):
    def test_the_bodyguard_goes_where_they_go_and_stops_the_strike(self):
        g, (a, b, c, k), post = self.fixed_game()
        b["job"] = "bodyguard"
        g["carry"][k["pid"]] = "rope"
        self.assertEqual(post(a, type="shadow", target=c["pid"]).status_code, 409, "only the Bodyguard")
        v = post(b, type="shadow", target=c["pid"]).get_json()
        self.assertEqual(v["shadowing"]["name"], "Cat")
        self.assertEqual(post(b, type="shadow", target=a["pid"]).status_code, 400, "once a day")
        d = game.today(g)
        d["moves"] = {a["pid"]: "library", b["pid"]: "library", c["pid"]: "garden", k["pid"]: "garden"}
        game.resolve_move(g)
        self.assertEqual(d["cur"]["where"][b["pid"]], "garden", "the Bodyguard follows Cat, whatever they picked")
        d["acts"] = {k["pid"]: {"strike": c["pid"]}}
        game.resolve_room(g)
        self.assertTrue(c["alive"], "fought off")
        self.assertIsNone(d["kill"])
        self.assertEqual(d["saves"][0]["by"], "bodyguard")
        self.assertIn("You fought off Kay", " ".join(game.my_day(g, b, d)[-1]["events"]))
        self.assertIn("Kay went for you", " ".join(game.my_day(g, c, d)[-1]["events"]), "face to face: Cat saw who")
        self.assertGreaterEqual(game.suspicion(g, c)[k["pid"]], 20)
        b["bot"] = True
        self.assertEqual(game.evidence(g, b)[0], k["pid"], "a Bodyguard bot says who it was")
        self.assertIn("bodyguard", game.gazette(g, d)["lines"][-1].lower() + " ".join(game.gazette(g, d)["lines"]).lower())

    def test_without_a_shadow_the_strike_lands(self):
        g, (a, b, c, k), post = self.fixed_game()
        b["job"] = "bodyguard"
        g["carry"][k["pid"]] = "rope"
        self.hour(g, [(a, "library"), (b, "library"), (c, "garden"), (k, "garden")], [(k, {"strike": c["pid"]})])
        self.assertFalse(c["alive"])


class Board(Base):
    def test_the_board_marks_a_claim_that_clashes_with_what_you_saw(self):
        g, (a, b, c, k), post = self.fixed_game()
        g["carry"][k["pid"]] = "rope"
        self.hour(g, [(a, "library"), (b, "library"), (c, "garden"), (k, "kitchen")])
        self.hour(g, [(a, "kitchen"), (b, "library"), (c, "garden"), (k, "garden")], [(k, {"strike": c["pid"]})])
        self.hour(g, [(a, "garden"), (b, "library"), (k, "kitchen")])
        self.assertEqual(g["phase"], "body")
        d = game.today(g)
        d["claims"][k["pid"]] = {"0": "library", "1": "kitchen"}            # Kay lies twice
        d["claims"][b["pid"]] = {"0": "library", "1": "library", "2": "library"}
        game.set_phase(g, "talk", 60)
        v = game.view(g, a)
        rows = {r["name"]: r for r in v["board"]["rows"]}
        self.assertEqual(rows["Kay"]["cells"][:2], ["Library", "Kitchen"])
        kinds = [f["kind"] for f in rows["Kay"]["flags"]]
        self.assertEqual(kinds.count("lie"), 3, rows["Kay"]["flags"])
        self.assertIn("nobody can walk there from the Library", " ".join(f["text"] for f in rows["Kay"]["flags"]), "Library to Kitchen is not one door")
        self.assertEqual(rows["Ben"]["flags"], [], "Ben told the truth")
        self.assertFalse(rows["Cat"]["claimed"])
        self.assertEqual(v["board"]["rows"][0]["name"], "Kay", "the most suspicious first")
        self.assertEqual(v["board"]["murder"], [{"i": 1, "room": "Garden"}])
        self.assertNotIn("board", game.view(g, a) if g.update(phase="move") is None else {})


class Emotes(Base):
    def test_emotes_float_up_only_where_you_are(self):
        g, (a, b, c, k), post = self.fixed_game()
        self.assertEqual(post(a, type="emote", emoji="😱").status_code, 400, "nobody to react to while picking a room")
        d = game.today(g)
        d["moves"] = {a["pid"]: "library", b["pid"]: "library", c["pid"]: "garden", k["pid"]: "kitchen"}
        game.resolve_move(g)
        self.assertEqual(post(a, type="emote", emoji="💩").status_code, 400)
        v = post(a, type="emote", emoji="😱").get_json()
        self.assertEqual(v["emotes"][-1]["emoji"], "😱")
        self.assertEqual(post(a, type="emote", emoji="😂").status_code, 429, "one at a time")
        self.assertEqual([e["emoji"] for e in game.view(g, b)["emotes"]], ["😱"])
        self.assertEqual(game.view(g, c)["emotes"], [], "another room sees nothing")
        game.set_phase(g, "talk", 60)
        b["emoted"] = 0
        post(b, type="emote", emoji="👏")
        self.assertIn("👏", [e["emoji"] for e in game.view(g, k)["emotes"]], "the whole meeting")
        c["alive"] = False
        c["emoted"] = 0
        post(c, type="emote", emoji="👀")
        self.assertNotIn("👀", [e["emoji"] for e in game.view(g, k)["emotes"]], "the living don't see the ghosts'")
        with mock.patch.object(game, "now", return_value=game.now() + 30):
            self.assertEqual(game.view(g, k)["emotes"], [], "they fade")

    def test_the_room_reacts_to_a_verdict(self):
        g = game.new_game()
        me = game.add_player(g, "Ann")
        for _ in range(4):
            game.add_bot(g)
        game.start(g)
        game.new_day(g)
        game.set_phase(g, "vote", 30)
        game.bot_votes(g)
        game.tally(g)
        alive = next(q for q in g["players"] if q["alive"])                # whoever wasn't voted out sees the room react
        self.assertTrue(game.view(g, alive)["emotes"], "bots react")


class Ghosts(Base):
    def test_the_dead_watch_every_room(self):
        g, (a, b, c, k), post = self.fixed_game()
        c["alive"] = False
        g["carry"][k["pid"]] = "rope"
        post(a, type="move", room="library")
        v = game.view(g, c)
        picking = {x["room"]: [q["name"] for q in x["people"]] for x in v["house"]}
        self.assertEqual(picking["library"], ["Ann"], "even while they pick")
        d = game.today(g)
        d["moves"].update({b["pid"]: "library", k["pid"]: "kitchen"})
        game.resolve_move(g)
        post(a, type="room", text="cosy in here")
        v = game.view(g, c)
        house = {x["room"]: x for x in v["house"]}
        self.assertEqual(house["library"]["chat"][-1]["text"], "cosy in here")
        kay = house["kitchen"]["people"][0]
        self.assertEqual((kay["name"], kay["killer"], kay["carry"]), ("Kay", True, "rope"))
        self.assertNotIn("house", game.view(g, a))


class EndOfGame(Base):
    def test_highlights_and_your_stats(self):
        g, (a, b, c, k), post = self.fixed_game()
        g["carry"][k["pid"]] = "rope"
        self.hour(g, [(a, "library"), (b, "library"), (c, "garden"), (k, "garden")], [(k, {"strike": c["pid"]})])
        self.hour(g, [(a, "garden"), (b, "library"), (k, "kitchen")])
        d = game.today(g)
        d["claims"][k["pid"]] = {"0": "kitchen"}
        d["votes"] = {a["pid"]: k["pid"], b["pid"]: k["pid"], k["pid"]: a["pid"]}
        game.tally(g)
        game.game_over(g)
        self.assertEqual(g["winner"], "guests")
        titles = [h["title"] for h in game.view(g, a)["highlights"]]
        for t in ("First blood", "The big lie", "Justice"):
            self.assertIn(t, titles)
        s = game.view(g, a)["mystats"]
        self.assertTrue(s["won"] and s["caught"] and s["survived"])
        self.assertEqual((s["rightVotes"], s["votesAgainst"], s["role"]), (1, 1, "guest"))
        ks = game.my_stats(g, k)
        self.assertEqual((ks["won"], ks["kills"], ks["ejected"]), (False, 1, True))
        self.assertNotIn("mystats", game.view(g, a) if g.update(phase="talk") is None else {})


class Lobbies(Base):
    def test_open_games_are_listed_and_private_ones_are_not(self):
        game.QUEUE["code"] = None
        host = self.c.post("/api/play", json={"mode": "create", "name": "Mum"}).get_json()
        codes = lambda: [x["code"] for x in self.c.get("/api/lobbies").get_json()["lobbies"]]
        self.assertNotIn(host["code"], codes(), "private by default")
        url, auth = f"/api/game/{host['code']}", {"pid": host["pid"], "token": host["token"]}
        kid = self.c.post("/api/play", json={"mode": "join", "code": host["code"], "name": "Sam"}).get_json()
        self.assertEqual(self.c.post(url, json={"pid": kid["pid"], "token": kid["token"], "type": "listed", "on": True}).status_code, 409, "only the host")
        v = self.c.post(url, json={**auth, "type": "listed", "on": True}).get_json()
        self.assertTrue(v["listed"])
        row = next(x for x in self.c.get("/api/lobbies").get_json()["lobbies"] if x["code"] == host["code"])
        self.assertEqual((row["host"], row["players"], row["humans"]), ("Mum", 2, 2))
        q = self.c.post("/api/play", json={"mode": "queue", "name": "Q"}).get_json()
        self.assertEqual(codes()[0], q["code"], "the public queue comes first")
        game.start(game.GAMES[host["code"]])
        self.assertNotIn(host["code"], codes(), "started: gone")

    def test_the_lobby_has_its_own_chat(self):
        host = self.c.post("/api/play", json={"mode": "create", "name": "Mum"}).get_json()
        url, auth = f"/api/game/{host['code']}", {"pid": host["pid"], "token": host["token"]}
        self.c.post(url, json={**auth, "type": "bots", "n": 3})
        with mock.patch.object(game.random, "random", return_value=0.1):
            v = self.c.post(url, json={**auth, "type": "chat", "text": "hello everyone"}).get_json()
        self.assertEqual(v["lobbychat"][0]["text"], "hello everyone")
        self.assertTrue(v["lobbychat"][1]["bot"], "a bot says hello back")
        self.assertEqual(self.c.post(url, json={**auth, "type": "chat", "text": "again"}).status_code, 429)


class Practice(Base):
    def test_a_practice_game_is_gentle(self):
        for _ in range(15):
            me = self.c.post("/api/play", json={"mode": "practice", "name": "New"}).get_json()
            g = game.GAMES[me["code"]]
            p = game.player(g, me["pid"])
            self.assertEqual(p["role"], "guest", "never the killer in practice")
            self.assertEqual((len(g["players"]), g["pace"]), (5, "relaxed"))
        v = self.c.get(f"/api/game/{me['code']}", query_string={"pid": me["pid"], "token": me["token"]}).get_json()
        self.assertTrue(v["practice"])
        self.assertEqual(v["span"], game.tm(g, "roles"), "the phone knows how long this step lasts")


class Flair(Base):
    def test_your_level_and_badge_show_next_to_your_name(self):
        me = self.c.post("/api/play", json={"mode": "create", "name": "Ann", "level": 12, "badge": "🔥"}).get_json()
        bad = self.c.post("/api/play", json={"mode": "join", "code": me["code"], "name": "Bob", "level": 9999, "badge": "<script>"}).get_json()
        g = game.GAMES[me["code"]]
        v = game.view(g, game.player(g, me["pid"]))
        rows = {p["name"]: p for p in v["players"]}
        self.assertEqual((rows["Ann"]["level"], rows["Ann"]["badge"]), (12, "🔥"))
        self.assertEqual((rows["Bob"]["level"], rows["Bob"]["badge"]), (None, None), "nonsense is dropped")
        self.assertIsNotNone(bad["pid"])
        game.start(g)
        game.game_over(g, "guests")
        v = self.c.post(f"/api/game/{me['code']}", json={"pid": me["pid"], "token": me["token"], "type": "again", "level": 13, "badge": "⭐"}).get_json()
        self.assertEqual(v["phase"], "lobby")
        self.assertEqual(next(p for p in v["players"] if p["name"] == "Ann")["level"], 13, "levelled up since: the lobby shows it")


class BotMemory(Base):
    def test_a_witness_still_remembers_on_the_next_day(self):
        g, (a, b, c, d_, k), post = self.fixed_game(("Ann", "Ben", "Cat", "Dan", "Kay"))
        b["bot"] = True
        g["carry"][k["pid"]] = "rope"
        self.hour(g, [(k, "garden"), (a, "garden"), (b, "garden"), (c, "library"), (d_, "library")], [(k, {"strike": a["pid"]})])
        self.assertFalse(a["alive"])
        d = game.today(g)
        d["votes"] = {c["pid"]: d_["pid"], d_["pid"]: c["pid"]}            # the vote fails
        game.tally(g)
        self.assertTrue(k["alive"])
        game.new_day(g)
        self.assertGreaterEqual(game.suspicion(g, b)[k["pid"]], 20, "a day later, Ben still knows what he saw")
        self.assertIn("on day 1", game.evidence(g, b)[1])
        self.assertEqual(game.bot_vote(g, b), k["pid"])


if __name__ == "__main__":
    unittest.main()
