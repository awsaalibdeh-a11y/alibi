# Alibi

A murder party game where **the killer is one of the players**, each on their own phone. 4 to 8 players; bots fill
the empty chairs.

- **A normal day at the manor.** Every hour (5 of them, 30 seconds each) everyone secretly picks a room and something to
  do there. Anyone can pick up the things lying around: the candlestick, the rope, the kitchen knife…
- **The killer** (two in a game of 7 or 8), once armed, picks a target and a room to hunt them in. If the gamble pays
  off and the target is really there, they strike — even in front of others, though a crowd means witnesses find the
  body on the spot, while a solo kill stays deniable until someone walks in later (or it's found at dusk).
- **Look back.** You only know what you saw yourself (who was with you, who took what). Everyone sees where the body
  lay, roughly when and how they died, and what's missing from the house.
- **Talk and vote.** Two minutes of chat: share your day (the killer can lie about theirs), argue, then vote someone
  out. Catch every killer to win; if the killers ever match the rest, they win. The dead become ghosts who see
  everything and can only talk to each other.
- **Ways to play:** start a game and send the family the code or link (it starts when everyone taps Ready), find a
  game online (a public queue that starts after 30 seconds, topped up with bots), or play with bots.
- **Bots** move around, pick things up, hunt (if they're the killer), post their day, argue in the chat with AI
  (plain lines if AI is off) and vote on what they saw against what people claimed.
- **The end** shows every role and the whole day, hour by hour, for everyone.

## How it works

The server (`game.py`) holds every game in memory and is the only one that knows the truth. Each phone polls
`/api/game/<code>` once a second and gets its own view of the game, which never includes anyone else's role. There's
no background loop: every request "ticks" the room forward (expired clocks, everyone having acted, bots' planned
messages). One gunicorn worker, so every request sees the same games.

## Run it

```bash
pip install -r requirements.txt
python app.py            # http://127.0.0.1:5085
```

`OPENAI_API_KEY` (a local `.env`, or the host's environment) lets the bots talk with AI; without it they use plain
lines. Optional: `OPENAI_MODEL` (default gpt-5), `OPENAI_REASONING_EFFORT` (default minimal), `AI_DAILY_LIMIT`.

## Tests

```bash
python -m unittest discover tests     # rules (kills, discovery, votes), whole bot games, rooms, the queue (no AI)
```

## Layout

```
app.py            Flask: the page, security headers
game.py           rooms, the day, kills, views per player, the clock, bots, the API
static/app.js     the phone: home, lobby, role, the day, the body, chat, vote, the end
static/style.css  a noir look
```
