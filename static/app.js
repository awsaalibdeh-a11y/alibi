/* Alibi: the game. One phone, 1 to 4 detectives, taking turns.

   A turn is one move: question a suspect (up to 3 questions), search a place (one clue), or try to solve the case.
   In Rivals mode each detective has a private notebook and the phone is passed between turns behind a "pass to…"
   screen; in Team mode everyone shares one notebook. The case's answer never reaches the phone: the server keeps it
   sealed inside `token` and only says right or wrong. The whole game is saved after every move, so a reload or a
   closed tab picks up where it left off. */
"use strict";

/* ---------- helpers ---------- */
const $app = document.getElementById("app");
const KEY = "alibi.v1";
const COLORS = ["#e8c46a", "#6fb7e0", "#e27d8e", "#86cf8e"];
const MUGS = ["#7a4b3a", "#3f5d6e", "#5d4a70", "#56663d", "#7a6a3a"];
const SETTINGS = [
  ["random", "🎲", "Surprise me"], ["manor", "🏰", "Country manor"], ["train", "🚂", "Sleeper train"], ["film", "🎬", "Film set"],
  ["resort", "🏜️", "Desert resort"], ["liner", "🚢", "Ocean liner"], ["museum", "💎", "Museum gala"], ["lodge", "🏔️", "Ski lodge"], ["kitchen", "🍽️", "Restaurant"],
];
const LOADING = ["Choosing a victim…", "Inviting the suspects…", "Giving everyone a secret…", "Hiding the weapon…", "Planting clues…",
  "Laying a few red herrings…", "Checking every alibi…", "Sealing the envelope…"];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;                 // only ever our own icon markup
    else if (k === "style" && typeof v === "object") for (const [prop, val] of Object.entries(v)) { if (prop.startsWith("--")) el.style.setProperty(prop, val); else el.style[prop] = val; }
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  talk: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  gavel: '<path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6 3 3 6-6M8 13l-5 5 2 2 5-5M13 21h8"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  lens: '<circle cx="27" cy="27" r="13" fill="none" stroke="#e8c46a" stroke-width="5"/><path d="M36.5 36.5 L50 50" stroke="#e8c46a" stroke-width="7" stroke-linecap="round"/><circle cx="27" cy="27" r="4" fill="#c7402f" stroke="none"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const ibtn = (name, label, onClick) => h("button", { class: "ibtn", type: "button", "aria-label": label, title: label, html: icon(name), onClick });
const initials = (name) => String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mug = (s) => h("span", { class: "mug", style: { "--m": MUGS[(+String(s.id).slice(1) - 1) % MUGS.length] }, "aria-hidden": "true" }, initials(s.name));
const dot = (p) => h("span", { class: "dot", style: { "--c": p.color }, "aria-hidden": "true" }, initials(p.name).slice(0, 1));

function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
/** *stage directions* in a suspect's answer become italics; everything else stays plain text. */
function speech(text) {
  return String(text).split(/(\*[^*]+\*)/g).filter(Boolean).map((part) => (/^\*[^*]+\*$/.test(part) ? h("em", {}, part.slice(1, -1)) : part));
}

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

/* ---------- state ---------- */
let G = load();
let view = { name: "home" };           // what's on screen now (not saved)

function load() { try { const g = JSON.parse(localStorage.getItem(KEY) || "null"); return g && g.v === 1 ? g : null; } catch { return null; } }
function save() { try { if (G) localStorage.setItem(KEY, JSON.stringify(G)); else localStorage.removeItem(KEY); } catch { /* private mode: the game still runs */ } }

const player = () => G.players[G.turn];
const solo = () => G.players.length === 1;
const team = () => G.mode === "team" || solo();
/** Whose notebook the current detective writes in. */
const bookOf = (i = G.turn) => G.books[team() ? "team" : String(i)];
const suspect = (id) => G.case.suspects.find((s) => s.id === id);
const place = (id) => G.case.places.find((p) => p.id === id);
const active = () => G.players.map((p, i) => i).filter((i) => !G.players[i].out);

function newBook() { return { clues: [], talks: {}, marks: {}, jot: "", found: {} }; }

function go(name, extra = {}) { view = { name, ...extra }; render(); window.scrollTo({ top: 0 }); }

function logEvent(text) { G.log.push({ round: G.round, text }); G.log = G.log.slice(-30); }

/* ---------- the flow of turns ---------- */
function startTurn() {
  G.acted = false;
  showTurn();
}
/** Hand the phone over (Rivals) or straight to the turn. A reload lands here too, keeping whether the move was made. */
function showTurn() {
  save();
  if (!team() && G.players.length > 1) go("pass");
  else go("turn");
}
/** The move is made: next detective, next round, or the final accusations. */
function endTurn() {
  if (!active().length) return finish();
  let next = G.turn;
  do {                                                                     // the next detective still in the game
    next = (next + 1) % G.players.length;
    if (next === 0) G.round++;                                             // back to the first seat: a new round
  } while (G.players[next].out);
  G.turn = next;
  if (G.round > G.rounds) return beginFinal();
  startTurn();
}

