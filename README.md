# Alibi

A murder party game where **the killer is one of the players**, each on their own phone. 4 to 8 players; bots fill
the empty chairs.

- **A story.** Lord Ashcombe's will is read at dusk. Every guest gets a character (the Heir, the Doctor, the Actress…),
  and every hour has a story beat: some just colour the day, some change it (a power cut leaves a room pitch dark and
  hides who's in it; rain locks the garden).
- **Every hour, two steps.** Move: stay, or walk to a room next door on the floor plan. Then the room (up to a minute, or until everyone leaves): see who came,
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

## Maps

Nine places to commit a murder: **The Wrenmoor Weekend** (country-house manor), **The Midnight Express** (luxury night train),
**Frostline Lodge** (snowed-in ski lodge), **The Grand Marlowe** (1920s seaside hotel), **Station Helios** (space station),
**The Dune Palace** (desert resort), **The Gulf Pearl** (yacht), **The Night Museum** (a museum after dark) and **The Velvet Circus**
(a travelling circus).
Pick one on the home screen (or 🎲 for a surprise); the host can change it in the lobby. A map is only data (`maps.py`:
six rooms, twelve things to pick up, twelve characters, ten story beats and its own headlines and colours), so the rules
never change. Room ids stay the same six slots (the `garden` slot is the exposed one the weather locks), and
`tests/test_maps.py` checks that every map is complete and plays a whole bot game on each.

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
static/app.js     the phone: home, lobby, role, the day, the body, the meeting and its evidence board, vote, the end
static/profile.js your profile on this phone: XP, levels, achievements, badges, the daily challenge
static/style.css  matte black, one accent colour per map, every animation scoped to a screen's first draw
```

## The October update

- **🏠 Start a game from the Homebase family chat.** In Homebase, tap 🎮 in the family chat and choose Alibi. Homebase makes a one-time
  link (it works once, for that family, for two hours) and opens Alibi as the host. When the game exists, its code goes back to the
  chat with a Join button, which opens Alibi with the person's name filled in. Nothing to link or set up. The address the Join button
  points to is built by Homebase, never taken from the game.
- **⏱️ Pace.** The host picks Quick (about 40% shorter hours and meetings), Normal or Relaxed (about 70% longer) in the lobby.
- **Two new places to be murdered:** 🏜️ The Dune Palace (a desert resort in a sandstorm) and 🛥️ The Gulf Pearl (a luxury yacht at sea).
- **⚙️ Settings:** sound, vibration and calm mode on their own switches, **your record** (games, wins, win rate, best streak, wins as
  killer; kept on the phone only), the tutorial, and Install Alibi.
- **📲 An app.** An install bar on the home screen (and the Share, Add to Home Screen steps on iPhone), plus an Android app when
  `static/alibi.apk` is published (the settings sheet shows the download only when it exists).

Tests: `python -m unittest discover tests` (71 then).

## The October 29 update

- **Three new roles**, each switchable by the host: **🃏 the Jester** (on nobody's side: wins by getting voted out; the game goes on),
  **🧭 the Tracker** (once a day follows someone's footprints for an hour: where they really went, with whom, what they took, even
  under a Shapeshifter's borrowed face) and **🛡️ the Bodyguard** (once a day shadows someone for an hour, going wherever they go; if
  the killer strikes them, the Bodyguard fights them off and both see who it was). The Detective and the Doctor come first; the other
  roles are drawn at random by game size, always leaving at least one plain guest.
- **🔎 The evidence board** in the meeting: everyone's claimed day side by side, the murder hour marked, and every claim that clashes
  with what *you* saw (or with your Tracker footprints) in red. On a wide screen the meeting is two columns: chat, and the board.
- **Emotes**: tap 😱 😂 🤔 😡 👀 🔪… and it floats up the screen for everyone in the same room, the meeting, the ghosts or the lobby.
  Bots react to verdicts, accusations and bodies. **Quick lines** for one-tap chat.
- **Ghosts see everything**: every room, who's in it (or heading there), who carries what, the killer marked, and what's being said.
- **The end**: the weekend's big moments (first blood, caught in the act, saves, the big lie, the verdicts), plus your XP.
- **Your profile** (on this phone): XP and levels with titles, 27 achievements, badges you can wear next to your name (other players see
  them in the lobby), a daily challenge with a streak, your record by role and map, recent games.
- **Open games**: a host can list a family game; the home screen shows open games anyone can join. **Lobby chat.**
- **🎓 Practice**: a gentle game with four bots, a relaxed clock and a coach explaining each step; you're never the killer.
- **Two new maps**: 🏛️ The Night Museum and 🎪 The Velvet Circus.
- **Bots remember**: a witness from an earlier day still names the killer; trackers and bodyguards play their parts.
- **A new look**: every screen redone, phones first; a ring clock that beats in the last ten seconds; title cards for each new day,
  the meeting and the vote; a role card that flips; doors that show the next hour and its story; room tiles, vote tiles, ballots and a
  falling verdict; confetti, sparks, level-ups. Ticking and a heartbeat in the last seconds, optional ambience per map.
- **Settings**: calm mode, larger text, high contrast, tips, ambience, sound and vibration.

Tests: `python -m unittest discover tests` (92 then).

## The house map and hide and seek (October 29, later)

- **Ten rooms in every house.** Each map gained four rooms (a hall in the middle, a dining room, a bedroom and an attic, each in the
  map's own style: the Midnight Express has a Train Corridor, an Observation Car, a Sleeper Cabin and a Roof Hatch), and every game
  now uses the whole house.
- **The old free-roaming game is gone.** Every game is played on a **floor plan**: the day starts in the hall, and each hour you stay
  or walk through one door (stairs count). You see who you pass in a doorway, and you hear voices next door. The killer knows three
  **secret passages** (shown dashed on their plan); a story that skips across the house is flagged on the evidence board, because
  only a secret passage explains it. Careful killer bots tell walkable lies; bots walk to the meetings they promise.
- **🙈 Hide and seek**, the second way to play (pick it on the home screen, or the host switches it in the lobby). One night,
  10 PM to 5 AM. One seeker (two in a game of 7 or 8) counts in the hall for the first hour (catching nobody), then hunts: a seeker
  runs up to two rooms an hour, knows the secret passages and hears anyone moving that far away. Hiders walk one room an hour and pick
  a hiding place: behind the door, under the furniture or in the shadows. A seeker finds everyone in the open in their room, plus
  whoever is in the two places they search. Keep still in the same spot and nobody walking in even sees you (they only hear
  breathing), but after two hours your legs cramp and the seekers can hear you. Hiders hear the seekers' footsteps next door.
  Talking or reacting gives you away. Whoever is found joins the hunt; the hiders win if anyone is still hidden at 5 AM. Balanced on
  simulated bot nights: the hiders win about half to two thirds of them, and most hiders are found.
- **The Bodyguard** now shadows someone in the same room and follows them through the same door.

Tests: `python -m unittest discover tests` (104).
