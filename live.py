"""First person: Wrenmoor Manor as a house you walk around, live.

The classic game plays each hour in two steps (pick a room, then see who came). Here there are no steps: the day is
five hours of real time and everyone walks the house at once. You see the people in the same room as you (the server
never sends anyone you couldn't see), watch them come and go, pick things up and put them back, and you can lock the
door behind you for a little while. Whoever is facing you sees what you do; whoever is looking the other way doesn't.
The killer, once armed, walks up to someone and strikes. A body lies where it fell until someone reports it, or it's
found at dusk.

Each hour is still written down the classic way (the room you spent most of it in, who you ran into, what you saw),
so the meeting, the claims, the bots' suspicions, the vote and the truth at the end work unchanged. The story beats
still happen: a dark room hides who's in it, and rain keeps everyone out of the garden.
"""

import math
import random
import secrets
from functools import lru_cache

import game as G

ROOM_W, ROOM_H = 7, 5
WALK, BOT_WALK, RADIUS = 2.6, 2.1, 0.22
REACH, KILL_REACH = 1.4, 1.5
SIGHT = math.radians(62)          # half of what you can see ahead of you
NEAR = 1.3                        # this close, you notice whatever someone does, whichever way you're facing
LOCK_SECS, LOCK_COOLDOWN = 15, 25
SHOWDOWN_REST = 25                # the last day: a killer needs a breather between strikes


# ---------- the house ----------
@lru_cache(maxsize=16)
def layout(ids):
    """A floor plan for these rooms: half along the top, half along the bottom, a hall between them, one door each."""
    cols = (len(ids) + 1) // 2
    width, height = 1 + cols * (ROOM_W + 1), 2 * ROOM_H + 6
    grid = [["#"] * width for _ in range(height)]
    for x in range(1, width - 1):
        grid[ROOM_H + 2][x] = grid[ROOM_H + 3][x] = "h"
    legend, doors, boxes, spots = {"h": "hall"}, {}, {}, {}
    for i, room in enumerate(ids):
        top = i < cols
        x0, y0 = 1 + (i if top else i - cols) * (ROOM_W + 1), 1 if top else ROOM_H + 5
        ch = "ABCDEF"[i]
        for y in range(y0, y0 + ROOM_H):
            for x in range(x0, x0 + ROOM_W):
                grid[y][x] = ch
        dx, dy = x0 + ROOM_W // 2, y0 + ROOM_H if top else y0 - 1
        grid[dy][dx] = ch.lower()
        legend[ch] = legend[ch.lower()] = room
        doors[room] = (dx, dy)
        boxes[room] = (x0, y0, x0 + ROOM_W, y0 + ROOM_H)
        wall = y0 + 0.6 if top else y0 + ROOM_H - 0.6                   # the things in a room sit against its far wall
        first, second = G.ROOM[room]["items"]
        spots[first], spots[second] = (x0 + 1.5, wall), (x0 + ROOM_W - 1.5, wall)
    return {"map": ["".join(r) for r in grid], "legend": legend, "doors": doors, "boxes": boxes, "spots": spots,
            "w": width, "h": height, "hall": ROOM_H + 2}


def lay(g):
    return layout(tuple(G.room_ids(g)))


def info(g):
    """The floor plan for a phone: static for the whole game."""
    ly = lay(g)
    return {"map": ly["map"], "legend": ly["legend"], "doors": {r: list(xy) for r, xy in ly["doors"].items()},
            "spots": {i: list(xy) for i, xy in ly["spots"].items()}, "walk": WALK, "radius": RADIUS, "reach": REACH, "killReach": KILL_REACH}


def cell(ly, x, y):
    xi, yi = math.floor(x), math.floor(y)
    return ly["map"][yi][xi] if 0 <= yi < ly["h"] and 0 <= xi < ly["w"] else "#"


def place_at(ly, x, y):
    return ly["legend"].get(cell(ly, x, y))


def hour_len(d):
    """A minute an hour; the final showdown is a shorter, tenser day to survive."""
    return G.T["walk_hour"] * (0.4 if d["showdown"] else 1)


def day_len(d):
    return hour_len(d) * len(G.HOURS)


def hour_now(d):
    return min(len(G.HOURS) - 1, int((G.now() - d["live"]["start"]) / hour_len(d)))


def beat_now(d):
    return d["beats"][hour_now(d)]