function beginFinal() {
  G.phase = "final";
  G.finalQueue = active();
  save();
  nextFinal();
}
function nextFinal() {
  if (!G.finalQueue.length) return finish();
  G.turn = G.finalQueue[0];
  save();
  if (!team() && G.players.length > 1) go("pass", { final: true });
  else go("solve", { final: true });
}

async function finish() {
  G.phase = "reveal";
  save();
  go("revealing");
  try {
    G.answer = await api("/api/reveal", { token: G.token });
    save();
    go("reveal");
  } catch (e) {
    go("reveal", { error: e.message });
  }
}

/* ---------- screens ---------- */
function render() {
  const screens = { home, setup, loading, briefing, pass, turn, pickSuspect, pickPlace, interview, search, notebook, solve, wrong, revealing, reveal };
  const el = (screens[view.name] || home)();
  el.classList.add("screen");
  $app.replaceChildren(el);
  const focus = el.querySelector("[data-focus]");
  if (focus && !matchMedia("(pointer: coarse)").matches) focus.focus({ preventScroll: true });
}

function bar(title, { back, book = true } = {}) {
  return h("div", { class: "bar" },
    back ? ibtn("back", "Back", back) : ibtn("home", "Leave the game (it's saved)", () => go("home")),
    h("span", { class: "title" }, title),
    h("span", { class: "spacer" }),
    G && book && G.phase === "play" ? h("button", { class: "btn sm", type: "button", onClick: () => go("notebook", { from: view }) }, h("span", { html: icon("book"), style: { display: "grid", width: "1.1rem" } }), "Notebook") : null);
}

function home() {
  const saved = G && G.phase !== "reveal" ? G : null;
  return h("section", { class: "home" },
    h("div", { class: "logo" }, h("span", { html: `<svg viewBox="0 0 64 64">${ICONS.lens}</svg>` }), h("span", { class: "label" }, "A party murder mystery")),
    h("div", {}, h("h1", { class: "display" }, "Alibi"),
      h("p", { class: "tagline" }, "Somebody here is lying. Pass the phone, ask the right questions, and name the killer before the night is out.")),
    saved ? h("div", { class: "resume" }, h("span", { class: "label" }, "Case in progress"), h("b", {}, saved.case.title),
      h("span", { class: "muted small" }, `Round ${Math.min(saved.round, saved.rounds)} of ${saved.rounds} · ${saved.players.map((p) => p.name).join(", ")}`),
      h("div", { class: "row", style: { marginTop: "0.5rem" } }, h("button", { class: "btn primary", type: "button", onClick: () => resumeGame() }, "Continue the case"),
        h("button", { class: "btn ghost sm", type: "button", onClick: () => { if (confirm("Abandon this case? It can't be brought back.")) { G = null; save(); go("setup"); } } }, "Abandon it"))) : null,
    h("button", { class: "btn primary block", type: "button", onClick: () => go("setup") }, "Open a new case"),
    h("div", { class: "card" }, h("span", { class: "label" }, "How to play"),
      h("ol", { class: "howto", style: { marginTop: "0.8rem" } },
        h("li", {}, h("span", {}, h("b", {}, "1 to 4 detectives, one phone. "), "Every case is new, written by AI: a victim, five suspects, five places, and one killer.")),
        h("li", {}, h("span", {}, h("b", {}, "Take turns. "), "On your turn, question a suspect (3 questions) or search a place for a clue. Then pass the phone.")),
        h("li", {}, h("span", {}, h("b", {}, "Keep your notebook. "), "In Rivals mode what you learn is yours alone. Share it, or don't.")),
        h("li", {}, h("span", {}, h("b", {}, "Show them the evidence. "), "Confront a suspect with a clue and watch their story crack. Only the killer lies about the murder; everyone lies about their secrets.")),
        h("li", {}, h("span", {}, h("b", {}, "Solve it. "), "Name who, why and how. Get it all right on your turn and you win on the spot; get it wrong and you're out. At the end, everyone left makes a final guess.")))));
}

function resumeGame() {
  if (G.phase === "briefing") return go("briefing");
  if (G.phase === "final") return nextFinal();
  if (G.phase === "reveal") return G.answer ? go("reveal") : finish();
  showTurn();
}

