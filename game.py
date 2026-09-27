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
COLOR_NAMES = ["gold", "blue", "rose", "green", "violet", "orange", "teal", "grey"]
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
T = {"countdown": 4, "roles": 14, "move": 20, "room": 60, "body": 12, "quiet": 8, "talk": 150, "vote": 35, "result": 9, "queue": 30}
ROOMS_FOR = {4: 3, 5: 4, 6: 4, 7: 5, 8: 6}                            # guests -> rooms: few enough that people keep meeting
ROOM_ORDER = ["library", "kitchen", "garden", "study", "ballroom", "cellar"]
REACTIONS = ["👍", "😂", "😱", "🤔", "🔪", "👀"]
HAUNTS = ["👻", "🔪", "👀", "🕯️", "❄️", "❓"]                           # what a ghost can send rattling through a room
HUMAN_KILLER_WEIGHT = 2.5                                            # people get the knife more often than bots do
BOT_LIAR_SKILL = 0.25                                                 # how often a killer bot tells a lie nobody can catch
DETECTIVE_EAGERNESS = 0.5                                             # how often a bot detective investigates when it can
CLUE_CHANCE = 0.4                                                     # how often a victim dies clutching a clue
CLUE_WEIGHT = 0.5                                                     # how much a bot makes of it
BOT_ACCUSE_AT = 5                                                     # how sure a bot has to be to say J'accuse out loud

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
    """The more guests, the more of the house is open: three rooms for four guests, up to all six for eight."""
    ids = ROOM_ORDER[:ROOMS_FOR.get(len(g["players"]), 3 if len(g["players"]) < 4 else 6)]
    return [r for r in ROOMS if r["id"] in ids]


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
        p.update(role="guest", alive=True, ready=False, ejected=False, killed=None, searched=False, noted=False, char={"title": title, "blurb": blurb})
    pool = list(g["players"])
    for _ in range(2 if n >= 7 else 1):
        p = random.choices(pool, weights=[1.0 if q["bot"] else HUMAN_KILLER_WEIGHT for q in pool])[0]
        pool.remove(p)
        p["role"] = "killer"
    guests = [q for q in g["players"] if q["role"] != "killer"]
    for p in g["players"]:
        p.update(job=None, belled=False)
    for job in jobs_for(g, n):
        if not guests:
            break
        p = random.choices(guests, weights=[1.0 if q["bot"] else 2.0 for q in guests])[0]   # people get the fun jobs more often
        guests.remove(p)
        p["job"] = job
    for p in g["players"]:
        p["mission"] = pick_mission(g, p)
    g.update(day=0, days=[], winner=None, dms=[], signals={}, meets={}, searches=[], findings=[], ai_calls=0)
    set_phase(g, "roles", T["roles"])


# ---------- secret missions: a little something of your own to do, for bragging rights at the end ----------
def pick_mission(g, p):
    rooms = room_ids(g)
    if p.get("job") == "jester":
        return {"kind": "jester"}
    if p["role"] == "killer":
        return random.choice([{"kind": "kill_in", "room": random.choice(rooms)}, {"kind": "clean"}])
    others = [q for q in g["players"] if q["pid"] != p["pid"]]
    return random.choice([{"kind": "visit", "room": random.choice(rooms), "n": 3}, {"kind": "meet", "with": random.choice(others)["pid"], "n": 2},
                          {"kind": "carry", "item": random.choice([i for r in rooms for i in ROOM[r]["items"]])}, {"kind": "look", "n": 3},
                          {"kind": "whisper", "n": 3}, {"kind": "survive"}])


def mission(g, p):
    """Your mission, how far along it is, and whether it's done (or can't be any more)."""
    m = p.get("mission")
    if not m:
        return None
    pid, over = p["pid"], g["phase"] == "over"
    hours = [hr for d in g["days"] for hr in d["hours"]]
    count = lambda n, of: {"prog": f"{min(n, of)}/{of}", "done": n >= of}
    k = m["kind"]
    if k == "visit":
        out = {"text": f"Spend {m['n']} hours in the {ROOM[m['room']]['name']}", **count(sum(hr["where"].get(pid) == m["room"] for hr in hours), m["n"])}
    elif k == "meet":
        out = {"text": f"Be in the same room as {name_of(g, m['with'])} {m['n']} times",
               **count(sum(1 for hr in hours if pid in hr["where"] and hr["where"][pid] == hr["where"].get(m["with"])), m["n"])}
    elif k == "carry":
        took = any(e["pid"] == pid and e.get("kind") == "take" and e["item"] == m["item"] for hr in hours for evs in hr["events"].values() for e in evs)
        out = {"text": f"Get your hands on the {m['item']}", "prog": "done" if took else "not yet", "done": took}
    elif k == "look":
        out = {"text": f"Look around {m['n']} times", **count(sum(hr["acts"].get(pid, {}).get("act") == "look" for hr in hours), m["n"])}
    elif k == "whisper":
        out = {"text": f"Send a private message to {m['n']} different people", **count(len({x["to"] for x in g["dms"] if x["from"] == pid}), m["n"])}
    elif k == "survive":
        out = {"text": "Still be alive when the weekend ends", "prog": "alive" if p["alive"] else "failed", "done": over and p["alive"], "failed": not p["alive"]}
    elif k == "jester":
        out = {"text": "Get yourself voted out", "prog": "done!" if p.get("ejected") else "not yet", "done": bool(p.get("ejected")), "failed": not p["alive"] and not p.get("ejected")}
    elif k == "kill_in":
        hit = any(kk["killer"] == pid and kk["room"] == m["room"] for d in g["days"] for kk in d.get("kills") or [])
        out = {"text": f"Commit a murder in the {ROOM[m['room']]['name']}", "prog": "done" if hit else "not yet", "done": hit}
    else:
        n = sum(1 for d in g["days"] for t in d["votes"].values() if t == pid)
        out = {"text": "Get through the weekend without a single vote against you", "prog": f"{n} votes" if n else "clean so far", "done": over and not n, "failed": bool(n)}
    return {"failed": False, **out}


def gazette(g, d):
    """The morning paper: yesterday at Wrenmoor, in headlines."""
    k, ej = d["kill"], d.get("ejected")
    lines = []
    if k:
        lines.append(f"{name_of(g, k['victim'])} ({player(g, k['victim'])['char']['title']}) found dead in the {ROOM[k['room']]['name']}: {CAUSE[KIND[k['weapon']]]}.")
    if ej:
        p = player(g, ej)
        head = f"{p['char']['title'].upper()} THROWN OUT OF WRENMOOR"
        lines.append(f"{p['name']} was voted out by the guests, " + ("and was a killer after all!" if p["role"] == "killer" else "and was innocent. The killer is still among us."))
    elif k:
        head = f"MURDER IN THE {ROOM[k['room']]['name'].upper()}!"
        lines.append("The guests couldn't agree on a culprit." if d.get("tally") else "Nobody was voted out.")
    else:
        head = "A QUIET DAY AT THE MANOR…"
        lines.append("No bodies, no verdict. Police baffled; butler unavailable for comment.")
    for x in d.get("saves", []):
        lines.append(f"{name_of(g, x['victim'])} survived an attack in the {ROOM[x['room']]['name']}. The Doctor is said to be pleased.")
    if d["missing"]:
        lines.append(f"Still missing: the {', the '.join(d['missing'])}.")
    return {"headline": head, "lines": lines, "day": d["n"]}


def new_day(g, showdown=False):
    prev = g["days"][-1] if g["days"] else None
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
                      "showdown": showdown, "kills": [], "gazette": gazette(g, prev) if prev else None})
    set_phase(g, "move", T["move"])


def beat(g, h=None):
    d = today(g)
    return d["beats"][g["hour"] if h is None else h] if d else None


JOBS = {"detective": ("🕵️", "The Detective", "Once a day, question someone when the two of you are alone in a room (lights on): you'll learn if they're a killer. Careful: if they are, you're alone with them."),
        "doctor": ("🩺", "The Doctor", "Once a day, pick a patient to watch over: if the killer strikes them that day, they survive. You also read the body: the exact weapon."),
        "jester": ("🃏", "The Jester", "You're not the killer, and you don't care who is. You win if the others vote YOU out. Act suspicious… but not too suspicious."),
        "medium": ("🔮", "The Medium", "You can hear the dead: you read the ghosts' chat, and once a day you hold a séance to ask them a question. Ghosts answer in riddles.")}


def jobs_for(g, n):
    """Which special roles this game has: the host can switch any off in the lobby; small games get fewer."""
    on = set(g.get("roles", JOBS))
    care = [j for j in ("detective", "doctor") if j in on]
    jobs = care if n >= 5 else care[:1] if len(care) < 2 else [random.choice(care)]
    return jobs + [j for j, need in (("jester", 5), ("medium", 6)) if j in on and n >= need]