def dark(d, place):
    b = beat_now(d)
    return b.get("fx") == "dark" and b.get("room") == place


def locked(d, room):
    """A locked door keeps people out (whoever's inside can always walk out). Rain keeps everyone out of the garden."""
    lk = d["live"]["locks"].get(room)
    b = beat_now(d)
    return bool(lk and lk["until"] > G.now()) or (b.get("fx") == "rain" and b.get("room") == room)


def solid(g, d, x, y, ghost=False, inside=None):
    ly = lay(g)
    if ghost:
        return not (0.3 < x < ly["w"] - 0.3 and 0.3 < y < ly["h"] - 0.3)
    ch = cell(ly, x, y)
    if ch == "#":
        return True
    room = ly["legend"].get(ch) if ch.islower() and ch != "h" else None
    return bool(room and room != inside and locked(d, room))


def free(g, d, x, y, ghost=False, inside=None):
    return not any(solid(g, d, x + dx, y + dy, ghost, inside) for dx in (-RADIUS, RADIUS) for dy in (-RADIUS, RADIUS))


def _xy(pos):
    return (pos["x"], pos["y"]) if isinstance(pos, dict) else pos


def _dist(a, b):
    (ax, ay), (bx, by) = _xy(a), _xy(b)
    return math.hypot(ax - bx, ay - by)


# ---------- a day ----------
def begin(g, d):
    """Morning: everyone starts in the hall; the staff have put everything back where it belongs."""
    t, ly = G.now(), lay(g)
    people = list(g["players"])
    random.shuffle(people)
    pos, loc = {}, {}
    for i, p in enumerate(people):
        y = ly["hall"] + 0.5 + i % 2
        x = 1.6 + (i * 1.9) % (ly["w"] - 3.2)
        pos[p["pid"]] = {"x": x, "y": y, "a": 0.0 if x < ly["w"] / 2 else math.pi, "t": t}   # looking down the hall, at the doors
        loc[p["pid"]] = "hall"
    d["live"] = {"start": t, "last": t, "pos": pos, "loc": loc, "room": {}, "locks": {}, "cooldown": {}, "bots": {},
                 "dwell": [{} for _ in G.HOURS], "met": [{} for _ in G.HOURS], "log": {p["pid"]: [] for p in people},
                 "events": [], "took": {}, "bodies": [], "chat": [], "seq": 0,
                 "mask": {p["pid"]: secrets.token_hex(3) for p in people}}   # who a shape in the dark really is, for the server only


def present(g, d, place):
    """The living people in a place right now."""
    return [q["pid"] for q in g["players"] if q["alive"] and d["live"]["loc"].get(q["pid"]) == place]


def sees(d, viewer, actor):
    """Could this person see what that one just did? Facing them, or right next to them."""
    a, b = d["live"]["pos"][viewer], d["live"]["pos"][actor]
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    if math.hypot(dx, dy) < NEAR:
        return True
    return abs((math.atan2(dy, dx) - a["a"] + math.pi) % (2 * math.pi) - math.pi) <= SIGHT


def witnesses(g, d, place, actor, also=()):
    if dark(d, place):
        return []
    return [q for q in present(g, d, place) if q != actor and q not in also and sees(d, q, actor)]


def note(g, d, who, text, kind="info", item=None):
    """Something happened in front of these people: it goes into their memory of the day and their live feed."""
    L = d["live"]
    L["seq"] += 1
    h, t = hour_now(d), G.now()
    for pid in who:
        L["log"].setdefault(pid, []).append({"id": L["seq"], "h": h, "t": t, "text": text(pid) if callable(text) else text, "kind": kind, "item": item})


def set_pos(g, d, p, x, y, a):
    L, ly = d["live"], lay(g)
    pid = p["pid"]
    L["pos"][pid] = {"x": x, "y": y, "a": a, "t": G.now()}
    new, old = place_at(ly, x, y), L["loc"].get(pid)
    if not new or new == old:
        return
    L["loc"][pid] = new
    if new != "hall":
        L["room"][pid] = new
    G.bump(g)                                                          # who's with whom changed: voice and views follow
    if not p["alive"]:
        return
    name = p["name"]
    if old:
        gone = [q for q in present(g, d, old) if q != pid]
        note(g, d, gone, "Someone slipped out." if dark(d, old) else f"{name} went into the {G.ROOM[new]['name']}." if old == "hall" and new in G.ROOM else f"{name} left.", "move")
    here = [q for q in present(g, d, new) if q != pid]
    note(g, d, here, "Someone came in." if dark(d, new) else f"{name} came out of the {G.ROOM[old]['name']}." if new == "hall" and old in G.ROOM else f"{name} walked in.", "move")