/* ---------- setup ---------- */
let draft = { names: ["", ""], mode: "rivals", length: "quick", setting: "random" };
function setup() {
  const rows = h("div", { class: "players" });
  const paintRows = () => rows.replaceChildren(...draft.names.map((n, i) => h("div", { class: "player-row" },
    h("span", { class: "dot", style: { "--c": COLORS[i] }, "aria-hidden": "true" }, String(i + 1)),
    (() => {
      const inp = h("input", { class: "input", value: n, placeholder: `Detective ${i + 1}`, maxlength: "16", "aria-label": `Player ${i + 1} name`, autocomplete: "off", enterkeyhint: "next" });
      inp.addEventListener("input", () => { draft.names[i] = inp.value; });
      if (i === 0) inp.dataset.focus = "";
      return inp;
    })(),
    draft.names.length > 1 ? ibtn("x", `Remove player ${i + 1}`, () => { draft.names.splice(i, 1); render(); }) : h("span"))));
  paintRows();
  const n = draft.names.length;
  const seg = (key, opts) => h("div", { class: "seg", role: "radiogroup" }, opts.map(([val, title, sub, disabled]) => {
    const on = (key === "mode" ? mode : draft[key]) === val;
    return h("button", { type: "button", role: "radio", "aria-checked": String(on), class: on ? "on" : "", disabled, onClick: () => { draft[key] = val; render(); } },
      h("b", {}, title), sub ? h("small", {}, sub) : null);
  }));
  const mode = n === 1 ? "team" : draft.mode;                        // one detective: nothing to keep secret
  const err = h("p", { class: "error", hidden: true });
  const start = async () => {
    const names = draft.names.map((x, i) => x.trim() || `Detective ${i + 1}`);
    if (new Set(names.map((x) => x.toLowerCase())).size !== names.length) { err.textContent = "Give everyone a different name."; err.hidden = false; return; }
    const players = names.map((name, i) => ({ name, color: COLORS[i], out: false }));
    go("loading", { players });
    try {
      const d = await api("/api/case", { setting: draft.setting });
      const rounds = { quick: players.length === 1 ? 6 : 4, full: players.length === 1 ? 9 : 6 }[draft.length];
      G = {
        v: 1, case: d.case, token: d.token, players, mode: players.length === 1 ? "team" : draft.mode, rounds, round: 1, turn: 0,
        phase: "briefing", books: {}, log: [], started: Date.now(),
      };
      if (team()) G.books.team = newBook(); else players.forEach((p, i) => { G.books[String(i)] = newBook(); });
      save();
      go("briefing");
    } catch (e) {
      go("setup", { error: e.message });
    }
  };
  return h("section", { class: "stack", style: { gap: "1.3rem" } },
    bar("New case", { back: () => go("home"), book: false }),
    h("h1", { class: "h2" }, "Who's on the case?"),
    view.error ? h("p", { class: "error" }, view.error) : null,
    rows,
    n < 4 ? h("button", { class: "btn sm", type: "button", onClick: () => { draft.names.push(""); render(); } }, "+ Add a detective") : h("p", { class: "muted small" }, "Four detectives is a full table."),
    h("div", { class: "field" }, h("span", {}, "How do you play?"),
      seg("mode", [["rivals", "Rivals", "Private notebooks. Pass the phone.", n === 1], ["team", "Team", "One shared notebook. Solve it together."]])),
    h("div", { class: "field" }, h("span", {}, "How long?"),
      seg("length", [["quick", "Quick", n === 1 ? "6 moves · ~15 min" : `4 moves each · ~${8 + n * 4} min`], ["full", "Full", n === 1 ? "9 moves · ~25 min" : `6 moves each · ~${12 + n * 6} min`]])),
    h("div", { class: "field" }, h("span", {}, "Where does it happen?"),
      h("div", { class: "settings" }, SETTINGS.map(([key, emoji, name]) => h("button", { class: "setting" + (draft.setting === key ? " on" : ""), type: "button", "aria-pressed": String(draft.setting === key), onClick: () => { draft.setting = key; render(); } },
        h("span", { "aria-hidden": "true" }, emoji), h("b", {}, name))))),
    err,
    h("button", { class: "btn primary block", type: "button", onClick: start }, "Write our case"));
}

function loading() {
  const line = h("p", { class: "loadline" }, LOADING[0]);
  const bar_ = h("i");
  let i = 0, t0 = Date.now();
  const tick = setInterval(() => {
    if (!line.isConnected) return clearInterval(tick);
    i = (i + 1) % LOADING.length;
    line.textContent = LOADING[i];
    bar_.style.width = `${Math.min(95, ((Date.now() - t0) / 30000) * 100)}%`;
  }, 2600);
  requestAnimationFrame(() => { bar_.style.width = "8%"; });
  return h("section", { class: "loading" },
    h("span", { class: "lens", html: `<svg viewBox="0 0 64 64">${ICONS.lens}</svg>` }),
    h("h1", { class: "h2" }, "Writing your case"),
    line, h("div", { class: "meter", "aria-hidden": "true" }, bar_),
    h("p", { class: "muted small" }, "A brand-new mystery takes about half a minute."));
}