def guarded(g, pid):
    """Is someone under an alive Doctor's care today?"""
    d = today(g)
    return any(t == pid and player(g, doc)["alive"] for doc, t in d.get("guard", {}).items())


def evidence(g, p):
    """The one thing a guest bot knows for certain, if anything: (who, what to say)."""
    if p["role"] == "killer":
        return None
    d = today(g)
    for k in d.get("kills") or []:
        if p["pid"] in k.get("witnesses", []) and player(g, k["killer"])["alive"]:
            return k["killer"], f"I SAW {name_of(g, k['killer'])} kill {name_of(g, k['victim'])}! Right in front of me, with the {k['weapon']}."
    for x in d.get("saves", []):
        if player(g, x["killer"])["alive"] and p["pid"] in x["witnesses"]:
            return x["killer"], f"{name_of(g, x['killer'])} attacked {name_of(g, x['victim'])} with the {x['weapon']}! I saw it. Only the Doctor's care saved them."
    for f in g.get("findings", []):
        if f["by"] == p["pid"] and f["killer"] and player(g, f["target"])["alive"]:
            return f["target"], f"I'm the Detective. I investigated {name_of(g, f['target'])} at {HOURS[f['hour']]}: they're a killer."
    return None


def job_brief(g, p):
    if p.get("job") == "detective":
        found = "; ".join(f"{name_of(g, f['target'])}: {'KILLER' if f['killer'] else 'innocent'}" for f in g.get("findings", []) if f["by"] == p["pid"])
        return f"You are secretly the Detective. Your investigations: {found or 'none yet'}.\n"
    if p.get("job") == "doctor":
        return "You are secretly the Doctor, watching over one guest a day.\n"
    return ""


def can_cut(g, room=None):
    """The killer's trick, once a day: kill the lights in a room for the coming hour (not in a storm, not in the garden)."""
    d = today(g)
    return (g["phase"] == "move" and d.get("sabotaged") is None and beat(g)["fx"] != "rain"
            and (room is None or (room in room_ids(g) and room != "garden")))


def cut_lights(g, room):
    d = today(g)
    d["sabotaged"] = g["hour"]
    d["beats"][g["hour"]] = {"text": f"The lights suddenly die in the {ROOM[room]['name']}. Someone has been at the fuse box…",
                             "fx": "dark", "room": room, "sabotage": True}
    bump(g)


def haunt(g, p, room, emoji):
    d = today(g)
    d.setdefault("haunts", {})[p["pid"]] = g["hour"]
    d["roomchat"].setdefault(f"{g['hour']}:{room}", []).append({"id": secrets.token_hex(3), "pid": p["pid"], "name": f"Ghost of {p['name']}", "color": p["color"],
                                                                "bot": p["bot"], "text": emoji, "t": now(), "ghost": True, "haunt": True})
    bump(g)


# ---------- the day ----------
def bot_move(g, p):
    d = today(g)
    last = d["hours"][-1]["where"].get(p["pid"]) if d["hours"] else None
    rooms = [r for r in room_ids(g) if not (beat(g)["fx"] == "rain" and r == beat(g)["room"])]
    meet = (g.get("meets") or {}).get(p["pid"])
    if meet and (meet["day"], meet["hour"]) < (g["day"], g["hour"]):
        g["meets"].pop(p["pid"])                                       # missed it: forget it
    elif meet and (meet["day"], meet["hour"]) == (g["day"], g["hour"]) and meet["room"] in rooms:
        g["meets"].pop(p["pid"])
        return meet["room"]                                            # a promise is a promise
    if p["role"] == "killer" and not g["carry"].get(p["pid"]):
        options = [r for r in rooms if any(g["items"].get(i) == r for i in ROOM[r]["items"])]
        return random.choice(options or rooms)
    return last if last in rooms and random.random() < 0.35 else random.choice(rooms)


def resolve_move(g):
    d = today(g)
    b = beat(g)
    for p in living(g):                                                # a bot doctor picks today's patient
        if p["bot"] and p.get("job") == "doctor" and p["pid"] not in d.setdefault("guard", {}):
            others = [q for q in living(g) if q["pid"] != p["pid"]]
            if others:
                d["guard"][p["pid"]] = random.choice(others)["pid"]
    where = {}
    for p in living(g):
        room = d["moves"].get(p["pid"])
        if not room:
            last = d["hours"][-1]["where"].get(p["pid"]) if d["hours"] else None
            room = bot_move(g, p) if p["bot"] else (last or random.choice(room_ids(g)))
        if b["fx"] == "rain" and room == b["room"]:
            room = "library"
        where[p["pid"]] = room
    for p in living(g):                                                # a killer bot with a weapon sometimes kills the lights where it's going
        if p["bot"] and p["role"] == "killer" and g["carry"].get(p["pid"]) and can_cut(g, where[p["pid"]]) and random.random() < 0.3:
            cut_lights(g, where[p["pid"]])
    d["cur"] = {"where": where, "idle": [pid for pid in where if pid not in d["moves"] and not player(g, pid)["bot"]]}
    d["moves"] = {}
    d["acts"] = {}
    d["leaving"] = set()
    # walking in on a body left in an earlier hour
    k = d["kill"]
    if k and not d["found"] and not d["showdown"]:
        finders = [q for q, room in where.items() if room == k["room"]]
        if finders:
            d["found"] = {"hour": g["hour"], "by": finders}
            record_hour(g, {q: {"act": "found the body"} for q in where}, {r["id"]: [] for r in ROOMS}, {})
            return body_found(g)
    set_phase(g, "room", T["room"])
    live_rooms = sorted(set(where.values()))
    for p in g["players"]:                                             # the dead rattle the house now and then
        if p["bot"] and not p["alive"] and live_rooms and random.random() < 0.2:
            haunt(g, p, random.choice(live_rooms), random.choice(HAUNTS))


def occupants(g, room):
    d = today(g)
    return [q for q, r in d["cur"]["where"].items() if r == room]