def move(g, d, p, x, y, a):
    """A phone says where its player has walked: accepted if it's a step they could really have taken."""
    L = d["live"]
    cur = L["pos"][p["pid"]]
    try:
        x, y, a = float(x), float(y), float(a)
    except (TypeError, ValueError):
        return False
    if not all(math.isfinite(v) for v in (x, y, a)):
        return False
    ghost, inside = not p["alive"], L["loc"].get(p["pid"])
    limit = WALK * max(0.05, G.now() - cur["t"]) * 1.6 + 0.35
    mid = ((x + cur["x"]) / 2, (y + cur["y"]) / 2)
    if math.hypot(x - cur["x"], y - cur["y"]) > limit or not free(g, d, x, y, ghost, inside) or not free(g, d, *mid, ghost, inside):
        cur["t"] = G.now()
        return False
    set_pos(g, d, p, x, y, a % (2 * math.pi))
    return True


# ---------- doing things ----------
def take(g, d, p, item):
    L, ly = d["live"], lay(g)
    pid = p["pid"]
    if not p["alive"]:
        return "Ghosts can't pick things up."
    if g["carry"].get(pid):
        return "Your hands are full."
    room = G.HOME.get(item)
    if item not in ly["spots"] or g["items"].get(item) != room:
        return "It's not there any more."
    if L["loc"].get(pid) != room or _dist(L["pos"][pid], ly["spots"][item]) > REACH:
        return "Get closer to it first."
    g["items"][item] = None
    g["carry"][pid] = item
    h = hour_now(d)
    L["took"][f"{h}:{pid}"] = item
    seen = witnesses(g, d, room, pid)
    L["events"].append({"h": h, "room": room, "pid": pid, "text": f"took the {item}" if seen else f"quietly took the {item}", "item": item, "kind": "take", "sneak": not seen})
    note(g, d, [pid], f"You took the {item}." + ("" if seen else " Nobody was looking."), "take", {"who": "You", "item": item, "kind": "take", "sneak": not seen})
    note(g, d, seen, f"{p['name']} took the {item}.", "take", {"who": p["name"], "item": item, "kind": "take", "sneak": False})
    G.bump(g)


def put(g, d, p):
    L, ly = d["live"], lay(g)
    pid = p["pid"]
    item = g["carry"].get(pid)
    if not p["alive"] or not item:
        return "You're not carrying anything."
    room = G.HOME[item]
    if L["loc"].get(pid) != room or _dist(L["pos"][pid], ly["spots"][item]) > REACH + 0.6:
        return f"The {item} belongs in the {G.ROOM[room]['name']}."
    del g["carry"][pid]
    g["items"][item] = room
    h = hour_now(d)
    L["events"].append({"h": h, "room": room, "pid": pid, "text": f"put the {item} back", "item": item, "kind": "put"})
    seen = witnesses(g, d, room, pid)
    note(g, d, [pid], f"You put the {item} back.", "put", {"who": "You", "item": item, "kind": "put"})
    note(g, d, seen, f"{p['name']} put the {item} back.", "put", {"who": p["name"], "item": item, "kind": "put"})
    G.bump(g)


def resolve(d, token):
    """The pid behind an id a phone sent: a real one, or the mask of a shape in the dark."""
    return next((pid for pid, m in d["live"]["mask"].items() if m == token), token)