/* ---------- the briefing: read it out together ---------- */
function briefing() {
  const c = G.case;
  return h("section", { class: "brief" },
    bar("The case file", { book: false }),
    h("div", {}, h("span", { class: "label" }, "Case file"), h("h1", { class: "display", style: { fontSize: "clamp(2rem, 8vw, 3rem)", marginTop: "0.3rem" } }, c.title)),
    h("p", { class: "lead" }, c.intro),
    h("div", { class: "paper tilt victim" }, h("span", { class: "stamp" }, "DECEASED"), h("span", { class: "label" }, "The victim"),
      h("h2", {}, c.victim.name), h("p", { class: "muted" }, c.victim.role),
      h("p", {}, c.victim.found), h("p", {}, h("b", {}, "Died: "), c.victim.time), h("p", {}, h("b", {}, "The doctor says: "), c.cause)),
    h("div", {}, h("span", { class: "label" }, "The suspects"), h("p", { class: "muted small" }, "What each of them told you when you arrived.")),
    h("div", { class: "suspects" }, c.suspects.map((s) => h("div", { class: "suspect" }, mug(s),
      h("div", {}, h("b", {}, s.name), h("div", { class: "role" }, `${s.role}${s.age ? `, ${s.age}` : ""}`), h("p", { class: "small muted", style: { margin: "0.2rem 0" } }, s.relation), h("p", { class: "quote" }, `“${s.statement}”`))))),
    h("div", {}, h("span", { class: "label" }, "Places to search")),
    h("div", { class: "places" }, c.places.map((p) => h("div", { class: "place" }, h("b", {}, p.name), h("small", {}, p.desc)))),
    h("div", { class: "card" }, h("span", { class: "label" }, "To solve it, name"),
      h("p", { class: "small", style: { marginTop: "0.6rem" } }, h("b", {}, "Who"), " did it, ", h("b", {}, "why"), " (one of these motives) and ", h("b", {}, "how"), " (one of these weapons):"),
      h("ul", { class: "opts" }, c.motive_options.map((m) => h("li", {}, m))), h("hr", { class: "rule" }),
      h("ul", { class: "opts" }, c.weapon_options.map((m) => h("li", {}, m)))),
    h("p", { class: "muted small" }, solo() ? `You have ${G.rounds} moves.` : `${G.rounds} rounds: every detective gets ${plural(G.rounds, "move")}. ${G.players[0].name} goes first.`),
    h("button", { class: "btn primary block", type: "button", onClick: () => { G.phase = "play"; save(); startTurn(); } }, "Begin the investigation"));
}

/* ---------- pass the phone ---------- */
function pass() {
  const p = player();
  const recent = G.log.filter((e) => e.text).slice(-Math.max(1, G.players.length - 1));
  return h("section", { class: "pass" },
    h("span", { class: "label" }, view.final ? "Final accusations" : `Round ${G.round} of ${G.rounds}`),
    h("span", { class: "big-dot", style: { "--c": p.color }, "aria-hidden": "true" }, initials(p.name).slice(0, 1)),
    h("p", { class: "muted", style: { margin: 0 } }, "Pass the phone to"),
    h("h1", { class: "who" }, p.name),
    h("p", { class: "muted small" }, view.final ? "Everyone else, look away: this accusation is secret." : "Everyone else, no peeking."),
    !view.final && recent.length ? h("div", { class: "news" }, h("span", { class: "label" }, "Meanwhile"), recent.map((e) => h("span", {}, e.text))) : null,
    h("button", { class: "btn primary", type: "button", "data-focus": "", onClick: () => { try { navigator.vibrate?.(30); } catch { /* no vibration */ } go(view.final ? "solve" : "turn", { final: view.final }); } }, `I'm ${p.name}`));
}

/* ---------- a turn ---------- */
function turn() {
  const p = player(), b = bookOf();
  const left = G.rounds - G.round;
  const action = (ico, title, sub, onClick, cls = "") => h("button", { class: `action ${cls}`, type: "button", onClick },
    h("span", { class: "ico", html: icon(ico) }), h("span", {}, h("b", {}, title), h("small", {}, sub)), h("span", { class: "muted", "aria-hidden": "true" }, "›"));
  return h("section", {},
    bar(G.case.title),
    h("div", { class: "turnhead" },
      h("div", { class: "meta" }, h("span", { class: "pchip" }, dot(p), p.name), h("span", { class: "tag" }, `Round ${G.round} of ${G.rounds}`),
        left === 0 ? h("span", { class: "tag warn" }, "Last round") : null),
      h("h1", { class: "h2", style: { marginTop: "0.5rem" } }, "Your move, detective."),
      h("p", { class: "muted" }, `Pick one. ${b.clues.length ? `You have ${plural(b.clues.length, "clue")} so far.` : "Your notebook is empty so far."}`)),
    G.acted ? h("div", { class: "card stack" }, h("b", {}, "You've made your move this turn."),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onClick: endTurn }, "End my turn"),
        h("button", { class: "btn sm", type: "button", onClick: () => go("notebook", { from: { name: "turn" } }) }, "Read my notebook"))) :
    h("div", { class: "actions" },
      action("talk", "Question a suspect", "Up to 3 questions. Show them evidence to shake them.", () => go("pickSuspect")),
      action("search", "Search a place", "Find one clue for your notebook.", () => go("pickPlace")),
      action("book", "Read your notebook", "Clues, interviews, your hunches. Doesn't use your move.", () => go("notebook", { from: { name: "turn" } })),
      action("gavel", "Solve the case", "Name who, why and how. One try: right wins, wrong and you're out.", () => go("solve"), "solve")));
}