def bot_act(g, p):
    d = today(g)
    room = d["cur"]["where"][p["pid"]]
    carrying = g["carry"].get(p["pid"])
    here = [i for i in ROOM[room]["items"] if g["items"].get(i) == room]
    others = [q for q in occupants(g, room) if q != p["pid"]]
    if p.get("job") == "detective" and len(others) == 1 and not is_dark(beat(g), room) and p["pid"] not in d.get("checked", {}) and random.random() < DETECTIVE_EAGERNESS:
        done = {f["target"] for f in g.get("findings", []) if f["by"] == p["pid"]}
        a = {"act": ROOM[room]["act"], "investigate": random.choice([q for q in others if q not in done] or others)}
        if carrying and HOME[carrying] == room:
            a["put"] = True
        return a
    if p["role"] == "killer":
        victims = [q for q in others if player(g, q)["role"] != "killer"]
        if carrying and len(victims) == 1 and len(others) == len(victims) and random.random() < 0.85:
            return {"act": ROOM[room]["act"], "strike": victims[0]}
        if not carrying and here:
            return {"act": ROOM[room]["act"], "take": random.choice(here), "sneak": random.random() < 0.8}
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
            events[where[pid]].append({"pid": pid, "text": f"put the {item} back", "item": item, "kind": "put"})
    order = list(acts.items())
    random.shuffle(order)
    for pid, a in order:                                               # …then take them
        item = a.get("take")
        if not item or g["carry"].get(pid) or HOME.get(item) != where[pid]:
            continue
        if g["items"].get(item) == where[pid]:
            g["items"][item] = None
            g["carry"][pid] = item
            sneak = bool(a.get("sneak"))
            events[where[pid]].append({"pid": pid, "text": f"{'quietly ' if sneak else ''}took the {item}", "item": item, "kind": "take", "sneak": sneak})
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
    for pid, a in acts.items():                                        # the Detective's question, answered at the end of the hour
        t = a.get("investigate")
        if (t and player(g, pid).get("job") == "detective" and t != pid and occupants(g, where[pid]) == sorted([pid, t], key=list(where).index)
                and not is_dark(beat(g), where[pid])
                and pid not in d.setdefault("checked", {})):
            d["checked"][pid] = t
            g.setdefault("findings", []).append({"by": pid, "target": t, "day": g["day"], "hour": h, "killer": player(g, t)["role"] == "killer"})
    if not d["kill"] or d["showdown"]:
        for pid, a in order:
            killer = player(g, pid)
            target = a.get("strike")
            if killer["role"] != "killer" or not target or not carried_at_start.get(pid):
                continue
            room = where[pid]
            dark = is_dark(beat(g), room)
            others = [q for q in occupants(g, room) if q != pid and player(g, q)["role"] != "killer" and player(g, q)["alive"]]
            # walk up to them and strike, alone or not; in the dark you can only find someone if they're the only one there
            victim = (others[0] if len(others) == 1 and target in ("dark", others[0]) else None) if dark else target if target in others else None
            if not victim:
                continue
            if guarded(g, victim):                                     # the Doctor's patient: they fight it off and live
                around = [q for q in occupants(g, room) if q not in (pid, victim) and player(g, q)["alive"]]
                d.setdefault("saves", []).append({"victim": victim, "killer": pid, "room": room, "hour": h, "weapon": carried_at_start[pid], "dark": dark,
                                                  "witnesses": [] if dark else around})
                continue
            victim = player(g, victim)
            weapon = carried_at_start[pid]
            victim["alive"] = False
            victim["killed"] = {"day": g["day"], "hour": h, "room": room, "by": pid, "weapon": weapon}
            around = [q for q in occupants(g, room) if q not in (pid, victim["pid"]) and player(g, q)["alive"]]
            d["kill"] = {"victim": victim["pid"], "killer": pid, "room": room, "hour": h, "weapon": weapon,
                         "witnesses": [] if dark else around, "heard": around if dark else []}
            if random.random() < CLUE_CHANCE:                          # a dying clue: a thread of the killer's coat, and two others'
                decoys = random.sample([q["pid"] for q in g["players"] if q["pid"] not in (pid, victim["pid"])], 2)
                d["kill"]["clue"] = random.sample([pid, *decoys], 3)
            d["kills"].append(d["kill"])
            if not d["showdown"]:
                break
    k = d["kill"]
    if k and k["hour"] == h and (k["witnesses"] or k["heard"]) and not d["found"] and not d["showdown"]:
        d["found"] = {"hour": h, "by": k["witnesses"] + k["heard"]}    # it happened right in front of them
        record_hour(g, acts, events, looks)
        return body_found(g)
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
    bots = [p for p in living(g) if p["bot"]]
    finders = [p for p in bots if d["found"] and p["pid"] in d["found"]["by"]]
    eyes = [p for p in bots if evidence(g, p)]
    if bots:                                                           # somebody always breaks the silence: whoever saw it or found the body, if a bot did
        d["bot_plan"].append({"at": t0 + random.uniform(0.5, 1.5), "pid": (eyes or finders or [random.choice(bots)])[0]["pid"], "kind": "open"})
    for p in bots:                                                     # then everyone posts their day, and chips in through the meeting
        if not (p.get("job") == "jester" and random.random() < 0.5):   # a jester "forgets" to, now and then
            d["bot_plan"].append({"at": t0 + random.uniform(2, 6), "pid": p["pid"], "kind": "claim"})
        if p.get("job") == "medium" and any(not q["alive"] for q in g["players"]):
            d["bot_plan"].append({"at": t0 + random.uniform(10, 30), "pid": p["pid"], "kind": "seance"})
        for _ in range(random.choice([1, 2])):
            d["bot_plan"].append({"at": t0 + random.uniform(8, T["talk"] - 30), "pid": p["pid"], "kind": "talk"})
        if p["role"] == "killer" and d["kill"] and not p.get("noted") and random.random() < 0.3:
            d["bot_plan"].append({"at": t0 + random.uniform(15, T["talk"] - 40), "pid": p["pid"], "kind": "note"})


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
        if p.get("job") == "jester":
            p["jester_won"] = True                                    # exactly what they wanted
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
            score[q] += 0.5                                            # hasn't shared their day: a little odd, not proof
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
    for x in d.get("saves", []):                                       # attacked, or watched someone be attacked
        if x["killer"] in score and me["pid"] in x["witnesses"]:
            score[x["killer"]] += 20
    for f in g.get("findings", []):
        if f["by"] == me["pid"] and f["target"] in score:
            score[f["target"]] += 20 if f["killer"] else -3
    k = d["kill"]
    if k and d["found"] and k.get("clue"):                            # one of the three colours clutched in the victim's hand
        for q in k["clue"]:
            if q in score:
                score[q] += CLUE_WEIGHT
    for kk in d.get("kills") or ([d["kill"]] if d["kill"] else []):
        if me["pid"] in kk.get("witnesses", []) and kk["killer"] in score:
            score[kk["killer"]] += 20                                  # saw them do it: nothing else matters
        nxt = d["hours"][kk["hour"] + 1] if kk["hour"] + 1 < len(d["hours"]) else None
        if nxt and nxt["acts"].get(me["pid"], {}).get("act") == "look" and nxt["where"].get(me["pid"]) == kk["room"]:
            for q, r in d["hours"][kk["hour"]]["where"].items():       # looked around the murder room: who'd been in it
                if r == kk["room"] and q in score:
                    score[q] += 3
    told = {q: 0 for q in score}
    for m in g["dms"][-40:]:                                           # what people whispered to me
        if m["to"] != me["pid"] or m["from"] == me["pid"] or not player(g, m["from"])["alive"]:
            continue
        for q in score:
            if q != m["from"] and re.search(rf"\b{re.escape(name_of(g, q).lower())}\b", m["text"].lower()):
                told[q] += 1
    for q, n in told.items():
        score[q] += min(2.5, 1.25 * n)
    mentions = {q: 0 for q in score}
    for msg in d["chat"][-30:]:
        if msg.get("ghost") or msg["pid"] == me["pid"]:
            continue
        for q in score:
            if re.search(rf"\b{re.escape(name_of(g, q).lower())}\b", msg["text"].lower()):
                mentions[q] += 1
    for q, n in mentions.items():                                      # being talked about adds up, but a pile-on can't convict alone
        score[q] += min(1.5, 0.5 * n)
    return score


def bot_vote(g, p):
    s = suspicion(g, p)
    if not s:
        return "skip"
    if p["role"] == "killer":
        s = {q: v for q, v in s.items() if player(g, q)["role"] != "killer"} or s
        return max(s, key=lambda q: s[q] + random.random())
    best = max(s, key=lambda q: s[q] + random.random() * 1.0)          # bots don't all land on the same name
    return best if s[best] >= 2 else "skip"


