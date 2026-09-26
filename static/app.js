/* Alibi: the phone. Each player's phone shows only their own view of the game, polled from the server once a second.

   Screens follow the game's phase: home → lobby → your secret role → the day (pick a room each hour) → the body →
   look back and argue in the chat → vote → the result → the next day, or the end with the whole truth. */
"use strict";

const $app = document.getElementById("app");
const ME = "alibi.me";
const POLL = 1000;

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;                 // only ever our own markup
    else if (k === "style" && typeof v === "object") for (const [prop, val] of Object.entries(v)) { if (prop.startsWith("--")) el.style.setProperty(prop, val); else el.style[prop] = val; }
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
function toast(msg, ms = 2800) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const LENS = '<svg viewBox="0 0 64 64"><circle cx="27" cy="27" r="13" fill="none" stroke="#e8c46a" stroke-width="5"/><path d="M36.5 36.5 L50 50" stroke="#e8c46a" stroke-width="7" stroke-linecap="round"/><circle cx="27" cy="27" r="4" fill="#c7402f"/></svg>';

/* a face drawn from a name: the same player always looks the same */
function portrait(name) {
  let seed = 7;
  for (const ch of String(name)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const skin = pick(["#f1d3b8", "#e8b996", "#d49a74", "#b67a52", "#8d5a3b", "#6a4029"]);
  const hair = pick(["#1f1712", "#3b2a1e", "#6b4a2b", "#a0692f", "#c9a063", "#7a2e1d", "#2b2b2b", "#d8d4cc"]);
  const coat = pick(["#2e3b4e", "#4a2f2a", "#2f4436", "#3d3d3d", "#5a4a2a", "#46304f", "#1f2a33"]);
  const style = pick(["short", "short", "long", "bob", "bald", "curly", "slick", "bun"]);
  const hairBack = style === "long" ? `<path d="M15 32 Q13 58 20 62 L40 62 Q47 58 45 32 Z" fill="${hair}"/>` : style === "bob" ? `<path d="M15 30 Q14 50 19 51 L41 51 Q46 50 45 30 Z" fill="${hair}"/>` : "";
  const top = {
    short: `<path d="M17 30 Q18 16 30 16 Q42 16 43 30 Q40 22 30 22 Q20 22 17 30Z" fill="${hair}"/>`,
    long: `<path d="M16 32 Q16 15 30 15 Q44 15 44 32 Q40 21 30 21 Q20 21 16 32Z" fill="${hair}"/>`,
    bob: `<path d="M16 32 Q16 15 30 15 Q44 15 44 32 Q38 20 26 22 Q20 24 16 32Z" fill="${hair}"/>`,
    bald: `<path d="M17 29 Q17 25 19 24 M43 29 Q43 25 41 24" stroke="${hair}" stroke-width="2.5" fill="none"/>`,
    curly: [18, 23, 28, 33, 38, 42].map((x, i) => `<circle cx="${x}" cy="${20 + (i % 2) * 2}" r="5" fill="${hair}"/>`).join(""),
    slick: `<path d="M17 29 Q16 16 31 16 Q44 17 43 29 Q37 19 22 23Z" fill="${hair}"/>`,
    bun: `<circle cx="30" cy="12" r="5" fill="${hair}"/><path d="M17 30 Q18 16 30 16 Q42 16 43 30 Q40 21 30 21 Q20 21 17 30Z" fill="${hair}"/>`,
  }[style];
  const b = pick([0, -2, 2]);
  const extras = (rnd() < 0.28 ? `<circle cx="25" cy="35" r="3.6" fill="none" stroke="#1b130e" stroke-width="1.2"/><circle cx="35" cy="35" r="3.6" fill="none" stroke="#1b130e" stroke-width="1.2"/><path d="M28.6 35h2.8" stroke="#1b130e" stroke-width="1.2"/>` : "")
    + (rnd() < 0.2 ? `<path d="M25 42 Q30 40 35 42 Q30 44 25 42Z" fill="${hair}"/>` : "")
    + (rnd() < 0.16 ? `<path d="M13 22 L47 22 L42 18 Q41 9 30 9 Q19 9 18 18Z" fill="#1c1a18"/><rect x="18" y="16.5" width="24" height="2.2" fill="#6b1f16"/>` : "");
  return `<svg viewBox="0 0 60 70" aria-hidden="true">${hairBack}<rect x="25" y="47" width="10" height="9" fill="${skin}"/><path d="M8 70 Q10 55 30 54 Q50 55 52 70Z" fill="${coat}"/>`
    + `<ellipse cx="30" cy="35" rx="13" ry="15.5" fill="${skin}"/><ellipse cx="17" cy="36" rx="2" ry="3" fill="${skin}"/><ellipse cx="43" cy="36" rx="2" ry="3" fill="${skin}"/>${top}`
    + `<path d="M22 ${31 + b} l5 ${-b}" stroke="#2a1d14" stroke-width="1.6"/><path d="M38 ${31 + b} l-5 ${-b}" stroke="#2a1d14" stroke-width="1.6"/><circle cx="25" cy="35" r="1.5" fill="#1b130e"/><circle cx="35" cy="35" r="1.5" fill="#1b130e"/>`
    + `<path d="M26 45 Q30 ${45 + pick([2, 0, -2])} 34 45" stroke="#6b3a2c" stroke-width="1.5" fill="none"/>${extras}</svg>`;
}
const face = (p, cls = "") => h("span", { class: `face ${cls}${p.alive === false ? " dead" : ""}`, style: { "--c": p.color || "#e8c46a" }, html: portrait(p.name), "aria-hidden": "true" });

/* ---------- sound: made on the spot, no files ---------- */
const sound = { on: localStorage.getItem("alibi.sound") !== "off", ctx: null };
function sfx(kind) {
  if (!sound.on) return;
  try {
    const ctx = (sound.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const t = ctx.currentTime;
    const tone = (f, at, dur, type = "sine", vol = 0.12) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t + at);
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(ctx.destination); o.start(t + at); o.stop(t + at + dur + 0.05);
    };
    const noise = (at, dur, vol, freq) => {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = "lowpass"; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f).connect(g).connect(ctx.destination); src.start(t + at);
    };
    ({
      tick: () => tone(880, 0, 0.08, "square", 0.03),
      hour: () => { tone(523, 0, 0.3); tone(784, 0.1, 0.4); },
      scream: () => { noise(0, 1.6, 0.8, 500); tone(880, 0, 0.9, "sawtooth", 0.05); tone(660, 0.3, 1.0, "sawtooth", 0.04); },
      msg: () => tone(1200, 0, 0.07, "triangle", 0.05),
      vote: () => { tone(330, 0, 0.2, "triangle"); tone(262, 0.18, 0.4, "triangle"); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.45, "triangle", 0.1)),
      lose: () => { tone(220, 0, 0.4, "sawtooth", 0.06); tone(165, 0.3, 0.8, "sawtooth", 0.06); },
      role: () => { tone(110, 0, 1.2, "sawtooth", 0.05); tone(165, 0.2, 1.1, "sawtooth", 0.04); },
    })[kind]?.();
  } catch { /* no audio */ }
}
const soundBtn = () => h("button", { class: "ibtn", type: "button", "aria-label": sound.on ? "Sound on" : "Sound off", title: sound.on ? "Sound on" : "Sound off",
  onClick: () => { sound.on = !sound.on; try { localStorage.setItem("alibi.sound", sound.on ? "on" : "off"); } catch { /* ignore */ } render(); } }, sound.on ? "🔊" : "🔇");

