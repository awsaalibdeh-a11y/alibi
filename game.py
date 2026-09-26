"""Alibi: the killer is one of the players.

Everyone is a guest at Wrenmoor Manor, each on their own phone; one of them (two in a big game) is secretly a killer.
The day runs in hours. Every hour each player picks a room and something to do there; anyone can pick up an object
lying around. The killer, once armed, picks a target and a room to hunt them in; if that guess pays off and the
target really is there, they strike, whether or not anyone else is in the room too — a solo kill stays deniable, a
kill in front of others gets them found out on the spot. When the body is found, everybody looks back over the day
with only what they saw themselves (who was with them, who took what) and what's public (where the body lay, how
they died, what's missing), argues it out in the chat, and votes someone out.

The server is the only one who knows the truth. Each room lives in memory (one worker, no database); every phone
polls for its own view of it, which never includes anyone else's role. Phases move on when their clock runs out or
everyone has acted; there is no background loop, each request "ticks" the room forward. Bots play the same game:
they pick rooms, take things, the killer bot hunts, and in the chat they report their day (the killer bot lies) and
argue with AI, falling back to plain templates when AI is off.
"""

import json
import logging
import os
import random
import re
import secrets
import string
import threading
import time

import requests
from flask import Blueprint, jsonify, request

log = logging.getLogger("alibi")
bp = Blueprint("game", __name__)

# ---------- the manor ----------
ROOMS = [
    {"id": "library", "name": "Library", "emoji": "📚", "items": ["candlestick", "letter opener"], "acts": ["Read by the fire", "Dust the shelves"]},
    {"id": "kitchen", "name": "Kitchen", "emoji": "🍳", "items": ["kitchen knife", "rolling pin"], "acts": ["Bake bread", "Brew some tea"]},
    {"id": "garden", "name": "Garden", "emoji": "🌹", "items": ["garden shears", "rope"], "acts": ["Prune the roses", "Feed the koi"]},
    {"id": "cellar", "name": "Cellar", "emoji": "🍷", "items": ["wine bottle", "piano wire"], "acts": ["Pick a vintage", "Fix the boiler"]},
]
ROOM = {r["id"]: r for r in ROOMS}
HOME = {item: r["id"] for r in ROOMS for item in r["items"]}
KIND = {"candlestick": "blunt", "rolling pin": "blunt", "wine bottle": "blunt",
        "kitchen knife": "sharp", "garden shears": "sharp", "letter opener": "sharp", "rope": "cord", "piano wire": "cord"}
CAUSE = {"blunt": "struck on the head with something heavy", "sharp": "stabbed with something sharp", "cord": "strangled with a cord of some kind"}
HOURS = ["9 AM", "11 AM", "1 PM", "3 PM", "5 PM"]
COLORS = ["#e8c46a", "#6fb7e0", "#e27d8e", "#86cf8e", "#b9a6f0", "#f0a36b", "#5fd0c0", "#d9d9d9"]
BOT_NAMES = ["Rosa", "Theo", "Maggie", "Felix", "Ines", "Hugo", "Priya", "Otto", "Wren", "Basil", "Clara", "Jonah"]
MIN_PLAYERS, MAX_PLAYERS, QUEUE_SIZE = 4, 8, 6
T = {"countdown": 4, "roles": 9, "hour": 30, "body": 10, "quiet": 7, "talk": 120, "vote": 35, "result": 9, "queue": 30}
REACTIONS = ["👍", "😂", "😱", "🤔", "🔪"]
AWAY_SECS = 12                                                        # a phone that hasn't polled in this long is probably locked or backgrounded
TYPING_SECS = 4

LOCK = threading.RLock()
GAMES = {}
QUEUE = {"code": None}


def now():
    return time.time()


# ---------- rooms (games) ----------
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
         "players": [], "host": None, "day": 0, "hour": 0, "days": [], "items": {}, "carry": {}, "winner": None, "start_at": None}
    GAMES[g["code"]] = g
    return g


def bump(g):
    g["v"] += 1
    g["touched"] = now()


def add_player(g, name, bot=False):
    taken = {p["name"].lower() for p in g["players"]}
    base = name
    n = 2
    while name.lower() in taken:
        name = f"{base} {n}"
        n += 1
    p = {"pid": secrets.token_hex(4), "token": secrets.token_urlsafe(16), "name": name, "bot": bot, "color": COLORS[len(g["players"]) % len(COLORS)],
         "role": "guest", "alive": True, "ready": bot, "seen": now()}
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