# ---------- what each phone may see ----------
def color_name(g, pid):
    return COLOR_NAMES[COLORS.index(player(g, pid)["color"])]


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
        looked = a.get("act") == "look"                               # only someone looking around catches a quiet hand
        noticed = [e for e in hr["events"][room] if e["pid"] == p["pid"] or (not dark and (not e.get("sneak") or looked))]
        ev = [f"{'You' if e['pid'] == p['pid'] else name_of(g, e['pid'])} {e['text']}."
              + (" You caught it while looking around." if e.get("sneak") and e["pid"] != p["pid"] else "") for e in noticed]
        items = [{"who": "You" if e["pid"] == p["pid"] else name_of(g, e["pid"]), "item": e["item"], "kind": e["kind"], "sneak": bool(e.get("sneak"))}
                 for e in noticed if e.get("item")]
        if a.get("missed"):
            ev.append(f"You looked for the {a['missed']}, but it was already gone.")
        if p["pid"] in hr["looks"]:
            ev.append(f"You looked around: {hr['looks'][p['pid']]}")
        k = d["kill"]
        for kk in [x for x in d.get("kills") or ([k] if k else []) if x["hour"] == i]:
            if kk["killer"] == p["pid"]:
                ev.append(f"You killed {name_of(g, kk['victim'])} here with the {kk['weapon']}" + (" — in front of " + ", ".join(name_of(g, q) for q in kk.get("witnesses", [])) if kk.get("witnesses") else "") + ".")
            if kk["victim"] == p["pid"]:
                ev.append(f"{name_of(g, kk['killer'])} killed you here with the {kk['weapon']}.")
            if p["pid"] in kk.get("witnesses", []):
                ev.append(f"You SAW {name_of(g, kk['killer'])} kill {name_of(g, kk['victim'])} with the {kk['weapon']}, right in front of you!")
            if p["pid"] in kk.get("heard", []):
                ev.append(f"A scream in the dark: {name_of(g, kk['victim'])} was killed right beside you, but you couldn't see by whom.")
        for x in [x for x in d.get("saves", []) if x["hour"] == i]:
            if x["killer"] == p["pid"]:
                ev.append(f"You struck at {name_of(g, x['victim'])} with the {x['weapon']}, but they survived: someone had been looking after them!")
            if x["victim"] == p["pid"]:                                 # from behind: you live, but you never saw who
                ev.append(f"Someone attacked you from behind with the {x['weapon']}! You survived: the Doctor had been watching over you.")
            if p["pid"] in x["witnesses"]:
                ev.append(f"You SAW {name_of(g, x['killer'])} attack {name_of(g, x['victim'])} with the {x['weapon']}! They survived.")
            if d.get("guard", {}).get(p["pid"]) == x["victim"]:
                ev.append(f"Your patient {name_of(g, x['victim'])} was attacked in the {ROOM[x['room']]['name']}, and lived, thanks to you.")
        for f in [f for f in g.get("findings", []) if f["day"] == d["n"] and f["hour"] == i]:
            if f["by"] == p["pid"]:
                ev.append(f"You investigated {name_of(g, f['target'])}: " + ("they ARE a killer! 🔪" if f["killer"] else "they're innocent."))
            elif f["target"] == p["pid"] and p["role"] == "killer":   # a killer feels it: a hint of who the Detective is
                ev.append(f"{name_of(g, f['by'])} kept studying you all hour, far too closely. A detective, perhaps?")
        if d["found"] and d["found"]["hour"] == i and p["pid"] in d["found"]["by"] and not (k and p["pid"] in k.get("witnesses", []) + k.get("heard", [])):
            ev.append(f"You found {name_of(g, k['victim'])}'s body!")
        out.append({"hour": HOURS[i], "i": i, "room": room, "act": a.get("act", ""), "saw": saw, "events": ev, "items": items, "dark": dark,
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
             "host": q["pid"] == g["host"], "ejected": q.get("ejected", False), "voice": q.get("voice", False) and not q["bot"], "char": q.get("char"),
             "colorName": COLOR_NAMES[COLORS.index(q["color"])]}
        if over and q.get("mission"):
            e["mission"] = mission(g, q)
        if over:
            e["job"] = q.get("job")
        if over or q["pid"] == p["pid"] or (killer and q["role"] == "killer") or q.get("ejected") or dead:
            e["role"] = q["role"]
        if d and g["phase"] in ("talk", "vote", "result"):
            e["claimed"] = q["pid"] in d["claims"]
            e["voted"] = q["pid"] in d["votes"]
            e["readyToVote"] = q["pid"] in d["ready"]
        pub.append(e)
    v = {"code": g["code"], "public": g["public"], "v": g["v"], "now": now(), "phase": g["phase"], "deadline": g["deadline"], "start_at": g["start_at"],
         "day": g["day"], "hour": g["hour"], "roleInfo": {j: list(x) for j, x in JOBS.items()}, "rolesOn": list(g.get("roles", JOBS)),
         "cast": {"killers": sum(q.get("role") == "killer" for q in g["players"]), "jobs": [j for j in JOBS if any(q.get("job") == j for q in g["players"])]}
         if g["phase"] != "lobby" else None, "hours": HOURS, "rooms": rooms_of(g), "showdown": bool(today(g) and today(g).get("showdown")), "players": pub, "winner": g["winner"], "prologue": PROLOGUE,
         "me": {"pid": p["pid"], "name": p["name"], "role": p["role"], "alive": p["alive"], "host": p["pid"] == g["host"], "carrying": g["carry"].get(p["pid"]),
                "ejected": p.get("ejected", False), "char": p.get("char"), "voice": p.get("voice", False), "searched": p.get("searched", False),
                "noted": p.get("noted", False), "mission": mission(g, p) if g["phase"] != "lobby" else None,
                "job": p.get("job"), "jobInfo": list(JOBS[p["job"]]) if p.get("job") else None},
         "dms": [m for m in g["dms"] if p["pid"] in (m["from"], m["to"])][-120:],
         "searches": [{"by": name_of(g, s["by"]), "target": name_of(g, s["target"]), "found": s["found"], "day": s["day"], "mine": s["by"] == p["pid"]}
                      for s in g.get("searches", []) if p["pid"] in (s["by"], s["target"])]}
    ty = {q: x["ctx"] for q, x in g.get("typing", {}).items() if q != p["pid"] and now() - x["t"] < 12 and player(g, q)}
    room_key = f"{g['hour']}:{d['cur']['where'].get(p['pid'])}" if d and g["phase"] == "room" and d.get("cur") else None
    v["typing"] = {"dm": [q for q, c in ty.items() if c == ("dm", p["pid"])],
                   "meet": [name_of(g, q) for q, c in ty.items() if c == ("meet",) and (player(g, q)["alive"] or dead or over)],
                   "room": [name_of(g, q) for q, c in ty.items() if room_key and c == ("room", room_key)]}
    if d:
        v["myday"] = my_day(g, p, d)
        v["beat"] = beat(g) if g["phase"] in ("move", "room") else None
        v["myvote"] = d["votes"].get(p["pid"])
        v["readyToVote"] = p["pid"] in d["ready"]
        medium = p.get("job") == "medium"                             # the Medium hears the dead
        v["chat"] = [m for m in d["chat"] if dead or over or medium or not m.get("ghost")][-80:]
        if g["phase"] in ("move", "room") and g["hour"] == 0 and d.get("gazette"):
            v["gazette"] = d["gazette"]
        if g["phase"] in ("talk", "vote"):
            v["accused"] = p["pid"] in d.get("accused", {})
        if p.get("job") == "detective":
            v["findings"] = [{"target": name_of(g, f["target"]), "day": f["day"], "hour": HOURS[f["hour"]], "killer": f["killer"]} for f in g.get("findings", []) if f["by"] == p["pid"]]
            v["checked"] = p["pid"] in d.get("checked", {})
        if p.get("job") == "medium":
            v["canSeance"] = p["alive"] and p["pid"] not in d.get("seances", ()) and any(not q["alive"] for q in g["players"])
        if p.get("job") == "doctor":
            v["guard"] = name_of(g, d["guard"][p["pid"]]) if p["pid"] in d.get("guard", {}) else None
        v["canBell"] = p["alive"] and not p.get("belled") and g["phase"] == "move" and g["hour"] > 0 and not d["showdown"]
        if g["phase"] in ("body", "quiet", "talk", "vote", "result", "over"):
            v["saves"] = [{"victim": name_of(g, x["victim"]), "room": ROOM[x["room"]]["name"], "hour": HOURS[x["hour"]]} for x in d.get("saves", [])]
        if g["phase"] == "move":
            v["moved"] = d["moves"].get(p["pid"])
            if killer and p["alive"]:
                v["canCut"] = can_cut(g)
        if g["phase"] == "room" and dead and d["cur"]:                 # the dead see the whole house, and can rattle it once an hour
            v["house"] = [{"room": r, "people": [name_of(g, q) for q in occupants(g, r)]} for r in room_ids(g)]
            v["haunted"] = d.get("haunts", {}).get(p["pid"]) == g["hour"]
        if g["phase"] == "room" and d["cur"]:
            room = d["cur"]["where"].get(p["pid"])
            if room:
                dark = is_dark(beat(g), room)
                others = [q for q in occupants(g, room) if q != p["pid"]]
                v["here"] = {"room": room, "dark": dark, "count": len(others),
                             "people": [] if dark else [{"pid": q, "name": name_of(g, q), "color": player(g, q)["color"], "bot": player(g, q)["bot"],
                                                         "char": player(g, q)["char"]["title"]} for q in others],
                             "items": [i for i in ROOM[room]["items"] if g["items"].get(i) == room],
                             "gone": [i for i in ROOM[room]["items"] if g["items"].get(i) != room]}
                v["leaving"] = p["pid"] in d.get("leaving", ())
                key = f"{g['hour']}:{room}"
                v["roomchat"] = [dict(m, name="A voice in the dark", color="#7d7466") if dark and m["pid"] != p["pid"] and not m.get("haunt") else m
                                 for m in d["roomchat"].get(key, [])]
                v["acted"] = d["acts"].get(p["pid"])
        if g["phase"] in ("body", "talk", "vote", "result", "over", "quiet"):
            k = d["kill"]
            if k and (d["found"] or over):
                f = d["found"] or {}
                v["body"] = {"victim": name_of(g, k["victim"]), "room": ROOM[k["room"]]["name"], "hour": HOURS[k["hour"]], "cause": CAUSE[KIND[k["weapon"]]],
                             "foundBy": [name_of(g, q) for q in f.get("by", [])], "foundAt": HOURS[f["hour"]] if f.get("hour") is not None else "the bell" if d.get("bell") else "dusk",
                             "char": player(g, k["victim"])["char"]["title"],
                             "autopsy": k["weapon"] if p.get("job") == "doctor" else None,
                             "clue": ", ".join(color_name(g, q) for q in k["clue"][:-1]) + " and " + color_name(g, k["clue"][-1]) if k.get("clue") else None}
            v["missing"] = [{"item": i, "room": ROOM[HOME[i]]["name"]} for i in d["missing"]]
            v["beats"] = [{"hour": HOURS[i], "text": b["text"]} for i, b in enumerate(d["beats"][:len(d["hours"])])]
        if g["phase"] in ("result", "over") and "tally" in d:
            v["tally"] = {("skip" if k == "skip" else name_of(g, k)): n for k, n in d["tally"].items()}
            ej = d.get("ejected")
            v["ejected"] = {"name": name_of(g, ej), "role": player(g, ej)["role"], "jester": bool(player(g, ej).get("jester_won"))} if ej else None
            v["ballots"] = [{"from": name_of(g, q), "to": "Skip" if t == "skip" else name_of(g, t)} for q, t in d["votes"].items() if player(g, q)]
    if over:
        v["truth"] = truth(g)
        v["awards"] = awards(g)
    return v


def awards(g):
    """A few superlatives for the end of the game: bragging rights only."""
    votes = {p["pid"]: 0 for p in g["players"]}
    msgs = {p["pid"]: 0 for p in g["players"]}
    for d in g["days"]:
        for target in d["votes"].values():
            if target in votes:
                votes[target] += 1
        for m in d["chat"] + [m for lst in d["roomchat"].values() for m in lst]:
            if m["pid"] in msgs and not m.get("claim") and not m.get("haunt"):
                msgs[m["pid"]] += 1
    s = lambda n, word: f"{n} {word}{'' if n == 1 else 's'}"
    out = []
    if any(votes.values()):
        top = max(votes, key=votes.get)
        out.append({"emoji": "🔍", "title": "Prime Suspect", "name": name_of(g, top), "detail": s(votes[top], "vote") + " against them"})
        killers = [q for q in votes if player(g, q)["role"] == "killer"]
        if killers:
            cool = min(killers, key=votes.get)
            out.append({"emoji": "🎭", "title": "Best Poker Face", "name": name_of(g, cool), "detail": f"the killer, with only {s(votes[cool], 'vote')} all game"})
    if any(msgs.values()):
        chatty, quiet = max(msgs, key=msgs.get), min(msgs, key=msgs.get)
        out.append({"emoji": "💬", "title": "Chatterbox", "name": name_of(g, chatty), "detail": s(msgs[chatty], "message")})
        if msgs[quiet] < msgs[chatty]:
            out.append({"emoji": "🤫", "title": "Man of Mystery", "name": name_of(g, quiet), "detail": "never said a word" if not msgs[quiet] else f"only {s(msgs[quiet], 'message')}"})
    takes = {}
    for d in g["days"]:
        for hr in d["hours"]:
            for evs in hr["events"].values():
                for e in evs:
                    if e.get("kind") == "take":
                        takes[e["pid"]] = takes.get(e["pid"], 0) + 1
    if takes:
        thief = max(takes, key=takes.get)
        out.append({"emoji": "🧤", "title": "Sticky Fingers", "name": name_of(g, thief), "detail": f"picked up {s(takes[thief], 'thing')}"})
    eyes = {}
    for d in g["days"]:
        for hr in d["hours"]:
            for pid, a in hr["acts"].items():
                room = hr["where"].get(pid)
                if a.get("act") == "look" and room and not is_dark(hr, room):
                    n = sum(1 for e in hr["events"][room] if e.get("sneak") and e["pid"] != pid)
                    if n:
                        eyes[pid] = eyes.get(pid, 0) + n
    if eyes:
        eagle = max(eyes, key=eyes.get)
        out.append({"emoji": "🦅", "title": "Eagle Eye", "name": name_of(g, eagle), "detail": f"caught {s(eyes[eagle], 'sneaky hand')}"})
    hits = [x for x in g.get("searches", []) if x["found"]]
    if hits:
        out.append({"emoji": "🕵️", "title": "Pickpocket", "name": ", ".join(sorted({name_of(g, x["by"]) for x in hits})), "detail": "found something in someone's pockets"})
    haunts = {}
    for d in g["days"]:
        for m in [m for lst in d["roomchat"].values() for m in lst if m.get("haunt")]:
            haunts[m["pid"]] = haunts.get(m["pid"], 0) + 1
    if haunts:
        spook = max(haunts, key=haunts.get)
        out.append({"emoji": "👻", "title": "Poltergeist", "name": name_of(g, spook), "detail": f"haunted {s(haunts[spook], 'room')}"})
    for q in [q for q in g["players"] if q.get("jester_won")]:
        out.insert(0, {"emoji": "🃏", "title": "The Jester wins!", "name": q["name"], "detail": "fooled you all into voting them out"})
    right = {}
    for d in g["days"]:
        for voter, t in d["votes"].items():
            if player(g, t) and player(g, t)["role"] == "killer":
                right[voter] = right.get(voter, 0) + 1
    if right:
        nose = max(right, key=right.get)
        out.append({"emoji": "👃", "title": "Sharpest Nose", "name": name_of(g, nose), "detail": f"voted for a killer {s(right[nose], 'time')}"})
    done = [q for q in g["players"] if (mission(g, q) or {}).get("done")]
    if done:
        out.append({"emoji": "🎯", "title": "Mission accomplished", "name": ", ".join(q["name"] for q in done), "detail": "did their secret mission"})
    return out


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
    if g["phase"] == "room":                                           # you stay until you choose to leave, or the minute is up
        waiting = [p for p in humans(g, alive_only=True) if p["pid"] not in d.get("leaving", ())]
        if t >= g["deadline"] or not waiting:
            resolve_room(g)
        return
    if g["phase"] == "talk":
        for plan in [x for x in d["bot_plan"] if x["at"] <= t and not x.get("done")]:
            plan["done"] = True
            if plan["kind"] not in ("claim", "note"):              # an anonymous note mustn't show who is typing it
                typing(g, plan["pid"], ("meet",))
            threading.Thread(target=bot_speak, args=(g, plan["pid"], plan["kind"]), daemon=True).start()
        if t >= g["deadline"] or all(p["pid"] in d["ready"] for p in humans(g, alive_only=True)):
            d["vote_plan"] = [{"at": t + random.uniform(1, 8), "pid": p["pid"]} for p in living(g) if p["bot"]]
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
    """What a bot says it did: the truth, except that a killer covers the hours that would give it away (the murder, picking
    up the weapon), and only with a lie nobody alive can catch: nobody saw it where it really was, nobody was where it says."""
    d = today(g)
    claim = {str(i): hr["where"][p["pid"]] for i, hr in enumerate(d["hours"]) if p["pid"] in hr["where"]}
    if p["role"] == "killer":
        mine = [k for k in d.get("kills") or ([d["kill"]] if d["kill"] else []) if k["killer"] == p["pid"]]
        for i, hr in enumerate(d["hours"]):
            took = (hr["acts"].get(p["pid"]) or {}).get("take")
            if str(i) not in claim or not any(k["hour"] == i or k["weapon"] == took for k in mine):
                continue
            seen_by = lambda room: [q for q, r in hr["where"].items() if r == room and q != p["pid"] and player(g, q)["alive"]]
            others = [r for r in room_ids(g) if r != claim[str(i)]]
            empty = [r for r in others if not seen_by(r)]
            if random.random() < BOT_LIAR_SKILL:                       # a careful liar: only lies nobody can catch
                if empty and not seen_by(claim[str(i)]):
                    claim[str(i)] = random.choice(empty)
            elif k_hour(mine, i):                                      # a clumsy one: just says it was somewhere else
                claim[str(i)] = random.choice(others)
    return claim


def k_hour(kills, i):
    return any(k["hour"] == i for k in kills)


def claim_text(claim):
    return " · ".join(f"{HOURS[int(i)]} {ROOM[r]['name']}" for i, r in sorted(claim.items(), key=lambda kv: int(kv[0])))


def rooms_heard(g, p, d):
    """Everything said today in rooms this player was in."""
    out = []
    for key, lst in d["roomchat"].items():
        h, room = key.split(":", 1)
        h = int(h)
        was = d["hours"][h]["where"].get(p["pid"]) if h < len(d["hours"]) else (d["cur"] or {}).get("where", {}).get(p["pid"])
        if was == room:
            out += [f"  [{HOURS[h]}, {ROOM[room]['name']}] {m['name']}: {m['text']}" for m in lst]
    return "\n".join(out[-20:])


MEET_HOURS = {"9": 0, "11": 1, "1": 2, "3": 3, "5": 4}


def meetup(g, text):
    """'Library at 3' → the Library at 3 PM. The room must be one of this house's; the hour is optional (next hour)."""
    low = text.lower()
    if not re.search(r"\b(meet|come|go|join|see you|let'?s|lets|wait|head|be (in|at)|find me|catch you)\b", low):
        return None                                                    # "I was in the library at 9" is a story, not a plan
    room = next((r for r in room_ids(g) if re.search(rf"\b{r}\b", low)), None)
    if not room:
        return None
    m = re.search(r"\b(9|11|1|3|5)\s*(?::00)?\s*(am|pm|o'?clock)?\b", low)
    d = today(g)
    nxt = g["hour"] if g["phase"] == "move" else g["hour"] + 1
    hour = MEET_HOURS[m.group(1)] if m else nxt
    day = g["day"] if d and hour >= nxt else g["day"] + 1               # an hour already gone today means tomorrow
    return {"room": room, "hour": hour, "day": day}


def remember_meet(g, bot, who_, text):
    """Someone asked a bot to meet them somewhere: the bot really goes."""
    plan = meetup(g, text)
    if plan:
        g.setdefault("meets", {})[bot["pid"]] = dict(plan, **{"with": who_["pid"]})
    return plan


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
    whispers = "\n".join(f"  {name_of(g, m['from'])} → {name_of(g, m['to'])}: {m['text']}" for m in [m for m in g["dms"] if p["pid"] in (m["from"], m["to"])][-6:])
    heard = rooms_heard(g, p, d) if d else ""
    meet = (g.get("meets") or {}).get(p["pid"])
    s = suspicion(g, p) if d and p["alive"] else {}
    gut = ", ".join(f"{name_of(g, q)} ({v:.0f})" for q, v in sorted(s.items(), key=lambda kv: -kv[1])[:3] if v >= 1)
    saw_kill = bool(d) and any(p["pid"] in x.get("witnesses", []) for x in d.get("kills") or [])
    return (f"You are {p['name']}, {p['char']['title']} ({p['char']['blurb']}). {role} {lie}\nThe other guests (the only people here; never invent others): {guests}\n"
            f"Public facts: {public or 'none yet'}\nWhat you personally saw today: {seen or 'nothing yet'}\n"
            + ("You SAW the murder happen: that is the most important thing you know. Say so plainly and name the killer.\n" if saw_kill and p["role"] != "killer" else "")
            + (f"Private messages you've had (only you and them know; use them, and bring up what's useful at the meeting):\n{whispers}\n" if whispers else "")
            + (f"What you heard said in rooms today:\n{heard[-600:]}\n" if heard else "")
            + job_brief(g, p)
            + (f"You promised to meet {name_of(g, meet['with'])} in the {ROOM[meet['room']]['name']} at {HOURS[meet['hour']]}, and you will really go.\n" if meet else "")
            + (f"Your gut feeling, most suspicious first: {gut}." if gut and p["role"] != "killer" else ""))


STYLE = "Reply as JSON {\"say\": \"...\"}: 1-2 short casual sentences (max 200 characters), like a real person texting in a party game. No hashtags."


def audience(g):
    """Is a real person still here to read it? A phone that hasn't checked in for 40 seconds is gone."""
    return any(not q["bot"] and now() - q.get("seen", 0) < 40 for q in g["players"])


def _bot_reply(g, prompt, fallback):
    if not audience(g) or g.get("ai_calls", 0) >= GAME_LIMIT:         # nobody watching, or this game has had its share: plain lines are free
        return fallback
    g["ai_calls"] = g.get("ai_calls", 0) + 1
    try:
        text = _s(_ask_json("You play a guest in a murder-mystery party game with friends. Output only JSON.", prompt, 160).get("say"), 200)
    except Exception as exc:                                           # AI off or slow: a plain line keeps the bot in the game
        log.debug("bot fallback: %s", exc)
        text = ""
    return text or fallback


def typing(g, pid, ctx):
    """Someone started writing: the others see "… is typing" straight away, however long an AI answer takes."""
    g.setdefault("typing", {})[pid] = {"ctx": ctx, "t": now()}
    bump(g)


def typing_done(g, pid):
    g.get("typing", {}).pop(pid, None)


def ghost_brief(g, p):
    """What a dead bot knows: how it died, and (being a ghost) who the killer is."""
    k = p.get("killed")
    how = (f"{name_of(g, k['by'])} killed you in the {ROOM[k['room']]['name']} at {HOURS[k['hour']]} with the {k['weapon']}"
           if k else "the others voted you out")
    killers = " and ".join(q["name"] for q in g["players"] if q["role"] == "killer")
    return (f"You are {p['name']}, {p['char']['title']}, and you are dead: {how}. As a ghost you see everything (the killer is {killers}), "
            f"but you can only talk to the other ghosts, never to the living.")


GHOST_LINES = ["It's cold on this side.", "We can only watch now.", "I never saw it coming.", "They'll work it out. I hope."]


def bot_speak(g, pid, kind):
    with LOCK:
        p = player(g, pid)
        if g["phase"] != "talk" or not p or not p["alive"]:
            typing_done(g, pid)
            return
        d = today(g)
        if kind == "claim":
            claim = claim_for(g, p)
            d["claims"][pid] = claim
            return say(g, p, f"My day: {claim_text(claim)}", claim=claim)
        chat = "\n".join(f"{m['name']}: {m['text']}" for m in d["chat"][-8:] if not m.get("ghost")) or "(nobody has said anything yet)"
        k = d["kill"]
        if kind == "note":                                             # the killer points everyone somewhere else, anonymously
            guests = [q for q in living(g) if q["role"] != "killer"]
            if not guests or p.get("noted") or not k:
                return typing_done(g, pid)
            mark = random.choice(guests)
            return note(g, p, random.choice([f"I saw {mark['name']} slip out of the {ROOM[k['room']]['name']} around {HOURS[k['hour']]}. Say nothing.",
                                             f"Ask {mark['name']} why their hands were shaking at {HOURS[k['hour']]}.",
                                             f"{mark['name']} is not who they say they are."]))
        if kind == "seance":
            return seance(g, p, random.choice(["Spirits, who did this to you?", "Is anyone there? Tell me who the killer is.", "Speak to me. Where was the killer?"]))
        if kind == "talk" and p.get("job") == "jester" and random.random() < 0.5:
            return say(g, p, random.choice(["Honestly? Maybe it was me. Who knows 😏", "I'm not saying I did it… but I'm not saying I didn't.",
                                            "Vote me out, I dare you.", "I had the rope for, uh, gardening reasons.", "Why is everyone looking at me? …Keep looking."]))
        s = suspicion(g, p)
        top = max(s, key=s.get) if s else None
        if kind == "talk" and top and s[top] >= BOT_ACCUSE_AT and pid not in d.get("accused", {}) and random.random() < 0.5:
            return accuse(g, p, player(g, top))                        # sure enough to say it out loud
        proof = evidence(g, p) if kind in ("open", "talk") else None
        if proof:                                                      # I know who it is: that's what I say, and I say it first
            prompt = f"{bot_brief(g, p)}\nThe meeting chat so far:\n{chat}\nWhat you know for certain: {proof[1]} Tell everyone, name them, insist. {STYLE}"
            fallback = random.choice([proof[1], f"It was {name_of(g, proof[0])}. I know it. Vote {name_of(g, proof[0])} out, now."])
        elif kind == "defend":
            by = next((m["name"] for m in reversed(d["chat"]) if m.get("accuse") == p["name"]), "someone")
            prompt = (f"{bot_brief(g, p)}\nThe meeting chat so far:\n{chat}\n{by} just accused you in front of everyone. Answer them: "
                      + ("deny it calmly and turn suspicion onto someone else." if p["role"] == "killer" else "you're innocent, so defend yourself with what you really did today.") + f" {STYLE}")
            fallback = random.choice([f"Me?! That's rubbish, {by}. Read my day.", f"Nice try, {by}. Why are you so keen to point fingers?",
                                      f"I didn't do it! {by}, where were YOU?"])
        elif kind == "open":
            found = k and d["found"] and pid in d["found"]["by"]
            prompt = (f"{bot_brief(g, p)}\nThe meeting is starting and nobody has spoken yet. Open it: "
                      + ("you found the body, so say what you saw and ask where everyone was." if found else "say what's on your mind about the day and get people talking.") + f" {STYLE}")
            fallback = (f"I found {name_of(g, k['victim'])} in the {ROOM[k['room']]['name']}. Where was everyone around {HOURS[k['hour']]}?" if found
                        else f"Right. {name_of(g, k['victim'])} is dead. Where was everyone around {HOURS[k['hour']]}?" if k
                        else "Nobody died, but someone's been taking things. Let's hear everyone's day.")
        else:
            prompt = f"{bot_brief(g, p)}\nThe meeting chat so far:\n{chat}\nWrite your next message: react to others, point out contradictions with what you saw, defend yourself, or say who you suspect and why. {STYLE}"
            fallback = f"Something's off about {name_of(g, top)}'s story." if top and s[top] >= 2 else random.choice(["Who was near the body?", "Post your days, everyone.", "Who's got the missing stuff?"])
    text = _bot_reply(g, prompt, fallback)
    with LOCK:
        if g["phase"] == "talk" and p["alive"]:
            say(g, p, text)
        typing_done(g, pid)


def bot_ghost_reply(g, pid):
    """A dead bot answers in the ghosts' chat."""
    with LOCK:
        p, d = player(g, pid), today(g)
        if not p or p["alive"] or not d:
            return typing_done(g, pid)
        log_ = "\n".join(f"{m['name']}: {m['text']}" for m in d["chat"][-10:] if m.get("ghost"))
        prompt = f"{ghost_brief(g, p)}\nThe ghosts' chat:\n{log_}\nReply as a ghost. {STYLE}"
    text = _bot_reply(g, prompt, random.choice(GHOST_LINES))
    with LOCK:
        if today(g) is d:
            say(g, p, text)
        typing_done(g, pid)


def answer_in_chat(g, d, p, text):
    """A person spoke at the meeting (or among the ghosts): a bot answers straight away rather than at its next turn."""
    ghost = not p["alive"]
    if p["bot"] or (not ghost and g["phase"] != "talk"):
        return
    bots = [q for q in g["players"] if q["bot"] and q["alive"] != ghost]
    named = [q for q in bots if re.search(rf"\b{re.escape(q['name'].lower())}\b", text.lower())]
    last = d.setdefault("bot_last", {})
    if not ghost:
        for q in named:
            remember_meet(g, q, p, text)
    for q in named[:2] or ([random.choice(bots)] if bots and random.random() < (0.9 if ghost else 0.7) else []):
        if now() - last.get(q["pid"], 0) < 6:
            continue
        last[q["pid"]] = now()
        typing(g, q["pid"], ("meet",))
        _spawn(bot_ghost_reply, g, q["pid"]) if ghost else _spawn(bot_speak, g, q["pid"], "talk")


def bot_room_reply(g, pid, key):
    """A bot answers someone who spoke to it in the same room."""
    with LOCK:
        p = player(g, pid)
        d = today(g)
        if g["phase"] != "room" or not p or not p["alive"]:
            return typing_done(g, pid)
        log_ = "\n".join(f"{m['name']}: {m['text']}" for m in d["roomchat"].get(key, [])[-8:])
        who_ = ", ".join(f"{name_of(g, q)} ({player(g, q)['char']['title']})" for q in occupants(g, d["cur"]["where"][pid]) if q != pid)
        prompt = (f"{bot_brief(g, p)}\nIt's {HOURS[g['hour']]}, you're in the {ROOM[d['cur']['where'][pid]]['name']} with {who_}. The conversation here:\n{log_}\n"
                  f"Answer in character: small talk, gossip about the will or the others, what you're doing here. {STYLE}")
    text = _bot_reply(g, prompt, random.choice(["Just passing through.", f"Lovely day for it, isn't it?", "I'd rather not say, darling."]))
    with LOCK:
        if g["phase"] == "room" and p["alive"] and f"{g['hour']}:{d['cur']['where'].get(pid)}" == key:
            room_say(g, p, text)
        typing_done(g, pid)


def agreed(g, plan):
    return f"Deal: the {ROOM[plan['room']]['name']} at {HOURS[plan['hour']]}{' tomorrow' if plan['day'] > g['day'] else ''}. I'll be there."


def bot_dm_reply(g, pid, to, plan=None):
    """A bot answers a private message; a dead bot answers a fellow ghost, in character and knowing what ghosts know."""
    with LOCK:
        p, other = player(g, pid), player(g, to)
        if not p or not other or p["alive"] != other["alive"]:
            return typing_done(g, pid)
        thread = [m for m in g["dms"] if {m["from"], m["to"]} == {pid, to}][-10:]
        log_ = "\n".join(f"{name_of(g, m['from'])}: {m['text']}" for m in thread)
        brief = bot_brief(g, p) if p["alive"] else ghost_brief(g, p)
        deal = f"They just asked you to meet: you've agreed to be in the {ROOM[plan['room']]['name']} at {HOURS[plan['hour']]}, and you really will go. Confirm it. " if plan else ""
        prompt = f"{brief}\nA private message thread with {name_of(g, to)} (only the two of you can see it):\n{log_}\n{deal}Reply privately. {STYLE}"
        lines = ["Can't talk now.", "Why are you asking me?", "Keep this between us, all right?"] if p["alive"] else GHOST_LINES
    text = _bot_reply(g, prompt, agreed(g, plan) if plan else random.choice(lines))
    with LOCK:
        dm(g, p, to, text)


def say(g, p, text, claim=None, **extra):
    d = today(g)
    msg = {"id": secrets.token_hex(3), "pid": p["pid"], "name": p["name"], "color": p["color"], "bot": p["bot"], "text": text, "t": now(), "ghost": not p["alive"], **extra}
    if claim:
        msg["claim"] = [{"hour": HOURS[int(i)], "room": ROOM[r]["name"]} for i, r in sorted(claim.items(), key=lambda kv: int(kv[0]))]
    d["chat"].append(msg)
    d["chat"] = d["chat"][-200:]
    typing_done(g, p["pid"])
    bump(g)


def note(g, p, text):
    """An anonymous note slipped under the door: nobody sees who wrote it."""
    p["noted"] = True
    d = today(g)
    d["chat"].append({"id": secrets.token_hex(3), "pid": "note", "name": "An anonymous note", "color": "#7d7466", "bot": False, "text": text, "t": now(), "ghost": False, "note": True})
    typing_done(g, p["pid"])
    bump(g)


def seance(g, p, text):
    """The Medium calls out to the dead, once a day. Dead bots answer with a riddle about the truth."""
    d = today(g)
    d.setdefault("seances", set()).add(p["pid"])
    d["chat"].append({"id": secrets.token_hex(3), "pid": "medium", "name": "The Medium", "color": "#8d6be0", "bot": False, "text": text, "t": now(),
                      "ghost": True, "medium": True})
    typing_done(g, p["pid"])
    bump(g)
    for q in random.sample([q for q in g["players"] if q["bot"] and not q["alive"]], min(2, sum(1 for q in g["players"] if q["bot"] and not q["alive"]))):
        typing(g, q["pid"], ("meet",))
        _spawn(bot_spirit_reply, g, q["pid"])


def spirit_hint(g):
    """Something true about a killer, in a riddle: where they were at some hour, or two coats one of which is theirs."""
    killers = [q for q in living(g) if q["role"] == "killer"] or [q for q in g["players"] if q["role"] == "killer"]
    k = random.choice(killers)
    seen = [(i, hr["where"][k["pid"]]) for d in g["days"][-1:] for i, hr in enumerate(d["hours"]) if k["pid"] in hr["where"]]
    if seen and random.random() < 0.7:
        i, room = random.choice(seen)
        return f"At {HOURS[i]}… the one you seek stood in the {ROOM[room]['name']}…"
    other = random.choice([q for q in g["players"] if q["pid"] != k["pid"]])
    pair = random.sample([color_name(g, k["pid"]), color_name(g, other["pid"])], 2)
    return f"A coat of {pair[0]}… or was it {pair[1]}… stained dark…"


def bot_spirit_reply(g, pid):
    with LOCK:
        p, d = player(g, pid), today(g)
        if not p or p["alive"] or not d:
            return typing_done(g, pid)
        hint = spirit_hint(g)
        prompt = (f"{ghost_brief(g, p)}\nThe Medium, a living guest, is holding a séance and asking the dead for help. Answer as a ghost in one eerie, "
                  f"cryptic line. Never say the killer's name. Work in this true clue: {hint} {STYLE}")
    text = _bot_reply(g, prompt, hint)
    with LOCK:
        if today(g) is d:
            say(g, p, text)
        typing_done(g, pid)


def accuse(g, p, target):
    """J'accuse! Once a meeting, point at someone in front of everyone. A bot you point at answers back."""
    d = today(g)
    d.setdefault("accused", {})[p["pid"]] = target["pid"]
    say(g, p, f"J'ACCUSE! I think it's {target['name']}.", accuse=target["name"])
    if target["bot"] and target["alive"]:
        typing(g, target["pid"], ("meet",))
        _spawn(bot_speak, g, target["pid"], "defend")


def room_say(g, p, text):
    d = today(g)
    key = f"{g['hour']}:{d['cur']['where'][p['pid']]}"
    d["roomchat"].setdefault(key, []).append({"id": secrets.token_hex(3), "pid": p["pid"], "name": p["name"], "color": p["color"], "bot": p["bot"], "text": text, "t": now()})
    typing_done(g, p["pid"])
    bump(g)
    return key


def dm(g, p, to, text):
    g["dms"].append({"id": secrets.token_hex(3), "from": p["pid"], "to": to, "name": p["name"], "text": text, "t": now()})
    g["dms"] = g["dms"][-400:]
    typing_done(g, p["pid"])
    bump(g)


# ---------- AI ----------
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")                # small, cheap, quick, and no hidden reasoning tokens to pay for
FALLBACK_MODEL = "gpt-4.1-mini"                                        # if the key can't use it: another small model, never a pricier one
EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "minimal")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "1500"))
GAME_LIMIT = int(os.environ.get("AI_GAME_LIMIT", "60"))                 # after this many AI lines in one game, bots use plain lines
_day = {"date": "", "n": 0, "tokens_in": 0, "tokens_out": 0}
_bad_models = set()


