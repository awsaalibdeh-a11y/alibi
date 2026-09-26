"""Alibi: The Wrenmoor Weekend. The killer is one of the players.

Everyone is a guest at Wrenmoor Manor for the weekend, each with a character, each on their own phone; one of them
(two in a big game) is secretly a killer. The day runs in hours, and every hour has two steps:

  move   everyone secretly picks a room (a story beat may lock one, or plunge one into darkness)
  room   you see who came to the same room (unless it's dark), talk to them, and choose what to do: an activity,
         look around (who was here the hour before), take or put back an object. The killer, seeing who's there,
         can strike someone they're alone with, if they came in already carrying a weapon.

When the body is found, everyone looks back over the day with only what they saw themselves plus what's public,
argues it out in the meeting chat (and on voice), sends private messages, and votes someone out.

The server is the only one who knows the truth. Games live in memory (one worker, no database); each phone polls
for its own view, which never includes anyone else's role. Phases move on when their clock runs out or everyone
has acted; every request "ticks" the game forward. Bots play the same game and talk with AI (plain lines without
it). Voice is peer-to-peer between phones (WebRTC); the server only passes the connection messages along.
"""

import json
import logging
import os
import random
import re
import secrets
import threading
import time

import requests
from flask import Blueprint, jsonify, request

log = logging.getLogger("alibi")
bp = Blueprint("game", __name__)

# ---------- the manor ----------
ROOMS = [
    {"id": "library", "name": "Library", "emoji": "📚", "items": ["candlestick", "heavy atlas"], "act": "Read by the fire"},
    {"id": "kitchen", "name": "Kitchen", "emoji": "🍳", "items": ["kitchen knife", "rolling pin"], "act": "Bake bread"},
    {"id": "garden", "name": "Garden", "emoji": "🌹", "items": ["garden shears", "rope"], "act": "Prune the roses"},
    {"id": "ballroom", "name": "Ballroom", "emoji": "🎻", "items": ["iron poker", "silk scarf"], "act": "Play the piano"},
    {"id": "study", "name": "Study", "emoji": "🖋️", "items": ["letter opener", "brass paperweight"], "act": "Write letters"},
    {"id": "cellar", "name": "Cellar", "emoji": "🍷", "items": ["wine bottle", "piano wire"], "act": "Pick a vintage"},
]
ROOM = {r["id"]: r for r in ROOMS}
HOME = {item: r["id"] for r in ROOMS for item in r["items"]}
KIND = {"candlestick": "blunt", "heavy atlas": "blunt", "rolling pin": "blunt", "iron poker": "blunt", "brass paperweight": "blunt", "wine bottle": "blunt",
        "kitchen knife": "sharp", "garden shears": "sharp", "letter opener": "sharp", "rope": "cord", "silk scarf": "cord", "piano wire": "cord"}
CAUSE = {"blunt": "struck on the head with something heavy", "sharp": "stabbed with something sharp", "cord": "strangled with a cord of some kind"}
HOURS = ["9 AM", "11 AM", "1 PM", "3 PM", "5 PM"]
COLORS = ["#d9a441", "#3f8fc9", "#d05a74", "#3fa56b", "#8d6be0", "#e07b39", "#1fa3a0", "#7d7466"]
BOT_NAMES = ["Rosa", "Theo", "Maggie", "Felix", "Ines", "Hugo", "Priya", "Otto", "Wren", "Basil", "Clara", "Jonah"]
CHARACTERS = [
    ("The Heir", "Old Lord Ashcombe's nephew, up to his neck in gambling debts."),
    ("The Doctor", "The family physician, who knows everyone's ailments and a few of their secrets."),
    ("The Actress", "A stage star past her best, hoping the will remembers an old romance."),
    ("The Butler", "Thirty years of service and the keys to every door in the house."),
    ("The Colonel", "A retired soldier with a loud laugh and a quiet grudge."),
    ("The Governess", "She raised the Ashcombe children and never forgot a slight."),
    ("The Lawyer", "Here to read the will at dusk, and the only one who knows what's in it."),
    ("The Artist", "Painting the family portrait, and very good at noticing who stands where."),
    ("The Cook", "Rules the kitchen, hears every piece of gossip that passes through it."),
    ("The Journalist", "Says she's writing a society piece. She isn't."),
    ("The Gardener", "Knows every path, hedge and shortcut on the estate."),
    ("The Heiress", "Engaged to the Heir, for reasons nobody quite understands."),
]
PROLOGUE = ("Lord Ashcombe has gathered his family and friends at Wrenmoor Manor for the weekend: at dusk his lawyer will read "
            "a new will, and not everyone will like what's in it. Somebody here has decided not to wait.")
# a story beat for each hour: some only colour the day, some change it
BEATS = [
    {"text": "Breakfast is cleared away. The house hums with whispers about the will.", "fx": None},
    {"text": "The morning post arrives. Somebody receives a letter they burn at once.", "fx": None},
    {"text": "A storm blows in and the lights fail in the {room}: it's pitch dark in there this hour.", "fx": "dark"},
    {"text": "Rain lashes the terrace: the Garden is locked this hour.", "fx": "rain"},
    {"text": "Tea is served in the Ballroom, and the gramophone plays too loudly to hear much else.", "fx": None},
    {"text": "The dogs start barking at nothing in particular.", "fx": None},
    {"text": "The butler rings the gong for luncheon; half the house ignores it.", "fx": None},
    {"text": "A fuse blows: the {room} is pitch dark this hour.", "fx": "dark"},
    {"text": "Lord Ashcombe shuts himself in his rooms and asks not to be disturbed.", "fx": None},
    {"text": "The lawyer's car crunches up the drive. The will is in his briefcase.", "fx": None},
]
MIN_PLAYERS, MAX_PLAYERS, QUEUE_SIZE = 4, 8, 6
T = {"countdown": 4, "roles": 14, "move": 20, "room": 30, "body": 12, "quiet": 8, "talk": 150, "vote": 35, "result": 9, "queue": 30}