def _weighted_sample(pool, weights, k):
    """random.sample, but some players are less likely to be drawn (still possible, just rarer)."""
    pool, weights = list(pool), list(weights)
    out = []
    for _ in range(k):
        pick = random.choices(range(len(pool)), weights=weights, k=1)[0]
        out.append(pool.pop(pick))
        weights.pop(pick)
    return out


# ---------- starting ----------
def start(g, favor_guest=None):
    while len(g["players"]) < MIN_PLAYERS:
        add_bot(g)
    n = len(g["players"])
    killers = 2 if n >= 7 else 1
    for p in g["players"]:
        p.update(role="guest", alive=True, ready=False, ejected=False, killed=None)
    weights = [0.35 if favor_guest and p["pid"] == favor_guest else 1.0 for p in g["players"]]
    for p in _weighted_sample(g["players"], weights, killers):
        p["role"] = "killer"
    g.update(day=0, days=[], winner=None)
    set_phase(g, "roles", T["roles"])


def new_day(g):
    g["day"] += 1
    g["hour"] = 0
    g["items"] = {item: HOME[item] for item in HOME}                 # the staff tidy up overnight
    g["carry"] = {}
    g["days"].append({"n": g["day"], "hours": [], "choices": {}, "kill": None, "found": None, "chat": [], "votes": {}, "ready": set(),
                      "claims": {}, "ejected": None, "bot_plan": [], "missing": [], "typing": {}})
    set_phase(g, "day", T["hour"])


def today(g):
    return g["days"][-1] if g["days"] else None


# ---------- the day ----------
def bot_choice(g, p):
    d, h = today(g), g["hour"]
    last = d["hours"][-1]["where"].get(p["pid"]) if d["hours"] else None
    carrying = g["carry"].get(p["pid"])
    if p["role"] == "killer":
        if not carrying:                                            # go where a weapon can be had
            options = [r for r in ROOMS if any(g["items"].get(i) == r["id"] for i in r["items"])]
            room = random.choice(options or ROOMS)["id"]
            here = [i for i in ROOM[room]["items"] if g["items"].get(i) == room]
            return {"room": room, "act": random.choice(ROOM[room]["acts"]), "take": random.choice(here) if here else None, "put": None, "strike": False, "target": None}
        victims = [q for q in living(g) if q["pid"] != p["pid"] and q["role"] != "killer"]
        target = random.choice(victims) if victims else None
        room = d["hours"][-1]["where"].get(target["pid"]) if target and d["hours"] and random.random() < 0.6 else None
        room = room or random.choice(ROOMS)["id"]                    # hunt where they were last seen, more often than not
        return {"room": room, "act": random.choice(ROOM[room]["acts"]), "take": None, "put": None, "strike": bool(target), "target": target["pid"] if target else None}
    room = last if last and random.random() < 0.35 else random.choice(ROOMS)["id"]
    take = put = None
    if carrying and HOME[carrying] == room and random.random() < 0.6:
        put = carrying
    elif not carrying and random.random() < 0.2:
        here = [i for i in ROOM[room]["items"] if g["items"].get(i) == room]
        take = random.choice(here) if here else None
    return {"room": room, "act": random.choice(ROOM[room]["acts"]), "take": take, "put": put, "strike": False}