def _s(value, n):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value or ""))).strip()[:n]


def _ask_json(system, user, max_tokens):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("no key")
    today_ = time.strftime("%Y-%m-%d")
    if _day["date"] != today_:
        _day.update(date=today_, n=0, tokens_in=0, tokens_out=0)
    _day["n"] += 1
    if _day["n"] > DAILY_LIMIT:
        raise RuntimeError("daily limit")
    for model in [m for m in dict.fromkeys((MODEL, FALLBACK_MODEL)) if m not in _bad_models] or [FALLBACK_MODEL]:
        body = {"model": model, "max_completion_tokens": max_tokens, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if re.match(r"^(gpt-5|o\d)", model):
            body["reasoning_effort"] = EFFORT
        resp = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=(4, 10))
        if resp.status_code in (400, 403, 404) and "model" in resp.text.lower() and model != FALLBACK_MODEL:
            _bad_models.add(model)                                     # this key can't use it: use the fallback from now on
            continue
        resp.raise_for_status()
        out = resp.json()
        use = out.get("usage") or {}
        _day["tokens_in"] += use.get("prompt_tokens", 0)
        _day["tokens_out"] += use.get("completion_tokens", 0)
        return json.loads(out["choices"][0]["message"]["content"] or "{}")
    raise RuntimeError("no usable model")


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
    return jsonify(ai=bool(os.environ.get("OPENAI_API_KEY")), games=len(GAMES), queue=bool(QUEUE["code"] and QUEUE["code"] in GAMES), ice=_ice(),
                   ai_today={"calls": _day["n"], "tokens_in": _day["tokens_in"], "tokens_out": _day["tokens_out"], "limit": DAILY_LIMIT})


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
            else:                                                      # mid-game: a bot takes over your seat, so nobody waits for you
                p.update(left=True, bot=True, voice=False)
                if g["host"] == p["pid"]:
                    nxt = next((q for q in g["players"] if not q["bot"]), None)
                    g["host"] = nxt["pid"] if nxt else None
            bump(g)
        elif kind == "react" and d:
            emoji, mid = body.get("emoji"), body.get("id")
            msg = next((m for m in d["chat"] + [m for lst in d["roomchat"].values() for m in lst] if m["id"] == mid), None)
            if emoji not in REACTIONS or not msg:
                return _err("Can't react to that.")
            reactions = msg.setdefault("reactions", {})
            mine = [e for e, pids in reactions.items() if p["pid"] in pids]
            for e in mine:
                reactions[e].remove(p["pid"])
                if not reactions[e]:
                    del reactions[e]
            if emoji not in mine:                                      # same emoji again takes it back, another one swaps
                reactions.setdefault(emoji, []).append(p["pid"])
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
                a["sneak"] = bool(body.get("sneak"))
            if body.get("put") and carrying and HOME[carrying] == room:
                a["put"] = True
            if p["role"] == "killer" and body.get("strike"):
                a["strike"] = body["strike"]
            if p.get("job") == "detective" and body.get("investigate") and p["pid"] not in d.get("checked", {}):
                a["investigate"] = body["investigate"]
            d["acts"][p["pid"]] = a
            bump(g)
        elif kind == "cut" and p["alive"] and p["role"] == "killer":
            if not can_cut(g, body.get("room")):
                return _err("You can't cut the lights now: once a day, while everyone picks a room.")
            cut_lights(g, body["room"])
        elif kind == "guard" and g["phase"] in ("move", "room") and p["alive"] and p.get("job") == "doctor":
            target = player(g, body.get("target"))
            if p["pid"] in d.setdefault("guard", {}):
                return _err("You've already chosen today's patient.")
            if not target or target["pid"] == p["pid"] or not target["alive"]:
                return _err("Pick someone else who's alive.")
            d["guard"][p["pid"]] = target["pid"]
            bump(g)
        elif kind == "bell" and g["phase"] == "move" and p["alive"]:
            if p.get("belled") or d["showdown"] or g["hour"] == 0:
                return _err("You can ring the bell once a game, from 11 AM on.")
            p["belled"] = True
            d["bell"] = {"by": p["pid"], "hour": g["hour"]}
            d["chat"].append({"id": secrets.token_hex(3), "pid": "bell", "name": "The bell", "color": "#b3261e", "bot": False, "t": now(), "ghost": False, "bell": True,
                              "text": f"{p['name']} rang the bell at {HOURS[g['hour']]} and called everyone together."})
            if d["kill"] and not d["found"]:
                d["found"] = {"hour": None, "by": []}
                body_found(g)
            else:
                d["missing"] = missing(g)
                set_phase(g, "quiet", T["quiet"])
        elif kind == "haunt" and g["phase"] == "room" and not p["alive"]:
            if d.get("haunts", {}).get(p["pid"]) == g["hour"]:
                return _err("You've already rattled the house this hour.")
            if body.get("room") not in room_ids(g) or body.get("emoji") not in HAUNTS:
                return _err("Pick a room and a sign.")
            haunt(g, p, body["room"], body["emoji"])
        elif kind == "search" and g["phase"] == "talk" and p["alive"]:
            target = player(g, body.get("target"))
            if p.get("searched"):
                return _err("You've already searched someone this game.")
            if not target or target["pid"] == p["pid"] or not target["alive"]:
                return _err("Pick someone alive to search.")
            p["searched"] = True
            g["searches"].append({"by": p["pid"], "target": target["pid"], "found": g["carry"].get(target["pid"]), "day": g["day"]})
            bump(g)
        elif kind == "note" and g["phase"] == "talk" and p["alive"]:
            text = _s(body.get("text"), 200)
            if p.get("noted"):
                return _err("You've already sent your anonymous note this game.")
            if not text:
                return _err("Write something.")
            note(g, p, text)
        elif kind == "seance" and g["phase"] == "talk" and p["alive"] and p.get("job") == "medium":
            text = _s(body.get("text"), 200)
            if p["pid"] in d.get("seances", ()):
                return _err("One séance a day: the spirits need their rest.")
            if not any(not q["alive"] for q in g["players"]):
                return _err("Nobody has died yet. The other side is quiet… for now.")
            if not text:
                return _err("Ask the spirits something.")
            seance(g, p, text)
        elif kind == "roles" and g["phase"] == "lobby" and p["pid"] == g["host"]:
            role = body.get("role")
            if role not in JOBS:
                return _err("No such role.")
            on = set(g.get("roles", JOBS))
            on.add(role) if body.get("on") else on.discard(role)
            g["roles"] = [j for j in JOBS if j in on]
            bump(g)
        elif kind == "accuse" and g["phase"] == "talk" and p["alive"]:
            target = player(g, body.get("target"))
            if p["pid"] in d.get("accused", {}):
                return _err("You've already made your accusation this meeting.")
            if not target or target["pid"] == p["pid"] or not target["alive"]:
                return _err("Pick someone alive to accuse.")
            accuse(g, p, target)
        elif kind == "leave_room" and g["phase"] == "room" and p["alive"]:
            d.setdefault("leaving", set()).add(p["pid"])
            bump(g)
        elif kind == "room" and g["phase"] == "room" and p["alive"]:
            text = _s(body.get("text"), 200)
            if not text:
                return _err("Say something.")
            key = room_say(g, p, text)
            room = d["cur"]["where"][p["pid"]]
            bots = [q for q in occupants(g, room) if player(g, q)["bot"]]
            named = [q for q in bots if re.search(rf"\b{re.escape(name_of(g, q).lower())}\b", text.lower())]
            busy = {q for q, x in g.get("typing", {}).items() if x["ctx"] == ("room", key) and now() - x["t"] < 12}
            free = [q for q in bots if q not in busy]
            # every message gets an answer: whoever you named, else one of the bots here (sometimes two chime in)
            answer = [q for q in named if q in free] or random.sample(free, min(len(free), 2 if len(free) > 1 and random.random() < 0.3 else 1))
            for q in named or (bots if len(bots) == 1 else []):
                remember_meet(g, player(g, q), p, text)
            for q in answer:
                typing(g, q, ("room", key))
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
            answer_in_chat(g, d, p, text)
        elif kind == "typing":
            c = str(body.get("ctx") or "")
            ctx = (("meet",) if c == "meet" else ("dm", c[3:]) if c.startswith("dm:")
                   else ("room", f"{g['hour']}:{d['cur']['where'].get(p['pid'])}") if c == "room" and g["phase"] == "room" and d and d.get("cur") else None)
            if not ctx:
                return _err("Nothing to type into.")
            typing(g, p["pid"], ctx)
        elif kind == "dm":
            to = player(g, body.get("to"))
            text = _s(body.get("text"), 200)
            if not to or to["pid"] == p["pid"] or not text:
                return _err("Pick someone and write something.")
            if to["alive"] != p["alive"]:
                return _err("The living and the dead can't message each other.")
            dm(g, p, to["pid"], text)
            if to["bot"]:                                              # the dead answer the dead, too
                plan = remember_meet(g, to, p, text) if to["alive"] else None
                typing(g, to["pid"], ("dm", p["pid"]))
                _spawn(bot_dm_reply, g, to["pid"], p["pid"], plan)
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