LOCK = threading.RLock()
GAMES = {}
QUEUE = {"code": None}


def now():
    return time.time()


# ---------- games ----------
def _code():
    while True:
        c = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
        if c not in GAMES:
            return c


def _cleanup():
    cutoff = now() - 3 * 3600
    for c in [c for c, g in GAMES.items() if g["touched"] < cutoff]:
        del GAMES[c]


def new_game(public=False):
    _cleanup()
    g = {"code": _code(), "public": public, "created": now(), "touched": now(), "v": 0, "phase": "lobby", "deadline": None,
         "players": [], "host": None, "day": 0, "hour": 0, "days": [], "items": {}, "carry": {}, "winner": None, "start_at": None,
         "dms": [], "signals": {}}
    GAMES[g["code"]] = g
    return g


def bump(g):
    g["v"] += 1
    g["touched"] = now()


def add_player(g, name, bot=False):
    taken = {p["name"].lower() for p in g["players"]}
    base, n = name, 2
    while name.lower() in taken:
        name = f"{base} {n}"
        n += 1
    p = {"pid": secrets.token_hex(4), "token": secrets.token_urlsafe(16), "name": name, "bot": bot, "color": COLORS[len(g["players"]) % len(COLORS)],
         "role": "guest", "alive": True, "ready": bot, "seen": now(), "voice": False}
    g["players"].append(p)
    if not bot and not g["host"]:
        g["host"] = p["pid"]
    bump(g)
    return p


def add_bot(g):
    used = {p["name"] for p in g["players"]}
    free = [n for n in BOT_NAMES if n not in used] or [f"Bot {len(g['players']) + 1}"]
    return add_player(g, random.choice(free), bot=True)


def player(g, pid):
    return next((p for p in g["players"] if p["pid"] == pid), None)


def living(g):
    return [p for p in g["players"] if p["alive"]]


def humans(g, alive_only=False):
    return [p for p in g["players"] if not p["bot"] and (p["alive"] or not alive_only)]


def set_phase(g, phase, secs=None):
    g["phase"] = phase
    g["deadline"] = now() + secs if secs else None
    bump(g)


def rooms_of(g):
    """Four rooms in a small game (people meet more), all six from six players up."""
    return ROOMS if len(g["players"]) >= 6 else [r for r in ROOMS if r["id"] in ("library", "kitchen", "garden", "study")]


def room_ids(g):
    return [r["id"] for r in rooms_of(g)]


def today(g):
    return g["days"][-1] if g["days"] else None


def name_of(g, pid):
    p = player(g, pid)
    return p["name"] if p else "?"


# ---------- starting ----------
def start(g):
    while len(g["players"]) < MIN_PLAYERS:
        add_bot(g)
    n = len(g["players"])
    for p, (title, blurb) in zip(g["players"], random.sample(CHARACTERS, n)):
        p.update(role="guest", alive=True, ready=False, ejected=False, killed=None, char={"title": title, "blurb": blurb})
    for p in random.sample(g["players"], 2 if n >= 7 else 1):
        p["role"] = "killer"
    g.update(day=0, days=[], winner=None, dms=[], signals={})
    set_phase(g, "roles", T["roles"])


def new_day(g, showdown=False):
    g["day"] += 1
    g["hour"] = 0
    g["items"] = {item: HOME[item] for item in HOME}                 # the staff tidy up overnight
    g["carry"] = {}
    beats = []
    ids = room_ids(g)
    fits = [b for b in BEATS if all(r["name"] not in b["text"] or r["id"] in ids for r in ROOMS)]   # no tea in a ballroom this house hasn't got
    for i, b in enumerate(random.sample(fits, len(HOURS))):
        b = dict(b)
        if i == 0:                                                    # nothing strange at 9 AM
            b = {"text": BEATS[0]["text"] if g["day"] == 1 else "A new day at Wrenmoor. Nobody slept well.", "fx": None}
        if b["fx"] == "dark":
            b["room"] = random.choice([r for r in room_ids(g) if r != "garden"])
            b["text"] = b["text"].format(room=ROOM[b["room"]]["name"])
        elif b["fx"] == "rain":
            b["room"] = "garden"
        beats.append(b)
    g["days"].append({"n": g["day"], "hours": [], "beats": beats, "moves": {}, "acts": {}, "cur": None, "kill": None, "found": None,
                      "chat": [], "roomchat": {}, "votes": {}, "ready": set(), "claims": {}, "ejected": None, "bot_plan": [], "missing": [],
                      "bot_room_said": set(), "showdown": showdown, "kills": []})
    set_phase(g, "move", T["move"])


def beat(g, h=None):
    d = today(g)
    return d["beats"][g["hour"] if h is None else h] if d else None


# ---------- the day ----------
def bot_move(g, p):
    d = today(g)
    last = d["hours"][-1]["where"].get(p["pid"]) if d["hours"] else None
    rooms = [r for r in room_ids(g) if not (beat(g)["fx"] == "rain" and r == beat(g)["room"])]
    if p["role"] == "killer" and not g["carry"].get(p["pid"]):
        options = [r for r in rooms if any(g["items"].get(i) == r for i in ROOM[r]["items"])]
        return random.choice(options or rooms)
    return last if last in rooms and random.random() < 0.35 else random.choice(rooms)


def resolve_move(g):
    d = today(g)
    b = beat(g)
    where = {}
    for p in living(g):
        room = d["moves"].get(p["pid"])
        if not room:
            last = d["hours"][-1]["where"].get(p["pid"]) if d["hours"] else None
            room = bot_move(g, p) if p["bot"] else (last or random.choice(room_ids(g)))
        if b["fx"] == "rain" and room == b["room"]:
            room = "library"
        where[p["pid"]] = room
    d["cur"] = {"where": where, "idle": [pid for pid in where if pid not in d["moves"] and not player(g, pid)["bot"]]}
    d["moves"] = {}
    d["acts"] = {}
    # walking in on a body left in an earlier hour
    k = d["kill"]
    if k and not d["found"] and not d["showdown"]:
        finders = [q for q, room in where.items() if room == k["room"]]
        if finders:
            d["found"] = {"hour": g["hour"], "by": finders}
            record_hour(g, {q: {"act": "found the body"} for q in where}, {r["id"]: [] for r in ROOMS}, {})
            return body_found(g)
    set_phase(g, "room", T["room"])


