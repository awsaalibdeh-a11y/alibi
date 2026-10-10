"""The bots should know about every death and never make things up. No AI is called: the AI is replaced by a script."""

import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
import game  # noqa: E402

os.environ.pop("OPENAI_API_KEY", None)


def a_game(map_id="wrenmoor", bots=5):
    g = game.new_game(map_id=map_id)
    me = game.add_player(g, "Ann")
    for _ in range(bots):
        game.add_bot(g)
    game.start(g)
    game.use_map(g)
    game.new_day(g)                                                    # the first morning: there is a day to put things in
    return g, me


def force_a_death(g, found=True):
    """Day 1: the killer kills someone in a room with a weapon, as the real game records it."""
    game.use_map(g)
    killer = next(q for q in g["players"] if q["role"] == "killer")
    victim = next(q for q in g["players"] if q["role"] != "killer" and q["pid"] != killer["pid"])
    room = game.room_ids(g)[0]
    weapon = game.ROOM[room]["items"][0]
    d = game.today(g)
    kill = {"killer": killer["pid"], "victim": victim["pid"], "room": room, "hour": 1, "weapon": weapon, "witnesses": [], "heard": []}
    d["kill"] = kill
    d["kills"] = [kill]
    d["found"] = {"hour": 2, "by": [], "at": 2} if found else None
    victim["alive"] = False
    return killer, victim, kill


class Deaths(unittest.TestCase):
    def test_a_bot_knows_who_died_where_when_and_how(self):
        g, _ = a_game()
        killer, victim, kill = force_a_death(g)
        bot = next(q for q in g["players"] if q["bot"] and q["role"] != "killer" and q["alive"])
        brief = game.bot_brief(g, bot)
        self.assertIn("Deaths so far", brief)
        self.assertIn(victim["name"], brief)
        self.assertIn(game.ROOM[kill["room"]]["name"], brief)
        self.assertIn(game.HOURS[kill["hour"]], brief)
        self.assertIn(game.CAUSE[game.KIND[kill["weapon"]]], brief)
        self.assertNotIn(killer["name"] + " killed", brief)                       # the killer is not revealed to the others

    def test_an_unfound_body_is_not_described(self):
        g, _ = a_game()
        killer, victim, kill = force_a_death(g, found=False)
        bot = next(q for q in g["players"] if q["bot"] and q["role"] != "killer" and q["alive"])
        brief = game.deaths_brief(g)
        self.assertIn("nobody has found a body yet", brief)
        self.assertNotIn(game.CAUSE[game.KIND[kill["weapon"]]], brief)            # nobody knows how yet
        self.assertNotIn(game.ROOM[kill["room"]]["name"], brief.split("Still alive")[0])

    def test_earlier_days_and_the_vote_are_remembered(self):
        g, _ = a_game()
        force_a_death(g)
        d1 = game.today(g)
        d1["n"] = 1
        voted = next(q for q in g["players"] if q["alive"] and q["role"] == "guest")
        d1["ejected"] = voted["pid"]
        voted["alive"] = False
        voted["ejected"] = True
        g["days"].append({**d1, "n": 2, "kill": None, "kills": [], "found": None, "ejected": None})
        brief = game.deaths_brief(g)
        self.assertIn("Day 1", brief)
        self.assertIn(f"voted out {voted['name']}", brief)
        self.assertIn("innocent", brief)
        self.assertIn("Still alive", brief)
        self.assertNotIn(voted["name"] + ",", brief.split("Still alive")[1])      # the dead are not listed as alive

    def test_works_on_every_map(self):
        for mid in game.MAPS:
            g, _ = a_game(mid)
            _, victim, kill = force_a_death(g)
            brief = game.deaths_brief(g)
            self.assertIn(game.ROOM[kill["room"]]["name"], brief, mid)


