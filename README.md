# Alibi: The Wrenmoor Weekend

A murder party game where **the killer is one of the players**, each on their own phone. 4 to 8 players; bots fill
the empty chairs.

- **A story.** Lord Ashcombe's will is read at dusk. Every guest gets a character (the Heir, the Doctor, the Actress…),
  and every hour has a story beat: some just colour the day, some change it (a power cut leaves a room pitch dark and
  hides who's in it; rain locks the garden).
- **Every hour, two steps.** Move: pick a room. Then the room (up to a minute, or until everyone leaves): see who came,
  talk to them (typing or voice), and choose what to do: an activity, look around (who was here the hour before), take
  or put back an object. Take it openly, or sneak it: then only someone looking around notices.
- **The house grows with the party:** three rooms for four guests, up to all six for eight, so people keep meeting.
- **You're the killer more often than a bot is**, when you play with bots.
- **The killer** (two in a game of 7 or 8) strikes when they are alone with someone and already carrying a weapon.
  Walk into that room later and you find the body; otherwise it's found at dusk.
- **The Detective and the Doctor.** From five guests there's one of each (with four, one or the other), secretly, and
  people get these jobs more often than bots. The Detective questions one person a day, but only when the two of them are
  alone in a room with the lights on: they learn whether that person is a killer (and a killer feels someone studying
  them). The Doctor picks a patient each day: if the killer strikes them, they survive (without seeing who did it), and
  the Doctor's autopsy names the exact weapon.
- **🎭 The Shapeshifter** (5+ players): one of the killers can wear another guest's face for an hour, once a day. Anyone
  who sees them, even watching them strike, sees that guest, and blames them. The Detective can unmask them, and the
  dying clue's coat colour is still their own. **🔮 The Medium** (6+ players) reads the ghosts' chat and holds a séance
  once a day; the dead answer in riddles. The host can switch any special role off in the lobby.
- **🔔 The emergency bell.** Once a game, from 11 AM, anyone can ring it and call the meeting at once.
- **📝 A notebook** in the meeting: mark each guest ✅ ⚠️ 🔪 and jot notes (kept on your phone only).
- **🎬 Replay** at the end: the whole weekend on a map of the house, hour by hour.
- **Tricks up everyone's sleeve.** The killer can cut the lights in one room once a day (everyone sees them go, nobody
  sees who's inside). Every guest can search one person's pockets once a game, during the meeting: you see what they're
  carrying, and they know you looked. Ghosts see the whole house and can rattle one room an hour with a sign (👻 🔪 👀…).
- **The ballots are read out** one by one before the verdict lands.
- **Secret missions.** Everyone gets a little private goal ("spend 3 hours in the Library", "be in a room with Theo
  twice", the killer's "commit a murder in the Study"…), shown with your role and scored at the end.
- **Dying clues.** Sometimes the victim is found clutching threads of three coats' colours: one of them is the killer's.
- **J'accuse!** Once a meeting, point at someone in front of everyone (bots answer back, and accuse people too).
  **Anonymous notes:** once a game, slip a note into the meeting that nobody can trace (killer bots use it to frame).
- **The Wrenmoor Gazette** greets every new morning with yesterday's headlines.
- **More awards** at the end: Eagle Eye, Pickpocket, Poltergeist, Mission accomplished.
- **Look back.** You only know what you saw yourself (who was with you, who took what). Everyone sees where the body
  lay, roughly when and how they died, and what's missing from the house.
- **Private messages** to anyone (bots answer in character). **Proximity voice:** with the mic on, you hear whoever's in
  the same room during the day, and everyone at the meeting (peer to peer, WebRTC; set `TURN_URL`, `TURN_USER`,
  `TURN_PASS` for networks that block direct connections).
- **The final showdown.** When the killers catch up with the guests there's no instant loss: one last day with no
  meeting, where the killer can strike every hour and any guest alive at dusk wins it for the guests.
- **Talk and vote.** Two and a half minutes of chat: share your day (the killer can lie about theirs), argue, then vote someone
  out (most votes, and at least half the room; bots always vote, on a hunch if nothing stands out). Catch every killer to win; if the killers ever match the rest, they win. The dead become ghosts who see
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
lines. Optional: `OPENAI_MODEL` (default gpt-4o-mini, cheap and quick; falls back to gpt-4.1-mini if the key can't use it),
`OPENAI_REASONING_EFFORT` (default minimal, only for gpt-5 and o-series models), `AI_DAILY_LIMIT` (calls a day, default 1500), `AI_GAME_LIMIT` (calls a
game, default 60).

To keep the bill small, bots only use the AI while a person is actually playing (a phone checked in within 40 seconds);
games that carry on with only bots, and anything past a game's limit, use free plain lines. `/api/status` shows today's
calls and tokens.

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