def strike(g, d, p, target):
    L = d["live"]
    pid, target = p["pid"], resolve(d, target)
    weapon, here, victim = g["carry"].get(pid), L["loc"].get(pid), G.player(g, target)
    if p["role"] != "killer" or not p["alive"]:
        return "You can't do that."
    if d["kill"] and not d["showdown"]:
        return "Not again today. Lie low."
    if resting(d, pid):
        return "Catch your breath first."
    if not weapon:
        return "You need a weapon first."
    if here not in G.ROOM:
        return "Too exposed out here in the hall."
    if not victim or not victim["alive"] or victim["role"] == "killer" or L["loc"].get(target) != here or _dist(L["pos"][pid], L["pos"][target]) > KILL_REACH:
        return "Get closer first."
    h = hour_now(d)
    seen = witnesses(g, d, here, pid, also=[target])
    heard = [q for q in present(g, d, here) if q not in seen and q not in (pid, target)]
    victim["alive"] = False
    victim["killed"] = {"day": g["day"], "hour": h, "room": here, "by": pid, "weapon": weapon}
    L.setdefault("struck", {})[pid] = G.now()
    k = {"victim": target, "killer": pid, "room": here, "hour": h, "weapon": weapon, "witnesses": seen}
    d["kill"] = k
    d["kills"].append(k)
    vp = L["pos"][target]
    L["bodies"].append({"pid": target, "x": vp["x"], "y": vp["y"], "room": here})
    note(g, d, seen, f"You saw {p['name']} strike {victim['name']} down with the {weapon}!", "kill")
    note(g, d, heard, f"{'A scream in the dark!' if dark(d, here) else 'A thud behind you.'} {victim['name']} is down!", "kill")
    note(g, d, [pid], f"You struck {victim['name']} down with the {weapon}." + (" Nobody saw." if not seen else f" {len(seen)} saw it."), "kill")
    note(g, d, [target], f"{p['name']} killed you with the {weapon}.", "kill")
    G.bump(g)
    if d["showdown"] and not [q for q in G.living(g) if q["role"] != "killer"]:
        G.game_over(g, "killers")


def resting(d, pid):
    return d["showdown"] and G.now() - d["live"].get("struck", {}).get(pid, -1e9) < SHOWDOWN_REST


def report(g, d, p):
    L = d["live"]
    here = L["loc"].get(p["pid"])
    if not p["alive"] or d["found"] or d["showdown"] or not any(b["room"] == here for b in L["bodies"]):
        return "There's nothing to report here."
    h = hour_now(d)
    close_through(g, d, h)
    who = present(g, d, here)
    victim = G.name_of(g, d["kill"]["victim"])
    d["found"] = {"hour": h, "by": [p["pid"]] + [q for q in who if q != p["pid"]]}
    note(g, d, who, lambda v: f"You found {victim}'s body!" if v == p["pid"] else f"{p['name']} found {victim}'s body!", "found")
    G.body_found(g)


def lock(g, d, p):
    L, ly = d["live"], lay(g)
    pid, t = p["pid"], G.now()
    here = L["loc"].get(pid)
    if not p["alive"] or here not in G.ROOM:
        return "Stand inside a room to lock its door."
    if locked(d, here):
        return "It's already locked."
    if L["cooldown"].get(pid, 0) > t:
        return "Give it a moment before locking again."
    dx, dy = ly["doors"][here]
    if any(dx - RADIUS <= q["x"] < dx + 1 + RADIUS and dy - RADIUS <= q["y"] < dy + 1 + RADIUS for qid, q in L["pos"].items() if G.player(g, qid)["alive"]):
        return "Someone's standing in the doorway."
    L["locks"][here] = {"until": t + LOCK_SECS, "by": pid}
    L["cooldown"][pid] = t + LOCK_COOLDOWN
    note(g, d, present(g, d, here), lambda v: "You locked the door." if v == pid else "Someone locked the door." if dark(d, here) else f"{p['name']} locked the door.", "lock")
    note(g, d, present(g, d, "hall"), f"The {G.ROOM[here]['name']} door just locked.", "lock")
    G.bump(g)


def unlock(g, d, p):
    L = d["live"]
    here = L["loc"].get(p["pid"])
    lk = L["locks"].get(here)
    if not p["alive"] or here not in G.ROOM or not lk or lk["until"] <= G.now():
        return "Nothing to unlock here."
    del L["locks"][here]
    note(g, d, present(g, d, here), lambda v: "You unlocked the door." if v == p["pid"] else f"{p['name']} unlocked the door.", "lock")
    G.bump(g)


def say(g, d, p, text):
    """Talk out loud: the people in the same place hear it (ghosts hear only ghosts)."""
    L = d["live"]
    place = L["loc"].get(p["pid"])
    audience = present(g, d, place) if p["alive"] else [q["pid"] for q in g["players"] if not q["alive"]]
    hidden = p["alive"] and dark(d, place)
    L["chat"].append({"id": secrets.token_hex(3), "pid": p["pid"], "name": "A voice in the dark" if hidden else p["name"],
                      "color": "#7d7466" if hidden else p["color"], "bot": p["bot"] and not hidden, "ghost": not p["alive"],
                      "text": text, "t": G.now(), "to": audience})
    del L["chat"][:-150]
    G.typing_done(g, p["pid"])
    G.bump(g)
    return place, audience