class Grounding(unittest.TestCase):
    def setUp(self):
        self.g, self.me = a_game()
        self.names = [q["name"] for q in self.g["players"]]

    def test_plain_lines_about_real_people_and_places_pass(self):
        n = self.names[1]
        for line in (f"I was in the Library with {n}, and she seemed fine.", "Honestly I have no idea who did it.", f"Where were you at 1 PM, {n}?",
                     "I think we should be careful. Maybe nobody is who they seem."):
            self.assertTrue(game.grounded(self.g, line), line)

    def test_a_person_who_is_not_here_is_rejected(self):
        for line in ("I saw Margaret near the door.", "Victor was acting strange.", "Then Professor Higgins left.", "Ask Eleanor, she was there."):
            self.assertFalse(game.grounded(self.g, line), line)

    def test_a_room_or_object_from_another_house_is_rejected(self):
        for line in ("I found it in the Boiler Room.", "Someone took the ice axe.", "He was in the Dining Car all day."):
            self.assertFalse(game.grounded(self.g, line), line)

    def test_the_same_words_are_fine_on_the_map_they_belong_to(self):
        g, _ = a_game("frostline")
        self.assertTrue(game.grounded(g, "I was in the Boiler Room, then the Ski Shop."))
        self.assertFalse(game.grounded(g, "I was in the Library."))                # that is a Wrenmoor room, not a Frostline one

    def test_a_made_up_line_is_replaced_by_the_plain_one(self):
        with mock.patch.object(game, "_ask_json", return_value={"say": "Victor did it, I saw him in the Boiler Room!"}) as ask:
            out = game._bot_reply(self.g, "prompt", "A plain line.")
        self.assertEqual(out, "A plain line.")
        self.assertEqual(ask.call_count, 2)                                        # it got one more try before giving up

    def test_a_second_try_that_sticks_to_the_facts_is_used(self):
        answers = [{"say": "Margaret did it."}, {"say": f"I really don't know, {self.names[1]}."}]
        with mock.patch.object(game, "_ask_json", side_effect=answers):
            out = game._bot_reply(self.g, "prompt", "A plain line.")
        self.assertEqual(out, f"I really don't know, {self.names[1]}.")

    def test_the_ai_is_told_to_stick_to_its_notes(self):
        with mock.patch.object(game, "_ask_json", return_value={"say": "Fine."}) as ask:
            game._bot_reply(self.g, "prompt", "x")
        system = ask.call_args[0][0]
        self.assertIn("ONLY the facts", system)
        self.assertIn("Never invent", system)


class Strikes(unittest.TestCase):
    """The phones get what they need to animate a theft or a strike."""

    def test_the_killer_the_victim_and_a_witness_each_get_their_own_strike(self):
        g, me = a_game()
        game.use_map(g)
        killer, victim, kill = force_a_death(g)
        witness = next(q for q in g["players"] if q["pid"] not in (killer["pid"], victim["pid"]))
        kill["witnesses"] = [witness["pid"]]
        d = game.today(g)
        room = kill["room"]
        d["hours"] = [{"where": {q["pid"]: room for q in g["players"]}, "acts": {}, "events": {room: []}, "looks": {}, "idle": []} for _ in range(2)]
        d["hours"][1]["acts"] = {}
        by_role = {}
        for who in (killer, victim, witness):
            for entry in game.my_day(g, who, d):
                for s in entry.get("strikes", []):
                    by_role[s["role"]] = s
        self.assertEqual(set(by_role), {"killer", "victim", "witness"})
        self.assertEqual(by_role["killer"]["victim"], victim["name"])
        self.assertEqual(by_role["killer"]["wk"], game.KIND[kill["weapon"]])
        self.assertFalse(by_role["killer"]["survived"])
        self.assertEqual(by_role["victim"]["by"], killer["name"])
        self.assertEqual(by_role["witness"]["victim"], victim["name"])

    def test_taking_something_says_what_kind_of_thing_it_is(self):
        g, me = a_game()
        game.use_map(g)
        room = game.room_ids(g)[0]
        item = game.ROOM[room]["items"][0]
        d = game.today(g)
        ev = {"pid": me["pid"], "kind": "take", "item": item, "text": f"took the {item}", "sneak": False}
        d["hours"] = [{"where": {q["pid"]: room for q in g["players"]}, "acts": {}, "events": {room: [ev]}, "looks": {}, "idle": []}]
        entry = game.my_day(g, me, d)[0]
        self.assertEqual(entry["items"][0]["wk"], game.KIND[item])


if __name__ == "__main__":
    unittest.main()