def resolve_hour(g):
    d, h = today(g), g["hour"]
    alive = living(g)
    last = d["hours"][-1]["where"] if d["hours"] else {}
    choices = {}
    for p in alive:
        c = d["choices"].get(p["pid"])
        if not c:
            if p["bot"]:
                c = bot_choice(g, p)
            else:                                                      # didn't choose in time: they stay put
                room = last.get(p["pid"]) or random.choice(ROOMS)["id"]
                c = {"room": room, "act": ROOM[room]["acts"][0], "take": None, "put": None, "strike": False, "idle": True}
        choices[p["pid"]] = c
    where = {pid: c["room"] for pid, c in choices.items()}
    events = {r["id"]: [] for r in ROOMS}
    carried_at_start = dict(g["carry"])
    # objects go back first, then are taken (someone may put a thing back and another take it the same hour)
    for pid, c in choices.items():
        item = c.get("put")
        if item and g["carry"].get(pid) == item and HOME[item] == c["room"]:
            del g["carry"][pid]
            g["items"][item] = c["room"]
            events[c["room"]].append({"pid": pid, "text": f"put the {item} back", "item": item, "kind": "put"})
    order = list(choices.items())
    random.shuffle(order)
    for pid, c in order:
        item = c.get("take")
        if not item or g["carry"].get(pid) or HOME.get(item) != c["room"]:
            continue
        if g["items"].get(item) == c["room"]:
            g["items"][item] = None
            g["carry"][pid] = item
            events[c["room"]].append({"pid": pid, "text": f"took the {item}", "item": item, "kind": "take"})
        else:
            c["missed"] = item
    # the killer walks up to their target and strikes, if carrying a weapon and the target turns up where expected
    kill = None
    if not d["kill"]:
        for pid, c in order:
            killer = player(g, pid)
            target_pid = c.get("target")
            if killer["role"] != "killer" or not c.get("strike") or not target_pid or not carried_at_start.get(pid):
                continue
            target = player(g, target_pid)
            if not target or not target["alive"] or target["role"] == "killer" or where.get(target_pid) != c["room"]:
                continue                                               # the gamble didn't pay off: they weren't there
            weapon = carried_at_start[pid]
            target["alive"] = False
            target["killed"] = {"day": g["day"], "hour": h, "room": c["room"], "by": pid, "weapon": weapon}
            witnesses = [q for q, room in where.items() if room == c["room"] and q not in (pid, target_pid)]
            kill = d["kill"] = {"victim": target["pid"], "killer": pid, "room": c["room"], "hour": h, "weapon": weapon, "witnesses": witnesses}
            break
    # anyone else in the room sees it happen right away; otherwise the body waits to be walked in on
    found = None
    if d["kill"] and not d["found"]:
        if d["kill"]["hour"] == h and d["kill"]["witnesses"]:
            found = d["found"] = {"hour": h, "by": d["kill"]["witnesses"]}
        elif d["kill"]["hour"] < h:
            finders = [q for q, room in where.items() if room == d["kill"]["room"] and player(g, q)["alive"]]
            if finders:
                found = d["found"] = {"hour": h, "by": finders}
    d["hours"].append({"where": where, "choices": choices, "events": events})
    d["choices"] = {}
    if found:
        return body_found(g)
    if h + 1 >= len(HOURS):
        if d["kill"]:
            d["found"] = {"hour": None, "by": []}
            return body_found(g)
        d["missing"] = missing(g)
        return set_phase(g, "quiet", T["quiet"])
    g["hour"] = h + 1
    set_phase(g, "day", T["hour"])


def missing(g):
    return sorted(i for i, at in g["items"].items() if at != HOME[i])


def body_found(g):
    d = today(g)
    d["missing"] = missing(g)
    set_phase(g, "body", T["body"])


def begin_talk(g):
    if winner(g):
        return game_over(g)
    d = today(g)
    d["ready"] = set()
    set_phase(g, "talk", T["talk"])
    t0 = now()
    for p in living(g):                                                # bots speak up quickly, at their own pace
        if p["bot"]:
            d["bot_plan"].append({"at": t0 + random.uniform(1, 4), "pid": p["pid"], "kind": "claim"})
            for _ in range(random.choice([1, 2])):
                d["bot_plan"].append({"at": t0 + random.uniform(5, max(8, T["talk"] - 10)), "pid": p["pid"], "kind": "talk"})


def winner(g):
    killers = [p for p in living(g) if p["role"] == "killer"]
    guests = [p for p in living(g) if p["role"] != "killer"]
    if not killers:
        return "guests"
    if len(killers) >= len(guests):
        return "killers"
    return None


def game_over(g):
    g["winner"] = winner(g)
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
    """How much this player distrusts each other living player: from what they saw against what was claimed, and the chat."""
    d = today(g)
    score = {q["pid"]: 0.0 for q in living(g) if q["pid"] != me["pid"]}
    mine = {i: hr["where"].get(me["pid"]) for i, hr in enumerate(d["hours"])}
    for q in score:
        claim = d["claims"].get(q)
        if not claim:
            score[q] += 0.5                                            # hasn't shared yet: a little suspicious, not a dead giveaway
            continue
        for i, hr in enumerate(d["hours"]):
            said, truly_here = claim.get(str(i)), hr["where"].get(q)
            if mine.get(i) is None or said is None:
                continue
            if said == mine[i] and truly_here != mine[i]:
                score[q] += 3                                          # says they were with me; they weren't
            if truly_here == mine[i] and said != mine[i]:
                score[q] += 3                                          # I saw them here; they say elsewhere
        k = d["kill"]
        if k and claim.get(str(k["hour"])) == k["room"]:
            score[q] += 1
    for msg in d["chat"][-30:]:
        if msg.get("ghost") or msg["pid"] == me["pid"]:
            continue
        for q in score:
            name = player(g, q)["name"].lower()
            if re.search(rf"\b{re.escape(name)}\b", msg["text"].lower()):
                score[q] += 0.5
    return score