def bot_reply(g, pid, place):
    """A bot answers someone who spoke to it while walking about."""
    with G.LOCK:
        p, d = G.player(g, pid), G.today(g)
        if g["phase"] != "walk" or not p or not p["alive"] or d["live"]["loc"].get(pid) != place:
            return G.typing_done(g, pid)
        heard = [m for m in d["live"]["chat"] if pid in m["to"]][-8:]
        others = ", ".join(G.name_of(g, q) for q in present(g, d, place) if q != pid) or "nobody"
        where = "the hall" if place == "hall" else f"the {G.ROOM[place]['name']}"
        prompt = (f"{G.bot_brief(g, p)}\nIt's {G.HOURS[hour_now(d)]}; you're walking about the house, in {where} with {others}. What was just said near you:\n"
                  + "\n".join(f"{m['name']}: {m['text']}" for m in heard) + f"\nAnswer in character, out loud. {G.STYLE}")
    text = G._bot_reply(prompt, random.choice(["Hm? Oh, just stretching my legs.", "Can't stop, I'm looking for someone.", "Lovely house, isn't it?"]))
    with G.LOCK:
        if g["phase"] == "walk" and p["alive"] and d["live"]["loc"].get(pid) == place:
            say(g, d, p, text)
        G.typing_done(g, pid)


def speak(g, d, p, text):
    """A person talks out loud; a bot or two within earshot answers."""
    place, audience = say(g, d, p, text)
    if p["bot"] or not p["alive"]:
        return
    for q in audience:
        bot = G.player(g, q)
        if bot["bot"] and q != p["pid"] and random.random() < 0.75:
            G.typing(g, q, ("walk", place))
            G._spawn(bot_reply, g, q, place)


# ---------- the clock ----------
def tick(g, d):
    L = d["live"]
    t = G.now()
    dt = max(0.0, min(1.0, t - L["last"]))
    L["last"] = t
    h = hour_now(d)
    if h != g["hour"]:
        g["hour"] = h
        G.bump(g)                                                      # a new hour, a new story beat
    for p in list(g["players"]):
        if p["bot"] and p["alive"]:
            _bot(g, d, p, dt, t)
            if g["phase"] != "walk":
                return
    alive = [q["pid"] for q in g["players"] if q["alive"]]
    for pid in alive:                                                  # where each hour is spent, and who runs into whom
        here = L["loc"].get(pid)
        if here in G.ROOM:
            dw = L["dwell"][h].setdefault(pid, {})
            dw[here] = dw.get(here, 0) + dt
        if not dark(d, here):
            L["met"][h].setdefault(pid, set()).update(q for q in alive if q != pid and L["loc"].get(q) == here)
    for room, lk in list(L["locks"].items()):
        if lk["until"] <= t:
            del L["locks"][room]
            note(g, d, present(g, d, room) + present(g, d, "hall"), f"The {G.ROOM[room]['name']} door clicked open.", "move")
            G.bump(g)
    while len(d["hours"]) < h:
        close_hour(g, d, len(d["hours"]))
    if t >= g["deadline"]:
        end_day(g, d)


def close_hour(g, d, i):
    """Write an hour down the classic way, so everything after the day works as it always has."""
    L = d["live"]
    where, acts, hall = {}, {}, []
    for p in g["players"]:
        k = p.get("killed")
        if not (p["alive"] or (k and k["day"] == g["day"] and k["hour"] >= i)):
            continue
        pid = p["pid"]
        dwell = L["dwell"][i].get(pid) or {}
        room = max(dwell, key=dwell.get) if dwell else L["room"].get(pid) or nearest_room(g, L["pos"][pid])
        where[pid] = room                                              # always a room, for claims and suspicions…
        if not dwell:
            hall.append(pid)                                           # …but the truth at the end says they never left the hall
        acts[pid] = {"act": G.ROOM[room]["act"], "take": L["took"].get(f"{i}:{pid}")}
    events = {r["id"]: [e for e in L["events"] if e["h"] == i and e["room"] == r["id"]] for r in G.ROOMS}
    d["hours"].append({"where": where, "acts": acts, "events": events, "looks": {}, "idle": [], "beat": d["beats"][i], "hall": hall})
    G.bump(g)


