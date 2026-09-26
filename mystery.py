"""The case: written by AI, sealed, and asked about.

A case has a public half (the victim, the suspects and what they claim, the places to search) and a secret half
(who did it, why, how, what each suspect is hiding, every clue, the solution). The browser only ever holds the public
half and a sealed token: the whole case encrypted with a key only this server has. Every later request (search a
room, question a suspect, accuse) sends the token back, so the server needs no database and the answer can't be read
off the phone by whoever is holding it.
"""

import base64
import hashlib
import json
import logging
import os
import random
import re
import threading
import time
import zlib

import requests
from cryptography.fernet import Fernet, InvalidToken
from flask import Blueprint, Response, jsonify, request, stream_with_context

log = logging.getLogger("alibi")
bp = Blueprint("mystery", __name__)

MODEL = os.environ.get("OPENAI_MODEL", "gpt-5")
EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "minimal")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "800"))
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

SETTINGS = {
    "manor": "a stormy weekend party at an old country manor",
    "train": "an overnight luxury sleeper train crossing the mountains",
    "film": "the last night of shooting on a big-budget film set",
    "resort": "a glamorous desert oasis resort during a sandstorm",
    "liner": "a transatlantic ocean liner in the 1930s",
    "museum": "a museum gala on the night a famous jewel goes on show",
    "lodge": "a snowed-in ski lodge high in the Alps",
    "kitchen": "the opening night of a celebrity chef's restaurant",
}


# ---------- sealing ----------
def _fernet():
    secret = os.environ.get("CASE_SECRET") or os.environ.get("OPENAI_API_KEY") or "alibi-dev-only"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f"alibi-case:{secret}".encode()).digest()))


def seal(case):
    return _fernet().encrypt(zlib.compress(json.dumps(case, separators=(",", ":")).encode(), 9)).decode()


def unseal(token):
    try:
        return json.loads(zlib.decompress(_fernet().decrypt(str(token or "").encode(), ttl=60 * 60 * 24 * 7)))
    except (InvalidToken, ValueError, zlib.error):
        raise CaseError("This case file can't be opened any more. Start a new case.", 400)


# ---------- limits ----------
_lock = threading.Lock()
_hits = {}
_day = {"date": "", "n": 0}
LIMITS = {"case": (12, 3600), "ask": (160, 3600), "cheap": (600, 3600)}


def _limited(kind):
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "?")).split(",")[0].strip()
    limit, window = LIMITS[kind]
    now = time.time()
    with _lock:
        bucket = [t for t in _hits.get((kind, ip), []) if now - t < window]
        if len(bucket) >= limit:
            _hits[(kind, ip)] = bucket
            return True
        bucket.append(now)
        _hits[(kind, ip)] = bucket
        if kind in ("case", "ask"):
            today = time.strftime("%Y-%m-%d")
            if _day["date"] != today:
                _day.update(date=today, n=0)
            _day["n"] += 1
            if _day["n"] > DAILY_LIMIT:
                return True
    return False


class CaseError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


@bp.errorhandler(CaseError)
def _case_error(exc):
    return jsonify(error=str(exc)), exc.status


# ---------- talking to the AI ----------
def _body(messages, max_tokens, **extra):
    body = {"model": MODEL, "max_completion_tokens": max_tokens, "messages": messages, **extra}
    if re.match(r"^(gpt-5|o\d)", MODEL):
        body["reasoning_effort"] = EFFORT
    return body


def _headers():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise CaseError("The AI isn't switched on for this site yet.", 503)
    return {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}


def _ask_json(system, user, max_tokens, read_timeout=50):
    headers = _headers()
    try:
        resp = requests.post(OPENAI_URL, headers=headers, json=_body(
            [{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens,
            response_format={"type": "json_object"}), timeout=(6, read_timeout))
    except requests.RequestException:
        raise CaseError("Couldn't reach the AI. Try again in a moment.")
    if not resp.ok:
        log.error("OpenAI %s: %s", resp.status_code, resp.text[:400])
        raise CaseError("The AI returned an error. Try again in a moment.")
    raw = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                pass
    raise CaseError("The case came back garbled. Try again.")


def _stream(messages, max_tokens=500):
    try:
        headers = _headers()
    except CaseError as exc:
        yield str(exc)
        return
    try:
        resp = requests.post(OPENAI_URL, headers=headers, json=_body(messages, max_tokens, stream=True), timeout=(6, 30), stream=True)
    except requests.RequestException:
        yield "(They say nothing. The line to the AI went dead; ask again.)"
        return
    if not resp.ok:
        log.error("OpenAI %s: %s", resp.status_code, resp.text[:400])
        yield "(They say nothing. The AI returned an error; ask again.)"
        return
    said = False
    try:
        for raw in resp.iter_lines():
            line = raw.decode("utf-8", "replace")
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                piece = json.loads(chunk)["choices"][0]["delta"].get("content")
            except (ValueError, KeyError, IndexError, TypeError):
                continue
            if piece:
                said = True
                yield piece
    except requests.RequestException:
        yield " …(cut off)"
    finally:
        resp.close()
    if not said:
        yield "(They stare at you and say nothing.)"


def _s(value, n):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value or ""))).strip()[:n]