def occupants(g, room):
    d = today(g)
    return [q for q, r in d["cur"]["where"].items() if r == room]


def bot_act(g, p):
    d = today(g)
    room = d["cur"]["where"][p["pid"]]
    carrying = g["carry"].get(p["pid"])
    here = [i for i in ROOM[room]["items"] if g["items"].get(i) == room]
    others = [q for q in occupants(g, room) if q != p["pid"]]
    if p["role"] == "killer":
        victims = [q for q in others if player(g, q)["role"] != "killer"]
        if carrying and len(victims) == 1 and len(others) == len(victims) and random.random() < 0.85:
            return {"act": ROOM[room]["act"], "strike": victims[0]}
        if not carrying and here:
            return {"act": ROOM[room]["act"], "take": random.choice(here)}
        return {"act": random.choice([ROOM[room]["act"], "look"])}
    if carrying and HOME[carrying] == room and random.random() < 0.6:
        return {"act": ROOM[room]["act"], "put": True}
    if not carrying and here and random.random() < 0.2:
        return {"act": ROOM[room]["act"], "take": random.choice(here)}
    return {"act": "look" if random.random() < 0.4 else ROOM[room]["act"]}


def resolve_room(g):
    d, h = today(g), g["hour"]
    where = d["cur"]["where"]
    acts = {}
    for pid in where:
        p = player(g, pid)
        a = d["acts"].get(pid)
        if not a:
            a = bot_act(g, p) if p["bot"] else {"act": ROOM[where[pid]]["act"], "idle": True}
        acts[pid] = a
    events = {r["id"]: [] for r in ROOMS}
    carried_at_start = dict(g["carry"])
    for pid, a in acts.items():                                        # put things back first…
        item = g["carry"].get(pid)
        if a.get("put") and item and HOME[item] == where[pid]:
            del g["carry"][pid]
            g["items"][item] = where[pid]
            events[where[pid]].append({"pid": pid, "text": f"put the {item} back"})
    order = list(acts.items())
    random.shuffle(order)
    for pid, a in order:                                               # …then take them
        item = a.get("take")
        if not item or g["carry"].get(pid) or HOME.get(item) != where[pid]:
            continue
        if g["items"].get(item) == where[pid]:
            g["items"][item] = None
            g["carry"][pid] = item
            events[where[pid]].append({"pid": pid, "text": f"took the {item}"})
        else:
            a["missed"] = item
    looks = {}
    prev = d["hours"][-1]["where"] if d["hours"] else None
    for pid, a in acts.items():
        if a.get("act") == "look":
            room = where[pid]
            if prev is None:
                looks[pid] = "It's the first hour: nobody has been anywhere yet."
            else:
                seen = [name_of(g, q) for q, r in prev.items() if r == room and q != pid]
                gone = [i for i in ROOM[room]["items"] if g["items"].get(i) != room]
                looks[pid] = (f"Signs that {', '.join(seen)} {'was' if len(seen) == 1 else 'were'} in here at {HOURS[h - 1]}." if seen else f"Nobody else was in here at {HOURS[h - 1]}.") \
                    + (f" The {' and the '.join(gone)} {'is' if len(gone) == 1 else 'are'} gone from here." if gone else "")
    if not d["kill"] or d["showdown"]:
        for pid, a in order:
            killer = player(g, pid)
            target = a.get("strike")
            if killer["role"] != "killer" or not target or not carried_at_start.get(pid):
                continue
            others = [q for q in occupants(g, where[pid]) if q != pid and player(g, q)["role"] != "killer"]
            if others == [target] or (target == "dark" and len(others) == 1):
                victim = player(g, others[0])
                weapon = carried_at_start[pid]
                victim["alive"] = False
                victim["killed"] = {"day": g["day"], "hour": h, "room": where[pid], "by": pid, "weapon": weapon}
                d["kill"] = {"victim": victim["pid"], "killer": pid, "room": where[pid], "hour": h, "weapon": weapon}
                d["kills"].append(d["kill"])
                if not d["showdown"]:
                    break
    if d["showdown"]:                                                  # the last day: no meeting, just survive it
        record_hour(g, acts, events, looks)
        guests = [q for q in living(g) if q["role"] != "killer"]
        if not guests:
            return game_over(g, "killers")
        if h + 1 >= len(HOURS):
            return game_over(g, "guests")
        g["hour"] = h + 1
        return set_phase(g, "move", T["move"])
    record_hour(g, acts, events, looks)
    if h + 1 >= len(HOURS):
        if d["kill"]:
            d["found"] = {"hour": None, "by": []}
            return body_found(g)
        d["missing"] = missing(g)
        return set_phase(g, "quiet", T["quiet"])
    g["hour"] = h + 1
    set_phase(g, "move", T["move"])


def record_hour(g, acts, events, looks):
    d = today(g)
    d["hours"].append({"where": d["cur"]["where"], "acts": acts, "events": events, "looks": looks, "idle": d["cur"]["idle"], "beat": beat(g)})


def missing(g):
    return sorted(i for i, at in g["items"].items() if at != HOME[i])


def body_found(g):
    today(g)["missing"] = missing(g)
    set_phase(g, "body", T["body"])


def begin_talk(g):
    if winner(g):
        return game_over(g)
    if showdown_due(g):
        return set_phase(g, "showdown", T["result"])
    d = today(g)
    d["ready"] = set()
    set_phase(g, "talk", T["talk"])
    t0 = now()
    for p in living(g):
        if p["bot"]:
            d["bot_plan"].append({"at": t0 + random.uniform(3, 14), "pid": p["pid"], "kind": "claim"})
            for _ in range(random.choice([1, 2])):
                d["bot_plan"].append({"at": t0 + random.uniform(22, T["talk"] - 20), "pid": p["pid"], "kind": "talk"})