def bot_vote(g, p):
    s = suspicion(g, p)
    if not s:
        return "skip"
    if p["role"] == "killer":
        s = {q: v for q, v in s.items() if player(g, q)["role"] != "killer"} or s
        return max(s, key=lambda q: s[q] + random.random())
    best = max(s, key=lambda q: s[q] + random.random() * 1.2)          # enough jitter that bots don't all pile onto the same lone suspect
    return best if s[best] >= 2 else "skip"


# ---------- what each phone may see ----------
def my_day(g, p, d):
    """The day as this player lived it: where they were, who they saw, what they saw taken."""
    out = []
    for i, hr in enumerate(d["hours"]):
        room = hr["where"].get(p["pid"])
        if room is None:
            continue
        c = hr["choices"].get(p["pid"], {})
        saw = [player(g, q)["name"] for q, r in hr["where"].items() if r == room and q != p["pid"]]
        ev = [f"{'You' if e['pid'] == p['pid'] else player(g, e['pid'])['name']} {e['text']}." for e in hr["events"][room]]
        if c.get("missed"):
            ev.append(f"You looked for the {c['missed']}, but it was already gone.")
        if d["kill"] and d["kill"]["hour"] == i:
            if d["kill"]["killer"] == p["pid"] or (p["role"] == "killer" and d["kill"]["room"] == room):
                ev.append(f"{player(g, d['kill']['victim'])['name']} died here, by your hand." if d["kill"]["killer"] == p["pid"] else "")
            if d["kill"]["victim"] == p["pid"]:
                ev.append(f"{player(g, d['kill']['killer'])['name']} killed you here with the {d['kill']['weapon']}.")
        if d["found"] and d["found"]["hour"] == i and p["pid"] in d["found"]["by"]:
            ev.append(f"You found {player(g, d['kill']['victim'])['name']}'s body!")
        out.append({"hour": HOURS[i], "i": i, "room": room, "act": c.get("act", ""), "saw": saw, "events": [e for e in ev if e], "idle": bool(c.get("idle"))})
    return out