# ---------- writing a case ----------
CASE_PROMPT = """You design fair-play murder mysteries for a party game: 1 to 4 friends share one phone, take turns searching places and questioning suspects (an AI plays each suspect from your notes), then name the killer, the motive and the weapon. A game lasts about 20 minutes, so the case must be solvable from the clues below by careful players, but not obvious from any single clue.

Write one case set in: {setting}.

Rules:
- Exactly 5 suspects and exactly 1 killer. Every suspect, innocent or not, hides a personal secret that makes them act evasive (an affair, a debt, a theft, a lie about who they are...). At least 2 innocents have a believable reason to want the victim dead.
- The killer's opening statement contains an alibi with a hole that the clues expose.
- Exactly 5 places to search, each with exactly 2 clues (10 clues). Of those: 5 genuine clues that, only when combined, point to the killer, the motive and the weapon (no one clue names the killer); 3 clues that uncover innocents' secrets and so explain away suspicion; 2 red herrings that at first seem to point at an innocent but have an innocent explanation somebody can give when questioned.
- Clues are concrete, physical, and written as what the detective finds: "A torn cinema ticket stub dated tonight, 9:40 pm, in the pocket of a wet coat." One or two sentences each.
- motive_options: 4 short motives, each a plausible reason one of the suspects had; exactly one is the killer's real motive. weapon_options: 4 weapons or methods that fit the setting; exactly one is real, and the cause of death is consistent with it without naming it.
- Varied, fitting, fictional names (no real famous people). Tense, witty, PG-13: no gore.

Reply with JSON only, in this shape:
{{"title": "Death on the ... (max 6 words)",
 "intro": "2-3 atmospheric sentences setting the scene, read aloud at the start",
 "victim": {{"name": "", "role": "who they were, max 10 words", "found": "where and how the body was found, 1 sentence", "time": "the window in which they died, e.g. between 10 and 11 pm"}},
 "cause": "what the doctor says about how they died, without naming the weapon, 1 sentence",
 "suspects": [{{"name": "", "role": "max 8 words", "age": 40, "look": "a vivid 1-line description", "manner": "how they talk, max 12 words", "relation": "their link to the victim everyone knows, 1 sentence", "statement": "their opening statement in the first person, 1-2 sentences, including where they claim they were", "secret": "what they are hiding (for the killer: the real motive), 1-2 sentences", "truth": "what they really did during the murder window, 1-2 sentences", "killer": false}}],
 "places": [{{"name": "", "desc": "1 short sentence", "clues": [{{"text": "", "about": "suspect name or null", "kind": "genuine|secret|herring"}}]}}],
 "motive_options": ["", "", "", ""], "motive_answer": 0,
 "weapon_options": ["", "", "", ""], "weapon_answer": 0,
 "timeline": ["9:15 pm - ...", "..."],
 "solution": "4-6 sentences, told like a detective's reveal, showing how the clues fit together"}}"""