/* ---------- connection ---------- */
// this tab's seat first (two tabs are two players); the last seat on this phone lets a closed browser rejoin
let me = (() => { try { return JSON.parse(sessionStorage.getItem(ME) || localStorage.getItem(ME) || "null"); } catch { return null; } })();
let S = null;                   // the latest view from the server
let clockSkew = 0;              // server time minus ours
let ui = { tab: "chat", room: null, act: null, take: null, put: false, strike: false, revealed: false, draft: null, changing: false };
let lastPhaseKey = "";

const saveMe = () => {
  try {
    for (const store of [sessionStorage, localStorage]) { if (me) store.setItem(ME, JSON.stringify(me)); else store.removeItem(ME); }
  } catch { /* ignore */ }
};
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Something went wrong."), { status: r.status });
  return d;
}
async function act(type, extra = {}) {
  try {
    const d = await post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type, ...extra });
    if (type === "choose") ui.changing = false;
    accept(d);
  } catch (e) { toast(e.message); }
}
function accept(d) {
  if (d.now) clockSkew = d.now * 1000 - Date.now();
  if (d.same) return;
  const before = S;
  S = d;
  const key = `${d.phase}|${d.day}|${d.hour}`;
  if (key !== lastPhaseKey) {                                   // a new phase: reset what was half-picked and make a sound
    lastPhaseKey = key;
    ui = { ...ui, room: null, act: null, take: null, put: false, strike: false, draft: null, changing: false };
    if (d.phase === "roles") ui.revealed = false;
    if (before) sfx({ roles: "role", day: "hour", body: "scream", vote: "vote", over: d.winner && ((d.winner === "killers") === (d.me.role === "killer")) ? "win" : "lose" }[d.phase] || "tick");
    window.scrollTo({ top: 0 });
  }
  const newMsgs = (d.chat?.length || 0) - (before?.chat?.length || 0);
  if (before && newMsgs > 0 && d.chat[d.chat.length - 1].pid !== d.me.pid) sfx("msg");
  render();
}
let polling = null;
async function poll() {
  if (!me) return;
  try {
    const q = new URLSearchParams({ pid: me.pid, token: me.token, v: S?.v ?? "" });
    const r = await fetch(`/api/game/${me.code}?${q}`, { cache: "no-store" });
    if (r.status === 404 || r.status === 403) { const d = await r.json().catch(() => ({})); me = null; S = null; saveMe(); clearInterval(polling); toast(d.error || "That game is over."); render(); return; }
    accept(await r.json());
  } catch { /* offline for a moment: try again next tick */ }
}
function startPolling() { clearInterval(polling); polling = setInterval(poll, POLL); poll(); }