def close_through(g, d, h):
    while len(d["hours"]) <= h:
        close_hour(g, d, len(d["hours"]))


def nearest_room(g, pos):
    ly = lay(g)
    return min(ly["doors"], key=lambda r: _dist(pos, (ly["doors"][r][0] + 0.5, ly["doors"][r][1] + 0.5)))


def end_day(g, d):
    close_through(g, d, len(G.HOURS) - 1)
    if d["showdown"]:
        return G.game_over(g, "guests" if [q for q in G.living(g) if q["role"] != "killer"] else "killers")
    if d["kill"]:
        d["found"] = {"hour": None, "by": []}
        return G.body_found(g)
    d["missing"] = G.missing(g)
    G.set_phase(g, "quiet", G.T["quiet"])


# ---------- what each phone may see ----------
def my_day(g, p, d):
    """The day as this player lived it, from what they actually saw."""
    L = d["live"]
    logs = L["log"].get(p["pid"], [])
    out = []
    for i, hr in enumerate(d["hours"]):
        room = hr["where"].get(p["pid"])
        if room is None:
            continue
        mine = [e for e in logs if e["h"] == i and e["kind"] != "move"]
        if not L["dwell"][i].get(p["pid"]):                            # never set foot in a room that hour: say so
            room = "hall"
        out.append({"hour": G.HOURS[i], "i": i, "room": room, "act": "", "saw": sorted(G.name_of(g, q) for q in L["met"][i].get(p["pid"], ())),
                    "events": [e["text"] for e in mine], "items": [e["item"] for e in mine if e.get("item")], "dark": G.is_dark(hr, room), "idle": False})
    return out


def near(g, d, p):
    """Who you'd hear on voice right now: the living in the same place as you."""
    if not p["alive"]:
        return []
    return [q for q in present(g, d, d["live"]["loc"].get(p["pid"])) if q != p["pid"]]


def snapshot(g, d, p):
    """Everything this player can see from where they stand, a few times a second."""
    L, ly = d["live"], lay(g)
    t, pid, ghost = G.now(), p["pid"], not p["alive"]
    here = L["loc"].get(pid)
    shadowy = not ghost and dark(d, here)
    others = []
    for q in g["players"]:
        if q["pid"] == pid or q["pid"] not in L["pos"] or not (ghost or (q["alive"] and L["loc"].get(q["pid"]) == here)):
            continue
        qp, anon = L["pos"][q["pid"]], shadowy and q["alive"]
        others.append({"pid": L["mask"][q["pid"]] if anon else q["pid"], "name": "" if anon else q["name"], "color": "#1c1a22" if anon else q["color"],
                       "x": round(qp["x"], 3), "y": round(qp["y"], 3), "a": round(qp["a"], 2), "ghost": not q["alive"], "dark": anon})
    items = [{"item": i, "x": x, "y": y} for i, (x, y) in ly["spots"].items() if g["items"].get(i) == G.HOME[i] and (ghost or G.HOME[i] == here)]
    bodies = [{"pid": b["pid"], "name": G.name_of(g, b["pid"]), "color": G.player(g, b["pid"])["color"], "x": b["x"], "y": b["y"]}
              for b in L["bodies"] if ghost or b["room"] == here]
    b = beat_now(d)
    locks = {r: round(lk["until"] - t, 1) for r, lk in L["locks"].items() if lk["until"] > t}
    if b.get("fx") == "rain":
        locks[b["room"]] = -1                                           # -1: rain, not a key
    me = L["pos"][pid]
    out = {"phase": g["phase"], "v": g["v"], "now": t, "me": {"x": me["x"], "y": me["y"], "a": me["a"]}, "here": here, "alive": p["alive"],
           "others": others, "items": items, "bodies": bodies, "locks": locks, "dark": dark(d, here) and not ghost,
           "darkRoom": b.get("room") if b.get("fx") == "dark" else None, "carrying": g["carry"].get(pid), "hour": hour_now(d),
           "start": L["start"], "hourLen": hour_len(d), "beat": b["text"], "showdown": d["showdown"],
           "feed": [{"id": e["id"], "text": e["text"], "kind": e["kind"]} for e in L["log"].get(pid, []) if e["t"] > t - 6],
           "chat": [{k: v for k, v in m.items() if k != "to"} for m in L["chat"] if ghost or pid in m["to"]][-30:]}   # ghosts hear everything
    if p["role"] == "killer":
        out["struck"] = bool(d["kill"]) and not d["showdown"]
    return out