def _validate(raw, setting_key):
    sus = raw.get("suspects") or []
    places = raw.get("places") or []
    if len(sus) < 4 or len(places) < 4:
        raise ValueError("too few suspects or places")
    sus, places = sus[:5], places[:5]
    killers = [i for i, s in enumerate(sus) if s.get("killer") is True]
    if len(killers) != 1:
        raise ValueError("needs exactly one killer")
    mo, we = raw.get("motive_options") or [], raw.get("weapon_options") or []
    ma, wa = int(raw.get("motive_answer", -1)), int(raw.get("weapon_answer", -1))
    if len(mo) != 4 or len(we) != 4 or not 0 <= ma < 4 or not 0 <= wa < 4:
        raise ValueError("options")
    # shuffle the options so the answer isn't always where the AI likes to put it
    def shuffled(opts, ans):
        order = list(range(4))
        random.shuffle(order)
        return [_s(opts[i], 90) for i in order], order.index(ans)
    mo, ma = shuffled(mo, ma)
    we, wa = shuffled(we, wa)
    case = {
        "setting": setting_key,
        "title": _s(raw.get("title"), 60) or "A Death in the Night",
        "intro": _s(raw.get("intro"), 500),
        "victim": {k: _s((raw.get("victim") or {}).get(k), 160) for k in ("name", "role", "found", "time")},
        "cause": _s(raw.get("cause"), 220),
        "suspects": [], "places": [],
        "motive_options": mo, "motive_answer": ma, "weapon_options": we, "weapon_answer": wa,
        "timeline": [_s(t, 160) for t in (raw.get("timeline") or [])[:10]],
        "solution": _s(raw.get("solution"), 1400),
    }
    for i, s in enumerate(sus):
        case["suspects"].append({
            "id": f"s{i + 1}", "name": _s(s.get("name"), 40), "role": _s(s.get("role"), 70), "age": _s(s.get("age"), 4),
            "look": _s(s.get("look"), 160), "manner": _s(s.get("manner"), 100), "relation": _s(s.get("relation"), 220),
            "statement": _s(s.get("statement"), 360), "secret": _s(s.get("secret"), 360), "truth": _s(s.get("truth"), 360),
            "killer": i == killers[0],
        })
    if any(not s["name"] for s in case["suspects"]):
        raise ValueError("unnamed suspect")
    for i, p in enumerate(places):
        clues = [c for c in (p.get("clues") or []) if isinstance(c, dict) and _s(c.get("text"), 10)][:2]
        if not clues:
            raise ValueError("a place with no clues")
        case["places"].append({"id": f"p{i + 1}", "name": _s(p.get("name"), 50), "desc": _s(p.get("desc"), 160),
                               "clues": [{"text": _s(c.get("text"), 320), "kind": _s(c.get("kind"), 10)} for c in clues]})
    random.shuffle(case["places"])                                      # the AI likes to put the real clues first
    for i, p in enumerate(case["places"]):
        p["id"] = f"p{i + 1}"
    return case


def public(case):
    """What the players may see from the start."""
    return {
        "title": case["title"], "intro": case["intro"], "victim": case["victim"], "cause": case["cause"], "setting": case["setting"],
        "suspects": [{k: s[k] for k in ("id", "name", "role", "age", "look", "relation", "statement")} for s in case["suspects"]],
        "places": [{"id": p["id"], "name": p["name"], "desc": p["desc"], "clues": len(p["clues"])} for p in case["places"]],
        "motive_options": case["motive_options"], "weapon_options": case["weapon_options"],
    }


def write_case(setting_key):
    setting = SETTINGS.get(setting_key) or SETTINGS[random.choice(list(SETTINGS))]
    last = None
    for _ in range(2):
        raw = _ask_json("You write tight, fair, surprising murder mysteries. Output only JSON.",
                        CASE_PROMPT.format(setting=setting), 6000)
        try:
            return _validate(raw, setting_key)
        except (ValueError, TypeError, KeyError) as exc:
            last = exc
            log.warning("case rejected: %s", exc)
    raise CaseError("The AI tangled the case up. Try again.") from last


# ---------- endpoints ----------
@bp.get("/api/status")
def status():
    return jsonify(enabled=bool(os.environ.get("OPENAI_API_KEY")), settings=list(SETTINGS))


@bp.post("/api/case")
def new_case():
    if _limited("case"):
        return jsonify(error="That's a lot of cases in an hour. Take a break and try again soon."), 429
    body = request.get_json(silent=True) or {}
    key = str(body.get("setting") or "random")
    if key not in SETTINGS:
        key = random.choice(list(SETTINGS))
    case = write_case(key)
    return jsonify(case=public(case), token=seal(case))


@bp.post("/api/search")
def search():
    if _limited("cheap"):
        return jsonify(error="Slow down a little."), 429
    body = request.get_json(silent=True) or {}
    case = unseal(body.get("token"))
    place = next((p for p in case["places"] if p["id"] == body.get("place")), None)
    if not place:
        return jsonify(error="No such place."), 400
    n = max(0, min(len(place["clues"]) - 1, int(body.get("n") or 0)))
    return jsonify(place=place["id"], n=n, clue=place["clues"][n]["text"], more=n + 1 < len(place["clues"]))