function pickSuspect() {
  const b = bookOf();
  return h("section", { class: "stack" },
    bar("Question a suspect", { back: () => go("turn") }),
    h("h1", { class: "h2" }, "Who do you want to talk to?"),
    h("div", { class: "suspects" }, G.case.suspects.map((s) => h("button", { class: "suspect", type: "button", onClick: () => go("interview", { id: s.id, asked: 0 }) }, mug(s),
      h("div", {}, h("b", {}, s.name), h("div", { class: "role" }, s.role),
        h("p", { class: "quote" }, `“${s.statement}”`),
        (b.talks[s.id] || []).length ? h("span", { class: "tag", style: { marginTop: "0.4rem" } }, `You've asked ${plural(b.talks[s.id].length, "question")}`) : null)))));
}

function pickPlace() {
  const b = bookOf();
  return h("section", { class: "stack" },
    bar("Search a place", { back: () => go("turn") }),
    h("h1", { class: "h2" }, "Where do you look?"),
    h("div", { class: "places" }, G.case.places.map((pl) => {
      const got = b.found[pl.id] || 0, done = got >= pl.clues;
      return h("button", { class: "place", type: "button", disabled: done, onClick: () => go("search", { id: pl.id }) },
        h("b", {}, pl.name), h("small", {}, pl.desc),
        h("span", { class: "left" }, done ? "Searched top to bottom" : got ? "Something else might be here" : "Not searched yet"));
    })));
}

/* ---------- questioning ---------- */
const MAX_Q = 3;
function interview() {
  const s = suspect(view.id), b = bookOf(), p = player();
  const talk = (b.talks[s.id] ||= []);
  const before = view.startAt ?? (view.startAt = talk.length);        // what was said on earlier turns shows faded
  const asked = talk.length - before;
  const out = MAX_Q - asked;
  const chat = h("div", { class: "chat" });
  const paint = () => chat.replaceChildren(
    ...talk.flatMap((t, i) => [
      t.ev ? h("div", { class: "msg ev" + (i < before ? " old" : "") }, h("span", { class: "who" }, "You show"), t.ev) : null,
      t.q ? h("div", { class: "msg q" + (i < before ? " old" : "") }, t.q) : null,
      h("div", { class: "msg a" + (i < before ? " old" : "") + (t.pending ? " typing" : "") }, h("span", { class: "who" }, s.name), ...speech(t.a)),
    ]).filter(Boolean));                                             // replaceChildren would print a null as "null"
  paint();
  const input = h("input", { class: "input", placeholder: out > 0 ? `Ask ${s.name.split(" ")[0]} anything…` : "No questions left this turn", maxlength: "240", disabled: out <= 0, "aria-label": "Your question", enterkeyhint: "send", "data-focus": "" });
  let busy = false;
  const ask = async (q, ev) => {
    q = (q || "").trim();
    if (busy || (!q && !ev) || MAX_Q - (talk.length - before) <= 0) return;
    busy = true;
    const history = talk.filter((t) => !t.pending).map((t) => ({ q: [t.ev ? `(shows evidence: ${t.ev})` : "", t.q].filter(Boolean).join(" "), a: t.a }));
    const turn_ = { q, ev: ev || "", a: "", pending: true, round: G.round, by: p.name };
    talk.push(turn_);
    render();
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: G.token, suspect: s.id, question: q, evidence: ev || "", history }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "They won't talk right now."); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        turn_.a += dec.decode(value, { stream: true });
        const bubble = $app.querySelector(".msg.a.typing");
        if (bubble) { bubble.replaceChildren(h("span", { class: "who" }, s.name), ...speech(turn_.a)); bubble.scrollIntoView({ block: "nearest" }); }
      }
    } catch (e) {
      talk.pop();
      toast(e.message);
      busy = false;
      render();
      return;
    }
    turn_.pending = false;
    turn_.a = turn_.a.trim() || "…";
    if (!G.acted) { G.acted = true; logEvent(`${p.name} questioned ${s.name}.`); }
    busy = false;
    save();
    render();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(input.value); });
  const first = s.name.split(" ")[0];
  const SUGGEST = [`Where were you ${G.case.victim.time}?`, `What was ${G.case.victim.name.split(" ")[0]} like to you?`, "Who do you think did it?", "Did you see or hear anything strange?", "What aren't you telling me?"];
  return h("section", { class: "interview" },
    bar(`Questioning ${first}`, { back: G.acted ? null : () => go("pickSuspect") }),
    h("div", { class: "suspect" }, mug(s), h("div", {}, h("b", {}, s.name), h("div", { class: "role" }, `${s.role}${s.age ? `, ${s.age}` : ""}`), h("p", { class: "small muted", style: { margin: "0.25rem 0 0" } }, s.look))),
    talk.length ? chat : h("p", { class: "empty" }, `${first} is waiting. Ask your first question, or show them something from your notebook.`),
    h("div", { class: "composer" },
      out > 0 ? h("div", { class: "asks" },
        b.clues.length ? h("button", { class: "chipbtn ev", type: "button", onClick: () => evidenceSheet((c) => ask(input.value, c)) }, "🔎 Show evidence") : null,
        SUGGEST.map((q) => h("button", { class: "chipbtn", type: "button", onClick: () => ask(q) }, q))) : null,
      out > 0 ? h("div", { class: "line" }, input, h("button", { class: "btn primary", type: "button", onClick: () => ask(input.value) }, "Ask")) : null,
      h("div", { class: "row" }, h("span", { class: "left-q" }, out > 0 ? `${plural(out, "question")} left` : "That's all your questions this turn."),
        h("span", { class: "spacer" }),
        G.acted ? h("button", { class: out > 0 ? "btn sm" : "btn primary sm", type: "button", onClick: endTurn }, "End my turn") : null)));
}