def winner(g):
    killers = [p for p in living(g) if p["role"] == "killer"]
    guests = [p for p in living(g) if p["role"] != "killer"]
    if not killers:
        return "guests"
    if not guests:
        return "killers"
    return None


def showdown_due(g):
    """The killers have caught up with the guests: instead of losing on the spot, the guests get one last day to survive."""
    killers = [p for p in living(g) if p["role"] == "killer"]
    guests = [p for p in living(g) if p["role"] != "killer"]
    return bool(killers and guests and len(killers) >= len(guests))


def game_over(g, who=None):
    g["winner"] = who or winner(g)
    set_phase(g, "over")


def tally(g):
    d = today(g)
    counts = {}
    for voter, target in d["votes"].items():
        if player(g, voter) and player(g, voter)["alive"]:
            counts[target] = counts.get(target, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    out = None
    if ranked and ranked[0][0] != "skip" and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
        out = ranked[0][0]
    d["tally"] = counts
    if out:
        p = player(g, out)
        p["alive"] = False
        p["ejected"] = True
        d["ejected"] = out
    set_phase(g, "result", T["result"])


def bot_votes(g):
    d = today(g)
    for p in living(g):
        if p["bot"] and p["pid"] not in d["votes"]:
            d["votes"][p["pid"]] = bot_vote(g, p)


def suspicion(g, me):
    """How much this player distrusts each other living player: what they saw against what was claimed, and the chat."""
    d = today(g)
    score = {q["pid"]: 0.0 for q in living(g) if q["pid"] != me["pid"]}
    mine = {i: hr["where"].get(me["pid"]) for i, hr in enumerate(d["hours"])}
    dark = {i: (hr["beat"] or {}).get("room") if (hr["beat"] or {}).get("fx") == "dark" else None for i, hr in enumerate(d["hours"])}
    for q in score:
        claim = d["claims"].get(q)
        if not claim:
            score[q] += 1
            continue
        for i, hr in enumerate(d["hours"]):
            said, truly = claim.get(str(i)), hr["where"].get(q)
            if mine.get(i) is None or said is None or dark.get(i) == mine[i]:
                continue
            if said == mine[i] and truly != mine[i]:
                score[q] += 3
            if truly == mine[i] and said != mine[i]:
                score[q] += 3
        k = d["kill"]
        if k and claim.get(str(k["hour"])) == k["room"]:
            score[q] += 1
    for msg in d["chat"][-30:]:
        if msg.get("ghost") or msg["pid"] == me["pid"]:
            continue
        for q in score:
            if re.search(rf"\b{re.escape(name_of(g, q).lower())}\b", msg["text"].lower()):
                score[q] += 0.5
    return score


def bot_vote(g, p):
    s = suspicion(g, p)
    if not s:
        return "skip"
    if p["role"] == "killer":
        s = {q: v for q, v in s.items() if player(g, q)["role"] != "killer"} or s
        return max(s, key=lambda q: s[q] + random.random())
    best = max(s, key=lambda q: s[q] + random.random() * 0.5)
    return best if s[best] >= 2 else "skip"


# ---------- what each phone may see ----------
def is_dark(hr_or_beat, room):
    b = hr_or_beat.get("beat", hr_or_beat) if hr_or_beat else None
    return bool(b and b.get("fx") == "dark" and b.get("room") == room)


def my_day(g, p, d):
    """The day as this player lived it: where they were, who they saw, what they saw happen."""
    out = []
    for i, hr in enumerate(d["hours"]):
        room = hr["where"].get(p["pid"])
        if room is None:
            continue
        a = hr["acts"].get(p["pid"], {})
        dark = is_dark(hr, room)
        others = [q for q, r in hr["where"].items() if r == room and q != p["pid"]]
        saw = ([f"{len(others)} {'person' if len(others) == 1 else 'people'} in the dark"] if others else []) if dark else [name_of(g, q) for q in others]
        ev = [] if dark else [f"{'You' if e['pid'] == p['pid'] else name_of(g, e['pid'])} {e['text']}." for e in hr["events"][room]]
        if dark:
            ev += [f"You {e['text']}." for e in hr["events"][room] if e["pid"] == p["pid"]]
        if a.get("missed"):
            ev.append(f"You looked for the {a['missed']}, but it was already gone.")
        if p["pid"] in hr["looks"]:
            ev.append(f"You looked around: {hr['looks'][p['pid']]}")
        k = d["kill"]
        if k and k["hour"] == i:
            if k["killer"] == p["pid"]:
                ev.append(f"You killed {name_of(g, k['victim'])} here with the {k['weapon']}.")
            if k["victim"] == p["pid"]:
                ev.append(f"{name_of(g, k['killer'])} killed you here with the {k['weapon']}.")
        if d["found"] and d["found"]["hour"] == i and p["pid"] in d["found"]["by"]:
            ev.append(f"You found {name_of(g, k['victim'])}'s body!")
        out.append({"hour": HOURS[i], "i": i, "room": room, "act": a.get("act", ""), "saw": saw, "events": ev, "dark": dark,
                    "idle": bool(a.get("idle")) or p["pid"] in hr.get("idle", [])})
    return out


def view(g, p):
    d = today(g)
    dead = not p["alive"]
    over = g["phase"] == "over"
    killer = p["role"] == "killer"
    pub = []
    for q in g["players"]:
        e = {"pid": q["pid"], "name": q["name"], "bot": q["bot"], "color": q["color"], "alive": q["alive"], "ready": q["ready"],
             "host": q["pid"] == g["host"], "ejected": q.get("ejected", False), "voice": q.get("voice", False) and not q["bot"], "char": q.get("char")}
        if over or q["pid"] == p["pid"] or (killer and q["role"] == "killer") or q.get("ejected") or dead:
            e["role"] = q["role"]
        if d and g["phase"] in ("talk", "vote", "result"):
            e["claimed"] = q["pid"] in d["claims"]
            e["voted"] = q["pid"] in d["votes"]
            e["readyToVote"] = q["pid"] in d["ready"]
        pub.append(e)
    v = {"code": g["code"], "public": g["public"], "v": g["v"], "now": now(), "phase": g["phase"], "deadline": g["deadline"], "start_at": g["start_at"],
         "day": g["day"], "hour": g["hour"], "hours": HOURS, "rooms": rooms_of(g), "showdown": bool(today(g) and today(g).get("showdown")), "players": pub, "winner": g["winner"], "prologue": PROLOGUE,
         "me": {"pid": p["pid"], "name": p["name"], "role": p["role"], "alive": p["alive"], "host": p["pid"] == g["host"], "carrying": g["carry"].get(p["pid"]),
                "ejected": p.get("ejected", False), "char": p.get("char"), "voice": p.get("voice", False)},
         "dms": [m for m in g["dms"] if p["pid"] in (m["from"], m["to"])][-120:]}
    if d:
        v["myday"] = my_day(g, p, d)
        v["beat"] = beat(g) if g["phase"] in ("move", "room") else None
        v["myvote"] = d["votes"].get(p["pid"])
        v["readyToVote"] = p["pid"] in d["ready"]
        v["chat"] = [m for m in d["chat"] if dead or over or not m.get("ghost")][-80:]
        if g["phase"] == "move":
            v["moved"] = d["moves"].get(p["pid"])
        if g["phase"] == "room" and d["cur"]:
            room = d["cur"]["where"].get(p["pid"])
            if room:
                dark = is_dark(beat(g), room)
                others = [q for q in occupants(g, room) if q != p["pid"]]
                v["here"] = {"room": room, "dark": dark, "count": len(others),
                             "people": [] if dark else [{"pid": q, "name": name_of(g, q), "color": player(g, q)["color"], "bot": player(g, q)["bot"],
                                                         "char": player(g, q)["char"]["title"]} for q in others],
                             "items": [i for i in ROOM[room]["items"] if g["items"].get(i) == room]}
                key = f"{g['hour']}:{room}"
                v["roomchat"] = [dict(m, name="A voice in the dark", color="#7d7466") if dark and m["pid"] != p["pid"] else m for m in d["roomchat"].get(key, [])]
                v["acted"] = d["acts"].get(p["pid"])
        if g["phase"] in ("body", "talk", "vote", "result", "over", "quiet"):
            k = d["kill"]
            if k and (d["found"] or over):
                f = d["found"] or {}
                v["body"] = {"victim": name_of(g, k["victim"]), "room": ROOM[k["room"]]["name"], "hour": HOURS[k["hour"]], "cause": CAUSE[KIND[k["weapon"]]],
                             "foundBy": [name_of(g, q) for q in f.get("by", [])], "foundAt": HOURS[f["hour"]] if f.get("hour") is not None else "dusk",
                             "char": player(g, k["victim"])["char"]["title"]}
            v["missing"] = [{"item": i, "room": ROOM[HOME[i]]["name"]} for i in d["missing"]]
            v["beats"] = [{"hour": HOURS[i], "text": b["text"]} for i, b in enumerate(d["beats"][:len(d["hours"])])]
        if g["phase"] in ("result", "over") and "tally" in d:
            v["tally"] = {("skip" if k == "skip" else name_of(g, k)): n for k, n in d["tally"].items()}
            ej = d.get("ejected")
            v["ejected"] = {"name": name_of(g, ej), "role": player(g, ej)["role"]} if ej else None
    if over:
        v["truth"] = truth(g)
    return v


def truth(g):
    out = []
    for d in g["days"]:
        grid = [{"hour": HOURS[i], "rows": [{"name": name_of(g, q), "room": ROOM[r]["name"],
                                             "did": "; ".join(e["text"] for e in hr["events"][r] if e["pid"] == q)} for q, r in hr["where"].items()]}
                for i, hr in enumerate(d["hours"])]
        kills = d.get("kills") or ([d["kill"]] if d["kill"] else [])
        out.append({"n": d["n"], "grid": grid, "showdown": d.get("showdown", False), "kills": [{"victim": name_of(g, k["victim"]), "killer": name_of(g, k["killer"]),
                    "room": ROOM[k["room"]]["name"], "hour": HOURS[k["hour"]], "weapon": k["weapon"]} for k in kills]})
    return out


# ---------- the clock ----------
def tick(g):
    """Move a game on: expired clocks, everyone having acted, bots' planned chat. Called on every request."""
    t = now()
    if g["phase"] == "lobby":
        if g["public"] and g["start_at"] is not None and t >= g["start_at"]:
            while len(g["players"]) < QUEUE_SIZE:
                add_bot(g)
            g["start_at"] = None
            if QUEUE["code"] == g["code"]:
                QUEUE["code"] = None
            return start(g)
        hs = humans(g)
        if not g["public"] and hs and all(p["ready"] for p in hs):
            if g["start_at"] is None:
                g["start_at"] = t + T["countdown"]
                bump(g)
            elif t >= g["start_at"]:
                g["start_at"] = None
                start(g)
        elif not g["public"] and g["start_at"] is not None:
            g["start_at"] = None
            bump(g)
        return
    d = today(g)
    if g["phase"] == "move":
        waiting = [p for p in humans(g, alive_only=True) if p["pid"] not in d["moves"]]
        if t >= g["deadline"] or not waiting:
            resolve_move(g)
        return
    if g["phase"] == "room":
        waiting = [p for p in humans(g, alive_only=True) if p["pid"] not in d["acts"]]
        if t >= g["deadline"] or not waiting:
            resolve_room(g)
        return
    if g["phase"] == "talk":
        for plan in [x for x in d["bot_plan"] if x["at"] <= t and not x.get("done")]:
            plan["done"] = True
            threading.Thread(target=bot_speak, args=(g, plan["pid"], plan["kind"]), daemon=True).start()
        if t >= g["deadline"] or all(p["pid"] in d["ready"] for p in humans(g, alive_only=True)):
            d["vote_plan"] = [{"at": t + random.uniform(3, 20), "pid": p["pid"]} for p in living(g) if p["bot"]]
            set_phase(g, "vote", T["vote"])
        return
    if g["phase"] == "vote":
        for plan in [x for x in d.get("vote_plan", []) if x["at"] <= t and not x.get("done")]:
            plan["done"] = True
            p = player(g, plan["pid"])
            if p and p["alive"] and p["pid"] not in d["votes"]:
                d["votes"][p["pid"]] = bot_vote(g, p)
                bump(g)
        if t >= g["deadline"] or all(p["pid"] in d["votes"] for p in humans(g, alive_only=True)):
            bot_votes(g)
            tally(g)
        return
    if g["deadline"] is not None and t >= g["deadline"]:
        if g["phase"] == "roles":
            new_day(g)
        elif g["phase"] in ("body", "quiet"):
            begin_talk(g)
        elif g["phase"] == "result":
            if winner(g):
                game_over(g)
            elif showdown_due(g):
                set_phase(g, "showdown", T["result"])
            else:
                new_day(g)
        elif g["phase"] == "showdown":
            new_day(g, showdown=True)


# ---------- bots talking ----------
def claim_for(g, p):
    d = today(g)
    claim = {str(i): hr["where"][p["pid"]] for i, hr in enumerate(d["hours"]) if p["pid"] in hr["where"]}
    k = d["kill"]
    if p["role"] == "killer":
        if k and k["killer"] == p["pid"]:
            claim[str(k["hour"])] = random.choice([r for r in room_ids(g) if r != k["room"]])
        for i in list(claim):
            if random.random() < 0.15:
                claim[i] = random.choice(room_ids(g))
    return claim


def claim_text(claim):
    return " · ".join(f"{HOURS[int(i)]} {ROOM[r]['name']}" for i, r in sorted(claim.items(), key=lambda kv: int(kv[0])))


def bot_brief(g, p):
    """Everything a bot knows, for its AI prompt."""
    d = today(g)
    k = d["kill"] if d else None
    public = ""
    if d:
        public = (f"{name_of(g, k['victim'])} was found dead in the {ROOM[k['room']]['name']}, killed around {HOURS[k['hour']]}, {CAUSE[KIND[k['weapon']]]}. "
                  if k and d["found"] else "") + ("Missing objects: " + ", ".join(d["missing"]) + ". " if d["missing"] else "")
    seen = "; ".join(f"{e['hour']} in the {ROOM[e['room']]['name']} with {', '.join(e['saw']) or 'nobody'}" + (f" ({' '.join(e['events'])})" if e["events"] else "")
                     for e in my_day(g, p, d)) if d else ""
    role = ("You are secretly the KILLER" + (f" (you killed {name_of(g, k['victim'])} at {HOURS[k['hour']]} in the {ROOM[k['room']]['name']})" if k and k['killer'] == p['pid'] else "")
            + ". Never admit it; calmly steer suspicion elsewhere.") if p["role"] == "killer" else "You are an innocent guest trying to find the killer."
    lie = f"The day you told everyone (stick to it): {claim_text(d['claims'][p['pid']])}." if d and p["role"] == "killer" and p["pid"] in d["claims"] else ""
    guests = ", ".join(f"{q['name']} ({q['char']['title']}{'' if q['alive'] else ', dead'})" for q in g["players"] if q["pid"] != p["pid"])
    return (f"You are {p['name']}, {p['char']['title']} ({p['char']['blurb']}). {role} {lie}\nThe other guests (the only people here; never invent others): {guests}\n"
            f"Public facts: {public or 'none yet'}\nWhat you personally saw today: {seen or 'nothing yet'}")


STYLE = "Reply as JSON {\"say\": \"...\"}: 1-2 short casual sentences (max 200 characters), like a real person texting in a party game. No hashtags."


def _bot_reply(prompt, fallback):
    try:
        text = _s(_ask_json("You play a guest in a murder-mystery party game with friends. Output only JSON.", prompt, 300).get("say"), 200)
    except Exception as exc:                                           # AI off or slow: a plain line keeps the bot in the game
        log.debug("bot fallback: %s", exc)
        text = ""
    return text or fallback


def bot_speak(g, pid, kind):
    with LOCK:
        if g["phase"] != "talk":
            return
        p = player(g, pid)
        if not p or not p["alive"]:
            return
        d = today(g)
        if kind == "claim":
            claim = claim_for(g, p)
            d["claims"][pid] = claim
            return say(g, p, f"My day: {claim_text(claim)}", claim=claim)
        chat = "\n".join(f"{m['name']}: {m['text']}" for m in d["chat"][-14:] if not m.get("ghost")) or "(nobody has said anything yet)"
        prompt = f"{bot_brief(g, p)}\nThe meeting chat so far:\n{chat}\nWrite your next message: react to others, point out contradictions with what you saw, defend yourself, or say who you suspect and why. {STYLE}"
        s = suspicion(g, p)
        top = max(s, key=s.get) if s else None
        fallback = f"Something's off about {name_of(g, top)}'s story." if top and s[top] >= 2 else random.choice(["Who was near the body?", "Post your days, everyone.", "Who's got the missing stuff?"])
    text = _bot_reply(prompt, fallback)
    with LOCK:
        if g["phase"] == "talk" and p["alive"]:
            say(g, p, text)


def bot_room_reply(g, pid, key):
    """A bot answers someone who spoke to it in the same room."""
    with LOCK:
        p = player(g, pid)
        d = today(g)
        if g["phase"] != "room" or not p or not p["alive"]:
            return
        log_ = "\n".join(f"{m['name']}: {m['text']}" for m in d["roomchat"].get(key, [])[-8:])
        who_ = ", ".join(f"{name_of(g, q)} ({player(g, q)['char']['title']})" for q in occupants(g, d["cur"]["where"][pid]) if q != pid)
        prompt = (f"{bot_brief(g, p)}\nIt's {HOURS[g['hour']]}, you're in the {ROOM[d['cur']['where'][pid]]['name']} with {who_}. The conversation here:\n{log_}\n"
                  f"Answer in character: small talk, gossip about the will or the others, what you're doing here. {STYLE}")
    text = _bot_reply(prompt, random.choice(["Just passing through.", f"Lovely day for it, isn't it?", "I'd rather not say, darling."]))
    with LOCK:
        if g["phase"] == "room" and p["alive"] and f"{g['hour']}:{d['cur']['where'].get(pid)}" == key:
            room_say(g, p, text)


def bot_dm_reply(g, pid, to):
    with LOCK:
        p = player(g, pid)
        if not p or not p["alive"]:
            return
        thread = [m for m in g["dms"] if {m["from"], m["to"]} == {pid, to}][-10:]
        log_ = "\n".join(f"{name_of(g, m['from'])}: {m['text']}" for m in thread)
        prompt = f"{bot_brief(g, p)}\nA private message thread with {name_of(g, to)} (only the two of you can see it):\n{log_}\nReply privately. {STYLE}"
    text = _bot_reply(prompt, random.choice(["Can't talk now.", "Why are you asking me?", "Keep this between us, all right?"]))
    with LOCK:
        dm(g, p, to, text)


def say(g, p, text, claim=None):
    d = today(g)
    msg = {"id": secrets.token_hex(3), "pid": p["pid"], "name": p["name"], "color": p["color"], "bot": p["bot"], "text": text, "t": now(), "ghost": not p["alive"]}
    if claim:
        msg["claim"] = [{"hour": HOURS[int(i)], "room": ROOM[r]["name"]} for i, r in sorted(claim.items(), key=lambda kv: int(kv[0]))]
    d["chat"].append(msg)
    d["chat"] = d["chat"][-200:]
    bump(g)


def room_say(g, p, text):
    d = today(g)
    key = f"{g['hour']}:{d['cur']['where'][p['pid']]}"
    d["roomchat"].setdefault(key, []).append({"id": secrets.token_hex(3), "pid": p["pid"], "name": p["name"], "color": p["color"], "bot": p["bot"], "text": text, "t": now()})
    bump(g)
    return key


def dm(g, p, to, text):
    g["dms"].append({"id": secrets.token_hex(3), "from": p["pid"], "to": to, "name": p["name"], "text": text, "t": now()})
    g["dms"] = g["dms"][-400:]
    bump(g)


# ---------- AI ----------
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5")
EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "minimal")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "4000"))
_day = {"date": "", "n": 0}