# ---------- bots on their feet ----------
def _inside(ly, room):
    x, y = ly["doors"][room]
    return (x + 0.5, y - 0.5) if y < ly["hall"] else (x + 0.5, y + 1.5)


def _outside(ly, room):
    x, y = ly["doors"][room]
    return (x + 0.5, y + 1.5) if y < ly["hall"] else (x + 0.5, y - 0.5)


def _door(ly, room):
    x, y = ly["doors"][room]
    return (x + 0.5, y + 0.5)


def stand_by(ly, item):
    x, y = ly["spots"][item]
    return (x, y + 0.9) if y < ly["hall"] else (x, y - 0.9)


def somewhere(ly, room):
    x0, y0, x1, y1 = ly["boxes"][room]
    return (random.uniform(x0 + 0.7, x1 - 0.7), random.uniform(y0 + 0.7, y1 - 0.7))


def route(g, d, pid, place, spot):
    """Waypoints from where a bot stands to a spot: straight lines through doors and along the hall."""
    ly, here = lay(g), d["live"]["loc"].get(pid)
    if here == place:
        return [spot]
    path = [_inside(ly, here), _door(ly, here), _outside(ly, here)] if here in ly["doors"] else []
    if place in ly["doors"]:
        path += [_outside(ly, place), _door(ly, place), _inside(ly, place)]
    return path + [spot]


def _bot(g, d, p, dt, t):
    L, pid = d["live"], p["pid"]
    b = L["bots"].setdefault(pid, {"path": [], "wait": t + random.uniform(0.3, 2.0), "goal": None, "look": t, "last_seen": {}})
    here = L["loc"].get(pid)
    if not dark(d, here):                                              # a bot only knows where people are from having seen them
        b["last_seen"].update({q: here for q in present(g, d, here) if q != pid})
    if p["role"] != "killer" and not d["found"] and not d["showdown"] and any(x["room"] == here for x in L["bodies"]):
        b.setdefault("report_at", t + random.uniform(0.8, 2.5))       # a guest who finds a body calls everyone, after a beat
        if t >= b["report_at"]:
            report(g, d, p)
            return
    if p["role"] == "killer" and _hunt(g, d, p, b, dt, t):
        return
    if d["showdown"] and p["role"] != "killer":                        # the last day: a guest keeps away from everyone, behind a locked door
        company = [q for q in present(g, d, here) if q != pid]
        if company and (b.get("goal") or {}).get("type") != "flee":
            rooms = [r for r in G.room_ids(g) if r != here and not locked(d, r)]
            if rooms:
                room = random.choice(rooms)
                b.update(goal={"type": "flee"}, wait=0, path=route(g, d, pid, room, somewhere(lay(g), room)))
        elif not company and here in G.ROOM and not locked(d, here) and L["cooldown"].get(pid, 0) <= t:
            lock(g, d, p)
    if b["wait"] > t:
        if t >= b["look"]:                                             # standing about, looking around
            b["look"] = t + random.uniform(1.2, 3.5)
            me = L["pos"][pid]
            set_pos(g, d, p, me["x"], me["y"], random.uniform(-math.pi, math.pi))
        return
    if b["path"]:
        _follow(g, d, p, b, dt, t)
    else:
        _plan(g, d, p, b, t)


def _hunt(g, d, p, b, dt, t):
    """An armed killer bot strikes when it's alone with someone (locking the door first), or, rarely, when nobody's looking."""
    L, pid = d["live"], p["pid"]
    here = L["loc"].get(pid)
    if (d["kill"] and not d["showdown"]) or not g["carry"].get(pid) or here not in G.ROOM or resting(d, pid):
        return False
    prey = [q for q in present(g, d, here) if q != pid and G.player(g, q)["role"] != "killer"]
    if not prey:
        return False
    if len(prey) == 1:
        victim = prey[0]
        if not locked(d, here) and b.get("locked_for") != (here, victim):
            b["locked_for"] = (here, victim)
            lock(g, d, p)
    else:
        victim = min(prey, key=lambda q: _dist(L["pos"][pid], L["pos"][q]))
        bold = hour_now(d) >= 2 and random.random() < 1 - math.exp(-0.12 * dt)
        if not bold or witnesses(g, d, here, pid, also=[victim]):
            return False
    vp = L["pos"][victim]
    if _dist(L["pos"][pid], vp) <= KILL_REACH * 0.85:
        strike(g, d, p, victim)
        b.update(path=[], goal=None, wait=t + random.uniform(0.5, 1.2))
        return True
    b["path"], b["goal"], b["wait"] = [(vp["x"], vp["y"])], {"type": "hunt"}, 0
    _follow(g, d, p, b, dt, t)
    return True