function evidenceSheet(onPick) {
  const b = bookOf();
  const scrim = h("div", { class: "sheet-scrim" });
  const close = () => { scrim.remove(); sheet.remove(); };
  scrim.addEventListener("click", close);
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Show evidence" },
    h("h3", {}, "Show them…"),
    h("div", { class: "cluelist" }, b.clues.map((c) => h("button", { class: "paper clue", type: "button", style: { border: 0, textAlign: "left", width: "100%" }, onClick: () => { close(); onPick(c.text); } },
      h("small", {}, `Found in ${place(c.place)?.name || "?"}`), c.text))),
    h("button", { class: "btn ghost block", type: "button", style: { marginTop: "0.8rem" }, onClick: close }, "Never mind"));
  document.body.append(scrim, sheet);
}

/* ---------- searching ---------- */
function search() {
  const pl = place(view.id), b = bookOf(), p = player();
  const box = h("div", { class: "stack" }, h("div", { class: "loading", style: { minHeight: "40vh" } },
    h("span", { class: "lens", html: `<svg viewBox="0 0 64 64">${ICONS.lens}</svg>` }), h("p", { class: "loadline" }, `Searching ${pl.name}…`)));
  if (!view.result && !view.started) {
    view.started = true;
    const n = b.found[pl.id] || 0;
    Promise.all([api("/api/search", { token: G.token, place: pl.id, n }), new Promise((r) => setTimeout(r, 1300))]).then(([d]) => {
      b.found[pl.id] = n + 1;
      const clue = { place: pl.id, text: d.clue, round: G.round, by: p.name };
      b.clues.push(clue);
      G.acted = true;
      logEvent(`${p.name} searched ${pl.name}.`);
      save();
      view.result = clue;
      render();
    }).catch((e) => { toast(e.message); go("pickPlace"); });
  }
  return h("section", { class: "stack" },
    bar(pl.name, { back: view.result ? null : () => go("pickPlace") }),
    view.result ? [
      h("span", { class: "label" }, "You found"),
      h("div", { class: "paper clue tilt" }, h("span", { class: "stamp" }, "EVIDENCE"), h("small", { class: "label", style: { display: "block", marginBottom: "0.5rem" } }, pl.name), view.result.text),
      h("p", { class: "muted small" }, team() ? "Added to the team notebook." : "Added to your notebook. Only you can see it, unless you tell the others."),
      h("button", { class: "btn primary block", type: "button", onClick: endTurn }, "End my turn"),
    ] : box);
}