def _s(value, n):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value or ""))).strip()[:n]


def _ask_json(system, user, max_tokens):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("no key")
    today_ = time.strftime("%Y-%m-%d")
    if _day["date"] != today_:
        _day.update(date=today_, n=0)
    _day["n"] += 1
    if _day["n"] > DAILY_LIMIT:
        raise RuntimeError("daily limit")
    body = {"model": MODEL, "max_completion_tokens": max_tokens, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if re.match(r"^(gpt-5|o\d)", MODEL):
        body["reasoning_effort"] = EFFORT
    resp = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=(5, 20))
    resp.raise_for_status()
    return json.loads(resp.json()["choices"][0]["message"]["content"] or "{}")


def _spawn(fn, *args):
    threading.Thread(target=fn, args=args, daemon=True).start()


# ---------- endpoints ----------
def _err(msg, status=400):
    return jsonify(error=msg), status


def _clean_name(raw):
    name = re.sub(r"[^\w .'-]", "", str(raw or ""), flags=re.UNICODE).strip()[:16]
    return name or "Guest"


def _ice():
    servers = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
    if os.environ.get("TURN_URL"):
        servers.append({"urls": os.environ["TURN_URL"].split(","), "username": os.environ.get("TURN_USER", ""), "credential": os.environ.get("TURN_PASS", "")})
    return servers