const serverNow = () => Date.now() + clockSkew;
const secsLeft = (deadline) => (deadline ? Math.max(0, Math.ceil(deadline - serverNow() / 1000)) : 0);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const timer = (deadline) => h("span", { class: "tag clock", "data-deadline": deadline || "" }, "⏳ ", h("span", {}, fmt(secsLeft(deadline))));
setInterval(() => {
  for (const el of document.querySelectorAll("[data-deadline]")) {
    const s = secsLeft(+el.dataset.deadline);
    el.lastChild.textContent = fmt(s);
    el.classList.toggle("hurry", s > 0 && s <= 10);
  }
}, 250);

/* ---------- rendering, keeping what you're typing ---------- */
function render() {
  const active = document.activeElement?.dataset?.keep || null;
  const kept = Object.fromEntries([...document.querySelectorAll("[data-keep]")].map((el) => [el.dataset.keep, el.value]));
  const chatBox = document.querySelector(".chatlog");
  const nearBottom = !chatBox || chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
  const el = screen();
  $app.replaceChildren(el);
  for (const [k, v] of Object.entries(kept)) { const x = el.querySelector(`[data-keep="${k}"]`); if (x && v) x.value = v; }
  if (active) { const x = el.querySelector(`[data-keep="${active}"]`); if (x) { x.focus({ preventScroll: true }); try { x.setSelectionRange(x.value.length, x.value.length); } catch { /* ignore */ } } }
  const log_ = el.querySelector(".chatlog");
  if (log_ && nearBottom) log_.scrollTop = log_.scrollHeight;
}

function screen() {
  if (!me) return home();
  if (!S) return h("section", { class: "loading" }, h("span", { class: "lens", html: LENS }), h("p", { class: "loadline" }, "Joining the game…"));
  const fn = { lobby, roles, day, body, quiet, talk, vote, result, over }[S.phase] || lobby;
  return fn();
}

const bar = (title, ...right) => h("div", { class: "bar" },
  h("span", { class: "logo-sm", html: LENS }), h("span", { class: "title" }, title), h("span", { class: "spacer" }), ...right, soundBtn());
const who = (pid) => S.players.find((p) => p.pid === pid);
const roomName = (id) => S.rooms.find((r) => r.id === id)?.name || id;
const roleChip = () => h("button", { class: "tag role-chip", type: "button", onClick: () => { ui.revealed = !ui.revealed; render(); } },
  ui.revealed ? (S.me.role === "killer" ? "🔪 Killer" : "🕯️ Guest") : "👁 My role");
const ghostBanner = () => (!S.me.alive ? h("div", { class: "ghost" }, "👻 ", S.me.ejected ? "You were voted out." : "You're dead.",
  " You can watch everything. Only other ghosts can read what you write.") : null);