/* ---------- the notebook ---------- */
function notebook() {
  const b = bookOf(), tab = view.tab || "clues";
  const back = () => go(view.from?.name || "turn", view.from || {});
  const tabs = [["clues", `Clues (${b.clues.length})`], ["talks", "Interviews"], ["suspects", "Suspects"], ["jot", "My notes"]];
  let body;
  if (tab === "clues") {
    body = b.clues.length ? h("div", { class: "cluelist" }, b.clues.map((c) => h("div", { class: "paper clue" }, h("small", {}, `${place(c.place)?.name} · round ${c.round}${team() && c.by ? ` · ${c.by}` : ""}`), c.text)))
      : h("p", { class: "empty" }, "No clues yet. Search a place to find one.");
  } else if (tab === "talks") {
    const who = G.case.suspects.filter((s) => (b.talks[s.id] || []).length);
    body = who.length ? h("div", { class: "stack" }, who.map((s) => h("div", { class: "card stack" },
      h("div", { class: "row" }, mug(s), h("b", {}, s.name)),
      h("div", { class: "chat" }, b.talks[s.id].filter((t) => !t.pending).flatMap((t) => [
        t.ev ? h("div", { class: "msg ev" }, h("span", { class: "who" }, "Shown"), t.ev) : null,
        t.q ? h("div", { class: "msg q" }, t.q) : null,
        h("div", { class: "msg a" }, ...speech(t.a))])))))
      : h("p", { class: "empty" }, "You haven't questioned anyone yet.");
  } else if (tab === "suspects") {
    body = h("div", { class: "suspects" }, G.case.suspects.map((s) => {
      const m = b.marks[s.id] || "";
      const set = (v) => { b.marks[s.id] = m === v ? "" : v; save(); render(); };
      return h("div", { class: "suspect" }, mug(s), h("div", {}, h("b", {}, s.name), h("div", { class: "role" }, s.role), h("p", { class: "quote" }, `“${s.statement}”`),
        h("div", { class: "marks", style: { marginTop: "0.5rem" } },
          h("button", { class: "markbtn sus" + (m === "sus" ? " on" : ""), type: "button", "aria-pressed": String(m === "sus"), onClick: () => set("sus") }, "Suspicious"),
          h("button", { class: "markbtn clear" + (m === "clear" ? " on" : ""), type: "button", "aria-pressed": String(m === "clear"), onClick: () => set("clear") }, "Cleared"))));
    }));
  } else {
    const ta = h("textarea", { class: "input", rows: "8", placeholder: "Theories, timelines, who's lying about what…", "aria-label": "Your notes" });
    ta.value = b.jot;
    ta.addEventListener("input", () => { b.jot = ta.value; save(); });
    body = ta;
  }
  return h("section", {},
    bar(team() ? "Team notebook" : `${player().name}'s notebook`, { back, book: false }),
    h("div", { class: "tabs", role: "tablist" }, tabs.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), class: tab === k ? "on" : "", onClick: () => { view.tab = k; render(); } }, label))),
    body,
    h("details", { class: "card", style: { marginTop: "1rem" } }, h("summary", {}, h("b", {}, "The case file")),
      h("p", { class: "small" }, h("b", {}, G.case.victim.name), `, ${G.case.victim.role}. ${G.case.victim.found} Died ${G.case.victim.time}. ${G.case.cause}`),
      h("p", { class: "small muted" }, "Motives: ", G.case.motive_options.join(" · ")),
      h("p", { class: "small muted" }, "Weapons: ", G.case.weapon_options.join(" · "))));
}

/* ---------- solving ---------- */
function solve() {
  const pick = view.pick || (view.pick = { suspect: null, motive: null, weapon: null });
  const p = player();
  const ready = pick.suspect && pick.motive != null && pick.weapon != null;
  const btn = (on, onClick, ...kids) => h("button", { class: "pickbtn" + (on ? " on" : ""), type: "button", "aria-pressed": String(on), onClick }, ...kids);
  const submit = async () => {
    if (!ready) return;
    if (!view.final && !confirm(`Accuse ${suspect(pick.suspect).name}? You only get one try.`)) return;
    try {
      const d = await api("/api/accuse", { token: G.token, suspect: pick.suspect, motive: pick.motive, weapon: pick.weapon, final: !!view.final });
      if (view.final) {
        const pts = (d.parts.killer ? 3 : 0) + (d.parts.motive ? 1 : 0) + (d.parts.weapon ? 1 : 0);
        Object.assign(p, { final: { ...pick, parts: d.parts }, score: pts });
        G.finalQueue.shift();
        save();
        return nextFinal();
      }
      if (d.right) {
        Object.assign(p, { final: { ...pick, parts: { killer: true, motive: true, weapon: true } }, score: 5, solved: true });
        G.winner = G.turn;
        logEvent(`${p.name} solved the case!`);
        return finish();
      }
      p.out = true;
      p.score = 0;
      p.final = { ...pick, wrong: true };
      logEvent(`${p.name} accused ${suspect(pick.suspect).name}, and was wrong. They're out.`);
      save();
      go("wrong");
    } catch (e) { toast(e.message); }
  };
  return h("section", { class: "stack", style: { gap: "1.1rem" } },
    bar(view.final ? "Final accusation" : "Solve the case", { back: view.final ? null : () => go("turn"), book: !view.final }),
    h("div", {}, h("span", { class: "label" }, view.final ? `${p.name}, the night is over` : `${p.name}, one shot`),
      h("h1", { class: "h2", style: { marginTop: "0.3rem" } }, "Who did it, why, and how?"),
      h("p", { class: "muted small" }, view.final ? "Killer 3 points, motive 1, weapon 1." : "All three right and you win now. Anything wrong and you're out of the game.")),
    view.final ? h("button", { class: "btn sm", type: "button", onClick: () => go("notebook", { from: { name: "solve", final: true, pick } }) }, "Check my notebook first") : null,
    h("span", { class: "label" }, "The killer"),
    h("div", { class: "pick" }, G.case.suspects.map((s) => btn(pick.suspect === s.id, () => { pick.suspect = s.id; render(); }, mug(s), h("span", {}, h("b", {}, s.name), h("br"), h("small", { class: "muted" }, s.role))))),
    h("span", { class: "label" }, "The motive"),
    h("div", { class: "pick" }, G.case.motive_options.map((m, i) => btn(pick.motive === i, () => { pick.motive = i; render(); }, m))),
    h("span", { class: "label" }, "The weapon"),
    h("div", { class: "pick" }, G.case.weapon_options.map((m, i) => btn(pick.weapon === i, () => { pick.weapon = i; render(); }, m))),
    h("button", { class: "btn danger block", type: "button", disabled: !ready, onClick: submit }, view.final ? "Seal my accusation" : "Make the accusation"));
}