def view(g, p):
    d = today(g)
    dead = not p["alive"]
    over = g["phase"] == "over"
    killer = p["role"] == "killer"
    pub_players = []
    for q in g["players"]:
        e = {"pid": q["pid"], "name": q["name"], "bot": q["bot"], "color": q["color"], "alive": q["alive"], "ready": q["ready"],
             "host": q["pid"] == g["host"], "ejected": q.get("ejected", False),
             "away": (not q["bot"]) and q["alive"] and (now() - q.get("seen", now()) > AWAY_SECS)}
        if over or q["pid"] == p["pid"] or (killer and q["role"] == "killer") or (not q["alive"] and q.get("ejected")) or dead:
            e["role"] = q["role"]                                      # your own role, fellow killers, the ejected, and ghosts see everything
        if d and g["phase"] in ("talk", "vote", "result"):
            e["claimed"] = q["pid"] in d["claims"]
            e["voted"] = q["pid"] in d["votes"]
            e["readyToVote"] = q["pid"] in d["ready"]
        pub_players.append(e)
    v = {"code": g["code"], "public": g["public"], "v": g["v"], "now": now(), "phase": g["phase"], "deadline": g["deadline"], "start_at": g["start_at"],
         "day": g["day"], "hour": g["hour"], "hours": HOURS, "rooms": ROOMS, "players": pub_players, "winner": g["winner"],
         "me": {"pid": p["pid"], "name": p["name"], "role": p["role"], "alive": p["alive"], "host": p["pid"] == g["host"], "carrying": g["carry"].get(p["pid"]),
                "killed": p.get("killed"), "ejected": p.get("ejected", False)}}
    if d:
        v["myday"] = my_day(g, p, d)
        v["chosen"] = d["choices"].get(p["pid"])
        v["chat"] = [m for m in d["chat"] if dead or over or not m.get("ghost")][-80:]
        v["myvote"] = d["votes"].get(p["pid"])
        v["readyToVote"] = p["pid"] in d["ready"]
        v["typing"] = [player(g, q)["name"] for q, ts in d.get("typing", {}).items()
                        if q != p["pid"] and now() - ts < TYPING_SECS and player(g, q) and (over or dead or player(g, q)["alive"])]
        if g["phase"] == "day":
            v["decided"] = [q for q in d["choices"]]
        if g["phase"] in ("body", "talk", "vote", "result", "over", "quiet") or d["found"]:
            k = d["kill"]
            if k and (d["found"] or over):
                f = d["found"] or {}
                v["body"] = {"victim": player(g, k["victim"])["name"], "room": ROOM[k["room"]]["name"], "roomId": k["room"], "hour": HOURS[k["hour"]],
                             "cause": CAUSE[KIND[k["weapon"]]], "foundBy": [player(g, q)["name"] for q in f.get("by", [])],
                             "foundAt": HOURS[f["hour"]] if f.get("hour") is not None else "dusk"}
            v["missing"] = [{"item": i, "room": ROOM[HOME[i]]["name"]} for i in d["missing"]]
        if g["phase"] in ("result", "over") and "tally" in d:
            v["tally"] = {("skip" if k == "skip" else player(g, k)["name"]): n for k, n in d["tally"].items()}
            ej = d.get("ejected")
            v["ejected"] = {"name": player(g, ej)["name"], "role": player(g, ej)["role"]} if ej else None
        if killer and g["phase"] == "day":
            v["fellow"] = [q["name"] for q in g["players"] if q["role"] == "killer" and q["pid"] != p["pid"]]
    if over:
        v["truth"] = truth(g)
        v["awards"] = awards(g)
    return v


def awards(g):
    """A few fun superlatives for the end screen: nothing here affects the game, just bragging rights."""
    votes = {p["pid"]: 0 for p in g["players"]}
    msgs = {p["pid"]: 0 for p in g["players"]}
    for d in g["days"]:
        for target in d["votes"].values():
            if target in votes:
                votes[target] += 1
        for m in d["chat"]:
            if not m.get("ghost") and m["pid"] in msgs:
                msgs[m["pid"]] += 1
    out = []
    if any(votes.values()):
        suspect = max(votes, key=votes.get)
        out.append({"emoji": "🔍", "title": "Prime Suspect", "name": player(g, suspect)["name"],
                    "detail": f"{votes[suspect]} vote{'s' if votes[suspect] != 1 else ''} against them"})
        killers = [pid for pid in votes if player(g, pid)["role"] == "killer"]
        if killers:
            face = min(killers, key=votes.get)
            out.append({"emoji": "🎭", "title": "Best Poker Face", "name": player(g, face)["name"],
                        "detail": f"the killer, and only {votes[face]} vote{'s' if votes[face] != 1 else ''} all game"})
    if any(msgs.values()):
        chatty = max(msgs, key=msgs.get)
        quiet = min(msgs, key=msgs.get)
        out.append({"emoji": "💬", "title": "Chatterbox", "name": player(g, chatty)["name"], "detail": f"{msgs[chatty]} messages sent"})
        if msgs[quiet] < msgs[chatty]:
            out.append({"emoji": "🤫", "title": "Man of Mystery", "name": player(g, quiet)["name"],
                        "detail": "didn't say a word" if not msgs[quiet] else f"only {msgs[quiet]} messages"})
    return out


def truth(g):
    """Everything, for the end: every day, hour by hour, who was where and what they did."""
    out = []
    for d in g["days"]:
        grid = []
        for i, hr in enumerate(d["hours"]):
            grid.append({"hour": HOURS[i], "rows": [{"name": player(g, q)["name"], "room": ROOM[r]["name"],
                                                    "did": "; ".join(e["text"] for e in hr["events"][r] if e["pid"] == q)} for q, r in hr["where"].items()]})
        k = d["kill"]
        out.append({"n": d["n"], "grid": grid, "kill": {"victim": player(g, k["victim"])["name"], "killer": player(g, k["killer"])["name"], "room": ROOM[k["room"]]["name"],
                                                      "hour": HOURS[k["hour"]], "weapon": k["weapon"]} if k else None})
    return out


