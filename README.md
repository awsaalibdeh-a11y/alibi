# Alibi

A murder mystery for 1 to 4 players on one phone. Every case is new, written by AI: a victim, five suspects who all
hide something, five places to search, and one killer.

- **Pass the phone**: in Rivals mode each detective has a private notebook, and a "pass to…" screen hides everything
  between turns. Team mode shares one notebook. One player plays solo.
- **Your move**: question a suspect (3 questions; they answer in character, streamed as they speak), search a place
  for a clue, or solve it. Show a suspect a clue from your notebook and watch their story crack: only the killer lies
  about the murder, but everyone lies about their secret.
- **Solve it**: name who, why and how. All three right on your turn wins on the spot; anything wrong and you're out.
  After the last round everyone left makes a secret final accusation (killer 3 points, motive 1, weapon 1).
- **The reveal**: the killer, what really happened, a timeline, and every suspect's secret.
- **No peeking**: the answer never reaches the phone. The server seals the whole case (encrypted with a key only it
  has) and hands the browser the public half plus the sealed token; searching, questioning and accusing send the token
  back. No database: a game in progress is saved in the browser and survives a reload.

## Run it

```bash
pip install -r requirements.txt
python app.py            # http://127.0.0.1:5085
```

Needs `OPENAI_API_KEY` (in a local `.env`, or the host's environment). Optional: `OPENAI_MODEL` (default gpt-5),
`OPENAI_REASONING_EFFORT` (default minimal), `AI_DAILY_LIMIT` (default 800), `CASE_SECRET` (the sealing key; defaults
to one derived from the API key).

## Tests

```bash
python -m unittest discover tests     # sealing, the public half, search, accuse, reveal (no AI calls)
```

## Layout

```
app.py            Flask: the page, security headers
mystery.py        writing a case, sealing it, the suspects (streamed), search / accuse / reveal
static/app.js     the game: setup, turns, passing the phone, interviews, notebook, solving, the reveal
static/style.css  a noir case file
```