/* ---------- home ---------- */
function home() {
  const joinCode = (location.hash.match(/join\/(\w{4})/i) || [])[1]?.toUpperCase() || "";
  const name = h("input", { class: "input", placeholder: "Your name", maxlength: "16", value: localStorage.getItem("alibi.name") || "", "aria-label": "Your name", autocomplete: "nickname", "data-keep": "name" });
  const code = h("input", { class: "input code-in", placeholder: "CODE", maxlength: "4", "aria-label": "Game code", autocapitalize: "characters", autocomplete: "off", "data-keep": "code", value: joinCode });
  const go = async (mode, extra = {}) => {
    const n = name.value.trim();
    if (!n) { name.focus(); toast("Type your name first."); return; }
    try { localStorage.setItem("alibi.name", n); } catch { /* ignore */ }
    try {
      const d = await post("/api/play", { name: n, mode, ...extra });
      me = { code: d.code, pid: d.pid, token: d.token };
      saveMe();
      history.replaceState(null, "", "/");
      S = null;
      render();
      startPolling();
    } catch (e) { toast(e.message, 4000); }
  };
  const join = () => { const c = code.value.trim().toUpperCase(); if (c.length !== 4) { toast("Game codes have 4 letters."); code.focus(); return; } go("join", { code: c }); };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  return h("section", { class: "home" },
    h("div", { class: "logo" }, h("span", { html: LENS }), h("span", { class: "label" }, "A murder party game")),
    h("div", {}, h("h1", { class: "display" }, "Alibi"),
      h("p", { class: "tagline" }, "One of you is a killer. Spend a normal day at the manor, find the body, then look back at who was where.")),
    joinCode ? h("div", { class: "card" }, h("b", {}, `You've been invited to game ${joinCode}.`), h("p", { class: "muted small" }, "Type your name and tap Join.")) : null,
    h("label", { class: "field" }, h("span", {}, "Your name"), name),
    h("div", { class: "stack" },
      h("div", { class: "joinrow" }, code, h("button", { class: "btn" + (joinCode ? " primary" : ""), type: "button", onClick: join }, "Join a game")),
      h("button", { class: "btn primary block", type: "button", onClick: () => go("create") }, "👨‍👩‍👧 Start a game for family or friends"),
      h("button", { class: "btn block", type: "button", onClick: () => go("queue") }, "🌍 Find a game online"),
      h("button", { class: "btn block", type: "button", onClick: () => go("bots") }, "🤖 Play with bots")),
    h("div", { class: "card" }, h("span", { class: "label" }, "How to play"),
      h("ol", { class: "howto", style: { marginTop: "0.8rem" } },
        h("li", {}, h("span", {}, h("b", {}, "Everyone on their own phone. "), "4 to 8 players; bots fill empty chairs. One of you is secretly the killer (two in a big game).")),
        h("li", {}, h("span", {}, h("b", {}, "A normal day. "), "Every hour, pick a room and what to do there. Anyone can pick up things lying around: the candlestick, the rope, the kitchen knife…")),
        h("li", {}, h("span", {}, h("b", {}, "The killer strikes "), "when they're alone with someone and already carrying a weapon. Walk into that room later and you'll find the body.")),
        h("li", {}, h("span", {}, h("b", {}, "Look back. "), "You only know what you saw: who was with you and who took what. Everyone sees what's missing and how the victim died.")),
        h("li", {}, h("span", {}, h("b", {}, "Talk, then vote. "), "Share your day in the chat (the killer lies), then vote someone out. Catch every killer to win; if the killers outnumber the rest, they win.")))),
    h("div", { class: "row" }, soundBtn(), h("span", { class: "muted small" }, sound.on ? "Sound is on" : "Sound is off")));
}