# ---------- the clock ----------
def tick(g):
    """Move a room on: expired clocks, everyone having acted, bots' planned chat. Called on every request."""
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
    if g["phase"] == "day":
        waiting = [p for p in humans(g, alive_only=True) if p["pid"] not in d["choices"]]
        if t >= g["deadline"] or not waiting:
            resolve_hour(g)
        return
    if g["phase"] == "talk":
        for plan in [x for x in d["bot_plan"] if x["at"] <= t and not x.get("done")]:
            plan["done"] = True
            threading.Thread(target=bot_speak, args=(g, plan["pid"], plan["kind"]), daemon=True).start()
        if t >= g["deadline"] or all(p["pid"] in d["ready"] for p in humans(g, alive_only=True)):
            bot_votes_later(g)
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
            else:
                new_day(g)


def bot_votes_later(g):
    d = today(g)
    d["vote_plan"] = [{"at": now() + random.uniform(1, 6), "pid": p["pid"]} for p in living(g) if p["bot"]]


# ---------- bots in the chat ----------
def claim_for(g, p):
    """What a player says they did: the truth, unless they're the killer, who moves themselves away from the crime."""
    d = today(g)
    claim = {str(i): hr["where"][p["pid"]] for i, hr in enumerate(d["hours"]) if p["pid"] in hr["where"]}
    k = d["kill"]
    if p["role"] == "killer":
        if k and k["killer"] == p["pid"]:
            claim[str(k["hour"])] = random.choice([r["id"] for r in ROOMS if r["id"] != k["room"]])
        for i, hr in enumerate(d["hours"]):                            # and never admits carrying the weapon's room
            if random.random() < 0.15:
                claim[str(i)] = random.choice(ROOMS)["id"]
    return claim


def claim_text(claim):
    return " · ".join(f"{HOURS[int(i)]} {ROOM[r]['name']}" for i, r in sorted(claim.items(), key=lambda kv: int(kv[0])))


BOT_PROMPT = """You are {name}, a guest at a manor in a murder party game played by friends in a group chat (like Among Us). {role_line}
Today's facts everyone knows: {public}
What you personally saw today, hour by hour: {seen}
{lie_line}
The chat so far (latest last):
{chat}

Write your next chat message: 1-2 short, casual sentences (max 200 characters), like a real player texting. React to what others said, point out contradictions with what you saw, defend yourself if accused, or name who you suspect and why. No emojis overload, no hashtags. Reply as JSON: {{"say": "..."}}"""


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
            say(g, p, f"My day: {claim_text(claim)}", claim=claim)
            return
        k = d["kill"]
        public = (f"{player(g, k['victim'])['name']} was found dead in the {ROOM[k['room']]['name']}, killed around {HOURS[k['hour']]}, {CAUSE[KIND[k['weapon']]]}. "
                  if k else "Nobody died today, but a killer is among us. ") + ("Missing objects: " + ", ".join(d["missing"]) + "." if d["missing"] else "Nothing is missing.")
        seen = "; ".join(f"{e['hour']} in the {ROOM[e['room']]['name']} with {', '.join(e['saw']) or 'nobody'}" + (f" ({' '.join(e['events'])})" if e["events"] else "")
                         for e in my_day(g, p, d))
        chat = "\n".join(f"{m['name']}: {m['text']}" for m in d["chat"][-14:] if not m.get("ghost")) or "(nobody has said anything yet)"
        role_line = "You are secretly the KILLER. Never admit it; deflect suspicion onto someone else, calmly." if p["role"] == "killer" else "You are an innocent guest trying to find the killer."
        lie_line = f"The day you told everyone (keep to it): {claim_text(d['claims'].get(pid, {}))}." if p["role"] == "killer" and pid in d["claims"] else ""
        prompt = BOT_PROMPT.format(name=p["name"], role_line=role_line, public=public, seen=seen or "nothing", lie_line=lie_line, chat=chat)
    text = ""
    try:
        text = _s(_ask_json("You play a guest in a social-deduction party game. Output only JSON.", prompt, 300).get("say"), 200)
    except Exception as exc:                                           # AI off or slow: a plain line still keeps the bot in the game
        log.info("bot chat fallback: %s", exc)
    with LOCK:
        if g["phase"] != "talk" or not p["alive"]:
            return
        if not text:
            s = suspicion(g, p)
            top = max(s, key=s.get) if s else None
            text = (f"Something's off about {player(g, top)['name']}'s story." if top and s[top] >= 2 else
                    random.choice(["I'm not sure yet. Who was near the body?", "Everyone post your day, please.", "Who took the missing stuff?"]))
        say(g, p, text)