def _plan(g, d, p, b, t):
    L, ly, pid = d["live"], lay(g), p["pid"]
    here, carrying = L["loc"].get(pid), g["carry"].get(pid)
    rooms = G.room_ids(g)
    open_ = [r for r in rooms if r == here or not locked(d, r)] or rooms
    lying = [i for i in ly["spots"] if g["items"].get(i) == G.HOME[i] and G.HOME[i] in open_]
    goal = place = spot = None
    if p["role"] == "killer":
        if not carrying and lying:
            item = random.choice(lying)
            goal, place, spot = {"type": "take", "item": item}, G.HOME[item], stand_by(ly, item)
        elif carrying and (not d["kill"] or d["showdown"]):
            target = G.player(g, b.get("target"))
            if not target or not target["alive"]:
                prey = [q for q in G.living(g) if q["role"] != "killer"]
                target = random.choice(prey) if prey else None
                b["target"] = target["pid"] if target else None
            if target:                                                 # search where it last saw them, or anywhere
                seen_at = b["last_seen"].pop(target["pid"], None)
                tl = seen_at if seen_at in open_ else random.choice(open_)
                goal, place, spot = {"type": "stalk"}, tl, somewhere(ly, tl)
    if place is None:
        if carrying and random.random() < 0.4 and G.HOME[carrying] in open_:
            goal, place, spot = {"type": "put"}, G.HOME[carrying], stand_by(ly, carrying)
        elif not carrying and p["role"] != "killer" and lying and random.random() < 0.2:
            item = random.choice(lying)
            goal, place, spot = {"type": "take", "item": item}, G.HOME[item], stand_by(ly, item)
        else:
            place = here if here in rooms and random.random() < 0.3 else random.choice(open_)
            spot = somewhere(ly, place)
    b["goal"], b["path"] = goal, route(g, d, pid, place, spot)


def _follow(g, d, p, b, dt, t):
    L, ly, pid = d["live"], lay(g), p["pid"]
    budget = BOT_WALK * dt
    while b["path"] and budget > 1e-6:
        tx, ty = b["path"][0]
        ch = cell(ly, tx, ty)
        room = ly["legend"].get(ch) if ch.islower() and ch != "h" else None
        if room and room != L["loc"].get(pid) and locked(d, room):   # locked out: think again
            b.update(path=[], goal=None, wait=t + random.uniform(0.8, 2.0))
            return
        me = L["pos"][pid]
        dx, dy = tx - me["x"], ty - me["y"]
        gap = math.hypot(dx, dy)
        if gap <= budget:
            nx, ny = tx, ty
            b["path"].pop(0)
            budget -= gap
        else:
            nx, ny, budget = me["x"] + dx / gap * budget, me["y"] + dy / gap * budget, 0
        set_pos(g, d, p, nx, ny, math.atan2(dy, dx) if gap > 1e-6 else me["a"])
    if not b["path"]:
        _arrive(g, d, p, b, t)


def _arrive(g, d, p, b, t):
    L, pid = d["live"], p["pid"]
    goal = b.get("goal") or {}
    here = L["loc"].get(pid)
    if goal.get("type") == "take":
        if p["role"] == "killer" and witnesses(g, d, here, pid) and goal.get("tries", 0) < 4:
            goal["tries"] = goal.get("tries", 0) + 1                   # wait for backs to turn
            b["wait"], b["path"] = t + random.uniform(1.0, 2.5), [_xy(L["pos"][pid])]
            return
        take(g, d, p, goal["item"])
    elif goal.get("type") == "put":
        put(g, d, p)
    if p["role"] != "killer" and here in G.ROOM and not [q for q in present(g, d, here) if q != pid] and random.random() < (0.9 if d["showdown"] else 0.06):
        lock(g, d, p)                                                  # alone in a room: a guest sometimes bolts the door (on the last day, always)
    b["goal"] = None
    b["wait"] = t + (random.uniform(0.4, 1.2) if goal.get("type") == "stalk" else random.uniform(2.0, 6.0))
