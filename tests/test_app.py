"""Alibi's server, tested without any AI call: the page, sealing, the public half of a case, search and accuse.

    python -m unittest discover tests
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

import mystery  # noqa: E402
from app import app  # noqa: E402

RAW = {
    "title": "Death on the Test Line", "intro": "A train.", "cause": "A blow.",
    "victim": {"name": "Horace", "role": "host", "found": "In the dining car.", "time": "10 pm"},
    "suspects": [{"name": f"Suspect {i}", "role": "r", "age": 40, "look": "l", "manner": "m", "relation": "x", "statement": "s",
                  "secret": f"secret {i}", "truth": "t", "killer": i == 2} for i in range(5)],
    "places": [{"name": f"Place {i}", "desc": "d", "clues": [{"text": f"clue {i}a", "kind": "genuine"}, {"text": f"clue {i}b", "kind": "herring"}]} for i in range(5)],
    "motive_options": ["m0", "m1", "m2", "m3"], "motive_answer": 1,
    "weapon_options": ["w0", "w1", "w2", "w3"], "weapon_answer": 3,
    "timeline": ["9 pm - dinner"], "solution": "It was Suspect 2.",
}


class Case(unittest.TestCase):
    def setUp(self):
        self.c = app.test_client()
        self.case = mystery._validate(json.loads(json.dumps(RAW)), "train")
        self.token = mystery.seal(self.case)

    def test_page_has_a_strict_policy(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("app.js", r.get_data(as_text=True))
        self.assertIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])
        self.assertNotIn("unsafe-inline", r.headers["Content-Security-Policy"].split("style-src")[0])

    def test_validation_shuffles_but_keeps_the_answers(self):
        self.assertEqual(self.case["motive_options"][self.case["motive_answer"]], "m1")
        self.assertEqual(self.case["weapon_options"][self.case["weapon_answer"]], "w3")
        self.assertEqual([s["killer"] for s in self.case["suspects"]].count(True), 1)
        self.assertEqual(sorted(p["id"] for p in self.case["places"]), ["p1", "p2", "p3", "p4", "p5"])

    def test_a_case_needs_exactly_one_killer(self):
        bad = json.loads(json.dumps(RAW))
        for s in bad["suspects"]:
            s["killer"] = False
        with self.assertRaises(ValueError):
            mystery._validate(bad, "train")

    def test_the_public_half_keeps_the_secrets(self):
        pub = json.dumps(mystery.public(self.case))
        for word in ("secret 2", "killer", "clue 0a", "It was Suspect 2", "motive_answer", "truth"):
            self.assertNotIn(word, pub)

    def test_seal_round_trip_and_tampering(self):
        self.assertEqual(mystery.unseal(self.token)["solution"], "It was Suspect 2.")
        r = self.c.post("/api/search", json={"token": self.token[:-4] + "AAAA", "place": "p1"})
        self.assertEqual(r.status_code, 400)

    def test_search_hands_out_clues_in_order(self):
        pid = self.case["places"][0]["id"]
        first = self.c.post("/api/search", json={"token": self.token, "place": pid, "n": 0}).get_json()
        second = self.c.post("/api/search", json={"token": self.token, "place": pid, "n": 1}).get_json()
        self.assertTrue(first["more"])
        self.assertFalse(second["more"])
        self.assertNotEqual(first["clue"], second["clue"])

    def test_accuse_says_only_right_or_wrong_until_the_end(self):
        killer = next(s["id"] for s in self.case["suspects"] if s["killer"])
        right = {"token": self.token, "suspect": killer, "motive": self.case["motive_answer"], "weapon": self.case["weapon_answer"]}
        self.assertTrue(self.c.post("/api/accuse", json=right).get_json()["right"])
        wrong = self.c.post("/api/accuse", json={**right, "weapon": (self.case["weapon_answer"] + 1) % 4}).get_json()
        self.assertFalse(wrong["right"])
        self.assertIsNone(wrong["parts"])
        final = self.c.post("/api/accuse", json={**right, "weapon": (self.case["weapon_answer"] + 1) % 4, "final": True}).get_json()
        self.assertEqual(final["parts"], {"killer": True, "motive": True, "weapon": False})

    def test_reveal(self):
        d = self.c.post("/api/reveal", json={"token": self.token}).get_json()
        self.assertEqual(d["solution"], "It was Suspect 2.")
        self.assertEqual(len(d["secrets"]), 5)

    def test_asking_needs_a_question(self):
        r = self.c.post("/api/ask", json={"token": self.token, "suspect": "s1"})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