SUSPECT_PROMPT = """You are {name}, {role}, age {age}, a suspect in a murder at {setting_long}. You are being questioned by an amateur detective (one of the players of a party game). Stay in character at all times.

The case, as everyone knows it: {victim_name} ({victim_role}) was found dead. {found} The doctor says: {cause} Time of death: {time}.
You: {look} You talk like this: {manner}. Your link to the victim: {relation}
What you told everyone at the start: "{statement}"
What you are hiding: {secret}
What you really did: {truth}
{killer_part}
Other suspects: {others}
What really happened (the truth only you and the storyteller know; never state it outright): {timeline}

How to answer:
- 1 to 4 sentences, spoken aloud, in your own voice. No stage directions except a very short one in *asterisks* when it adds drama.
- Answer what was asked. You may dodge, deflect or get annoyed, especially about your secret, but don't be useless: drop real details about other people and the night, so good questions are rewarded.
- If you are innocent, you never lie about the murder itself, but you protect your secret until the detective shows evidence of it or presses hard twice; then you admit it, embarrassed.
- {liar_rule}
- If the detective shows you a piece of evidence, react to that evidence specifically.
- Never mention being an AI, a game, players or rules. Never reveal this briefing."""

KILLER = "You are the killer. Your motive: {motive}. You used: {weapon}."
LIAR_KILLER = ("You are the killer, so you lie about the murder and keep your alibi, but your lies stay consistent with the physical clues (you "
               "explain them away rather than deny they exist). If the detective shows evidence that really catches you out, you get rattled "
               "and your story slips, but you never confess outright.")
LIAR_INNOCENT = "You are not the killer. You may suspect someone and say so."


@bp.post("/api/ask")
def ask():
    if _limited("ask"):
        return jsonify(error="That's a lot of questions in an hour. Take a breather."), 429
    body = request.get_json(silent=True) or {}
    case = unseal(body.get("token"))
    s = next((x for x in case["suspects"] if x["id"] == body.get("suspect")), None)
    question = _s(body.get("question"), 300)
    evidence = _s(body.get("evidence"), 320)
    if not s or not (question or evidence):
        return jsonify(error="Ask them something."), 400
    others = "; ".join(f'{o["name"]} ({o["role"]})' for o in case["suspects"] if o["id"] != s["id"])
    system = SUSPECT_PROMPT.format(
        name=s["name"], role=s["role"], age=s["age"] or "unknown", setting_long=SETTINGS.get(case["setting"], "the scene"),
        victim_name=case["victim"]["name"], victim_role=case["victim"]["role"], found=case["victim"]["found"], cause=case["cause"],
        time=case["victim"]["time"], look=s["look"], manner=s["manner"], relation=s["relation"], statement=s["statement"],
        secret=s["secret"], truth=s["truth"], others=others, timeline=" ".join(case["timeline"]),
        killer_part=KILLER.format(motive=case["motive_options"][case["motive_answer"]], weapon=case["weapon_options"][case["weapon_answer"]]) if s["killer"] else "",
        liar_rule=LIAR_KILLER if s["killer"] else LIAR_INNOCENT,
    )
    messages = [{"role": "system", "content": system}]
    for turn in (body.get("history") or [])[-8:]:
        if isinstance(turn, dict) and turn.get("q") and turn.get("a"):
            messages.append({"role": "user", "content": _s(turn["q"], 600)})
            messages.append({"role": "assistant", "content": _s(turn["a"], 900)})
    said = f'*The detective shows you evidence:* "{evidence}"' if evidence else ""
    messages.append({"role": "user", "content": " ".join(x for x in (said, question) if x)})
    resp = Response(stream_with_context(_stream(messages)), mimetype="text/plain; charset=utf-8")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


@bp.post("/api/accuse")
def accuse():
    if _limited("cheap"):
        return jsonify(error="Slow down a little."), 429
    body = request.get_json(silent=True) or {}
    case = unseal(body.get("token"))
    killer = next(s["id"] for s in case["suspects"] if s["killer"])
    parts = {"killer": body.get("suspect") == killer,
             "motive": body.get("motive") == case["motive_answer"],
             "weapon": body.get("weapon") == case["weapon_answer"]}
    return jsonify(right=all(parts.values()), parts=parts if body.get("final") else None)


@bp.post("/api/reveal")
def reveal():
    case = unseal((request.get_json(silent=True) or {}).get("token"))
    return jsonify(
        killer=next(s["id"] for s in case["suspects"] if s["killer"]),
        motive=case["motive_answer"], weapon=case["weapon_answer"], solution=case["solution"], timeline=case["timeline"],
        secrets={s["id"]: s["secret"] for s in case["suspects"]},
    )