def say(g, p, text, claim=None):
    d = today(g)
    msg = {"id": secrets.token_hex(3), "pid": p["pid"], "name": p["name"], "color": p["color"], "bot": p["bot"], "text": text, "t": now(), "ghost": not p["alive"]}
    if claim:
        msg["claim"] = [{"hour": HOURS[int(i)], "room": ROOM[r]["name"]} for i, r in sorted(claim.items(), key=lambda kv: int(kv[0]))]
    d["chat"].append(msg)
    d["chat"] = d["chat"][-200:]
    bump(g)


# ---------- AI ----------
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5")
EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "minimal")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "3000"))
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


# ---------- endpoints ----------
def _err(msg, status=400):
    return jsonify(error=msg), status


def _clean_name(raw):
    name = re.sub(r"[^\w .'-]", "", str(raw or ""), flags=re.UNICODE).strip()[:16]
    return name or "Guest"


@bp.get("/api/status")
def status():
    return jsonify(ai=bool(os.environ.get("OPENAI_API_KEY")), games=len(GAMES), queue=bool(QUEUE["code"] and QUEUE["code"] in GAMES))


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
            start(g, favor_guest=p["pid"])
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
    body = request.get_json(silent=True) or {} if request.method == "POST" else request.args
    p = player(g, body.get("pid"))
    if not p or p["token"] != body.get("token"):
        return None, None, _err("You're not in this game.", 403)
    p["seen"] = now()
    return g, p, None


@bp.get("/api/game/<code>")
def state(code):
    with LOCK:
        g, p, err = _auth(code)
        if err:
            return err
        tick(g)
        if request.args.get("v") == str(g["v"]):
            return jsonify(same=True, v=g["v"], now=now())
        return jsonify(view(g, p))


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
        if kind == "ready" and g["phase"] == "lobby":
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
        elif kind == "choose" and g["phase"] == "day" and p["alive"]:
            room = body.get("room")
            if room not in ROOM:
                return _err("Pick a room.")
            carrying = g["carry"].get(p["pid"])
            take = body.get("take") if body.get("take") in ROOM[room]["items"] and not carrying else None
            put = carrying if body.get("put") and carrying and HOME[carrying] == room else None
            act_ = body.get("act") if body.get("act") in ROOM[room]["acts"] else ROOM[room]["acts"][0]
            target = player(g, body.get("target"))
            valid_target = p["role"] == "killer" and target and target["alive"] and target["pid"] != p["pid"] and target["role"] != "killer"
            d["choices"][p["pid"]] = {"room": room, "act": act_, "take": take, "put": put,
                                       "strike": bool(body.get("strike")) and valid_target, "target": target["pid"] if valid_target else None}
            bump(g)
        elif kind == "chat" and g["phase"] in ("talk", "vote", "result", "body", "quiet", "day", "over"):
            text = _s(body.get("text"), 200)
            if not d or not text:
                return _err("Say something.")
            last = [m for m in d["chat"] if m["pid"] == p["pid"]]
            if last and now() - last[-1]["t"] < 1:
                return _err("Slow down a little.", 429)
            if p["alive"] and g["phase"] == "day":
                return _err("No talking during the day: wait until the body is found.")
            say(g, p, text)
        elif kind == "typing" and d:
            d["typing"][p["pid"]] = now()
            bump(g)
        elif kind == "react" and d:
            emoji, mid = body.get("emoji"), body.get("id")
            if emoji not in REACTIONS:
                return _err("Not a reaction.")
            msg = next((m for m in d["chat"] if m["id"] == mid), None)
            if not msg or (msg.get("ghost") and p["alive"] and g["phase"] != "over"):
                return _err("Can't react to that.")
            mine = [e for e, pids in msg.get("reactions", {}).items() if p["pid"] in pids]
            reactions = msg.setdefault("reactions", {})
            for e in mine:
                reactions[e].remove(p["pid"])
                if not reactions[e]:
                    del reactions[e]
            if emoji not in mine:
                reactions.setdefault(emoji, []).append(p["pid"])
            bump(g)
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
            g.update(days=[], day=0, winner=None)
            set_phase(g, "lobby")
        else:
            return _err("You can't do that right now.", 409)
        tick(g)
        return jsonify(view(g, p))