/* ---------- the lobby ---------- */
function lobby() {
  const humans = S.players.filter((p) => !p.bot), bots = S.players.filter((p) => p.bot);
  const mine = who(S.me.pid);
  const link = `${location.origin}/#join/${S.code}`;
  const share = async () => {
    const text = `Come play Alibi with me! Code ${S.code}`;
    try { if (navigator.share) { await navigator.share({ title: "Alibi", text, url: link }); return; } } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text}: ${link}`); toast("Link copied. Send it to everyone."); } catch { toast(link, 8000); }
  };
  return h("section", { class: "stack", style: { gap: "1.1rem" } },
    bar(S.public ? "Finding players" : "Your game", h("button", { class: "btn ghost sm", type: "button", onClick: leave }, "Leave")),
    S.public
      ? h("div", { class: "card stack" }, h("h1", { class: "h2" }, "Looking for players…"),
        h("p", { class: "muted" }, "The game starts when the timer runs out, or as soon as 8 people join. Empty chairs get bots."), h("div", {}, S.start_at ? timer(S.start_at) : null))
      : h("div", { class: "card codecard" }, h("span", { class: "label" }, "Game code"), h("div", { class: "bigcode" }, S.code),
        h("p", { class: "muted small" }, "Everyone opens this site on their own phone and joins with the code, or with the link."),
        h("button", { class: "btn primary", type: "button", onClick: share }, "📤 Send the link")),
    h("div", { class: "card" }, h("span", { class: "label" }, `Players · ${S.players.length} of 8`),
      h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("b", {}, p.name, p.pid === S.me.pid ? " (you)" : ""),
        p.bot ? h("span", { class: "tag" }, "🤖 bot") : p.host ? h("span", { class: "tag" }, "host") : null, h("span", { class: "spacer" }),
        p.bot ? null : h("span", { class: p.ready ? "yes" : "muted" }, p.ready ? "✓ Ready" : "Not ready"))))),
    !S.public && S.me.host ? h("div", { class: "card row" }, h("span", {}, h("b", {}, "Bots"), h("br"), h("small", { class: "muted" }, "Fill empty chairs. At least 4 players in all.")), h("span", { class: "spacer" }),
      h("div", { class: "stepper" }, h("button", { type: "button", "aria-label": "One bot fewer", disabled: !bots.length, onClick: () => act("bots", { n: bots.length - 1 }) }, "−"),
        h("b", {}, String(bots.length)), h("button", { type: "button", "aria-label": "One more bot", disabled: S.players.length >= 8, onClick: () => act("bots", { n: bots.length + 1 }) }, "+"))) : null,
    !S.public ? h("button", { class: "btn block " + (mine?.ready ? "" : "primary"), type: "button", onClick: () => act("ready", { on: !mine?.ready }) }, mine?.ready ? "Not ready yet" : "I'm ready") : null,
    !S.public ? h("p", { class: "muted small center" }, S.start_at ? ["Everyone's ready. Starting in ", timer(S.start_at)]
      : `${humans.filter((p) => p.ready).length} of ${humans.length} ready. It starts as soon as everyone is.${S.players.length < 4 ? " Bots will fill it up to 4." : ""}`) : null);
}
async function leave() {
  try { await post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type: "leave" }); } catch { /* ignore */ }
  me = null; S = null; saveMe(); clearInterval(polling); render();
}

/* ---------- your secret ---------- */
function roles() {
  const killer = S.me.role === "killer";
  const fellow = S.players.filter((p) => p.role === "killer" && p.pid !== S.me.pid);
  return h("section", { class: "pass" },
    h("span", { class: "label" }, "Your secret"),
    !ui.revealed ? [h("p", { class: "lead" }, "Cover your screen, then tap to see who you are."),
      h("button", { class: "btn primary", type: "button", onClick: () => { ui.revealed = true; render(); } }, "Show my role")]
      : h("div", { class: "rolecard " + (killer ? "killer" : "guest") },
        h("div", { class: "role-emoji" }, killer ? "🔪" : "🕯️"),
        h("h1", { class: "who" }, killer ? "You are the killer" : "You are a guest"),
        h("p", {}, killer ? "Pick up a weapon, get someone alone, strike. Then lie about where you were." : "Go about your day. Remember who you were with and who picked up what."),
        fellow.length ? h("p", { class: "small" }, "Your partner in crime: ", h("b", {}, fellow.map((p) => p.name).join(", "))) : null),
    h("p", { class: "muted small" }, "The day begins in ", timer(S.deadline)));
}

/* ---------- the day ---------- */
function day() {
  const hr = S.hours[S.hour], mine = S.myday || [];
  const last = mine[mine.length - 1];
  const chosen = ui.changing ? null : S.chosen;
  const room = ui.room && S.rooms.find((r) => r.id === ui.room);
  const killer = S.me.role === "killer";
  const header = h("div", { class: "dayhead" },
    h("div", { class: "meta" }, h("span", { class: "tag" }, `Day ${S.day}`), h("span", { class: "tag hour" }, `🕰️ ${hr}`), timer(S.deadline), roleChip()),
    S.me.carrying ? h("p", { class: "carry" }, "You're carrying the ", h("b", {}, S.me.carrying), ".") : null);
  const recap = last ? h("div", { class: "card recap" }, h("span", { class: "label" }, `At ${last.hour}`),
    h("p", {}, `You were in the ${roomName(last.room)} `, last.saw.length ? ["with ", h("b", {}, last.saw.join(", ")), "."] : "on your own."),
    last.events.map((e) => h("p", { class: "small ev" }, e))) : h("p", { class: "muted" }, "Morning at the manor. Everyone drifts off to start their day…");
  if (!S.me.alive) {
    return h("section", { class: "stack" }, bar(`Day ${S.day}`), ghostBanner(), header, h("p", { class: "lead" }, `It's ${hr}. The living are choosing where to go.`), ghostChat());
  }
  if (chosen) {
    return h("section", { class: "stack" }, bar(`Day ${S.day}`), header, recap,
      h("div", { class: "card center stack" }, h("span", { class: "big-emoji" }, S.rooms.find((r) => r.id === chosen.room).emoji),
        h("b", {}, `${hr}: the ${roomName(chosen.room)}`),
        h("span", { class: "muted small" }, [chosen.act, chosen.take && `take the ${chosen.take}`, chosen.put && "put back what you're carrying", chosen.strike && "🔪 strike if alone"].filter(Boolean).join(" · ")),
        h("p", { class: "muted small" }, "Waiting for the others…"),
        h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.changing = true; ui.room = chosen.room; ui.act = chosen.act; render(); } }, "Change my mind")));
  }
  const pickRoom = h("div", { class: "rooms" }, S.rooms.map((r) => h("button", { class: "roombtn" + (ui.room === r.id ? " on" : ""), type: "button", "aria-pressed": String(ui.room === r.id),
    onClick: () => { ui.room = r.id; ui.act = r.acts[0]; ui.take = null; ui.put = false; render(); } }, h("span", { class: "big-emoji" }, r.emoji), h("b", {}, r.name))));
  let details = null;
  if (room) {
    const opt = (on, label, fn, cls = "") => h("button", { class: `optbtn ${cls}${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), onClick: fn }, label);
    const home = S.me.carrying && S.rooms.find((r) => r.items.includes(S.me.carrying))?.id === room.id;
    details = h("div", { class: "card stack" },
      h("span", { class: "label" }, `In the ${room.name}`),
      h("div", { class: "opts2" }, room.acts.map((a) => opt(ui.act === a, a, () => { ui.act = a; render(); }))),
      S.me.carrying ? null : h("div", { class: "opts2" }, room.items.map((it) => opt(ui.take === it, `✋ Take the ${it}`, () => { ui.take = ui.take === it ? null : it; render(); }))),
      home ? opt(ui.put, `↩️ Put back the ${S.me.carrying}`, () => { ui.put = !ui.put; render(); }) : null,
      S.me.carrying && !home ? h("p", { class: "muted small" }, `Your hands are full. You can put the ${S.me.carrying} back in the room it came from.`) : null,
      killer ? opt(ui.strike, S.me.carrying ? `🔪 Strike if I end up alone with someone` : "🔪 You need a weapon first", () => { if (!S.me.carrying) return toast("Take a weapon this hour; you can strike from the next one."); ui.strike = !ui.strike; render(); }, "strike") : null,
      h("button", { class: "btn primary block", type: "button", onClick: () => act("choose", { room: room.id, act: ui.act, take: ui.take, put: ui.put, strike: ui.strike }) }, `Go to the ${room.name}`));
  }
  return h("section", { class: "stack" }, bar(`Day ${S.day}`), header, recap,
    h("h2", { class: "h2" }, `Where will you be at ${hr}?`), pickRoom, details);
}

/* ---------- the body ---------- */
function bodyCard(compact = false) {
  const b = S.body;
  if (!b) return null;
  return h("div", { class: "paper body-card" + (compact ? " compact" : "") }, h("span", { class: "stamp" }, "DECEASED"),
    h("span", { class: "label" }, "The body"),
    h("h2", {}, b.victim), h("p", {}, `Found in the ${b.room} ${b.foundAt === "dusk" ? "at dusk" : `at ${b.foundAt}`}${b.foundBy.length ? ` by ${b.foundBy.join(" and ")}` : ""}.`),
    h("p", {}, h("b", {}, "Died around "), b.hour, ", ", b.cause, "."),
    S.missing?.length ? h("p", {}, h("b", {}, "Missing from the house: "), S.missing.map((m) => `the ${m.item} (${m.room})`).join(", "), ".") : h("p", {}, "Nothing is missing from the house."));
}
function body() {
  return h("section", { class: "stack" }, bar(`Day ${S.day}`),
    h("div", { class: "scream" }, h("span", { class: "label" }, "A scream rings through the manor"), h("h1", { class: "display" }, `${S.body?.victim || "Someone"} is dead.`)),
    ghostBanner(), bodyCard(), h("p", { class: "muted small center" }, "Look back at your day. The talking starts in ", timer(S.deadline)), dayLog());
}
function quiet() {
  return h("section", { class: "pass" }, h("span", { class: "label" }, `Day ${S.day} ends`), h("h1", { class: "who" }, "Nobody died today."),
    h("p", { class: "lead" }, "But the killer is still among you, and someone has been picking things up…"),
    S.missing?.length ? h("p", {}, h("b", {}, "Missing: "), S.missing.map((m) => `the ${m.item}`).join(", ")) : null, h("p", { class: "muted small" }, "The talking starts in ", timer(S.deadline)));
}
/** Your day, hour by hour: the only witness statement you can trust. */
function dayLog() {
  const mine = S.myday || [];
  if (!mine.length) return null;
  return h("div", { class: "card" }, h("span", { class: "label" }, "Your day"),
    h("ol", { class: "daylog" }, mine.map((e) => h("li", {}, h("span", { class: "t" }, e.hour),
      h("span", {}, h("b", {}, roomName(e.room)), e.saw.length ? [" with ", e.saw.join(", ")] : " alone", e.idle ? h("em", { class: "muted" }, " (you didn't choose)") : null,
        e.events.map((x) => h("span", { class: "ev" }, x)))))));
}

/* ---------- talk ---------- */
function chatLog() {
  const msgs = S.chat || [];
  return h("div", { class: "chatlog", role: "log", "aria-live": "polite" }, msgs.map((m) => h("div", { class: "cmsg" + (m.pid === S.me.pid ? " mine" : "") + (m.ghost ? " ghostmsg" : "") },
    face({ name: m.name, color: m.color }, "sm"),
    h("div", {}, h("b", { style: { color: m.color } }, m.name, m.bot ? " 🤖" : "", m.ghost ? " 👻" : ""),
      m.claim ? h("div", { class: "claim" }, m.claim.map((c) => h("span", {}, h("i", {}, c.hour), " ", c.room))) : h("p", {}, m.text)))),
    !msgs.length ? h("p", { class: "muted small center" }, "Nobody has said anything yet. Start with where you were.") : null);
}
function composer() {
  const input = h("input", { class: "input", placeholder: S.me.alive ? "Say something…" : "Whisper to the other ghosts…", maxlength: "200", "aria-label": "Chat message", "data-keep": "chat", enterkeyhint: "send", autocomplete: "off" });
  const send = async () => { const t = input.value.trim(); if (!t) return; input.value = ""; await act("chat", { text: t }); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  return h("div", { class: "composer" }, h("div", { class: "line" }, input, h("button", { class: "btn primary", type: "button", onClick: send }, "Send")));
}
function ghostChat() {
  return h("div", { class: "card stack" }, h("span", { class: "label" }, "Ghost chat"), chatLog(), composer());
}
function claimSheet() {
  const hours = (S.myday || []).map((e) => e.i);
  ui.draft = ui.draft || Object.fromEntries((S.myday || []).map((e) => [e.i, e.room]));
  const scrim = h("div", { class: "sheet-scrim" });
  const close = () => { scrim.remove(); sheet.remove(); };
  scrim.addEventListener("click", close);
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Share my day" },
    h("h3", {}, "Share your day"),
    h("p", { class: "muted small" }, S.me.role === "killer" ? "It's filled in with the truth. You might want to… adjust it." : "Filled in with where you really were. Everyone will see it."),
    h("div", { class: "stack" }, hours.map((i) => {
      const sel = h("select", { class: "input", "aria-label": S.hours[i] }, S.rooms.map((r) => h("option", { value: r.id, selected: ui.draft[i] === r.id }, `${r.emoji} ${r.name}`)));
      sel.addEventListener("change", () => { ui.draft[i] = sel.value; });
      return h("label", { class: "claimrow" }, h("span", {}, S.hours[i]), sel);
    })),
    h("button", { class: "btn primary block", type: "button", style: { marginTop: "1rem" }, onClick: () => { close(); act("claim", { claim: ui.draft }); } }, "Post it in the chat"));
  document.body.append(scrim, sheet);
}
function talk() {
  const alive = S.players.filter((p) => p.alive && !p.bot);
  const readyN = alive.filter((p) => p.readyToVote).length;
  const claimed = who(S.me.pid)?.claimed;
  const tabs = h("div", { class: "tabs" }, [["chat", "💬 Chat"], ["evidence", "🔎 Evidence"], ["people", "👥 Who said what"]].map(([k, l]) =>
    h("button", { type: "button", class: ui.tab === k ? "on" : "", onClick: () => { ui.tab = k; render(); } }, l)));
  let main;
  if (ui.tab === "evidence") main = h("div", { class: "stack" }, bodyCard(true) || h("div", { class: "card" }, "Nobody died today.", S.missing?.length ? ` Missing: ${S.missing.map((m) => `the ${m.item}`).join(", ")}.` : ""), dayLog());
  else if (ui.tab === "people") {
    main = h("div", { class: "plist card" }, S.players.map((p) => {
      const c = [...(S.chat || [])].reverse().find((m) => m.pid === p.pid && m.claim);
      return h("div", { class: "prow top" }, face(p), h("div", {}, h("b", {}, p.name, p.alive ? "" : p.ejected ? " · voted out" : " · dead"),
        c ? h("div", { class: "claim" }, c.claim.map((x) => h("span", {}, h("i", {}, x.hour), " ", x.room))) : h("small", { class: "muted" }, p.alive ? " Hasn't shared their day" : "")));
    }));
  } else main = [chatLog(), composer()];
  return h("section", { class: "stack talk" }, bar(`Day ${S.day} · talk`, timer(S.deadline)), ghostBanner(), tabs, main,
    S.me.alive ? h("div", { class: "row" },
      h("button", { class: "btn sm" + (claimed ? "" : " primary"), type: "button", onClick: claimSheet }, claimed ? "📋 Share my day again" : "📋 Share my day"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn sm", type: "button", disabled: S.readyToVote, onClick: () => act("votenow") }, S.readyToVote ? `Waiting (${readyN}/${alive.length})` : `Vote now (${readyN}/${alive.length})`)) : null);
}

/* ---------- vote ---------- */
function vote() {
  const alive = S.players.filter((p) => p.alive);
  const mine = S.myvote;
  const opt = (target, ...kids) => h("button", { class: "pickbtn" + (mine === target ? " on" : ""), type: "button", disabled: !S.me.alive, onClick: () => act("vote", { target }) }, ...kids);
  return h("section", { class: "stack" }, bar(`Day ${S.day} · vote`, timer(S.deadline)), ghostBanner(),
    h("h1", { class: "h2" }, "Who is the killer?"),
    h("p", { class: "muted small" }, `${alive.filter((p) => p.voted).length} of ${alive.length} have voted. Most votes is out; a tie means nobody.`),
    h("div", { class: "pick" }, alive.filter((p) => p.pid !== S.me.pid).map((p) => opt(p.pid, face(p, "sm"), h("span", {}, h("b", {}, p.name), p.voted ? h("small", { class: "muted" }, " · voted") : null))),
      opt("skip", h("span", { class: "face sm skip" }, "–"), h("b", {}, "Skip: not sure yet"))),
    h("details", { class: "card" }, h("summary", {}, "Evidence"), bodyCard(true), dayLog()));
}

function result() {
  const e = S.ejected;
  return h("section", { class: "pass" }, h("span", { class: "label" }, "The vote"),
    e ? [h("h1", { class: "who" }, `${e.name} is out.`), h("p", { class: "lead " + (e.role === "killer" ? "yes" : "no") }, e.role === "killer" ? "They were a killer! 🔪" : "They were innocent…")]
      : h("h1", { class: "who" }, "Nobody is out."),
    h("div", { class: "row center" }, Object.entries(S.tally || {}).sort((a, b) => b[1] - a[1]).map(([n, c]) => h("span", { class: "tag" }, `${n === "skip" ? "Skip" : n}: ${c}`))),
    h("p", { class: "muted small" }, "Next: ", timer(S.deadline)));
}

/* ---------- the end ---------- */
function over() {
  const killers = S.players.filter((p) => p.role === "killer");
  const iWon = (S.winner === "killers") === (S.me.role === "killer");
  return h("section", { class: "stack reveal" }, bar("Game over"),
    h("div", { class: "culprit" }, h("span", { class: "bigstamp" + (S.winner === "guests" ? "" : " lost") }, S.winner === "guests" ? "CAUGHT" : "ESCAPED"),
      h("span", { class: "label" }, S.winner === "guests" ? "The guests win" : "The killers win"),
      h("div", { class: "row center" }, killers.map((p) => face(p, "big"))),
      h("h1", { class: "display", style: { fontSize: "clamp(1.8rem, 7vw, 2.6rem)" } }, killers.map((p) => p.name).join(" & ")),
      h("p", { class: "lead" }, iWon ? "You won! 🎉" : "You lost this one.")),
    h("div", { class: "card" }, h("span", { class: "label" }, "Everyone"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("b", {}, p.name),
      h("span", { class: "spacer" }), h("span", { class: p.role === "killer" ? "no" : "muted" }, p.role === "killer" ? "🔪 killer" : p.alive ? "survived" : p.ejected ? "voted out" : "killed"))))),
    (S.truth || []).map((d) => h("div", { class: "card stack" }, h("span", { class: "label" }, `Day ${d.n}: what really happened`),
      d.kill ? h("p", {}, h("b", {}, d.kill.killer), ` killed ${d.kill.victim} in the ${d.kill.room} at ${d.kill.hour} with the ${d.kill.weapon}.`) : h("p", { class: "muted" }, "Nobody died."),
      h("div", { class: "grid-wrap" }, h("table", { class: "truth" },
        h("thead", {}, h("tr", {}, h("th", {}, ""), d.grid.map((g) => h("th", {}, g.hour)))),
        h("tbody", {}, S.players.map((p) => h("tr", {}, h("th", {}, p.name), d.grid.map((g) => {
          const r = g.rows.find((x) => x.name === p.name);
          return h("td", {}, r ? r.room : "–", r?.did ? h("small", {}, r.did) : null);
        })))))))),
    h("button", { class: "btn primary block", type: "button", onClick: () => act("again") }, "Play again with the same people"),
    h("button", { class: "btn ghost block", type: "button", onClick: leave }, "Leave"));
}

/* ---------- start ---------- */
if (me) startPolling();
render();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) poll(); });