@bp.get("/api/status")
def status():
    return jsonify(ai=bool(os.environ.get("OPENAI_API_KEY")), games=len(GAMES), queue=bool(QUEUE["code"] and QUEUE["code"] in GAMES), ice=_ice())


@bp.post("/api/play")
def play():
    body = request.get_json(silent=True) or {}
    name, mode = _clean_name(body.get("name")), body.get("mode")
    with LOCK:
        if mode == "bots":
            g = new_game()
            p = add_player(g, name)
            for _ in range(max(3, min(7, int(body.get("bots") or 5)))):
                add_bot(g)
            start(g)
        elif mode == "create":
            g = new_game()
            p = add_player(g, name)
        elif mode == "join":
            g = GAMES.get(str(body.get("code") or "").upper().strip())
            if not g:
                return _err("No game with that code. Check it and try again.", 404)
            if g["phase"] != "lobby":
                return _err("That game has already started. Wait for the next round.", 409)
            if len(g["players"]) >= MAX_PLAYERS:
                return _err("That game is full.", 409)
            p = add_player(g, name)
        elif mode == "queue":
            g = GAMES.get(QUEUE["code"]) if QUEUE["code"] else None
            if not g or g["phase"] != "lobby" or len(g["players"]) >= MAX_PLAYERS:
                g = new_game(public=True)
                QUEUE["code"] = g["code"]
            p = add_player(g, name)
            p["ready"] = True
            if g["start_at"] is None:
                g["start_at"] = now() + T["queue"]
            if len(humans(g)) >= MAX_PLAYERS:
                g["start_at"] = now()
        else:
            return _err("Pick a way to play.")
        tick(g)
        return jsonify(code=g["code"], pid=p["pid"], token=p["token"])