function wrong() {
  const p = player();
  const anyone = active().length > 0;
  return h("section", { class: "pass" },
    h("span", { class: "label" }, "Wrong"),
    h("h1", { class: "who" }, "Not quite."),
    h("p", { class: "lead" }, `Something in that accusation is wrong, ${p.name}. You're out of the running${anyone ? ", but keep your lips sealed... or don't." : "."}`),
    h("button", { class: "btn primary", type: "button", onClick: () => (anyone ? endTurn() : finish()) }, anyone ? "Pass the phone on" : "See what really happened"));
}

/* ---------- the end ---------- */
function revealing() {
  return h("section", { class: "loading" }, h("span", { class: "lens", html: `<svg viewBox="0 0 64 64">${ICONS.lens}</svg>` }), h("h1", { class: "h2" }, "Opening the sealed envelope…"));
}

function reveal() {
  if (!G) return home();
  const a = G.answer;
  if (!a) return h("section", { class: "stack" }, bar("The end", { book: false }), h("p", { class: "error" }, view.error || "Couldn't open the answer."), h("button", { class: "btn primary", type: "button", onClick: finish }, "Try again"));
  const k = suspect(a.killer);
  const ranked = G.players.map((p, i) => ({ ...p, i, score: p.score || 0 })).sort((x, y) => y.score - x.score);
  const top = ranked[0]?.score || 0;
  const caught = G.players.some((p) => p.final?.parts?.killer);
  const tick = (ok) => h("span", { class: ok ? "yes" : "no" }, ok ? "✓" : "✗");
  return h("section", { class: "reveal" },
    bar("Case closed", { book: false }),
    h("div", { class: "culprit" }, h("span", { class: "label" }, "The killer was"), mug(k), h("h1", { class: "display", style: { fontSize: "clamp(2rem, 8vw, 2.8rem)" } }, k.name),
      h("p", { class: "muted" }, k.role),
      h("p", { class: "lead" }, G.winner != null ? `${G.players[G.winner].name} cracked it on round ${G.round}.` : caught ? "Caught at the final accusation." : "They got away with it.")),
    h("div", { class: "card" }, h("span", { class: "label" }, "Why and how"),
      h("p", {}, h("b", {}, "Motive: "), G.case.motive_options[a.motive]), h("p", {}, h("b", {}, "Weapon: "), G.case.weapon_options[a.weapon])),
    G.players.length > 1 || G.players[0].final ? h("div", { class: "scores" }, ranked.map((p) => h("div", { class: "score" + (p.score && p.score === top ? " win" : "") }, dot(p),
      h("span", {}, h("b", {}, p.name), h("small", {}, p.final?.wrong ? `Accused ${suspect(p.final.suspect)?.name} too early: out` : p.final ? [tick(p.final.parts.killer), " killer ", tick(p.final.parts.motive), " motive ", tick(p.final.parts.weapon), " weapon"] : "No accusation")),
      h("span", { class: "pts" }, String(p.score))))) : null,
    h("div", { class: "paper" }, h("span", { class: "label" }, "What really happened"), h("p", { style: { marginTop: "0.6rem" } }, a.solution),
      a.timeline?.length ? h("ol", { class: "timeline" }, a.timeline.map((t) => h("li", {}, t))) : null),
    h("div", {}, h("span", { class: "label" }, "Everyone's secrets")),
    h("div", { class: "suspects" }, G.case.suspects.map((s) => h("div", { class: "suspect" }, mug(s), h("div", {}, h("b", {}, s.name, s.id === a.killer ? " 🔪" : ""), h("p", { class: "small", style: { margin: "0.3rem 0 0" } }, a.secrets[s.id]))))),
    h("button", { class: "btn primary block", type: "button", onClick: () => { draft.names = G.players.map((p) => p.name); draft.mode = G.mode; G = null; save(); go("setup"); } }, "Play a new case"),
    h("button", { class: "btn ghost block", type: "button", onClick: () => { G = null; save(); go("home"); } }, "Back to the start"));
}

addEventListener("pagehide", save);
fetch("/api/status").then((r) => r.json()).then((d) => { if (!d.enabled) toast("The AI isn't switched on for this site yet, so new cases can't be written.", 6000); }).catch(() => {});
render();