def _auth(code):
    g = GAMES.get(str(code).upper())
    if not g:
        return None, None, _err("This game has ended or the server restarted. Start a new one.", 404)
    body = (request.get_json(silent=True) or {}) if request.method == "POST" else request.args
    p = player(g, body.get("pid"))
    if not p or p["token"] != body.get("token"):
        return None, None, _err("You're not in this game.", 403)
    p["seen"] = now()
    return g, p, None


def _signals(g, p):
    """Voice connection messages waiting for this phone: handed over once."""
    return g["signals"].pop(p["pid"], [])


@bp.get("/api/game/<code>")
def state(code):
    with LOCK:
        g, p, err = _auth(code)
        if err:
            return err
        tick(g)
        sig = _signals(g, p)
        if request.args.get("v") == str(g["v"]):
            return jsonify(same=True, v=g["v"], now=now(), signals=sig)
        return jsonify({**view(g, p), "signals": sig})


@bp.post("/api/game/<code>")
def act(code):
    with LOCK:
        g, p, err = _auth(code)
        if err:
            return err
        tick(g)
        body = request.get_json(silent=True) or {}
        kind = body.get("type")
        d = today(g)
        if kind == "signal":
            to = player(g, body.get("to"))
            if not to or to["bot"]:
                return _err("Nobody to call.")
            box = g["signals"].setdefault(to["pid"], [])
            box.append({"from": p["pid"], "data": body.get("data")})
            del box[:-60]
            return jsonify(ok=True)
        if kind == "voice":
            p["voice"] = bool(body.get("on"))
            bump(g)
        elif kind == "ready" and g["phase"] == "lobby":
            p["ready"] = bool(body.get("on"))
            bump(g)
        elif kind == "bots" and g["phase"] == "lobby" and p["pid"] == g["host"]:
            want = max(0, min(MAX_PLAYERS - len(humans(g)), int(body.get("n") or 0)))
            bots = [q for q in g["players"] if q["bot"]]
            while len(bots) < want:
                bots.append(add_bot(g))
            while len(bots) > want:
                g["players"].remove(bots.pop())
            bump(g)
        elif kind == "leave":
            if g["phase"] == "lobby":
                g["players"].remove(p)
                if g["host"] == p["pid"]:
                    nxt = next((q for q in g["players"] if not q["bot"]), None)
                    g["host"] = nxt["pid"] if nxt else None
            else:
                p["left"] = True
            bump(g)
        elif kind == "move" and g["phase"] == "move" and p["alive"]:
            room = body.get("room")
            b = beat(g)
            if room not in room_ids(g) or (b["fx"] == "rain" and room == b["room"]):
                return _err("You can't go there right now.")
            d["moves"][p["pid"]] = room
            bump(g)
        elif kind == "do" and g["phase"] == "room" and p["alive"]:
            room = d["cur"]["where"][p["pid"]]
            a = {"act": "look" if body.get("act") == "look" else ROOM[room]["act"]}
            carrying = g["carry"].get(p["pid"])
            if body.get("take") in ROOM[room]["items"] and not carrying:
                a["take"] = body["take"]
            if body.get("put") and carrying and HOME[carrying] == room:
                a["put"] = True
            if p["role"] == "killer" and body.get("strike"):
                a["strike"] = body["strike"]
            d["acts"][p["pid"]] = a
            bump(g)
        elif kind == "room" and g["phase"] == "room" and p["alive"]:
            text = _s(body.get("text"), 200)
            if not text:
                return _err("Say something.")
            key = room_say(g, p, text)
            room = d["cur"]["where"][p["pid"]]
            for q in occupants(g, room):
                bot = player(g, q)
                if bot["bot"] and (key, q) not in d["bot_room_said"] and random.random() < 0.9:
                    d["bot_room_said"].add((key, q))
                    _spawn(bot_room_reply, g, q, key)
        elif kind == "chat" and d and g["phase"] in ("talk", "vote", "result", "body", "quiet", "over", "move", "room"):
            text = _s(body.get("text"), 200)
            if not text:
                return _err("Say something.")
            if p["alive"] and g["phase"] in ("move", "room"):
                return _err("The meeting hasn't started: talk to the people in your room, or send a private message.")
            last = [m for m in d["chat"] if m["pid"] == p["pid"]]
            if last and now() - last[-1]["t"] < 1:
                return _err("Slow down a little.", 429)
            say(g, p, text)
        elif kind == "dm":
            to = player(g, body.get("to"))
            text = _s(body.get("text"), 200)
            if not to or to["pid"] == p["pid"] or not text:
                return _err("Pick someone and write something.")
            if to["alive"] != p["alive"]:
                return _err("The living and the dead can't message each other.")
            dm(g, p, to["pid"], text)
            if to["bot"] and to["alive"]:
                _spawn(bot_dm_reply, g, to["pid"], p["pid"])
        elif kind == "claim" and g["phase"] == "talk" and p["alive"]:
            raw = body.get("claim") or {}
            claim = {str(i): r for i, r in raw.items() if str(i).isdigit() and int(i) < len(d["hours"]) and r in ROOM}
            if not claim:
                return _err("Say where you were.")
            d["claims"][p["pid"]] = claim
            say(g, p, f"My day: {claim_text(claim)}", claim=claim)
        elif kind == "votenow" and g["phase"] == "talk" and p["alive"]:
            d["ready"].add(p["pid"])
            bump(g)
        elif kind == "vote" and g["phase"] == "vote" and p["alive"]:
            target = body.get("target")
            if target != "skip" and not (player(g, target) and player(g, target)["alive"]):
                return _err("You can't vote for them.")
            d["votes"][p["pid"]] = target
            bump(g)
        elif kind == "again" and g["phase"] == "over":
            g["players"] = [q for q in g["players"] if not q.get("left")]
            for q in g["players"]:
                q.update(alive=True, ready=q["bot"], role="guest", ejected=False, killed=None)
            g.update(days=[], day=0, winner=None, dms=[])
            set_phase(g, "lobby")
        else:
            return _err("You can't do that right now.", 409)
        tick(g)
        return jsonify({**view(g, p), "signals": _signals(g, p)})
