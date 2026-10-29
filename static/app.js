/* Alibi: the phone. Each player's phone shows only their own view of the game, polled from the server once a second.

   Screens follow the game's phase: home → lobby → your character and role → each hour: move (pick a room), then the
   room (who's here, talk, what you do) → the body → the meeting (chat, the evidence board, voice, private messages) → vote →
   the result → the next day, the final showdown, or the end with the whole truth, your XP and the weekend's highlights.

   Voice is proximity chat: with voice on, you're connected (peer to peer, WebRTC) to the people in the same room as
   you during the day, and to everyone at the meeting. The server only passes the connection messages along.
   Your profile (XP, levels, achievements, the daily challenge) lives in profile.js, on this phone only. */
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
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const pref = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const prefSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const LENS = '<svg viewBox="0 0 64 64"><circle cx="27" cy="27" r="13" fill="none" style="stroke:var(--gold-2)" stroke-width="5"/><path d="M36.5 36.5 L50 50" style="stroke:var(--gold-2)" stroke-width="7" stroke-linecap="round"/><circle cx="27" cy="27" r="4" fill="#ef5a5f"/></svg>';

/** A question in a sheet instead of the browser's own boxes: yes/no, or a line of text. */
function ask({ title, text, ok = "OK", cancel = "Cancel", input = false, placeholder = "", danger = false, max = 200 }) {
  return new Promise((resolve) => {
    const back = h("div", { class: "sheet-back" });
    const field = input ? h("textarea", { class: "input", placeholder, maxlength: String(max), rows: "3", "aria-label": title }) : null;
    const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(input ? null : false); };
    back.addEventListener("click", (e) => { if (e.target === back) done(input ? null : false); });
    const okBtn = h("button", { class: `btn block ${danger ? "danger" : "primary"}`, type: "button", onClick: () => {
      if (!input) return done(true);
      const t = field.value.trim();
      if (!t) { field.focus(); return; }
      done(t);
    } }, ok);
    back.append(h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h3", {}, title), text ? h("p", { class: "muted small" }, text) : null, field,
      h("div", { class: "row nowrap" }, h("button", { class: "btn ghost block", type: "button", onClick: () => done(input ? null : false) }, cancel), okBtn)));
    document.body.append(back);
    document.addEventListener("keydown", onKey);
    (field || okBtn).focus();
  });
}

/* a face drawn from a name: the same player always looks the same */
function portrait(name) {
  let seed = 7;
  for (const ch of String(name)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const skin = pick(["#f1d3b8", "#e8b996", "#d49a74", "#b67a52", "#8d5a3b", "#6a4029"]);
  const hair = pick(["#1f1712", "#3b2a1e", "#6b4a2b", "#a0692f", "#c9a063", "#7a2e1d", "#2b2b2b", "#d8d4cc"]);
  const coat = pick(["#2e3b4e", "#7a2e2a", "#2f5a3e", "#3d3d3d", "#6a5320", "#56346f", "#1f4a63"]);
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
    + (rnd() < 0.16 ? `<path d="M13 22 L47 22 L42 18 Q41 9 30 9 Q19 9 18 18Z" fill="#1c1a18"/><rect x="18" y="16.5" width="24" height="2.2" fill="#a3281c"/>` : "");
  return `<svg viewBox="0 0 60 70" aria-hidden="true">${hairBack}<rect x="25" y="47" width="10" height="9" fill="${skin}"/><path d="M8 70 Q10 55 30 54 Q50 55 52 70Z" fill="${coat}"/>`
    + `<ellipse cx="30" cy="35" rx="13" ry="15.5" fill="${skin}"/><ellipse cx="17" cy="36" rx="2" ry="3" fill="${skin}"/><ellipse cx="43" cy="36" rx="2" ry="3" fill="${skin}"/>${top}`
    + `<path d="M22 ${31 + b} l5 ${-b}" stroke="#2a1d14" stroke-width="1.6"/><path d="M38 ${31 + b} l-5 ${-b}" stroke="#2a1d14" stroke-width="1.6"/><circle cx="25" cy="35" r="1.5" fill="#1b130e"/><circle cx="35" cy="35" r="1.5" fill="#1b130e"/>`
    + `<path d="M26 45 Q30 ${45 + pick([2, 0, -2])} 34 45" stroke="#6b3a2c" stroke-width="1.5" fill="none"/>${extras}</svg>`;
}
const face = (p, cls = "") => h("span", { class: `face ${cls}${p.alive === false ? " dead" : ""}`, style: { "--c": p.color || "#c9cad3" }, html: portrait(p.name), "aria-hidden": "true" });
const lvl = (p) => (p && p.level ? h("span", { class: "lvl", title: `Level ${p.level}` }, p.badge ? `${p.badge} ${p.level}` : String(p.level)) : null);

/* ---------- preferences ---------- */
const sound = { on: pref("alibi.sound") !== "off", ctx: null };
const prefs = { buzz: pref("alibi.buzz") !== "off", calm: pref("alibi.calm") === "on", big: pref("alibi.big") === "on", contrast: pref("alibi.contrast") === "on",
  tips: pref("alibi.tips") !== "off", amb: pref("alibi.amb") === "on" };
function applyPrefs() {
  const c = document.documentElement.classList;
  c.toggle("calm", prefs.calm); c.toggle("big", prefs.big); c.toggle("contrast", prefs.contrast);
}
applyPrefs();
const calm = () => prefs.calm || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- sound: made on the spot, no files ---------- */
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
      tock: () => tone(660, 0, 0.06, "square", 0.025),
      hour: () => { tone(523, 0, 0.3); tone(784, 0.1, 0.4); },
      door: () => { noise(0, 0.25, 0.4, 900); tone(196, 0.05, 0.25, "triangle", 0.08); },
      scream: () => { noise(0, 1.6, 0.8, 500); tone(880, 0, 0.9, "sawtooth", 0.05); tone(660, 0.3, 1.0, "sawtooth", 0.04); },
      msg: () => tone(1200, 0, 0.07, "triangle", 0.05),
      dm: () => { tone(988, 0, 0.1, "triangle", 0.07); tone(1319, 0.1, 0.15, "triangle", 0.07); },
      vote: () => { tone(330, 0, 0.2, "triangle"); tone(262, 0.18, 0.4, "triangle"); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.45, "triangle", 0.1)),
      lose: () => { tone(220, 0, 0.4, "sawtooth", 0.06); tone(165, 0.3, 0.8, "sawtooth", 0.06); },
      role: () => { tone(110, 0, 1.2, "sawtooth", 0.05); tone(165, 0.2, 1.1, "sawtooth", 0.04); },
      reveal: () => { noise(0, 0.35, 0.25, 2400); tone(392, 0.1, 0.5, "triangle", 0.08); tone(587, 0.25, 0.7, "triangle", 0.07); },
      gasp: () => { tone(740, 0, 0.12, "sawtooth", 0.06); tone(554, 0.12, 0.5, "sawtooth", 0.06); },
      bell: () => [0, 0.45, 0.9].forEach((at) => { tone(880, at, 0.9, "sine", 0.1); tone(1320, at, 0.7, "sine", 0.04); }),
      drum: () => { for (let i = 0; i < 14; i++) noise(i * 0.09, 0.08, 0.25 + i * 0.02, 260); },
      click: () => tone(1500, 0, 0.04, "square", 0.04),
      pop: () => { tone(600, 0, 0.06, "sine", 0.07); tone(900, 0.04, 0.08, "sine", 0.05); },
      pick: () => { tone(700, 0, 0.05, "triangle", 0.06); tone(1050, 0.05, 0.09, "triangle", 0.05); },
      whoosh: () => noise(0, 0.6, 0.18, 1200),
      heart: () => { tone(60, 0, 0.12, "sine", 0.25); tone(55, 0.16, 0.14, "sine", 0.18); },
      level: () => [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(f, i * 0.08, 0.5, "triangle", 0.09); tone(f * 2, i * 0.08 + 0.02, 0.3, "sine", 0.03); }),
      unlock: () => { tone(988, 0, 0.12, "triangle", 0.08); tone(1319, 0.1, 0.12, "triangle", 0.08); tone(1760, 0.2, 0.35, "triangle", 0.07); },
      spook: () => { tone(392, 0, 1.2, "sine", 0.05); tone(370, 0.1, 1.3, "sine", 0.05); noise(0, 1.0, 0.15, 1800); },
    })[kind]?.();
  } catch { /* no audio */ }
}
const buzz = (p) => { try { if (navigator.vibrate && prefs.buzz) navigator.vibrate(p); } catch { /* not supported */ } };

/* the sound of the place: wind, the sea, a train, a station's hum (off unless switched on in Settings) */
const amb = { stop: null, map: null };
const AMB = { frostline: [520, 0.13, 0.05], dunes: [600, 0.18, 0.05], pearl: [330, 0.08, 0.06], midnight: [230, 1.5, 0.045], helios: [160, 0.05, 0.03, 55], circus: [300, 0.3, 0.03] };
function syncAmbience() {
  const want = prefs.amb && sound.on && me && S && !["lobby", "over"].includes(S.phase) && document.visibilityState === "visible";
  const mid = S?.map?.id || "wrenmoor";
  if (!want) { if (amb.stop) { amb.stop(); amb.stop = null; } return; }
  if (amb.stop && amb.map === mid) return;
  if (amb.stop) amb.stop();
  try {
    const ctx = (sound.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const [freq, rate, vol, hum] = AMB[mid] || [260, 0.05, 0.025];
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }   // brown noise
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    src.buffer = buf; src.loop = true; f.type = "lowpass"; f.frequency.value = freq; g.gain.value = vol; lfo.frequency.value = rate; lg.gain.value = vol * 0.7;
    lfo.connect(lg).connect(g.gain); src.connect(f).connect(g).connect(ctx.destination); src.start(); lfo.start();
    let o = null;
    if (hum) { o = ctx.createOscillator(); const og = ctx.createGain(); o.frequency.value = hum; og.gain.value = 0.012; o.connect(og).connect(ctx.destination); o.start(); }
    amb.stop = () => { try { src.stop(); lfo.stop(); o?.stop(); } catch { /* already stopped */ } };
    amb.map = mid;
  } catch { amb.stop = null; }
}

/* ---------- little bursts of joy ---------- */
function confetti(big = false) {
  if (calm()) return;
  const bits = ["🎉", "✨", "🥳", "🕯️", "🎊"], cols = ["#ededf2", "var(--gold-2)", "#3dd49b", "#7ab0ff", "#b49bff", "#ef5a5f"];
  const n = big ? 60 : 32;
  const wrap = h("div", { class: "confetti", "aria-hidden": "true" }, Array.from({ length: n }, (_, i) => {
    const style = { left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 0.7}s`, animationDuration: `${1.8 + Math.random() * 1.6}s`, "--spin": `${Math.random() * 900 - 450}deg` };
    return i % 3 ? h("i", { style: { ...style, background: cols[i % cols.length] } }) : h("span", { style }, bits[i % bits.length]);
  }));
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 4200);
}
/** Sparks flying out of an element. */
function burst(el, n = 14) {
  if (calm() || !el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  const b = h("div", { class: "burst", style: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` }, "aria-hidden": "true" });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = 36 + Math.random() * 54;
    b.append(h("i", { style: { "--dx": `${Math.cos(a) * d}px`, "--dy": `${Math.sin(a) * d}px`, background: i % 2 ? "var(--gold-2)" : "#fff" } }));
  }
  document.body.append(b);
  setTimeout(() => b.remove(), 1000);
}
/** A big title across the whole screen for a moment: a new day, the meeting, the vote. */
function titleCard(label, big, sub) {
  if (calm() || doorState.busy) return;
  document.querySelector(".titlecard")?.remove();
  const el = h("div", { class: "titlecard", "aria-hidden": "true" }, label ? h("span", { class: "label" }, label) : null, h("h1", { class: "display" }, big), sub ? h("p", {}, sub) : null);
  document.body.append(el);
  sfx("whoosh");
  setTimeout(() => el.remove(), 2100);
}
function redFlash() { if (calm()) return; const el = h("div", { class: "redflash", "aria-hidden": "true" }); document.body.append(el); setTimeout(() => el.remove(), 1300); }
function achToast(a, delay = 0) {
  setTimeout(() => {
    const el = h("div", { class: "achtoast", role: "status" }, h("span", { class: "e" }, a.emoji), h("span", {}, h("small", {}, "Achievement unlocked"), h("b", {}, a.title)));
    document.body.append(el);
    sfx("unlock"); buzz([20, 40, 20]);
    setTimeout(() => el.remove(), 3900);
  }, delay);
}
/* every press ripples, and a phone gives a tiny tap */
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest?.(".btn, .roomtile, .votetile, .mode, .mapcard, .optbtn");
  if (!b || b.disabled || e.target.closest("input, textarea, select")) return;
  if (prefs.buzz && e.pointerType === "touch") buzz(6);
  if (calm()) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
  const rip = h("span", { class: "ripple", style: { width: `${s}px`, height: `${s}px`, left: `${e.clientX - r.left - s / 2}px`, top: `${e.clientY - r.top - s / 2}px` } });
  if (getComputedStyle(b).position === "static") b.style.position = "relative";
  b.style.overflow = "hidden";
  b.append(rip);
  setTimeout(() => rip.remove(), 600);
}, { passive: true });

/* ---------- emotes: quick reactions floating up the screen ---------- */
const emoteLayer = (() => { const el = h("div", { id: "emotes", "aria-hidden": "true" }); document.body.append(el); return el; })();
const seenEmotes = new Set();
function floatEmote(e) {
  if (calm()) { toast(`${e.name}: ${e.emoji}`, 1500); return; }
  const el = h("div", { class: "floatemo", style: { left: `${8 + Math.random() * 78}%` } }, h("span", {}, e.emoji), h("small", { style: { color: e.color } }, e.name));
  emoteLayer.append(el);
  setTimeout(() => el.remove(), 3100);
}
const sendEmote = (emoji) => { sfx("pop"); act("emote", { emoji }); };
const emoteBar = () => (S?.emoteList ? h("div", { class: "emotebar", role: "group", "aria-label": "React" }, S.emoteList.map((e) => h("button", { type: "button", "aria-label": `React ${e}`, onClick: () => sendEmote(e) }, e))) : null);

/* ---------- doors: every way in and out of a room, or the house, swings a pair of doors ---------- */
const doorState = { busy: false };
/** Which doors to show between two views: into a room, out of one (with the next hour on the plaque), into the house when the game begins. */
function doorFor(a, b) {
  const place = (id) => { const r = b.rooms?.find((x) => x.id === id); return r ? `${r.emoji} ${r.name}` : ""; };
  if (b.phase === "room" && a.phase === "move" && b.here) return { label: place(b.here.room), sub: b.here.dark ? "You push the door open… into pitch darkness." : "You push the door open…" };
  if (b.phase === "body" && a.phase === "move" && b.body) return { label: `${b.body.room}`, sub: "You push the door open… and freeze." };
  if (a.phase === "room" && b.phase === "move") return { label: `🕰️ ${b.hours?.[b.hour] || ""}`, sub: b.beat?.text || "The door clicks shut behind you." };
  if (a.phase === "room" && ["body", "quiet", "showdown"].includes(b.phase)) return { label: "🚪 Back to the hall", sub: "The door clicks shut behind you." };
  if (a.phase === "lobby" && b.phase === "roles") return { label: (b.map || DEFAULT_MAP).door_label, sub: (b.map || DEFAULT_MAP).begin_sub };
  return null;
}
/** Two doors swing shut over the screen, the next screen is drawn behind them, and they swing open onto it. */
function doors({ label, sub }, then) {
  if (doorState.busy || calm()) { then(); return; }
  doorState.busy = true;
  const panel = (side) => h("div", { class: `door ${side}` }, h("span", { class: "panel" }), h("span", { class: "panel" }), h("i", { class: "knob" }));
  const ov = h("div", { class: "doors", "aria-hidden": "true" }, panel("left"), panel("right"),
    h("div", { class: "plaque" }, h("b", {}, label), sub ? h("small", {}, sub) : null));
  document.body.append(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("shut")));
  setTimeout(() => {
    doorState.busy = false;
    then();
    ov.classList.add("open");
    sfx("door");
    setTimeout(() => ov.remove(), 1000);
  }, sub && sub.length > 60 ? 1500 : 900);                          // a story beat on the plaque gets a moment to be read
}

/* ---------- connection ---------- */
// this tab's seat first (two tabs are two players); the last seat on this phone lets a closed browser rejoin
let me = (() => { try { return JSON.parse(sessionStorage.getItem(ME) || localStorage.getItem(ME) || "null"); } catch { return null; } })();
let S = null;                   // the latest view from the server
let clockSkew = 0;              // server time minus ours
let ui = { tab: "chat", side: "board", room: null, take: null, put: false, strike: null, look: false, revealed: false, draft: null, dm: null, seen: {}, coachOff: {} };
let lastPhaseKey = "";
let freshScreen = true;                 // animate a screen in only when it changes, not on every update
let endResult = null, endCard = null;    // the XP card at the end of a game: made once, kept across redraws

const saveMe = () => {
  try { for (const store of [sessionStorage, localStorage]) { if (me) store.setItem(ME, JSON.stringify(me)); else store.removeItem(ME); } } catch { /* ignore */ }
};
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Something went wrong."), { status: r.status });
  return d;
}
async function act(type, extra = {}) {
  try { accept(await post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type, ...extra })); } catch (e) { toast(e.message); }
}
function accept(d) {
  if (d.now) clockSkew = d.now * 1000 - Date.now();
  for (const s of d.signals || []) onSignal(s.from, s.data);
  if (d.same) { syncVoice(); return; }
  const before = S;
  S = d;
  for (const e of d.emotes || []) {                              // reactions float up once, when they first arrive
    if (seenEmotes.has(e.id)) continue;
    seenEmotes.add(e.id);
    if (before) { floatEmote(e); if (e.name !== d.me.name) sfx("pop"); }
  }
  const key = `${d.phase}|${d.day}|${d.hour}`;
  const door = before && key !== lastPhaseKey ? doorFor(before, d) : null;
  if (key !== lastPhaseKey) {                                   // a new phase: reset what was half-picked and make a sound
    const prevPhase = before?.phase;
    lastPhaseKey = key;
    freshScreen = true;
    ui = { ...ui, room: null, take: null, put: false, strike: null, look: false, draft: null, changing: false };
    if (d.phase === "roles") { ui.revealed = false; ui.coachOff = {}; endResult = null; endCard = null; }
    if (before && !["body", "showdown"].includes(d.phase)) buzz(BUZZ[d.phase] || [20]);
    if (before && d.phase === "over" && d.mystats) finishGame(d);
    if (before && ["body", "showdown"].includes(d.phase)) { buzz([90, 60, 180]); redFlash(); }
    if (before && d.phase === "result") setTimeout(() => sfx(d.ejected?.role === "killer" ? "win" : d.ejected ? "lose" : "tick"), (0.5 + (d.ballots || []).length * 0.45) * 1000);
    if (before) sfx({ result: "drum", roles: "role", move: door ? null : "hour", room: door ? null : "door", body: "scream", showdown: "scream", vote: "vote",
      over: d.mystats?.won ? "win" : "lose" }[d.phase] || "tick");
    if (before && !door) {                                          // the big moments get a title across the screen
      if (d.phase === "move" && d.hour === 0 && prevPhase !== "move" && d.mode === "hide") titleCard("Hide and seek", "Ready or not…", d.beat?.text);
      else if (d.phase === "move" && d.hour === 0 && prevPhase !== "move") titleCard(d.showdown ? "The final showdown" : (d.map || DEFAULT_MAP).title, d.showdown ? "The last day" : `Day ${d.day}`, d.beat?.text);
      else if (d.phase === "talk") titleCard(`Day ${d.day}`, "The meeting", "Share your day. Find the liar.");
      else if (d.phase === "vote") titleCard(`Day ${d.day}`, "The vote", "Who is the killer?");
    }
    if (!ui.dm) window.scrollTo({ top: 0 });
  }
  if (before) {
    const n = (x) => (x?.chat?.length || 0) + (x?.roomchat?.length || 0) + (x?.lobbychat?.length || 0);
    if (n(d) > n(before)) sfx((d.chat || []).slice((before.chat || []).length).some((m) => m.accuse) ? "gasp" : "msg");
    const incoming = (d.dms || []).filter((m) => m.to === d.me.pid).length - (before.dms || []).filter((m) => m.to === d.me.pid).length;
    if (incoming > 0) { sfx("dm"); buzz([25]); }
  }
  if (door) return doors(door, () => { render(); syncVoice(); });
  render();
  syncVoice();
  syncWake();
  syncAmbience();
  queueFx(before, d);
}
/** The end of a game: add it to your profile, then celebrate what's earned. */
function finishGame(d) {
  endResult = window.AlibiProfile ? AlibiProfile.finish(d) : null;
  endCard = null;
  if (d.mystats.won) setTimeout(() => confetti(true), 600);
  if (!endResult) return;
  endResult.fresh.forEach((a, i) => achToast(a, 2400 + i * 1600));
  if (endResult.levelUp) setTimeout(() => confetti(true), 1900);
}
let polling = null;
/* the little extras that make it feel like an app: a buzz at the big moments, a "reconnecting" pill, and the screen staying awake */
const BUZZ = { roles: [60], move: [40], room: [25], body: [220, 90, 220], showdown: [220, 90, 220], vote: [30, 40, 30], over: [140] };
let failures = 0, lock = null;
function netPill(show) {
  let el = document.getElementById("net");
  if (!el) { el = document.createElement("div"); el.id = "net"; el.setAttribute("role", "status"); el.textContent = "📡 Reconnecting…"; document.body.append(el); }
  el.hidden = !show;
}
async function syncWake() {
  try {
    if (me && S && S.phase !== "over" && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
    else if ((!me || !S || S.phase === "over") && lock) { await lock.release(); lock = null; }
  } catch { /* the browser said no: fine */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncWake(); syncAmbience(); });
async function poll() {
  if (!me) return;
  try {
    const q = new URLSearchParams({ pid: me.pid, token: me.token, v: S?.v ?? "" });
    const r = await fetch(`/api/game/${me.code}?${q}`, { cache: "no-store" });
    if (r.status === 404 || r.status === 403) { const d = await r.json().catch(() => ({})); stopVoice(); me = null; S = null; saveMe(); clearInterval(polling); syncAmbience(); toast(d.error || "That game is over."); render(); return; }
    accept(await r.json()); failures = 0; netPill(false);
  } catch { if (++failures >= 3) netPill(true); /* offline for a moment: keep trying */ }
}
function startPolling() { clearInterval(polling); polling = setInterval(poll, POLL); poll(); }

/* ---------- the clock: a ring that empties; the last seconds tick, and the vote's heart beats ---------- */
const serverNow = () => Date.now() + clockSkew;
const secsLeft = (deadline) => (deadline ? Math.max(0, Math.ceil(deadline - serverNow() / 1000)) : 0);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const RING = (off) => `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" class="bgc"/><circle cx="18" cy="18" r="15.9" class="fgc" pathLength="100" style="stroke-dashoffset:${off}"/></svg>`;
function timer(deadline, span) {
  const s = secsLeft(deadline), tot = span || S?.span || s || 1;
  return h("span", { class: "clock" + (s > 0 && s <= 10 ? " hurry" : ""), "data-deadline": deadline || "", "data-span": String(tot), role: "timer" },
    h("span", { class: "ring", html: RING(100 - Math.min(100, (100 * s) / tot)) }), h("span", { class: "t" }, fmt(s)));
}
let lastTick = null;
setInterval(() => {
  for (const el of document.querySelectorAll("[data-deadline]")) {
    const s = secsLeft(+el.dataset.deadline), tot = +el.dataset.span || 1;
    const t = el.querySelector(".t"); if (t) t.textContent = fmt(s);
    const ring = el.querySelector(".fgc"); if (ring) ring.style.strokeDashoffset = String(100 - Math.min(100, (100 * s) / tot));
    el.classList.toggle("hurry", s > 0 && s <= 10);
  }
  if (!S || !S.deadline) return;
  const s = secsLeft(S.deadline), k = `${lastPhaseKey}|${s}`;
  if (k === lastTick || s <= 0) return;
  lastTick = k;
  if (S.phase === "vote" && s <= 10 && S.me.alive && !S.myvote) { sfx("heart"); if (s <= 5) buzz(15); }
  else if (["move", "room", "talk", "vote"].includes(S.phase) && s <= 5) { sfx(s % 2 ? "tick" : "tock"); if (s <= 3) buzz(8); }
}, 250);

/* ---------- voice: proximity chat, peer to peer ---------- */
const voice = { on: false, stream: null, peers: new Map(), ice: [{ urls: ["stun:stun.l.google.com:19302"] }] };
fetch("/api/status").then((r) => r.json()).then((d) => { if (d.ice) voice.ice = d.ice; }).catch(() => {});
async function toggleVoice() {
  if (voice.on) { stopVoice(); act("voice", { on: false }); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast("Voice isn't supported in this browser.");
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch { return toast("The microphone is blocked. Allow it for this site to use voice."); }
  voice.on = true;
  toast("Voice on: you'll hear whoever's in the same room as you, and everyone at the meeting.", 4000);
  act("voice", { on: true });
}
function stopVoice() {
  voice.on = false;
  voice.stream?.getTracks().forEach((t) => t.stop());
  voice.stream = null;
  for (const pid of [...voice.peers.keys()]) dropPeer(pid);
  render();
}
/** Who you should be hearing right now: the people in your room, or everyone at the meeting (the living with the living, ghosts with ghosts). */
function voiceTargets() {
  if (!voice.on || !S || !me) return new Set();
  const talking = (p) => p.pid !== S.me.pid && !p.bot && p.voice;
  if (S.phase === "room" && S.here && !S.here.dark) {
    const here = new Set(S.here.people.map((x) => x.pid));
    return new Set(S.players.filter((p) => here.has(p.pid) && talking(p)).map((p) => p.pid));
  }
  if (S.phase === "move") return new Set([...voice.peers.keys()].filter((pid) => { const p = who(pid); return p && talking(p) && p.alive === S.me.alive; }));   // keep talking while everyone picks a room
  if (["body", "quiet", "talk", "vote", "result", "showdown", "over", "lobby", "roles"].includes(S.phase)) return new Set(S.players.filter((p) => talking(p) && p.alive === S.me.alive).map((p) => p.pid));
  return new Set();
}
function syncVoice() {
  const want = voiceTargets();
  for (const [pid, pr] of voice.peers) {
    const age = Date.now() - pr.at, stale = pr.pc.connectionState !== "connected" && age > 15000;
    if ((!want.has(pid) && age > 5000) || ["failed", "closed"].includes(pr.pc.connectionState) || stale) dropPeer(pid);   // a new call gets a moment: phones update a second apart
  }
  for (const pid of want) if (!voice.peers.has(pid) && S.me.pid < pid) callPeer(pid);       // the lower id calls, the other answers
  const n = [...voice.peers.values()].filter((pr) => pr.pc.connectionState === "connected").length;
  const badge = document.querySelector("[data-voice-count]");
  if (badge) badge.textContent = voice.on ? String(n) : "";
}
function makePeer(pid) {
  const pc = new RTCPeerConnection({ iceServers: voice.ice });
  voice.stream.getTracks().forEach((t) => pc.addTrack(t, voice.stream));
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
  const pr = { pc, audio, at: Date.now() };
  voice.peers.set(pid, pr);
  return pr;
}
const iceDone = (pc) => new Promise((res) => {
  if (pc.iceGatheringState === "complete") return res();
  const t = setTimeout(res, 2500);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
});
const signal = (to, data) => fetch(`/api/game/${me.code}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: me.pid, token: me.token, type: "signal", to, data }) }).catch(() => {});
async function callPeer(pid) {
  try {
    const { pc } = makePeer(pid);
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    signal(pid, { kind: "offer", sdp: pc.localDescription });
  } catch { dropPeer(pid); }
}
async function onSignal(from, data) {
  if (!voice.on || !data) return;
  try {
    if (data.kind === "offer") {
      if (voice.peers.has(from)) dropPeer(from);
      const { pc } = makePeer(from);
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      signal(from, { kind: "answer", sdp: pc.localDescription });
    } else if (data.kind === "answer") {
      const pr = voice.peers.get(from);
      if (pr && pr.pc.signalingState === "have-local-offer") await pr.pc.setRemoteDescription(data.sdp);
    }
  } catch { dropPeer(from); }
}
function dropPeer(pid) { const pr = voice.peers.get(pid); if (!pr) return; try { pr.pc.close(); } catch { /* ignore */ } pr.audio.srcObject = null; voice.peers.delete(pid); }

/* ---------- maps: where the murder happens ---------- */
const DEFAULT_MAP = { id: "wrenmoor", emoji: "🏰", title: "The Wrenmoor Weekend", short: "Country-house manor", tagline: "A weekend at the manor. A will to be read at dusk. And one of you has decided not to wait.",
  place: "Wrenmoor", prize: "the manor", gazette: "The Wrenmoor Gazette", door_label: "🏰 Wrenmoor Manor", begin_sub: "The weekend begins.", enter_sub: "The front doors creak open…",
  leave_label: "Farewell, Wrenmoor", leave_sub: "The front doors close behind you.", theme: null };
let MAPLIST = (() => { try { const c = JSON.parse(pref("alibi.maps") || "null"); return Array.isArray(c) && c.length ? c : [DEFAULT_MAP]; } catch { return [DEFAULT_MAP]; } })();   // remembered, so the right look is there before the list arrives
let pickedMap = pref("alibi.map") || "wrenmoor";
let pickedGame = pref("alibi.game") === "hide" ? "hide" : "murder";
/** The two ways to play, on the home screen. */
function gamePicker() {
  const card = (id, em, title, sub) => h("button", { class: `gamecard ${id}` + (pickedGame === id ? " on" : ""), type: "button", "aria-pressed": String(pickedGame === id),
    onClick: (e) => { pickedGame = id; prefSet("alibi.game", id); sfx("pick"); burst(e.currentTarget, 10); render(); } }, h("span", { class: "em" }, em), h("b", {}, title), h("small", {}, sub));
  return h("div", { class: "stack tight" }, h("span", { class: "label" }, "What shall we play?"),
    h("div", { class: "gamepick" }, card("murder", "🔪", "Murder weekend", "One of you is the killer. Walk the house, find the body, vote them out."),
      card("hide", "🙈", "Hide and seek", "One night, one seeker. Sneak, hide, keep still. Whoever's found joins the hunt.")));
}
const mapById = (id) => MAPLIST.find((m) => m.id === id) || null;
/** The map in play, or the one you've picked on the home screen. */
const curMap = () => ({ ...DEFAULT_MAP, ...(S?.map || (pickedMap !== "random" ? mapById(pickedMap) : null) || {}) });
const THEME_VARS = { bg: "--bg", bg3: "--bg-3", top: "--top", gold: "--gold", gold2: "--gold-2", soft: "--gold-soft", hero1: "--hero1", hero2: "--hero2" };
function applyTheme(t) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(THEME_VARS)) { if (t && t[k]) root.setProperty(v, t[k]); else root.removeProperty(v); }
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = t?.bg || "#09090b";
}
fetch("/api/maps").then((r) => r.json()).then((d) => { if (d.maps?.length) { MAPLIST = d.maps; prefSet("alibi.maps", JSON.stringify(d.maps)); render(); showPicked(); } }).catch(() => { /* the original map still works */ });
function pickMap(id, el) { pickedMap = id; prefSet("alibi.map", id); sfx("pick"); render(); showPicked(); burst(document.querySelector(".mapcard.on"), 10); }
/** The cards on the home screen, each in its map's own colours. */
function mapPicker() {
  const cards = [...MAPLIST, { id: "random", emoji: "🎲", title: "Surprise me", short: "A random map", tagline: "A different place every time." }];
  return h("div", { class: "mappick" }, h("div", { class: "row" }, h("span", { class: "label" }, "Choose a map"), h("span", { class: "spacer" }), h("small", { class: "muted" }, `${MAPLIST.length} places`)),
    h("div", { class: "maprail", role: "listbox", "aria-label": "Maps" }, cards.map((c) => h("button", { class: "mapcard" + (c.id === pickedMap ? " on" : ""), type: "button", role: "option", "aria-selected": String(c.id === pickedMap),
      style: { "--m1": c.theme?.hero1 || "#1b1b20", "--m2": c.theme?.hero2 || "#0f0f12", "--mc": c.theme?.gold || "#c9cad3" }, onClick: () => pickMap(c.id) },
      h("span", { class: "em" }, c.emoji), h("b", {}, c.title.replace(/^The /, "")), h("small", {}, c.short)))));
}
const showPicked = () => setTimeout(() => document.querySelector(".mapcard.on")?.scrollIntoView({ inline: "center", block: "nearest", behavior: calm() ? "auto" : "smooth" }), 40);
/** In the lobby the host can change it with one tap. */
function mapDots() {
  return h("div", { class: "mapdots", role: "group", "aria-label": "Change the map" }, [...MAPLIST, { id: "random", emoji: "🎲", title: "Surprise me" }].map((c) =>
    h("button", { type: "button", class: S.map?.id === c.id ? "on" : "", title: c.title, "aria-label": c.title, "aria-pressed": String(S.map?.id === c.id), onClick: () => { sfx("pick"); act("map", { id: c.id }); } }, c.emoji)));
}

/* ---------- the hand grabbing the thing, the blade coming down ---------- */
const WK_ICON = { sharp: "🔪", blunt: "🔨", cord: "🪢" };
const ICON_BY_WORD = [[/knife|blade|axe|cleaver|shears|opener|punch|scalpel|scraper|torch|cutter|pruning|dagger|chisel|stake|shard/i, "🔪"], [/rope|cord|wire|belt|scarf|cravat|chain|cable|strap|band|sheet|line|ribbon|whip|hose/i, "🪢"]];
const itemIcon = (name, wk) => WK_ICON[wk] || ICON_BY_WORD.find(([re]) => re.test(name || ""))?.[1] || "🔨";
const fxQueue = [];
let fxRunning = false;
const playerByName = (n) => S?.players?.find((q) => q.name === n) || null;
const faceOf = (n, cls) => { const q = playerByName(n); return q ? face(q, cls) : h("span", { class: "face " + (cls || ""), style: { "--c": "#8d8d96" } }, "🙂"); };
/** What to show for one hour's result: the hand taking something, and any strike you did, suffered or witnessed. */
function fxFor(entry) {
  const out = [];
  for (const it of entry.items || []) if (it.who === "You" && it.kind === "take") out.push({ type: "take", item: it.item, wk: it.wk, sneak: it.sneak });
  for (const x of entry.strikes || []) out.push({ type: "strike", ...x });
  return out;
}
function queueFx(before, d) {
  if (!before) return;                                           // joining or reloading never replays the past
  const had = before.day === d.day ? (before.myday || []).length : 0;
  const mine = d.myday || [];
  for (let i = had; i < mine.length; i++) fxQueue.push(...fxFor(mine[i]));
  runFx();
}
function runFx() {
  if (fxRunning || !fxQueue.length) return;
  if (doorState.busy) { setTimeout(runFx, 300); return; }          // wait for the doors to open first
  fxRunning = true;
  playFx(fxQueue.shift()).then(() => { fxRunning = false; runFx(); });
}
function playFx(x) {
  const icon = itemIcon(x.weapon || x.item, x.wk);
  let cap, body, cls, ms, buzzPat, snd;
  if (x.type === "take") {
    cls = "take"; ms = 1900; buzzPat = [30]; snd = "tick";
    cap = x.sneak ? ["You slip the ", h("b", {}, x.item), " into your pocket 🤫"] : ["You took the ", h("b", {}, x.item)];
    body = [h("div", { class: "item" }, icon), h("div", { class: "hand" }, "🤚"), h("div", { class: "spark" })];
  } else {
    const kind = x.wk || "sharp";
    cls = `strike ${kind}${x.survived ? " survived" : ""}`; ms = 2900; snd = x.role === "killer" ? "drum" : "scream"; buzzPat = x.role === "killer" ? [40, 60, 160] : [200, 80, 200];
    const verb = kind === "sharp" ? "stabbed" : kind === "blunt" ? "struck down" : "strangled";
    if (x.role === "killer") cap = x.survived ? [h("b", {}, x.victim), " survived! Someone was watching over them."] : ["You ", verb, " ", h("b", {}, x.victim)];
    else if (x.role === "victim") cap = x.survived ? (x.by ? [h("b", {}, x.by), " went for you… and you survived!"] : "Someone attacked you from behind… and you survived!") : [h("b", {}, x.by), " ", { sharp: "stabbed", blunt: "struck", cord: "strangled" }[kind], " you"];
    else cap = x.survived ? ["You saw ", h("b", {}, x.killer), " attack ", h("b", {}, x.victim), ". They survived!"] : ["You saw ", h("b", {}, x.killer), " ", verb, " ", h("b", {}, x.victim)];
    const mineP = S?.players?.find((q) => q.pid === S.me?.pid);
    const victimFace = x.role === "victim" ? (mineP ? face(mineP, "big") : h("span", { class: "face big" }, "🙂")) : faceOf(x.victim, "big");
    body = [h("div", { class: "victim" }, victimFace, x.survived ? h("span", { class: "shield" }, "🛡️") : null),
      kind === "cord" ? h("div", { class: "noose" }) : h("div", { class: "weapon" }, icon), kind === "sharp" ? h("div", { class: "slashline" }) : null,
      h("div", { class: "burst2" }), h("div", { class: "flash" })];
    if (x.role === "witness") body.unshift(h("div", { class: "who" }, faceOf(x.killer, "sm")));
  }
  cap = [].concat(cap);
  const capText = cap.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  sfx(snd); if (snd !== "tick") buzz(buzzPat);
  if (calm()) { toast(capText, 2200); return new Promise((r) => setTimeout(r, 900)); }
  const el = h("div", { class: `fx ${cls}`, role: "img", "aria-label": capText }, h("div", { class: "scrim" }), h("div", { class: "stage" }, ...body, h("p", { class: "cap" }, ...cap)));
  document.body.append(el);
  if (cls.startsWith("strike")) { setTimeout(() => document.body.classList.add("shake"), ms * 0.4); setTimeout(() => document.body.classList.remove("shake"), ms * 0.4 + 480); }
  return new Promise((resolve) => setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); resolve(); }, 350); }, ms));
}

/* ---------- rendering, keeping what you're typing ---------- */
function render() {
  if (doorState.busy) return;
  applyTheme(curMap().theme);                                    // the doors are shut: draw the next screen when they open
  const active = document.activeElement?.dataset?.keep || null;
  const kept = Object.fromEntries([...document.querySelectorAll("#app [data-keep]")].map((el) => [el.dataset.keep, el.value]));
  const logs = Object.fromEntries([...document.querySelectorAll("[data-log]")].map((el) => [el.dataset.log, el.scrollHeight - el.scrollTop - el.clientHeight < 80]));
  const el = h("div", {}, screen(), me && S ? dmPanel() : null);
  if (freshScreen) { el.firstChild?.classList.add("enter"); freshScreen = false; }
  $app.replaceChildren(el);
  for (const [k, v] of Object.entries(kept)) { const x = el.querySelector(`[data-keep="${k}"]`); if (x && v) x.value = v; }
  if (active) { const x = el.querySelector(`[data-keep="${active}"]`); if (x) { x.focus({ preventScroll: true }); try { x.setSelectionRange(x.value.length, x.value.length); } catch { /* ignore */ } } }
  for (const x of el.querySelectorAll("[data-log]")) if (logs[x.dataset.log] !== false) x.scrollTop = x.scrollHeight;
}
let wide = innerWidth >= 1000;
addEventListener("resize", () => { const w = innerWidth >= 1000; if (w !== wide) { wide = w; render(); } });

function screen() {
  if (!me) return home();
  if (!S) return h("section", { class: "loading" }, h("span", { class: "lens", html: LENS }), h("p", { class: "loadline" }, "Joining the game…"));
  const fn = { lobby, roles, move, room, body, quiet, talk, vote, result, showdown, over }[S.phase] || lobby;
  return fn();
}

const unread = () => (S.dms || []).filter((m) => m.to === S.me.pid && m.t > (ui.seen[m.from] || 0)).length;
const bar = (title, ...right) => h("div", { class: "bar" },
  h("span", { class: "logo-sm", html: LENS }), h("span", { class: "title" }, title), ...right,
  S && S.phase !== "lobby" ? h("button", { class: "ibtn", type: "button", "aria-label": "Private messages", title: "Private messages", onClick: () => { ui.dm = "list"; render(); } }, "✉️",
    unread() ? h("span", { class: "badge" }, String(unread())) : null) : null,
  S ? h("button", { class: "ibtn" + (voice.on ? " live" : ""), type: "button", "aria-pressed": String(voice.on), "aria-label": voice.on ? "Voice on: tap to leave" : "Join voice", title: voice.on ? "Voice on" : "Voice chat", onClick: toggleVoice },
    voice.on ? "🎙️" : "🔇", h("span", { class: "badge soft", "data-voice-count": "" }, "")) : null,
  h("button", { class: "ibtn", type: "button", "aria-label": "Settings", title: "Settings", onClick: settings }, "⚙️"),
  S && !["lobby", "over"].includes(S.phase) ? h("button", { class: "ibtn", type: "button", "aria-label": "Leave the game", title: "Leave the game",
    onClick: async () => { if (await ask({ title: "Leave the game?", text: S.me.alive ? "A bot takes over your seat and the game carries on." : "You can't come back to it.", ok: "Leave", danger: true })) leave(); } }, "🚪") : null);
const who = (pid) => S.players.find((p) => p.pid === pid);
const roomName = (id) => S.rooms.find((r) => r.id === id)?.name || id;
const roomOf = (id) => S.rooms.find((r) => r.id === id);
const swatch = (p) => (p.colorName ? h("span", { class: "swatch", title: `${p.colorName} coat` }, h("i", { style: { background: p.color } }), p.colorName) : null);
/** Your secret mission and how it's going: shown with your role, so it stays covered too. */
const missionLine = () => {
  const m = S.me.mission;
  if (!m || !ui.revealed) return null;
  return h("p", { class: "mission-line" + (m.done ? " done" : m.failed ? " failed" : "") }, "🎯 ", m.text, " · ", h("b", {}, m.done ? "✅ done" : m.prog));
};
const myRoleLabel = () => (S.mode === "hide" ? (S.me.role === "hunter" ? "🔦 Seeker" : "🙈 Hider") : S.me.job === "shapeshifter" ? "🎭 Shapeshifter" : S.me.role === "killer" ? "🔪 Killer" : S.me.jobInfo ? `${S.me.jobInfo[0]} ${S.me.jobInfo[1].replace("The ", "")}` : "🕯️ Guest");
const roleChip = () => h("button", { class: "tag role-chip" + (ui.revealed ? " accent" : ""), type: "button", "aria-pressed": String(ui.revealed), onClick: () => { ui.revealed = !ui.revealed; render(); } },
  ui.revealed ? `${myRoleLabel()} · ${S.me.char?.title || ""}` : "👁 My role");
const ghostBanner = () => (!S.me.alive ? h("div", { class: "ghost stack tight" },
  h("span", {}, "👻 ", h("b", {}, S.me.ejected ? "You were voted out." : "You're dead."), " You see the whole house now, and every room's chatter. Only other ghosts can hear you. Stay and watch, or leave: the game carries on either way."),
  h("div", { class: "row" }, h("span", { class: "spacer" }),
    h("button", { class: "btn sm ghost", type: "button", onClick: async () => { if (await ask({ title: "Leave for good?", text: "You can't come back to this game.", ok: "Leave", danger: true })) leave(); } }, "Leave the game"))) : null);
const voiceTip = () => (!voice.on && S.players.some((p) => p.voice && p.pid !== S.me.pid) ? h("button", { class: "tipbtn", type: "button", onClick: toggleVoice }, "🎙️ Others are on voice: tap to join") : null);

/* ---------- tips: a coach for your first games (and always in practice) ---------- */
const COACH = {
  lobby: ["👋", "Waiting for everyone", "Share the code or the link. When every person taps “I'm ready”, the game starts. Empty chairs get bots."],
  roles: ["🤫", "Your secret", "Cover your screen and flip the card. Most guests are innocent; one (or two) of you is the killer. Some guests have a special job too."],
  move: ["🚪", "Walk the house", "Tap your room to stay, or a room next door to walk there (one door an hour). Everyone chooses secretly; you see who you pass in the doorways."],
  room: ["🔍", "In the room", "See who's here, chat, then pick what to do. Look around to see who was here last hour, or take something. The voices next door tell you where people are. Leave when you're done."],
  body: ["💀", "A body!", "Read where and how they died, and what's missing from the house. Then think back over your own day."],
  talk: ["🗣️", "The meeting", "Tap “Share my day” so everyone can check stories. The Board tab marks any claim that clashes with what you saw: that's your liar."],
  vote: ["🗳️", "Vote", "Pick the person you think is the killer. It takes most votes, and at least half the room, to throw someone out."],
  result: ["📜", "The verdict", "If they were the killer, the guests win. If not, the killer is still out there, and tomorrow is another day."],
  over: ["🏁", "The end", "Everyone's role is revealed. Watch the replay to see what really happened, hour by hour."],
};
const COACH_HIDE = {
  lobby: COACH.lobby,
  roles: ["🙈", "Hide and seek", "One of you seeks (two in a big game), the rest hide. Whoever is found joins the seekers. Hiders win if anyone is still hidden at 5 AM."],
  move: ["👣", "One room at a time", "Walk through a door, or stay put. Listen: hiders hear a seeker's footsteps next door, seekers hear anyone moving about. Keeping still makes no sound."],
  room: ["🫥", "Hide!", "Hiders: pick a hiding place. A seeker in the room searches one spot; anyone in the open, or in that spot, is caught. Talking gives you away."],
  over: COACH.over,
};
function coach() {
  const c = (S.mode === "hide" ? COACH_HIDE : COACH)[S.phase];
  const games = window.AlibiProfile ? AlibiProfile.load().games : 0;
  if (!c || ui.coachOff[S.phase] || !(S.practice || (prefs.tips && games < 3))) return null;
  return h("div", { class: "coach", role: "note" }, h("span", { class: "e" }, c[0]), h("b", {}, c[1]), h("p", {}, c[2]),
    h("button", { type: "button", onClick: () => { ui.coachOff[S.phase] = true; render(); } }, "Got it"));
}

/* ---------- home ---------- */
let LOBBIES = [], lobbyTimer = null;
const seenLobbies = new Set();
function lobbyRows() {
  return LOBBIES.map((x) => {
    const fresh = !seenLobbies.has(x.code);
    seenLobbies.add(x.code);
    return h("div", { class: "lobbyrow" + (fresh ? " fresh" : "") }, h("span", { class: "em" }, x.map.emoji),
      h("span", { class: "grow" }, h("b", {}, x.public ? "Public game" : `${x.host}'s game`, x.mode === "hide" ? " · 🙈 hide and seek" : ""), h("small", {}, `${x.map.title} · ${x.players}/${x.max} · ${x.humans} ${x.humans === 1 ? "person" : "people"}`, x.starts != null ? ` · starts in ${x.starts}s` : "")),
      h("button", { class: "btn sm primary", type: "button", onClick: () => homeGo && homeGo("join", { code: x.code }) }, "Join"));
  });
}
function refreshLobbies() {
  if (me) { clearInterval(lobbyTimer); lobbyTimer = null; return; }
  fetch("/api/lobbies").then((r) => r.json()).then((d) => {
    LOBBIES = d.lobbies || [];
    const box = document.getElementById("lobbies");
    if (box) { box.replaceChildren(...lobbyRows()); box.closest(".lobbybox").hidden = !LOBBIES.length; }
  }).catch(() => { /* offline: no list */ });
}
let homeGo = null;
function home() {
  if (!lobbyTimer) { refreshLobbies(); lobbyTimer = setInterval(refreshLobbies, 6000); }
  const joinCode = (location.hash.match(/join\/(\w{4})/i) || [])[1]?.toUpperCase() || "";
  const fam = window.AlibiFamily && window.AlibiFamily.pending();
  const name = h("input", { class: "input", placeholder: "Your name", maxlength: "16", value: pref("alibi.name") || (fam ? fam.n : "") || decodeURIComponent((location.hash.match(/join\/\w{4}\/([^/?#]+)/) || [])[1] || ""), "aria-label": "Your name", autocomplete: "nickname", "data-keep": "name" });
  const code = h("input", { class: "input code-in", placeholder: "CODE", maxlength: "4", "aria-label": "Game code", autocapitalize: "characters", autocomplete: "off", "data-keep": "code", value: joinCode });
  // a perk for anyone called Aws: pick your side before the game
  let want = pref("alibi.want") || "";
  const perkBtns = [["killer", "🔪 Killer"], ["guest", "🕯️ Guest"], ["", "🎲 Random"]].map(([w, l]) => {
    const b = h("button", { class: "optbtn" + (want === w ? " on" : ""), type: "button" }, l);
    b.addEventListener("click", () => { want = w; prefSet("alibi.want", w); perkBtns.forEach((x, i) => x.classList.toggle("on", ["killer", "guest", ""][i] === w)); });
    return b;
  });
  const perk = h("div", { class: "card perk", hidden: true }, h("span", { class: "label" }, "✨ Aws's perk"), h("p", { class: "small" }, "Choose your side for the next game:"), h("div", { class: "opts3" }, perkBtns));
  const perkCheck = () => { perk.hidden = name.value.trim().toLowerCase() !== "aws"; };
  name.addEventListener("input", perkCheck);
  perkCheck();
  const go = async (mode, extra = {}) => {
    extra = { want: name.value.trim().toLowerCase() === "aws" ? want || null : null, ...(window.AlibiProfile ? AlibiProfile.flair() : {}), ...extra };
    const n = name.value.trim();
    if (!n) { name.focus(); toast("Type your name first."); return; }
    prefSet("alibi.name", n);
    try {
      const d = await post("/api/play", { name: n, mode, ...(["create", "bots", "practice"].includes(mode) ? { map: pickedMap, game: pickedGame } : {}), ...extra });
      me = { code: d.code, pid: d.pid, token: d.token };
      if (mode === "create" && window.AlibiFamily && window.AlibiFamily.pending()) window.AlibiFamily.announce(d.code);   // Homebase: tell the family chat the code
      saveMe();
      history.replaceState(null, "", "/");
      S = null;
      clearInterval(lobbyTimer); lobbyTimer = null;
      const pm = pickedMap === "random" && mode !== "join" ? { door_label: "🎲 Somewhere new", enter_sub: "Where will it happen…" } : curMap();
      doors({ label: pm.door_label, sub: pm.enter_sub }, () => { render(); startPolling(); });
    } catch (e) { toast(e.message, 4000); }
  };
  homeGo = go;
  const join = () => { const c = code.value.trim().toUpperCase(); if (c.length !== 4) { toast("Game codes have 4 letters."); code.focus(); return; } go("join", { code: c }); };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  const m = curMap();
  const mode = (cls, em, title, sub, fn) => h("button", { class: `mode ${cls}`, type: "button", onClick: fn }, h("span", { class: "em" }, em), h("b", {}, title), h("small", {}, sub));
  return h("section", { class: "home" },
    h("button", { class: "ibtn gear", type: "button", "aria-label": "Settings", title: "Settings", onClick: settings }, "⚙️"),
    h("div", { class: "hero" }, h("span", { class: "bigemoji", "aria-hidden": "true" }, pickedMap === "random" ? "🎲" : m.emoji),
      h("div", { class: "logo" }, h("span", { html: LENS }), h("span", { class: "label" }, pickedMap === "random" ? "A surprise location" : m.title)),
      h("h1", { class: "display" }, "Alibi"),
      h("p", { class: "tagline" }, pickedMap === "random" ? "Somewhere new every time. A secret to keep. And one of you has decided not to wait." : m.tagline)),
    window.AlibiProfile ? AlibiProfile.chip() : null,
    window.AlibiProfile ? AlibiProfile.dailyCard() : null,
    fam ? h("div", { class: "card invite" }, h("b", {}, `🏠 A game for ${fam.f || "your family"}`), h("p", { class: "muted small" }, "Check your name, then start. Your family is told the code in the Homebase chat, with a Join button."), h("button", { class: "btn primary block", type: "button", onClick: () => go("create") }, "Start the family game")) : null,
    joinCode ? h("div", { class: "card invite" }, h("b", {}, `You're invited to game ${joinCode}.`), h("p", { class: "muted small" }, "Type your name and tap Join.")) : null,
    h("label", { class: "field" }, h("span", {}, "Your name"), name), perk,
    gamePicker(),
    mapPicker(),
    h("div", { class: "modes" },
      mode("primary", "👨‍👩‍👧", "Start a game", "For family or friends: everyone joins on their own phone with a code", () => go("create")),
      mode("", "🤖", "Play with bots", "Right now, against five bots", () => go("bots")),
      mode("", "🌍", "Find a game", "The public queue: starts in 30 seconds", () => go("queue")),
      mode("", "🎓", "Practice", "A gentle game with tips: you're never the killer", () => go("practice")),
      mode("", "🏅", "Your profile", "Level, achievements, badges and your record", () => window.AlibiProfile && AlibiProfile.open()),
      h("div", { class: "mode join" }, h("span", { class: "em" }, "🔑"), h("span", { class: "grow" }, h("b", {}, "Join with a code"), h("small", {}, "Four letters from the host")), code, h("button", { class: "btn" + (joinCode ? " primary" : ""), type: "button", onClick: join }, "Join"))),
    h("div", { class: "lobbybox stack tight", hidden: !LOBBIES.length }, h("div", { class: "section-h" }, h("span", { class: "live-dot" }), h("span", { class: "label" }, "Open games right now")),
      h("div", { class: "lobbies", id: "lobbies" }, lobbyRows())),
    h("details", { class: "card" }, h("summary", {}, "📖 How to play"),
      h("ol", { class: "howto" },
        h("li", {}, h("span", {}, h("b", {}, "Everyone on their own phone. "), "4 to 8 guests, each with a character; bots fill empty chairs. One of you is secretly the killer (two in a big game).")),
        h("li", {}, h("span", {}, h("b", {}, "Every hour, walk to a room next door. "), "The house is a floor plan: you start in the middle and go one door at a time (the killer knows secret passages). See who's there, talk, look around, pick things up. You see who you pass in the doorways.")),
        h("li", {}, h("span", {}, h("b", {}, "The killer strikes "), "when they're alone with someone and already carrying a weapon. Storms and power cuts help: a dark room hides who's in it.")),
        h("li", {}, h("span", {}, h("b", {}, "Find the body, look back. "), "You only know what you saw. Everyone sees where they died, roughly when, how, and what's missing.")),
        h("li", {}, h("span", {}, h("b", {}, "Meet, whisper, vote. "), "Share your day (the killer lies), check the evidence board, message anyone privately, vote someone out. If the killers catch up, there's a final showdown: survive the day.")),
        h("li", {}, h("span", {}, h("b", {}, "Or play hide and seek. "), "One seeker counts, everyone else hides. Sneak a room an hour, hide behind the door, under the furniture or in the shadows, and keep quiet. Found? You join the hunt.")),
        h("li", {}, h("span", {}, h("b", {}, "Level up. "), "Every game earns XP. Unlock achievements and badges, and beat the daily challenge.")))),
    rolesGuide(),
    h("p", { class: "muted small center" }, "Voice needs a microphone and works best on Wi-Fi."));
}

/* ---------- the lobby ---------- */
/** Every role in the game, for the home screen. */
const ROLES = [["🔪", "The Killer", "Strikes when alone with someone, carrying a weapon. Lies about their day. Can cut the lights once a day."],
  ["🎭", "The Shapeshifter", "A killer who can wear someone else's face for an hour, once a day. Witnesses blame the wrong person. (5+ players)"],
  ["🕵️", "The Detective", "Once a day, questions someone they're alone with and learns if they're a killer. Can unmask the Shapeshifter."],
  ["🩺", "The Doctor", "Watches over one patient a day: the killer's strike won't kill them. Reads the exact weapon off the body."],
  ["🧭", "The Tracker", "Once a day, follows someone's footprints for an hour: where they really went, with whom, and what they took. (5+)"],
  ["🛡️", "The Bodyguard", "Once a day, shadows someone for an hour, going wherever they go, and fights off the killer if they strike. (6+)"],
  ["🔮", "The Medium", "Hears the ghosts' chat and holds a séance once a day. The dead answer in riddles. (6+)"],
  ["🃏", "The Jester", "On nobody's side: wins by getting voted out. Watch out for a guest who seems a little too guilty. (5+)"],
  ["🕯️", "Guest", "Everyone else: watch, talk, remember, and vote the killer out."]];
function rolesGuide() {
  return h("details", { class: "card roles-guide" }, h("summary", {}, "🎭 The roles"),
    h("div", { class: "plist" }, ROLES.map(([e, t, d]) => h("div", { class: "prow top" }, h("span", { class: "big-emoji sm" }, e), h("span", {}, h("b", {}, t), h("br"), h("small", { class: "muted" }, d))))));
}
const PACE_TEXT = { quick: "Hours and meetings are about 40% shorter. Good for a short break.", normal: "The standard pace.", relaxed: "Hours and meetings are about 70% longer: more time to talk it through." };
const seenPids = new Set();
function lobby() {
  const humans = S.players.filter((p) => !p.bot), bots = S.players.filter((p) => p.bot);
  const mine = who(S.me.pid);
  const link = `${location.origin}/#join/${S.code}`;
  const share = async () => {
    const text = `Come play Alibi with me! Code ${S.code}`;
    try { if (navigator.share) { await navigator.share({ title: "Alibi", text, url: link }); return; } } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text}: ${link}`); toast("Link copied. Send it to everyone."); } catch { toast(link, 8000); }
  };
  const tiles = S.players.map((p) => {
    const fresh = seenPids.size && !seenPids.has(p.pid);
    return h("div", { class: "ptile" + (p.ready && !p.bot ? " ready" : "") + (p.pid === S.me.pid ? " me" : "") + (fresh ? " fresh" : "") },
      p.badge ? h("span", { class: "flair", title: "Badge" }, p.badge) : null,
      h("span", { class: "state" }, p.bot ? "🤖" : p.ready ? "✅" : p.host ? "👑" : "…"),
      face(p), h("b", {}, p.name, p.pid === S.me.pid ? " (you)" : ""), h("small", {}, p.level ? `Level ${p.level}` : p.bot ? "Bot" : "New", p.voice ? " · 🎙️" : ""));
  });
  S.players.forEach((p) => seenPids.add(p.pid));
  return h("section", { class: "stack" },
    bar(S.public ? "Finding players" : S.practice ? "Practice" : "Your game", h("button", { class: "btn ghost sm", type: "button", onClick: leave }, "Leave")),
    coach(),
    S.public
      ? h("div", { class: "card codecard" }, h("span", { class: "label" }, "Public game"), h("h1", { class: "h2" }, "Looking for players…"),
        h("p", { class: "muted small" }, "It starts when the timer runs out, or as soon as 8 people join. Empty chairs get bots."), S.start_at ? timer(S.start_at, 30) : null)
      : h("div", { class: "card codecard" }, h("span", { class: "label" }, "Game code"), h("div", { class: "bigcode", "aria-label": `Game code ${S.code.split("").join(" ")}` }, S.code.split("").map((c) => h("span", { class: "ch" }, c))),
        h("p", { class: "muted small" }, "Everyone opens this site on their own phone and joins with the code, or with the link."),
        h("div", { class: "row center" }, h("button", { class: "btn primary", type: "button", onClick: share }, "📤 Send the link"),
          S.me.host ? h("button", { class: "btn" + (S.listed ? " accent" : ""), type: "button", "aria-pressed": String(S.listed), onClick: () => act("listed", { on: !S.listed }) }, S.listed ? "🌍 Listed: anyone can join" : "🔒 Private") : null)),
    h("div", { class: "card stack tight" }, h("div", { class: "row" }, h("span", { class: "label" }, `Guests · ${S.players.length} of 8`), h("span", { class: "spacer" }),
      !S.public && S.me.host ? h("div", { class: "stepper", "aria-label": "Bots" }, h("small", { class: "muted" }, "Bots"), h("button", { type: "button", "aria-label": "One bot fewer", disabled: !bots.length, onClick: () => act("bots", { n: bots.length - 1 }) }, "−"),
        h("b", {}, String(bots.length)), h("button", { type: "button", "aria-label": "One more bot", disabled: S.players.length >= 8, onClick: () => act("bots", { n: bots.length + 1 }) }, "+")) : null),
      h("div", { class: "ptiles" }, tiles), S.players.length < 4 ? h("p", { class: "muted small" }, "Bots fill it up to 4. More guests open more rooms.") : null),
    h("div", { class: "card stack tight" }, h("span", { class: "label" }, "Map"), h("div", { class: "row" }, h("span", { class: "big-emoji" }, curMap().emoji), h("span", { class: "grow" }, h("b", {}, curMap().title), h("br"), h("small", { class: "muted" }, curMap().short))),
      !S.public && S.me.host ? mapDots() : h("p", { class: "muted small" }, curMap().tagline)),
    !S.public ? h("div", { class: "card stack tight" }, h("span", { class: "label" }, "Pace" + (S.me.host ? "" : " · the host decides")),
      h("div", { class: "seg", role: "group", "aria-label": "Pace" }, [["quick", "⚡ Quick"], ["normal", "⏱️ Normal"], ["relaxed", "🛋️ Relaxed"]].map(([k, l]) =>
        h("button", { class: (S.pace || "normal") === k ? "on" : "", type: "button", disabled: !S.me.host, "aria-pressed": String((S.pace || "normal") === k), onClick: () => act("pace", { pace: k }) }, l))),
      h("p", { class: "muted small" }, PACE_TEXT[S.pace || "normal"])) : null,
    S.me.perk ? h("div", { class: "card perk" }, h("span", { class: "label" }, "✨ Aws's perk: your side"),
      h("div", { class: "opts3" }, [["killer", "🔪 Killer"], ["guest", "🕯️ Guest"], [null, "🎲 Random"]].map(([w, l]) =>
        h("button", { class: "optbtn" + ((S.me.want || null) === w ? " on" : ""), type: "button", onClick: () => act("want", { want: w }) }, l)))) : null,
    !S.public ? h("div", { class: "card stack tight" }, h("span", { class: "label" }, "The game" + (S.me.host ? "" : " · the host decides")),
      h("div", { class: "seg", role: "group", "aria-label": "The game" }, [["murder", "🔪 Murder weekend"], ["hide", "🙈 Hide and seek"]].map(([k, l]) =>
        h("button", { class: (S.mode || "murder") === k ? "on" : "", type: "button", disabled: !S.me.host, "aria-pressed": String(S.mode === k), onClick: () => { sfx("pick"); act("mode", { mode: k }); } }, l))),
      h("p", { class: "muted small" }, S.mode === "hide" ? "One night on the house map. A seeker (two in a big game) hunts the rest; whoever is found joins the hunt. Hiders win if anyone is still hidden at 5 AM."
        : "A weekend on the house map: walk one room an hour, find the body, vote out the killer.")) : null,
    !S.public && S.mode !== "hide" ? h("div", { class: "card" }, h("span", { class: "label" }, "Special roles" + (S.me.host ? " · tap to switch" : "")),
      h("div", { class: "rolechips" }, Object.entries(S.roleInfo || {}).map(([j, [e, t]]) => {
        const on = (S.rolesOn || []).includes(j);
        return h("button", { class: "rolechip" + (on ? " on" : ""), type: "button", disabled: !S.me.host, "aria-pressed": String(on), title: S.roleInfo[j][2], onClick: () => { sfx("click"); act("roles", { role: j, on: !on }); } },
          h("span", { class: "e" }, e), h("span", {}, t.replace("The ", ""), h("small", {}, { shapeshifter: "a killer · 5+", doctor: "5+ for both", detective: "always", medium: "6+", jester: "5+", tracker: "5+", bodyguard: "6+" }[j] || "")));
      })), h("p", { class: "muted small" }, "The Detective and the Doctor come first; the others are drawn at random, more in bigger games.")) : null,
    h("div", { class: "card stack tight" }, h("span", { class: "label" }, "Lobby chat"),
      h("div", { class: "chatlog lobby-log", "data-log": "lobby" }, (S.lobbychat || []).map(msgEl), !(S.lobbychat || []).length ? h("p", { class: "muted small center" }, "Say hello while you wait.") : null),
      composer("lobby", "Say something…", (t) => act("chat", { text: t })), emoteBar()),
    !S.public ? h("div", { class: "dock" },
      h("button", { class: "btn block lg " + (mine?.ready ? "" : "primary glow"), type: "button", onClick: (e) => { if (!mine?.ready) { sfx("pick"); burst(e.currentTarget, 12); } act("ready", { on: !mine?.ready }); } }, mine?.ready ? "✓ Ready · tap to wait" : "I'm ready"),
      h("p", { class: "muted small center", style: { margin: 0 } }, S.start_at ? ["Everyone's ready. Starting in ", timer(S.start_at, 4)]
        : `${humans.filter((p) => p.ready).length} of ${humans.length} ready. It starts as soon as everyone is.`)) : null);
}
async function leave() {
  try { await post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type: "leave" }); } catch { /* ignore */ }
  clearInterval(polling);
  doors({ label: curMap().leave_label, sub: curMap().leave_sub }, () => {
    stopVoice();
    me = null; S = null; ui.dm = null; saveMe(); syncAmbience(); render();
  });
}

/* ---------- your character and your secret ---------- */
function hideRoleCard() {
  const seek = S.me.role === "hunter";
  const others = S.players.filter((p) => p.role === "hunter" && p.pid !== S.me.pid);
  const flip = () => { ui.revealed = true; ui.justFlipped = true; sfx("reveal"); buzz([40]); render(); setTimeout(() => { burst(document.querySelector(".rolecard .role-emoji"), 18); ui.justFlipped = false; }, 650); };
  return h("div", { class: "flipcard" + (ui.revealed ? " flipped" : "") + (ui.justFlipped ? " justflipped" : "") }, h("div", { class: "inner" },
    h("button", { class: "cardback", type: "button", onClick: flip, "aria-label": "Turn over your card", inert: ui.revealed }, h("span", { class: "seal" }, "🙈"), h("b", {}, "Seeker or hider?"), h("small", {}, "Tap to turn the card over")),
    h("div", { class: "back rolecard " + (seek ? "hunter" : "hider"), inert: !ui.revealed },
      h("div", { class: "role-emoji" }, seek ? "🔦" : "🙈"),
      h("h1", { class: "who" }, seek ? "You are the seeker" : "You are hiding"),
      h("p", {}, seek ? "Count to a hundred in the middle of the house, then hunt, one room an hour. Anyone in the open is caught; for the rest, search one hiding place. Whoever you find joins you."
        : "Sneak through the house one room an hour. Hide behind the door, under the furniture or in the shadows: a seeker who looks in the wrong place walks right past. Keep still and quiet. Survive until 5 AM."),
      others.length ? h("p", { class: "small" }, seek ? "Seeking with you: " : others.length > 1 ? "The seekers: " : "The seeker: ", h("b", {}, others.map((p) => p.name).join(", "))) : null,
      h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.revealed = false; render(); } }, "Turn it back"))));
}
function roles() {
  const killer = S.me.role === "killer", jester = S.me.job === "jester";
  const fellow = S.players.filter((p) => p.role === "killer" && p.pid !== S.me.pid);
  const flip = () => { ui.revealed = true; ui.justFlipped = true; sfx("reveal"); buzz(killer ? [80, 40, 160] : [40]); render(); setTimeout(() => { burst(document.querySelector(".rolecard .role-emoji"), 18); ui.justFlipped = false; }, 650); };
  const card = h("div", { class: "flipcard" + (ui.revealed ? " flipped" : "") + (ui.justFlipped ? " justflipped" : "") }, h("div", { class: "inner" },
    h("button", { class: "cardback", type: "button", onClick: flip, "aria-label": "Reveal your secret role", inert: ui.revealed }, h("span", { class: "seal" }, "🕵️"), h("b", {}, "Your secret"), h("small", {}, "Cover your screen, then tap to turn the card over")),
    h("div", { class: "back rolecard " + (killer ? "killer" : jester ? "jester" : "guest"), inert: !ui.revealed },
      h("div", { class: "role-emoji" }, killer ? (S.me.job === "shapeshifter" ? "🎭" : "🔪") : jester ? "🃏" : S.me.jobInfo ? S.me.jobInfo[0] : "🕯️"),
      h("h1", { class: "who" }, killer ? "You are the killer" : jester ? "You are the Jester" : "You are a guest"),
      h("p", {}, killer ? "Come into a room already carrying a weapon, and strike when you're alone with someone. Then lie about where you were."
        : jester ? "Get yourself voted out and you win, whoever wins the weekend. Look guilty… but not too guilty." : "Go about your day. Notice who you're with, who picks up what, and who lies about it later."),
      fellow.length ? h("p", { class: "small" }, "Your partner in crime: ", h("b", {}, fellow.map((p) => p.name).join(", "))) : null,
      S.me.jobInfo && !jester ? h("div", { class: "jobcard" }, h("span", { class: "job-emoji" }, S.me.jobInfo[0]), h("div", {}, h("b", {}, `You're also ${S.me.jobInfo[1]}`), h("p", { class: "small" }, S.me.jobInfo[2]))) : null,
      S.me.mission ? h("p", { class: "mission-line" }, "🎯 Secret mission: ", h("b", {}, S.me.mission.text)) : null,
      h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.revealed = false; render(); } }, "Hide it again"))));
  return h("section", { class: "stack" }, bar(curMap().title), coach(),
    h("div", { class: "card prologue" }, h("span", { class: "label" }, "Prologue"), h("p", { class: "lead" }, S.prologue)),
    h("div", { class: "card charcard" }, face(who(S.me.pid), "big"), h("div", {}, h("span", { class: "label" }, "You are playing"), h("h2", { class: "h2" }, S.me.char?.title), h("p", { class: "muted" }, S.me.char?.blurb))),
    S.mode === "hide" ? hideRoleCard() : card,
    S.mode === "hide" ? h("div", { class: "card" }, h("span", { class: "label" }, "Tonight"), h("div", { class: "row" }, h("span", { class: "tag hunter" }, `🔦 ${S.cast?.hunters || 1} seeking`),
      h("span", { class: "tag hider" }, `🙈 ${S.players.length - (S.cast?.hunters || 1)} hiding`), h("span", { class: "tag" }, `🕰️ ${S.hours[0]} to ${S.hours[S.hours.length - 1]}`))) : null,
    S.cast && S.mode !== "hide" ? h("div", { class: "card" }, h("span", { class: "label" }, "In this game"),
      h("div", { class: "row" }, h("span", { class: "tag red" }, `🔪 ${S.cast.killers} killer${S.cast.killers > 1 ? "s" : ""}`),
        S.cast.jobs.map((j) => h("span", { class: "tag accent", title: S.roleInfo[j][2] }, `${S.roleInfo[j][0]} ${S.roleInfo[j][1].replace("The ", "")}`)))) : null,
    h("div", { class: "card" }, h("span", { class: "label" }, "The guests"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name), lvl(p), h("br"), h("small", { class: "muted" }, p.char?.title || "")), h("span", { class: "spacer" }), swatch(p))))),
    h("p", { class: "muted small center" }, S.mode === "hide" ? "The lights go out in " : "The day begins in ", timer(S.deadline)));
}

/* ---------- each hour, step 1: where do you go? ---------- */
function dayHeader() {
  return h("div", { class: "dayhead" },
    h("div", { class: "meta" }, h("span", { class: "tag accent" }, S.mode === "hide" ? "🌙 The night" : S.showdown ? "⚔️ Showdown" : `Day ${S.day}`), h("span", { class: "spacer" }), timer(S.deadline), roleChip()),
    h("div", { class: "hourtrack", "aria-label": `${S.hours[S.hour]}, hour ${S.hour + 1} of ${S.hours.length}` }, S.hours.map((hr, i) => h("span", { class: "h" + (i < S.hour ? " done" : i === S.hour ? " now" : "") }, h("i"), hr))),
    S.beat ? h("p", { class: "beat" + (S.beat.fx ? " storm" : "") }, h("span", { class: "e" }, S.beat.fx === "dark" ? "🕯️" : S.beat.fx === "rain" ? "🌧️" : "📜"), h("span", {}, S.beat.text)) : null,
    S.me.carrying ? h("p", { class: "carry" }, h("span", {}, itemIcon(S.me.carrying)), h("span", {}, "You're carrying the ", h("b", {}, S.me.carrying), ".")) : null,
    S.shape && S.phase === "room" ? h("p", { class: "carry shape-line" }, "🎭 You're wearing ", h("b", {}, `${S.shape}'s face`), " this hour.") : null, missionLine());
}
function lastHour() {
  const last = (S.myday || [])[S.myday.length - 1];
  if (!last) return null;
  const took = last.items || [];
  return h("div", { class: "card recap" }, h("span", { class: "label" }, `Last hour · ${last.hour}`),
    h("p", {}, `In the ${roomName(last.room)} `, last.saw.length ? ["with ", h("b", {}, last.saw.join(", ")), "."] : "on your own."),
    took.length ? h("div", { class: "took" }, took.map((x) => h("span", { class: `tookchip ${x.kind}` }, x.kind === "take" ? "✋ " : "↩️ ", h("b", {}, x.who),
      x.kind === "take" ? ` ${x.sneak ? "quietly " : ""}took the ${x.item}` : ` put back the ${x.item}`, x.sneak && x.who !== "You" ? " 👀" : ""))) : null,
    last.events.filter((e) => !/ (quietly )?took the | put the .+ back\./.test(e)).map((e) => h("p", { class: "small ev" }, e)));
}
/* ---------- the house on one screen: rooms where they sit, the doors between them, the killer's passages dashed ---------- */
const FLOORS = [[3, 0, "⬆ Upstairs"], [0, 2, "Ground floor"], [0, 3, "⬇ Below"], [1, 3, ""], [3, 3, ""]];
/** cell(id) may return { cls, onClick, tag: [text, cls], dots: [{ name, color, cls }], label } for each room. */
function floorPlan({ cell = () => ({}), compact = false, label = "Floor plan of the house" } = {}) {
  const P = S?.plan;
  if (!P) return null;
  const pos = Object.fromEntries(P.cells.map((c) => [c.id, c]));
  const cx = (c) => (c.col + 0.5) * 25, cy = (c) => (c.row + c.span / 2) * 25;
  const near = new Set(S.reach || []);
  const line = ([a, b], cls) => (pos[a] && pos[b] ? `<line x1="${cx(pos[a])}" y1="${cy(pos[a])}" x2="${cx(pos[b])}" y2="${cy(pos[b])}" class="${cls}"/>` : "");
  const svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${P.doors.map((d) => line(d, d.includes(S.at) && near.has(d[0]) && near.has(d[1]) ? "open" : "")).join("")}`
    + `${P.secrets.map((d) => line(d, "secret")).join("")}</svg>`;
  const taken = new Set(P.cells.flatMap((c) => Array.from({ length: c.span }, (_, k) => `${c.col},${c.row + k}`)));
  return h("div", { class: "plan" + (compact ? " compact" : ""), role: "group", "aria-label": label },
    h("span", { class: "links", html: svg }),
    FLOORS.filter(([c, r]) => !taken.has(`${c},${r}`)).map(([c, r, t]) => h("span", { class: "floor", style: { gridColumn: String(c + 1), gridRow: String(r + 1) } }, t)),
    P.cells.map((c) => {
      const r = roomOf(c.id) || { emoji: "❔", name: c.id }, x = cell(c.id) || {};
      return h(x.onClick ? "button" : "div", { class: `cell ${x.cls || ""}`, type: x.onClick ? "button" : null, onClick: x.onClick || null,
        "aria-label": x.label || r.name, style: { gridColumn: String(c.col + 1), gridRow: `${c.row + 1} / span ${c.span}` } },
        x.tag ? h("span", { class: `tagx ${x.tag[1] || ""}` }, x.tag[0]) : null, h("span", { class: "em" }, r.emoji), h("span", { class: "nm" }, r.name),
        x.dots?.length ? h("span", { class: "dots" }, x.dots.map((d) => h("span", { class: `dot ${d.cls || ""}`, style: { "--c": d.color || "#8a8a95" }, title: d.name }, d.name[0]))) : null);
    }));
}
const planHint = () => h("div", { class: "planhint" }, h("span", {}, h("i"), "a door you can take"), (S.plan?.secrets || []).length ? h("span", {}, h("i", { class: "s" }, ""), "a secret passage (only you know)") : null);
/** What you hear through the doors: voices, footsteps, someone moving about. */
function hearing() {
  const out = {};
  for (const x of S.next || []) {
    if (x.hunter) out[x.room] = ["👣", "warn", `Heavy footsteps in the ${roomName(x.room)}: a seeker!`];
    else if (x.count) out[x.room] = [S.mode === "hide" ? `🔊${x.count}` : `🗣️${x.count}`, "noise", S.mode === "hide" ? `Someone moving about in the ${roomName(x.room)}` : `Voices in the ${roomName(x.room)} (${x.count})`];
  }
  return out;
}
const hearingLine = () => { const x = Object.values(hearing()); return x.length ? h("div", { class: "nextdoor", "aria-label": "Next door" }, x.map(([, cls, t]) => h("span", { class: cls }, t))) : null; };
/** Pick where to be this hour, on the plan: where you are, or a room next door. */
function walkPlan() {
  const near = new Set(S.reach || []), heard = hearing();
  const doors = new Set((S.plan?.doors || []).filter((d) => d.includes(S.at)).flat());
  const locked = S.beat?.fx === "rain" ? S.beat.room : null, darkRoom = S.beat?.fx === "dark" ? S.beat.room : null;
  const go = (id, e) => { ui.changing = false; sfx("pick"); burst(e.currentTarget, 10); act("move", { room: id }); };
  return floorPlan({ label: "Where will you go? Tap your room or one next door.", cell: (id) => ({
    cls: [S.moved === id ? "picked" : id === S.at ? "here" : near.has(id) ? "can" : "far", near.has(id) && id !== S.at && !doors.has(id) ? "via" : "", id === darkRoom ? "dark" : "", id === locked ? "locked" : ""].join(" "),
    onClick: near.has(id) ? (e) => go(id, e) : null, tag: heard[id] || (id === locked ? ["🌧️", ""] : id === darkRoom ? ["🕯️", ""] : null),
    label: `${roomName(id)}${id === S.at ? " (you are here: stay)" : near.has(id) ? "" : " (too far this hour)"}${heard[id] ? `. ${heard[id][2]}` : ""}` }) });
}
function move() {
  if (S.mode === "hide") return hideMove();
  if (!S.me.alive) return h("section", { class: "stack" }, bar(`Day ${S.day}`), ghostBanner(), dayHeader(), spectateCard(), emoteBar(), ghostChat());
  const here = roomOf(S.at);
  if (S.moved && !ui.changing) {
    const r = roomOf(S.moved);
    return h("section", { class: "stack" }, bar(S.showdown ? "The last day" : `Day ${S.day}`), dayHeader(),
      h("div", { class: "card heading" }, h("span", { class: "big-emoji" }, r.emoji), h("b", { class: "h3" }, S.shadowing?.now ? `Shadowing ${S.shadowing.name}…` : S.moved === S.at ? `Staying in the ${r.name}…` : `Heading to the ${r.name}…`),
        h("div", { class: "steps", "aria-hidden": "true" }, h("span", {}, "👣"), h("span", {}, "👣"), h("span", {}, "👣"), h("span", {}, "👣")),
        h("p", { class: "muted small" }, "Waiting for everyone to choose."), S.shadowing?.now ? null : h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.changing = true; render(); } }, "Change my mind")),
      walkPlan(), abilities(), lastHour());
  }
  return h("section", { class: "stack" }, bar(S.showdown ? "The last day" : `Day ${S.day}`), dayHeader(), coach(),
    gazette(),
    S.showdown ? h("div", { class: "card warn" }, h("b", {}, "⚔️ The final showdown. "), S.me.role === "killer" ? "Catch every guest alone before dusk." : "Stay alive until dusk. Don't be caught alone with the killer.") : null,
    h("div", {}, h("h2", { class: "h2" }, `Where will you be at ${S.hours[S.hour]}?`),
      h("p", { class: "muted small" }, `You're in the ${here?.name || "hall"}. Stay, or walk through a door to a room next door.`)),
    walkPlan(), planHint(), hearingLine(),
    abilities(), lastHour(), voiceTip());
}

/* ---------- hide and seek ---------- */
const amHunter = () => S.me.role === "hunter";
const SPOT_TEXT = { door: "behind the door", under: "under the furniture", shadows: "in the shadows" };
const SPOT_EMOJI = { door: "🚪", under: "🛋️", shadows: "🌑" };
const seekerNote = (text) => h("div", { class: "alert", style: { background: "#2a1f0e", color: "#ffe3b8", boxShadow: "inset 0 0 0 1px rgba(240,180,90,.45)" } }, text);
function hideMove() {
  const h0 = S.hide || {};
  const seekers = S.players.filter((p) => p.role === "hunter"), hiders = S.players.filter((p) => p.role === "hider");
  const head = [bar("Hide and seek"), dayHeader(), coach()];
  const score = h("div", { class: "row" }, h("span", { class: "tag hider" }, `🙈 ${hiders.length} hiding`), h("span", { class: "tag hunter" }, `🔦 ${seekers.length} seeking`));
  if (h0.counting) {
    return h("section", { class: "stack" }, ...head, h("div", { class: "card counting" }, h("span", { class: "em" }, "🙈"), h("span", { class: "label" }, "You're the seeker"),
      h("div", { class: "big" }, "…98, 99, 100!"), h("p", { class: "muted" }, "Eyes closed in the middle of the house while everyone hides. You start hunting next hour.")), score, floorPlan({ cell: (id) => ({ cls: id === S.at ? "here" : "far" }) }));
  }
  if (S.moved && !ui.changing) {
    return h("section", { class: "stack" }, ...head, h("div", { class: "card heading" }, h("span", { class: "big-emoji" }, roomOf(S.moved).emoji),
      h("b", { class: "h3" }, S.moved === S.at ? (h0.spot ? `Keeping still ${SPOT_TEXT[h0.spot] || ""}…` : `Staying in the ${roomName(S.moved)}…`) : `${amHunter() ? "Creeping" : "Tiptoeing"} into the ${roomName(S.moved)}…`),
      h("div", { class: "steps", "aria-hidden": "true" }, h("span", {}, "👣"), h("span", {}, "👣"), h("span", {}, "👣"), h("span", {}, "👣")),
      h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.changing = true; render(); } }, "Change my mind")), score, walkPlan());
  }
  return h("section", { class: "stack" }, ...head, score,
    amHunter() ? seekerNote("🔦 You're a seeker: you can run two rooms an hour and you hear anyone moving that far away. Anyone in the open when the hour ends is caught; for the rest, search two hiding places.")
      : h0.cramp ? h("div", { class: "alert" }, "🦵 Your legs are cramping: the seekers can hear you. Time to move.")
      : h0.spot ? h("div", { class: "calmnote" }, `🫥 You're tucked away ${SPOT_TEXT[h0.spot]} in the ${roomName(S.at)}. Stay put to stay hidden: walking out puts you in the open.`)
        : h("div", { class: "calmnote" }, "🙈 Sneak one room at a time. Listen for footsteps, and find somewhere to hide."),
    h("div", {}, h("h2", { class: "h2" }, `Where to at ${S.hours[S.hour]}?`), h("p", { class: "muted small" }, `You're in the ${roomName(S.at)}.`)),
    walkPlan(), hearingLine(), planHint());
}
function hideRoom() {
  const here = S.here;
  if (!here) return h("section", { class: "stack" }, bar("Hide and seek"), dayHeader());
  const r = roomOf(here.room), a = S.acted || {}, h0 = S.hide || {};
  const seekersHere = here.people.filter((p) => p.role === "hunter"), hidersHere = here.people.filter((p) => p.role !== "hunter");
  const looks = [].concat(a.search || []), max = h0.searches || 2;
  const chosen = amHunter() ? looks : (a.spot ?? h0.spot);
  const isOn = (k) => (amHunter() ? looks.includes(k) : chosen === k);
  const pickSpot = (k, e) => {
    sfx("pick"); burst(e.currentTarget, 8);
    if (!amHunter()) return act("do", { spot: k });
    const next = looks.includes(k) ? looks.filter((x) => x !== k) : [...looks, k].slice(-max);
    act("do", { search: next });
  };
  const spots = h("div", { class: "spots" }, Object.keys(SPOT_TEXT).map((k) => h("button", { class: "spot" + (amHunter() ? " search" : "") + (isOn(k) ? " on" : ""), type: "button", "aria-pressed": String(isOn(k)),
    onClick: (e) => pickSpot(k, e) }, h("span", { class: "em" }, SPOT_EMOJI[k]), SPOT_TEXT[k][0].toUpperCase() + SPOT_TEXT[k].slice(1))));
  if (amHunter() && S.hour === 0) {
    return h("section", { class: "stack" }, bar("Hide and seek"), dayHeader(),
      h("div", { class: "card counting" }, h("span", { class: "em" }, "🙈"), h("span", { class: "label" }, "Eyes shut"), h("div", { class: "big" }, "…57, 58, 59…"),
        h("p", { class: "muted" }, "You hear footsteps scattering through the house. Next hour, you hunt.")),
      hearingLine(), h("div", { class: "dock" }, S.leaving ? h("p", { class: "center muted small", style: { margin: 0 } }, "✓ Ready.") : h("button", { class: "btn primary block lg", type: "button", onClick: () => act("leave_room") }, "Ready or not ▸")));
  }
  const status = amHunter()
    ? [hidersHere.length ? seekerNote(`👀 ${hidersHere.map((p) => p.name).join(", ")} ${hidersHere.length > 1 ? "are" : "is"} in here! Anyone still in the open at the end of the hour is caught. They'll dive somewhere: guess where.`) : null,
      here.breathing ? h("p", { class: "breath" }, "…you hear someone breathing in here. Very quietly.") : !hidersHere.length ? h("p", { class: "muted small" }, "Nobody in sight. Search a spot anyway, or listen at the doors.") : null,
      h("div", { class: "card stack tight" }, h("span", { class: "label" }, `🔦 Search ${max} hiding places this hour · ${looks.length} of ${max} picked`), spots)]
    : [seekersHere.length ? h("div", { class: "alert" }, `😱 ${seekersHere.map((p) => p.name).join(" and ")} ${seekersHere.length > 1 ? "are" : "is"} in here with you! Hide, now, and hope they look in the wrong place.`) : null,
      h0.cramp ? h("div", { class: "alert" }, "🦵 Your legs are cramping! Seekers can hear you now. Move somewhere new next hour.")
        : h0.still ? h("div", { class: "calmnote" }, `🫥 Nobody saw you: you were already tucked away ${SPOT_TEXT[h0.spot]}. Keep still.`) : null,
      here.breathing ? h("p", { class: "breath" }, "…someone else is hiding in here too.") : null,
      h("div", { class: "card stack tight" }, h("span", { class: "label" }, chosen ? `🫥 Hiding ${SPOT_TEXT[chosen]}` : "⚠️ You're in the open! Pick a hiding place"), spots,
        h("p", { class: "muted small", style: { margin: 0 } }, `A seeker looks in ${max} of the 3 places. Keeping still makes no sound (for ${2} hours, then your legs cramp). Talking, or reacting, gives you away.`))];
  return h("section", { class: "stack" }, bar(`${r.emoji} ${r.name}`), dayHeader(), coach(),
    h("div", { class: "roomhero" }, h("span", { class: "big-emoji" }, r.emoji), h("span", { class: "grow" }, h("span", { class: "label" }, `${S.hours[S.hour]} · you're in`), h("h2", { class: "h2" }, `The ${r.name}`))),
    ...status,
    h("div", { class: "card" }, h("span", { class: "label" }, here.people.length ? `In sight · ${here.people.length}` : "Nobody in sight"),
      here.people.length ? h("div", { class: "people" }, here.people.map((p) => h("div", { class: "person" }, face(p), h("span", { class: "grow" }, h("b", {}, p.name, p.bot ? " 🤖" : ""),
        h("small", {}, p.role === "hunter" ? "🔦 Seeker" : p.hiding ? "🫥 Hiding" : "🙈 Hider"))))) : h("p", { class: "muted small" }, "Just you… as far as you can tell.")),
    hearingLine() || h("p", { class: "muted small" }, amHunter() ? "No sound from next door." : "No footsteps next door. For now."),
    h("div", { class: "card stack tight" }, h("span", { class: "label" }, "Whisper here"),
      h("div", { class: "chatlog small-log", "data-log": "room" }, (S.roomchat || []).map(msgEl), !(S.roomchat || []).length ? h("p", { class: "muted small center" }, amHunter() ? "Taunt them: they can read it." : "Careful: a word gives away your hiding place.") : null),
      typingLine(S.typing?.room), composer("room", amHunter() ? "Ready or not…" : "Whisper (gives you away)…", (t) => act("room", { text: t }), "room"), emoteBar()),
    floorPlan({ compact: true, cell: (id) => ({ cls: id === here.room ? "here" : "far", tag: hearing()[id] || null }) }),
    h("div", { class: "dock" }, S.leaving ? h("p", { class: "center muted small", style: { margin: 0 } }, "✓ Ready. Waiting for the others, or the clock.")
      : h("button", { class: "btn primary block lg", type: "button", onClick: () => { sfx("door"); act("leave_room"); } }, amHunter() ? (looks.length ? "Search ▸" : "Done ▸") : chosen ? "Hold your breath ▸" : "Stay in the open ▸")));
}
/** What your role lets you do while everyone picks a room. */
function abilities() {
  return [S.canCut ? cutCard() : null, shapeCard(), doctorCard(), trackerCard(), bodyguardCard(),
    S.canBell ? h("button", { class: "btn ghost block bell", type: "button",
      onClick: async () => { if (await ask({ title: "🔔 Ring the bell?", text: "Everyone stops what they're doing and the meeting starts now. You can do this once a game.", ok: "Ring it" })) { sfx("bell"); act("bell"); } } }, "🔔 Ring the bell: call the meeting now") : null];
}
const ability = (cls, e, title, text, btn) => h("div", { class: `card jobpanel ability ${cls}` }, h("span", { class: "e" }, e), h("b", {}, title), h("p", { class: "small" }, text), btn);
/** The Shapeshifter borrows a face for the hour. */
function shapeCard() {
  if (S.me.job !== "shapeshifter" || !S.me.alive) return null;
  return ability("violet", "🎭", "The Shapeshifter", S.shape ? ["This hour you wear ", h("b", {}, `${S.shape}'s face`), ". Anyone who sees you sees them."]
    : S.canShift ? "Once a day: take someone's face for this hour. Anyone who sees you, even watching you strike, sees them." : "You've worn a borrowed face today already.",
  S.canShift && !S.shape ? h("button", { class: "btn primary block", type: "button", onClick: () => pickSheet("🎭 Whose face?", "For this hour only. Tip: pick someone who'll be somewhere else.", (p) => act("shift", { target: p.pid })) }, "Borrow a face") : null);
}
/** The Doctor chooses today's patient: whoever it is survives the killer's strike today. */
function doctorCard() {
  if (S.me.job !== "doctor" || !S.me.alive) return null;
  return ability("green", "🩺", "The Doctor", S.guard ? ["Today you're watching over ", h("b", {}, S.guard), ". If the killer strikes them, they'll live."] : "Choose today's patient: if the killer strikes them today, they survive.",
    S.guard ? null : h("button", { class: "btn primary block", type: "button", onClick: () => pickSheet("🩺 Today's patient", "You can't pick yourself, and you can't change your mind today.", (p) => act("guard", { target: p.pid })) }, "Choose a patient"));
}
/** The Tracker follows someone's footprints for this hour. */
function trackerCard() {
  if (S.me.job !== "tracker" || !S.me.alive) return null;
  const t = S.tracking;
  return ability("", "🧭", "The Tracker", t ? (t.now ? ["You're following ", h("b", {}, `${t.name}'s footprints`), " this hour. You'll know where they went when it ends."] : ["Today you followed ", h("b", {}, t.name), ` at ${t.hour}.`])
    : "Once a day: pick someone to follow this hour. When it ends you'll know where they really went, who was with them, and what they took.",
  S.canTrack ? h("button", { class: "btn primary block", type: "button", onClick: () => pickSheet("🧭 Follow whose footprints?", "For this hour. Footprints don't lie, even under a borrowed face.", (p) => act("track", { target: p.pid })) }, "Follow someone") : null);
}
/** The Bodyguard shadows someone: you go where they go. */
function bodyguardCard() {
  if (S.me.job !== "bodyguard" || !S.me.alive) return null;
  const s = S.shadowing;
  return ability("", "🛡️", "The Bodyguard", s ? (s.now ? ["You're shadowing ", h("b", {}, s.name), " this hour, wherever they go. If the killer strikes them in front of you, you'll fight them off."] : ["Today you shadowed ", h("b", {}, s.name), ` at ${s.hour}.`])
    : "Once a day: shadow someone for this hour. You go wherever they go (no room to pick), and if the killer strikes them, you step in.",
  S.canShadow ? h("button", { class: "btn primary block", type: "button", onClick: () => pickSheet("🛡️ Shadow who?", "You'll go wherever they go this hour. Careful: if they're the killer, you'll be alone with them.", (p) => act("shadow", { target: p.pid })) }, "Shadow someone") : null);
}
/** The morning paper: yesterday, in headlines, every morning. */
function gazette() {
  const g = S.gazette;
  if (!g || ui.paperShut === `${S.day}`) return null;
  return h("div", { class: "gazette" }, h("button", { class: "ibtn close", type: "button", "aria-label": "Fold the paper", onClick: () => { ui.paperShut = `${S.day}`; render(); } }, "✕"),
    h("div", { class: "masthead" }, curMap().gazette), h("div", { class: "dateline" }, `Morning of day ${S.day} · One penny`),
    h("h2", {}, g.headline), g.lines.map((l) => h("p", {}, l)));
}
/** The killer's trick, once a day: plunge a room into darkness for this hour. Everyone sees the lights go. */
function cutCard() {
  return h("details", { class: "card cut" }, h("summary", {}, "🔌 Cut the lights (once a day)"),
    h("p", { class: "muted small" }, "Pick a room: it's pitch dark in there this hour. Nobody sees who's inside, and you can strike whoever's alone with you."),
    h("div", { class: "opts2" }, S.rooms.filter((r) => r.id !== "garden").map((r) => h("button", { class: "optbtn", type: "button",
      onClick: async () => { if (await ask({ title: `Cut the lights in the ${r.name}?`, text: "Everyone will see the lights go out there. Once a day.", ok: "Cut them", danger: true })) act("cut", { room: r.id }); } }, `${r.emoji} ${r.name}`))));
}

/* ---------- each hour, step 2: in the room ---------- */
const ROOM_LINES = () => ["Hello! 👋", "What brings you here?", "Seen anything odd today?", "Let's stick together.", "I'm just passing through.", S.hour + 1 < S.hours.length ? `Meet me here at ${S.hours[S.hour + 1]}?` : "Nearly dusk…"];
function room() {
  if (S.mode === "hide") return hideRoom();
  if (!S.me.alive) return h("section", { class: "stack" }, bar(`Day ${S.day}`), ghostBanner(), dayHeader(), spectateCard(), hauntCard(), emoteBar(), ghostChat());
  const here = S.here;
  if (!here) return h("section", { class: "stack" }, bar(`Day ${S.day}`), dayHeader());
  const r = roomOf(here.room);
  const killer = S.me.role === "killer";
  const a = S.acted || {};                                       // what you've chosen so far: saved as you tap, used when the hour ends
  const choose = (patch) => { sfx("click"); act("do", { act: a.act === "look" ? "look" : "act", take: a.take || null, sneak: !!a.sneak, put: !!a.put, strike: a.strike || null, investigate: a.investigate || null, ...patch }); };
  const people = here.dark
    ? h("div", { class: "card dark" }, h("b", {}, "It's pitch dark."), h("p", {}, here.count ? `You can hear ${here.count === 1 ? "someone" : `${here.count} people`} breathing nearby.` : "You seem to be alone… probably."))
    : h("div", { class: "card" }, h("span", { class: "label" }, here.people.length ? `Here with you · ${here.people.length}` : "Nobody else is here"),
      here.people.length ? h("div", { class: "people" }, here.people.map((p) => h("div", { class: "person" }, face(p), h("span", { class: "grow" }, h("b", {}, p.name, p.bot ? " 🤖" : ""), h("small", {}, p.char)),
        who(p.pid)?.voice ? h("span", { title: "On voice" }, "🎙️") : null,
        h("button", { class: "ibtn", type: "button", "aria-label": `Whisper to ${p.name}`, title: "Whisper", onClick: () => { ui.dm = p.pid; render(); } }, "✉️")))) : h("p", { class: "muted small" }, "A quiet moment to yourself."));
  const opt = (on, label, fn, cls = "") => h("button", { class: `optbtn ${cls}${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), onClick: fn }, label);
  const home = S.me.carrying && S.rooms.find((x) => x.items.includes(S.me.carrying))?.id === here.room;
  const victims = here.people.filter((p) => who(p.pid)?.role !== "killer");
  const canStrike = killer && S.me.carrying && (here.dark ? here.count === 1 : victims.length > 0);
  const looking = a.act === "look";
  const doPanel = h("div", { class: "card stack" }, h("span", { class: "label" }, "What do you do?"),
    h("div", { class: "opts2" },
      opt(!looking, `✨ ${r.act}`, () => choose({ act: "act" })),
      opt(looking, "🔍 Look around", () => choose({ act: "look" }))),
    !S.me.carrying ? h("div", { class: "opts2" }, here.items.map((it) => opt(a.take === it, `✋ Take the ${it}`, () => choose({ take: a.take === it ? null : it }))),
      !here.items.length ? h("p", { class: "muted small" }, "Nothing here worth taking: someone got there first.") : null) : null,
    a.take ? opt(!!a.sneak, "🤫 Sneak it: only someone looking around will notice", () => choose({ sneak: !a.sneak }), "sneak") : null,
    home ? opt(!!a.put, `↩️ Put back the ${S.me.carrying}`, () => choose({ put: !a.put })) : null,
    killer ? (canStrike ? (here.dark ? [opt(a.strike === "dark", `🔪 Strike whoever is in the dark (with the ${S.me.carrying})`, () => choose({ strike: a.strike ? null : "dark" }), "strike")]
      : victims.map((v) => opt(a.strike === v.pid, `🔪 Walk up to ${v.name} and strike (with the ${S.me.carrying})${here.people.length > 1 ? ` · ${here.people.length - 1} will see it` : ""}`,
        () => choose({ strike: a.strike === v.pid ? null : v.pid }), "strike")))
      : h("p", { class: "muted small" }, S.me.carrying ? (here.dark ? "🔪 Too dark: you can only find someone if they're alone in here with you." : "🔪 Nobody here to strike.") : "🔪 Take a weapon: you can strike from the next hour.")) : null,
    S.me.job === "detective" ? (S.checked ? h("p", { class: "muted small" }, "🕵️ You've already questioned someone today.")
      : !here.dark && here.people.length === 1 ? opt(a.investigate === here.people[0].pid, `🕵️ Question ${here.people[0].name} (once a day): are they a killer?`,
        () => choose({ investigate: a.investigate ? null : here.people[0].pid }), "detect")
        : h("p", { class: "muted small" }, "🕵️ To question someone, you need to be alone with them, with the lights on.")) : null,
    h("p", { class: "muted small center", style: { margin: 0 } }, "Your choice is saved as you tap it. Stay up to a minute to talk."));
  const talkers = here.people.length || here.count;
  return h("section", { class: "stack" }, bar(`${r.emoji} ${r.name}`), dayHeader(), coach(),
    h("div", { class: "roomhero" + (here.dark ? " dark" : "") }, h("span", { class: "big-emoji" }, r.emoji), h("span", { class: "grow" }, h("span", { class: "label" }, here.dark ? "Pitch dark" : `${S.hours[S.hour]} · you're in`), h("h2", { class: "h2" }, `The ${r.name}`))),
    people, hearingLine(),
    here.gone?.length ? h("p", { class: "gone" }, "🕳️ Gone from this room: ", here.gone.map((i) => `the ${i}`).join(", "), ". Someone's taken it.") : null,
    h("div", { class: "card stack tight" }, h("span", { class: "label" }, here.dark ? "Whispers in the dark" : "Talk here"),
      h("div", { class: "chatlog small-log", "data-log": "room" }, (S.roomchat || []).map(msgEl),
        !(S.roomchat || []).length ? h("p", { class: "muted small center" }, talkers ? "Say hello. Only the people in this room can read it." : "Nobody to talk to.") : null),
      typingLine(S.typing?.room),
      talkers ? [quickLines(ROOM_LINES(), (t) => act("room", { text: t })), composer("room", "Say something to the room…", (t) => act("room", { text: t }), "room"), emoteBar()] : null),
    doPanel, voiceTip(),
    h("div", { class: "dock" }, S.leaving ? h("p", { class: "center muted small", style: { margin: 0 } }, "✓ Ready to move on. Waiting for the others, or the clock.")
      : h("button", { class: "btn primary block lg", type: "button", onClick: async () => { if (!S.acted) await act("do", { act: "act" }); sfx("door"); act("leave_room"); } }, "Leave the room ▸")));
}

/** The dead see the whole house: where everyone is (or is heading), what they carry, and what's being said. */
function spectateCard() {
  const house = S.house || [];
  if (!house.length) return null;
  const by = Object.fromEntries(house.map((x) => [x.room, x]));
  const talk = house.filter((x) => x.chat?.length);
  return h("div", { class: "card stack haunt" }, h("span", { class: "label" }, S.phase === "move" ? "👻 Where they're heading" : "👻 The house, from beyond"),
    floorPlan({ label: "Everyone in the house", cell: (id) => ({ cls: by[id]?.dark ? "dark" : "", dots: (by[id]?.people || []).map((q) => ({ name: q.name, color: q.color, cls: q.killer ? "k" : "" })),
      tag: (by[id]?.people || []).some((q) => q.carry) ? [itemIcon((by[id].people.find((q) => q.carry) || {}).carry), ""] : null,
      label: `${roomName(id)}: ${(by[id]?.people || []).map((q) => q.name + (q.killer ? " (the killer)" : "") + (q.carry ? `, carrying the ${q.carry}` : "")).join(", ") || "empty"}` }) }),
    h("p", { class: "muted small", style: { margin: 0 } }, "A red ring is a killer. ", h("span", { class: "planhint", style: { display: "inline-flex" } }, h("span", {}, h("i", { class: "s" }, ""), "secret passages"))),
    talk.length ? h("div", { class: "hchat" }, talk.flatMap((x) => x.chat.map((m) => h("span", {}, roomOf(x.room)?.emoji, " ", h("b", { style: { color: m.color } }, m.name), " ", m.text)))) : null);
}
/** Once an hour a ghost can send a sign rattling through one room. */
const HAUNTS = ["👻", "🔪", "👀", "🕯️", "❄️", "❓"];
function hauntCard() {
  const house = (S.house || []).filter((x) => x.people.length);
  if (S.phase !== "room") return null;
  return h("div", { class: "card stack haunt" }, h("span", { class: "label" }, "👻 Haunt a room"),
    S.haunted ? h("p", { class: "muted small center" }, "The candles still flicker where you passed. You can haunt again next hour.")
      : [h("p", { class: "muted small" }, "Rattle a room: the living in it see your sign. Point them at the truth… or just scare them."),
        h("div", { class: "picker haunts" }, HAUNTS.map((e) => h("button", { type: "button", class: ui.haunt === e ? "on" : "", "aria-pressed": String(ui.haunt === e), onClick: () => { ui.haunt = e; render(); } }, e))),
        h("div", { class: "opts2" }, house.map((x) => h("button", { class: "optbtn", type: "button",
          onClick: () => { sfx("spook"); act("haunt", { room: x.room, emoji: ui.haunt || "👻" }); } }, `Haunt the ${roomName(x.room)} with ${ui.haunt || "👻"}`)))]);
}

/* ---------- messages ---------- */
const REACTIONS = ["👍", "😂", "😱", "🤔", "🔪", "👀"];
function reactRow(m) {
  const have = Object.entries(m.reactions || {}).filter(([, pids]) => pids.length);
  const open = ui.reactFor === m.id;
  const pick = (e) => { ui.reactFor = null; sfx("tick"); act("react", { id: m.id, emoji: e }); };
  return h("div", { class: "reacts" },
    have.map(([e, pids]) => h("button", { class: "react" + (pids.includes(S.me.pid) ? " mine" : ""), type: "button", title: pids.map((q) => who(q)?.name).join(", "), onClick: () => pick(e) }, e, " ", String(pids.length))),
    h("button", { class: "react add", type: "button", "aria-label": "React", onClick: () => { ui.reactFor = open ? null : m.id; render(); } }, open ? "✕" : "☺︎+"),
    open ? h("span", { class: "picker" }, REACTIONS.map((e) => h("button", { type: "button", onClick: () => pick(e) }, e))) : null);
}
const seenMsgs = new Set();                   // messages animate once, when they first arrive, not on every redraw
function msgEl(m) {
  const fresh = m.id && !seenMsgs.has(m.id) ? " fresh" : "";
  if (m.id) seenMsgs.add(m.id);
  if (m.medium) return h("div", { class: "cmsg mediummsg" + fresh }, h("span", { class: "big-emoji" }, "🔮"), h("div", {}, h("b", {}, "The Medium calls to the dead"), h("p", {}, `“${m.text}”`)));
  if (m.bell) return h("div", { class: "cmsg bellmsg" + fresh }, h("span", { class: "big-emoji" }, "🔔"), h("p", {}, h("b", {}, m.text)));
  if (m.note) return h("div", { class: "cmsg notemsg" + fresh }, h("span", { class: "big-emoji" }, "📜"), h("div", {}, h("i", { class: "small muted" }, "A note has been slipped under the door…"), h("p", {}, `“${m.text}”`), m.id ? reactRow(m) : null));
  if (m.accuse) return h("div", { class: "cmsg accusemsg" + fresh }, face({ name: m.name, color: m.color }, "sm"),
    h("div", {}, h("b", { style: { color: m.color } }, m.name, m.bot ? " 🤖" : ""), h("p", { class: "jaccuse" }, "👉 J'ACCUSE!"), h("p", {}, "I think it's ", h("b", {}, m.accuse), "."), m.id ? reactRow(m) : null));
  if (m.haunt) return h("div", { class: "cmsg hauntmsg" + fresh }, h("span", { class: "big-emoji" }, m.text), h("p", {}, h("i", {}, "An icy draft sweeps the room… "), h("b", {}, m.name), " was here."));
  return h("div", { class: "cmsg" + fresh + (m.pid === S?.me?.pid ? " mine" : "") + (m.ghost ? " ghostmsg" : "") },
    face({ name: m.name, color: m.color }, "sm"),
    h("div", {}, h("b", { style: { color: m.color } }, m.name, m.bot ? " 🤖" : "", m.ghost ? " 👻" : ""),
      m.claim ? h("div", { class: "claim" }, m.claim.map((c) => h("span", {}, h("i", {}, c.hour), " ", c.room))) : h("p", {}, m.text),
      m.id && !m.noReact && S?.phase !== "lobby" ? reactRow(m) : null));
}
let typedAt = 0;
/** A text box; `ctx` says where you're typing, so the others see "… is typing" (sent at most every couple of seconds). */
function composer(key, placeholder, send, ctx) {
  const input = h("input", { class: "input", placeholder, maxlength: "200", "aria-label": placeholder, "data-keep": key, enterkeyhint: "send", autocomplete: "off" });
  const go = () => { const t = input.value.trim(); if (!t) return; input.value = ""; send(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  if (ctx) input.addEventListener("input", () => {
    if (!input.value.trim() || Date.now() - typedAt < 2500) return;
    typedAt = Date.now();
    post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type: "typing", ctx }).catch(() => {});
  });
  return h("div", { class: "line" }, input, h("button", { class: "btn primary", type: "button", onClick: go }, "Send"));
}
/** One-tap lines, for thumbs in a hurry. */
const quickLines = (lines, send) => h("div", { class: "quick", role: "group", "aria-label": "Quick lines" }, lines.map((t) => h("button", { type: "button", onClick: () => send(t) }, t)));
const typingLine = (names) => (names?.length ? h("p", { class: "typing-line" }, `${names.join(", ")} ${names.length > 1 ? "are" : "is"} typing`) : null);
function ghostChat() {
  return h("div", { class: "card stack" }, h("span", { class: "label" }, "Ghost chat"),
    h("div", { class: "chatlog", "data-log": "ghost" }, (S.chat || []).filter((m) => m.ghost).map(msgEl), !(S.chat || []).some((m) => m.ghost) ? h("p", { class: "muted small center" }, "It's quiet on this side.") : null),
    typingLine(S.typing?.meet),
    composer("ghost", "Whisper to the other ghosts…", (t) => act("chat", { text: t }), "meet"));
}
/** Private messages: a list of everyone you can write to, or one conversation. */
function dmPanel() {
  if (!ui.dm) return null;
  const close = () => { ui.dm = null; render(); };
  const others = S.players.filter((p) => p.pid !== S.me.pid && p.alive === S.me.alive);
  let body;
  if (ui.dm === "list") {
    body = [h("h3", {}, "Private messages"), h("p", { class: "muted small" }, "Only the two of you can read these. Bots answer too."),
      h("div", { class: "plist" }, others.map((p) => {
        const last = [...(S.dms || [])].reverse().find((m) => (m.from === p.pid && m.to === S.me.pid) || (m.from === S.me.pid && m.to === p.pid));
        const n = (S.dms || []).filter((m) => m.from === p.pid && m.to === S.me.pid && m.t > (ui.seen[p.pid] || 0)).length;
        return h("button", { class: "prow dmrow", type: "button", onClick: () => { ui.dm = p.pid; render(); } }, face(p),
          h("span", { class: "grow" }, h("b", {}, p.name, p.bot ? " 🤖" : ""), h("br"), h("small", { class: "muted" }, last ? last.text.slice(0, 48) : p.char?.title || "")),
          n ? h("span", { class: "badge" }, String(n)) : null);
      })),
      !others.length ? h("p", { class: "muted" }, "Nobody to write to.") : null];
  } else {
    const p = who(ui.dm);
    const thread = (S.dms || []).filter((m) => (m.from === ui.dm && m.to === S.me.pid) || (m.from === S.me.pid && m.to === ui.dm));
    ui.seen[ui.dm] = Math.max(ui.seen[ui.dm] || 0, ...thread.map((m) => m.t));
    body = [h("div", { class: "row" }, h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.dm = "list"; render(); } }, "‹ All"), face(p || {}, "sm"), h("h3", { style: { margin: 0 } }, p?.name || "?")),
      h("div", { class: "chatlog", "data-log": "dm" }, thread.map((m) => msgEl({ ...m, noReact: true, pid: m.from, color: who(m.from)?.color, bot: who(m.from)?.bot, name: who(m.from)?.name || m.name })),
        !thread.length ? h("p", { class: "muted small center" }, `Say something only ${p?.name} will see.`) : null),
      (S.typing?.dm || []).includes(ui.dm) ? typingLine([p?.name]) : null,
      p && p.alive === S.me.alive ? composer("dm", `Message ${p.name}…`, (t) => act("dm", { to: ui.dm, text: t }), `dm:${ui.dm}`) : null];
  }
  return h("div", { class: "overlay" }, h("div", { class: "sheet-scrim", onClick: close }), h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Private messages" },
    h("button", { class: "ibtn close", type: "button", "aria-label": "Close", onClick: close }, "✕"), body));
}

/* ---------- the body ---------- */
const CHALK = '<svg class="chalk" viewBox="0 0 120 90" aria-hidden="true"><path d="M60 8c8 0 12 6 11 13-1 6-6 9-11 9s-10-4-10-10c0-7 4-12 10-12zM50 32c-8 2-20 10-30 6-4-1-6 3-2 5 10 6 22 2 30-2l-4 22-18 18c-3 3 0 7 4 5l20-16 10 0 20 16c4 2 7-2 4-5L66 63l-4-22c8 4 20 8 30 2 4-2 2-6-2-5-10 4-22-4-30-6z"/></svg>';
function bodyCard(compact = false) {
  const b = S.body;
  if (!b) return null;
  const fact = (e, ...kids) => h("div", { class: "fact" }, h("span", {}, e), h("span", {}, ...kids));
  return h("div", { class: "paper body-card" + (compact ? " compact" : "") }, h("span", { class: "stamp" }, "DECEASED"),
    h("span", { class: "label" }, "The body"),
    h("h2", {}, b.victim), h("p", { class: "muted small", style: { margin: 0 } }, b.char),
    h("div", { class: "facts" },
      fact("📍", "Found in the ", h("b", {}, b.room), ` ${b.foundAt === "dusk" ? "at dusk" : `at ${b.foundAt}`}${b.foundBy.length ? `, by ${b.foundBy.join(" and ")}` : ""}.`),
      fact("🕰️", "Died around ", h("b", {}, b.hour), "."),
      fact("⚰️", `${b.cause[0].toUpperCase()}${b.cause.slice(1)}.`),
      S.missing?.length ? fact("🕳️", h("b", {}, "Missing from the house: "), S.missing.map((m) => `the ${m.item} (${m.room})`).join(", "), ".") : fact("✓", "Nothing is missing from the house.")),
    b.autopsy ? h("p", { class: "clue" }, "🩺 Your autopsy: it was the ", h("b", {}, b.autopsy), ".") : null,
    b.clue ? h("p", { class: "clue" }, "🧵 Clutched in their hand: threads of ", h("b", {}, b.clue), " fabric. One of them is from the killer's coat…") : null);
}
function body() {
  return h("section", { class: "stack" }, bar(`Day ${S.day}`), coach(),
    h("div", { class: "scream" }, h("span", { html: CHALK }), h("span", { class: "label" }, `A scream rings through ${curMap().place}`), h("h1", { class: "display" }, `${S.body?.victim || "Someone"} is dead.`)),
    ghostBanner(), bodyCard(), survivors(), dayLog(), storyLog(), emoteBar(), h("p", { class: "muted small center" }, "The meeting starts in ", timer(S.deadline)));
}
function quiet() {
  return h("section", { class: "stack" }, bar(`Day ${S.day}`), h("div", { class: "scream calm" }, h("span", { class: "label" }, `Day ${S.day} ends`), h("h1", { class: "display" }, "Nobody died today.")),
    h("p", { class: "lead" }, "But the killer is still among you, and someone has been picking things up…"), survivors(),
    S.missing?.length ? h("div", { class: "card" }, h("b", {}, "🕳️ Missing: "), S.missing.map((m) => `the ${m.item} (${m.room})`).join(", ")) : null, dayLog(),
    h("p", { class: "muted small center" }, "The meeting starts in ", timer(S.deadline)));
}
function showdown() {
  const guests = S.players.filter((p) => p.alive && p.pid !== S.me.pid);
  return h("section", { class: "stack" }, bar("The final showdown"),
    h("div", { class: "scream" }, h("span", { class: "label" }, "The killers have caught up"), h("h1", { class: "display" }, "One last day.")),
    h("div", { class: "card" }, S.me.alive
      ? (S.me.role === "killer" ? h("p", {}, `No more meetings. Catch every guest alone before dusk and ${curMap().prize} is yours.`) : h("p", {}, "No more meetings, no more votes. Survive until dusk and the guests win. Don't let yourself be caught alone with the killer."))
      : h("p", {}, "Watch from beyond: the last day decides everything.")),
    h("div", { class: "row center" }, guests.map((p) => face(p, "big"))), h("p", { class: "muted small center" }, "The day begins in ", timer(S.deadline)));
}
/** Your day, hour by hour: the only witness statement you can trust. */
function dayLog() {
  const mine = S.myday || [];
  if (!mine.length) return null;
  return h("div", { class: "card" }, h("span", { class: "label" }, "Your day"),
    h("ol", { class: "daylog" }, mine.map((e) => h("li", {}, h("span", { class: "t" }, e.hour),
      h("span", {}, h("b", {}, roomName(e.room)), e.dark ? " (dark)" : "", e.saw.length ? [" with ", e.saw.join(", ")] : " alone", e.idle ? h("em", { class: "muted" }, " (you didn't choose)") : null,
        e.events.map((x) => h("span", { class: "ev" }, x)))))));
}
function storyLog() {
  if (!S.beats?.length) return null;
  return h("details", { class: "card" }, h("summary", {}, "📜 What happened in the house"), h("ol", { class: "daylog" }, S.beats.map((b) => h("li", {}, h("span", { class: "t" }, b.hour), h("span", {}, b.text)))));
}

/* ---------- the meeting ---------- */
/** Your private suspect board: tap to cycle a verdict, jot a note. Kept on this phone only. */
const MARKS = [["", "❔", "no idea"], ["ok", "✅", "innocent"], ["hmm", "⚠️", "suspicious"], ["killer", "🔪", "the killer"]];
const bookKey = () => `alibi.notes.${me?.code}`;
function loadBook() { try { return JSON.parse(localStorage.getItem(bookKey()) || "{}"); } catch { return {}; } }
function saveBook(b) { prefSet(bookKey(), JSON.stringify(b)); }
function notebook() {
  const book = loadBook();
  return h("div", { class: "card stack" }, h("span", { class: "label" }, "📝 Your notebook (only you can see this)"),
    h("div", { class: "plist" }, S.players.filter((p) => p.pid !== S.me.pid).map((p) => {
      const e = book[p.pid] || {};
      const i = Math.max(0, MARKS.findIndex((m) => m[0] === (e.mark || "")));
      const note = h("input", { class: "input sm", placeholder: "A note…", maxlength: "80", value: e.text || "", "data-keep": `note-${p.pid}`, "aria-label": `Note on ${p.name}` });
      note.addEventListener("change", () => { const b = loadBook(); b[p.pid] = { ...(b[p.pid] || {}), text: note.value }; saveBook(b); });
      return h("div", { class: "prow top notebook-row" + (p.alive ? "" : " gone-row") }, face(p, "sm"),
        h("div", { class: "grow" }, h("b", {}, p.name), h("small", { class: "muted" }, p.alive ? ` · ${p.char?.title || ""}` : " · gone"), note),
        h("button", { class: `mark ${MARKS[i][0]}`, type: "button", title: MARKS[i][2], "aria-label": `${p.name}: ${MARKS[i][2]}`,
          onClick: () => { const b = loadBook(); b[p.pid] = { ...(b[p.pid] || {}), mark: MARKS[(i + 1) % MARKS.length][0] }; saveBook(b); sfx("click"); render(); } }, MARKS[i][1]));
    })));
}
/** The evidence board: everyone's claimed day side by side, and every claim that clashes with what you saw, in red. */
function evidenceBoard() {
  const b = S.board;
  if (!b) return h("div", { class: "card" }, h("p", { class: "muted small" }, "The board fills in as people share their day."));
  const book = loadBook();
  const murderAt = new Set(b.murder.map((m) => m.i));
  const flagged = b.rows.filter((r) => r.flags.length);
  return h("div", { class: "card stack" }, h("span", { class: "label" }, "🔎 Evidence board"),
    h("div", { class: "board" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, ""), b.hours.map((hr, i) => h("th", { class: murderAt.has(i) ? "murder" : "" }, hr, murderAt.has(i) ? " 🔪" : "")))),
      h("tbody", {},
        h("tr", {}, h("th", {}, h("span", { class: "who" }, "You")), b.you.map((r) => h("td", { class: "you" }, r || "–"))),
        b.rows.map((row) => h("tr", { class: row.alive ? "" : "dead" }, h("th", {}, h("span", { class: "who" }, face({ name: row.name, color: row.color, alive: row.alive }, "sm"), row.name, book[row.pid]?.mark ? ` ${MARKS.find((m) => m[0] === book[row.pid].mark)?.[1] || ""}` : "")),
          b.hours.map((_, i) => {
            const c = row.cells[i], lie = row.flags.some((f) => f.i === i && f.kind === "lie"), mur = row.flags.some((f) => f.i === i && f.kind === "murder");
            return h("td", { class: !c ? "empty" : lie ? "lie" : mur ? "murder" : "" }, c || (row.claimed ? "?" : "–"));
          })))))),
    h("div", { class: "legend" }, h("span", {}, h("i", { style: { background: "var(--red-soft)", boxShadow: "inset 0 0 0 1px var(--red)" } }), "clashes with what you saw"),
      h("span", {}, h("i", { style: { background: "#2a1a10", boxShadow: "inset 0 0 0 1px var(--amber)" } }), "in the murder room"), h("span", {}, "– hasn't shared")),
    flagged.length ? h("ul", { class: "flags" }, flagged.flatMap((r) => r.flags.map((f) => h("li", { class: f.kind }, h("span", {}, f.kind === "lie" ? "🚩" : "🔪"), h("span", {}, h("b", {}, r.name), ": ", f.text)))))
      : h("p", { class: "muted small" }, who(S.me.pid)?.claimed ? "No clashes with what you saw, so far. Ask everyone to share their day." : "No clashes with your day yet. Share yours, and ask the others to share theirs."));
}
/** A list of the living to pick from: for a search, an accusation, the Doctor's patient… */
function pickSheet(title, blurb, pick) {
  const scrim = h("div", { class: "sheet-scrim" });
  const close = () => { scrim.remove(); sheet.remove(); };
  scrim.addEventListener("click", close);
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h3", {}, title), h("p", { class: "muted small" }, blurb),
    h("div", { class: "pick" }, S.players.filter((p) => p.alive && p.pid !== S.me.pid).map((p) => h("button", { class: "pickbtn", type: "button",
      onClick: () => { close(); sfx("pick"); pick(p); } }, face(p, "sm"), h("span", {}, h("b", {}, p.name), h("small", { class: "muted" }, ` ${p.char?.title || ""}`)), h("span", { class: "spacer" }), swatch(p)))),
    h("button", { class: "btn ghost block", type: "button", onClick: close }, "Cancel"));
  document.body.append(scrim, sheet);
  sheet.querySelector(".pickbtn")?.focus();
}
const searchSheet = () => pickSheet("🧤 Search someone's pockets", "Once a game. You'll see what they're carrying right now; they'll know it was you.",
  (p) => act("search", { target: p.pid }));
const accuseSheet = () => pickSheet("👉 J'accuse!", "Once a meeting: point at someone in front of everyone. Bots will answer back.",
  (p) => act("accuse", { target: p.pid }));
async function writeNote() {
  const text = await ask({ title: "📜 An anonymous note", text: "Once a game. Everyone reads it; nobody knows it was you.", input: true, placeholder: "I saw someone slip out of…", ok: "Slip it under the door" });
  if (text) act("note", { text: text.slice(0, 200) });
}
async function seanceAsk() {
  const t = await ask({ title: "🔮 A séance", text: "Ask the dead one question. Only you and the ghosts will hear it. They answer in riddles.", input: true, placeholder: "Spirits, who did this to you?", ok: "Call to the dead" });
  if (t) { sfx("spook"); act("seance", { text: t.slice(0, 200) }); }
}
function casebook() {
  if (S.me.job === "tracker") {
    const t = S.trails || [];
    return h("div", { class: "card jobpanel" }, h("span", { class: "label" }, "🧭 Your trail book"),
      t.length ? t.map((x) => h("p", {}, `Day ${x.day}, ${x.hour}: `, h("b", {}, x.target), ` went to the ${x.room}`, x.with.length ? `, with ${x.with.join(", ")}` : ", alone", x.took ? `, and took the ${x.took}` : "", "."))
        : h("p", { class: "muted small" }, "Nobody followed yet. Pick someone while everyone chooses a room."));
  }
  if (S.me.job !== "detective") return null;
  const f = S.findings || [];
  return h("div", { class: "card jobpanel" }, h("span", { class: "label" }, "🕵️ Your casebook"),
    f.length ? f.map((x) => h("p", { class: x.killer ? "no" : "" }, `Day ${x.day}, ${x.hour}: `, h("b", {}, x.target), x.killer ? " is a KILLER 🔪" : " is innocent ✓"))
      : h("p", { class: "muted small" }, "No one questioned yet. Get someone alone."));
}
const survivors = () => (S.saves?.length ? S.saves.map((x) => h("div", { class: "card saved" }, "🛡️ ", h("b", {}, x.victim), ` was attacked in the ${x.room} around ${x.hour}, and survived.`)) : null);
function searchNotes() {
  const list = (S.searches || []).filter((x) => x.day === S.day || x.mine);
  if (!list.length) return null;
  return h("div", { class: "stack tight" }, list.map((x) => h("div", { class: "card pockets" + (x.mine && x.found ? " hit" : "") }, "🧤 ",
    x.mine ? [`You went through ${x.target}'s pockets: `, x.found ? h("b", {}, `the ${x.found}!`) : "nothing but lint."]
      : [h("b", {}, x.by), " went through your pockets", x.found ? ` and saw the ${x.found}.` : ". They found nothing."])));
}
function claimSheet() {
  const hours = (S.myday || []).map((e) => e.i);
  ui.draft = ui.draft || Object.fromEntries((S.myday || []).map((e) => [e.i, e.room]));
  const scrim = h("div", { class: "sheet-scrim" });
  const close = () => { scrim.remove(); sheet.remove(); };
  scrim.addEventListener("click", close);
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Share my day" },
    h("h3", {}, "📋 Share your day"),
    h("p", { class: "muted small" }, S.me.role === "killer" ? "It's filled in with the truth. You might want to… adjust it." : S.me.job === "jester" ? "The truth is filled in. A Jester might fib a little…" : "Filled in with where you really were. Everyone will see it."),
    h("div", { class: "stack tight" }, hours.map((i) => {
      const sel = h("select", { class: "input", "aria-label": S.hours[i] }, S.rooms.map((r) => h("option", { value: r.id, selected: ui.draft[i] === r.id }, `${r.emoji} ${r.name}`)));
      sel.addEventListener("change", () => { ui.draft[i] = sel.value; });
      return h("label", { class: "claimrow" }, h("span", {}, S.hours[i]), sel);
    })),
    h("button", { class: "btn primary block", type: "button", onClick: () => { close(); sfx("pick"); act("claim", { claim: ui.draft }); } }, "Post it in the meeting"));
  document.body.append(scrim, sheet);
}
const MEET_LINES = () => {
  const out = ["👋 Hi all", "Not me! 🙋", "I was alone all day 😬", "Let's hear everyone's day", "I trust no one 👀", "Let's vote"];
  if (S.body) out.splice(1, 0, `Where was everyone at ${S.body.hour}?`, `Who found ${S.body.victim}?`);
  if (S.missing?.length) out.splice(3, 0, `Who has the ${S.missing[0].item}?`);
  return out;
};
function meetingChat() {
  return h("div", { class: "card stack tight" }, h("span", { class: "label" }, S.me.alive ? "💬 The meeting" : "👻 Ghost chat (and the meeting)"), searchNotes(),
    h("div", { class: "chatlog", "data-log": "meeting" }, (S.chat || []).map(msgEl),
      !(S.chat || []).length ? h("p", { class: "muted small center" }, "Nobody has said anything yet. Start with where you were.") : null),
    typingLine(S.typing?.meet),
    S.me.alive ? quickLines(MEET_LINES(), (t) => act("chat", { text: t })) : null,
    composer("chat", S.me.alive ? "Say something to everyone…" : "Whisper to the other ghosts…", (t) => act("chat", { text: t }), "meet"), emoteBar());
}
function cluesPanel() {
  return h("div", { class: "stack" }, casebook(), survivors(), bodyCard(true) || h("div", { class: "card" }, "Nobody died today.", S.missing?.length ? ` Missing: ${S.missing.map((m) => `the ${m.item}`).join(", ")}.` : ""), dayLog(), storyLog());
}
function peoplePanel() {
  return h("div", { class: "plist card" }, S.players.map((p) => {
    const c = [...(S.chat || [])].reverse().find((m) => m.pid === p.pid && m.claim);
    return h("div", { class: "prow top" }, face(p), h("div", { class: "grow" }, h("b", {}, p.name, p.alive ? "" : p.ejected ? " · voted out" : " · dead"), lvl(p), h("small", { class: "muted" }, ` ${p.char?.title || ""} · `), swatch(p),
      c ? h("div", { class: "claim" }, c.claim.map((x) => h("span", {}, h("i", {}, x.hour), " ", x.room))) : h("small", { class: "muted", style: { display: "block" } }, p.alive ? "Hasn't shared their day" : "")),
      p.pid !== S.me.pid && p.alive === S.me.alive ? h("button", { class: "ibtn", type: "button", "aria-label": `Message ${p.name}`, onClick: () => { ui.dm = p.pid; render(); } }, "✉️") : null);
  }));
}
function talk() {
  const alive = S.players.filter((p) => p.alive && !p.bot);
  const readyN = alive.filter((p) => p.readyToVote).length;
  const claimed = who(S.me.pid)?.claimed;
  const flags = (S.board?.rows || []).reduce((n, r) => n + r.flags.filter((f) => f.kind === "lie").length, 0);
  const tabsFor = (list, key) => h("div", { class: "tabs", role: "tablist" }, list.map(([k, l]) =>
    h("button", { type: "button", role: "tab", "aria-selected": String(ui[key] === k), class: ui[key] === k ? "on" : "", onClick: () => { ui[key] = k; sfx("click"); render(); } }, l, k === "board" && flags ? h("span", { class: "badge" }, String(flags)) : null)));
  const panel = (k) => ({ chat: meetingChat, board: evidenceBoard, evidence: cluesPanel, people: peoplePanel, notes: notebook }[k] || meetingChat)();
  const tools = S.me.alive ? h("div", { class: "toolbar" },
    h("button", { class: "btn sm" + (claimed ? "" : " primary glow"), type: "button", onClick: claimSheet }, claimed ? "📋 Share again" : "📋 Share my day"),
    !S.accused ? h("button", { class: "btn sm danger", type: "button", onClick: accuseSheet }, "👉 J'accuse") : null,
    !S.me.searched ? h("button", { class: "btn sm", type: "button", onClick: searchSheet }, "🧤 Search pockets") : null,
    !S.me.noted ? h("button", { class: "btn sm", type: "button", onClick: writeNote }, "📜 Anonymous note") : null,
    S.canSeance ? h("button", { class: "btn sm", type: "button", onClick: seanceAsk }, "🔮 Séance") : null) : null;
  const voteBtn = S.me.alive ? h("button", { class: "btn block" + (S.readyToVote ? "" : " primary"), type: "button", disabled: S.readyToVote, onClick: () => { sfx("vote"); act("votenow"); } },
    S.readyToVote ? `Waiting for the others (${readyN}/${alive.length})` : `🗳️ Ready to vote (${readyN}/${alive.length})`) : null;
  if (wide) {
    if (ui.side === "chat") ui.side = "board";
    return h("section", { class: "stack wide" }, bar(`The meeting · day ${S.day}`, timer(S.deadline)), ghostBanner(), coach(), voiceTip(),
      h("div", { class: "meetgrid" }, h("div", { class: "stack" }, meetingChat(), tools, voteBtn),
        h("aside", { class: "stack" }, tabsFor([["board", "🔎 Board"], ["evidence", "🧩 Clues"], ["people", "👥 People"], ["notes", "📝 Notes"]], "side"), panel(ui.side))));
  }
  return h("section", { class: "stack" }, bar("The meeting", timer(S.deadline)), ghostBanner(), coach(), voiceTip(),
    tabsFor([["chat", "💬 Chat"], ["board", "🔎 Board"], ["evidence", "🧩 Clues"], ["people", "👥 People"], ["notes", "📝 Notes"]], "tab"), panel(ui.tab), tools,
    voteBtn ? h("div", { class: "dock" }, voteBtn) : null);
}

/* ---------- vote ---------- */
function vote() {
  const alive = S.players.filter((p) => p.alive);
  const mine = S.myvote;
  const voted = alive.filter((p) => p.voted).length;
  const cast = (target, e) => { sfx("vote"); buzz([20, 30, 20]); burst(e.currentTarget, 12); act("vote", { target }); };
  return h("section", { class: "stack" }, bar("The vote", timer(S.deadline)), ghostBanner(), coach(),
    h("div", { class: "center-col stack tight" }, h("span", { class: "label" }, "The vote"), h("h1", { class: "display", style: { fontSize: "clamp(2rem, 9vw, 3rem)" } }, "Who is the killer?"),
      h("p", { class: "muted small" }, `Most votes is out, if it's at least ${Math.max(2, Math.ceil(alive.length / 2))}. A tie means nobody.`)),
    h("div", { class: "card stack tight" }, h("div", { class: "row" }, h("span", { class: "label" }, `${voted} of ${alive.length} have voted`)),
      h("div", { class: "votemeter", "aria-hidden": "true" }, alive.map((p, i) => h("i", { class: i < voted ? "on" : "" })))),
    h("div", { class: "votegrid" }, alive.filter((p) => p.pid !== S.me.pid).map((p) => h("button", { class: "votetile" + (mine === p.pid ? " on" : ""), type: "button", disabled: !S.me.alive, "aria-pressed": String(mine === p.pid), onClick: (e) => cast(p.pid, e) },
      p.voted ? h("span", { class: "voted" }, "✓ voted") : null, face(p, "big"), h("b", {}, p.name), h("small", {}, p.char?.title || ""))),
      h("button", { class: "votetile" + (mine === "skip" ? " on" : ""), type: "button", disabled: !S.me.alive, "aria-pressed": String(mine === "skip"), onClick: (e) => cast("skip", e) },
        h("span", { class: "face big skip" }, "🤷"), h("b", {}, "Skip"), h("small", {}, "Not sure yet"))),
    emoteBar(),
    h("details", { class: "card" }, h("summary", {}, "🔎 The evidence"), evidenceBoard(), bodyCard(true), dayLog()));
}

function result() {
  const e = S.ejected;
  const ballots = S.ballots || [];
  const wait = `${0.5 + ballots.length * 0.45}s`;                // the verdict lands after the last ballot is read out
  const ej = e ? playerByName(e.name) : null;
  const tally = Object.entries(S.tally || {}).sort((a, b) => b[1] - a[1]);
  const most = Math.max(1, ...tally.map(([, c]) => c));
  return h("section", { class: "stack center-col" }, bar("The vote"), coach(),
    h("span", { class: "label" }, "The ballots are read out…"),
    h("div", { class: "ballots" }, ballots.map((b, i) => h("div", { class: "ballot", style: { animationDelay: `${0.3 + i * 0.45}s` } }, faceOf(b.from, "sm"), h("b", {}, b.from), h("span", { class: "arrow" }, "➜"), h("b", { class: "to" }, b.to)))),
    h("div", { class: "verdict", style: { animationDelay: wait } },
      e ? [ej ? Object.assign(face({ ...ej, alive: true }, "xl out"), { style: `animation-delay: calc(${wait} + 0.9s); --c: ${ej.color}` }) : null, h("h1", { class: "display" }, `${e.name} is out.`),
        h("p", { class: "lead " + (e.role === "killer" ? "yes" : "no") }, e.role === "killer" ? "They were a killer! 🔪" : e.jester ? "They were the Jester! 🃏 They wanted this…" : "They were innocent…")]
        : h("h1", { class: "display" }, "Nobody is out."),
      h("div", { class: "tallybars" }, tally.map(([n, c], i) => h("div", { class: "tallybar", style: { animationDelay: `calc(${wait} + ${0.15 * i}s)` } }, h("span", {}, n === "skip" ? "Skip" : n), h("i", { style: { width: `${(100 * c) / most}%` } }), h("b", {}, String(c)))))),
    emoteBar(),
    h("p", { class: "muted small" }, "Next: ", timer(S.deadline)));
}

/* ---------- the end ---------- */
/** The whole weekend replayed on a map of the house, hour by hour: who was where, and where it happened. */
const replayState = { step: 0, timer: null };
function replay() {
  const steps = (S.truth || []).flatMap((d) => d.grid.map((g) => ({ day: d, hour: g.hour, rows: g.rows })));
  if (!steps.length) return null;
  const at = Math.min(replayState.step, steps.length - 1);
  const st = steps[at];
  const kills = st.day.kills.filter((k) => k.hour === st.hour);
  const stop = () => { clearInterval(replayState.timer); replayState.timer = null; };
  const go = (n) => { replayState.step = Math.max(0, Math.min(steps.length - 1, n)); render(); };
  const play = () => {
    if (replayState.timer) { stop(); return render(); }
    if (at >= steps.length - 1) replayState.step = 0;
    replayState.timer = setInterval(() => { if (S?.phase !== "over" || replayState.step >= steps.length - 1) { stop(); if (S) render(); return; } replayState.step++; render(); }, 1400);
    render();
  };
  return h("div", { class: "card stack replay" }, h("span", { class: "label" }, "🎬 Replay the weekend"),
    h("div", { class: "row" }, h("b", {}, st.day.showdown ? "Showdown" : `Day ${st.day.n}`), h("span", { class: "tag accent" }, `🕰️ ${st.hour}`), h("span", { class: "spacer" }),
      h("button", { class: "ibtn", type: "button", "aria-label": "Back", onClick: () => { stop(); go(at - 1); } }, "◀"),
      h("button", { class: "ibtn", type: "button", "aria-label": replayState.timer ? "Pause" : "Play", onClick: play }, replayState.timer ? "⏸" : "▶"),
      h("button", { class: "ibtn", type: "button", "aria-label": "Forward", onClick: () => { stop(); go(at + 1); } }, "▶▶")),
    floorPlan({ label: `Who was where at ${st.hour}`, cell: (id) => {
      const name = roomName(id), here = st.rows.filter((x) => x.room === name), k = kills.find((x) => x.room === name);
      return { cls: k ? "murder" : "", tag: k ? ["🔪", "warn"] : null, label: `${name}: ${here.map((x) => x.name).join(", ") || "empty"}`,
        dots: here.map((x) => { const p = S.players.find((q) => q.name === x.name); return { name: x.name, color: p?.color, cls: p?.role === "killer" ? "k" : p?.role === "hunter" ? "h" : "" }; }) };
    } }),
    kills.map((k) => h("p", { class: "small no", style: { margin: 0 } }, `🔪 ${k.killer} killed ${k.victim} in the ${k.room}`)),
    (S.catches || []).filter((c) => c.hour === st.hour).map((c) => h("p", { class: "small", style: { margin: 0, color: "var(--amber)" } }, `🔦 ${c.by} found ${c.who} ${c.spot} in the ${c.room}`)),
    st.rows.filter((x) => x.did).map((x) => h("p", { class: "small muted", style: { margin: 0 } }, `${x.name} ${x.did}`)),
    h("div", { class: "scrub" }, steps.map((_, i) => h("button", { type: "button", class: i === at ? "on" : i < at ? "done" : "", "aria-label": `Step ${i + 1}`, onClick: () => { stop(); go(i); } }))));
}
/** Dawn: who made it, who was found where, and by whom. */
function hideOver() {
  const st = S.mystats || {}, iWon = !!st.won, dawn = S.winner === "hiders";
  const stars = S.players.filter((p) => (dawn ? p.role === "hider" : p.role === "hunter" && !p.caught));
  if (!endCard && endResult && window.AlibiProfile) endCard = AlibiProfile.resultCard(endResult);
  const foundAt = Object.fromEntries((S.catches || []).map((c) => [c.who, c]));
  return h("section", { class: "stack reveal" }, bar("Dawn"),
    h("div", { class: "culprit " + (iWon ? "won" : "lost") }, h("span", { class: "bigstamp" + (dawn ? "" : " lost") }, dawn ? "DAWN" : "FOUND"),
      h("span", { class: "label" }, dawn ? "🌅 The hiders win" : "🔦 The seekers win"),
      h("div", { class: "row center" }, stars.map((p) => face(p, stars.length > 2 ? "big" : "xl"))),
      h("h1", { class: "display" }, dawn ? stars.map((p) => p.name).join(" & ") : "Everyone was found"),
      h("p", { class: "muted" }, dawn ? `Still hidden at ${S.hours[S.hours.length - 1]}.` : `${stars.map((p) => p.name).join(" & ")} found ${(S.catches || []).length} ${(S.catches || []).length === 1 ? "hider" : "hiders"} between them.`),
      h("p", { class: "youresult" + (iWon ? " won" : "") }, iWon ? (dawn ? "You made it to dawn! 🌅" : "The hunt is over. You won! 🔦") : st.role === "hunter" && foundAt[S.me.name] ? `Found ${foundAt[S.me.name].spot} at ${foundAt[S.me.name].hour}.` : "You lost this one."),
      recordLine() ? h("p", { class: "muted small" }, recordLine()) : null),
    endCard,
    S.highlights?.length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "⭐ The night's big moments"), h("div", { class: "highlights" }, S.highlights.map((x) => h("div", { class: "hl" }, h("span", { class: "e" }, x.emoji), h("b", {}, x.title), h("span", {}, x.text))))) : null,
    (S.catches || []).length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "🔦 Who was found, and where"),
      h("ol", { class: "catchlist" }, S.catches.map((c, i) => h("li", { style: { animationDelay: `${0.2 + i * 0.12}s` } }, h("span", { class: "t" }, c.hour), h("span", {}, h("b", {}, c.by), " found ", h("b", {}, c.who), ` ${c.spot} in the ${c.room}.`))))) : null,
    h("div", { class: "card" }, h("span", { class: "label" }, "Everyone"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name), lvl(p), h("br"), h("small", { class: "muted" }, p.char?.title || "")),
      h("span", { class: "spacer" }), h("span", { class: "right" }, p.role === "hider" ? h("span", { class: "yes" }, "🌅 made it to dawn") : foundAt[p.name] ? h("span", { class: "muted" }, `🙈 found at ${foundAt[p.name].hour}`) : h("span", { style: { color: "var(--amber)" } }, "🔦 seeker")))))),
    replay(), emoteBar(),
    h("div", { class: "dock static" }, h("button", { class: "btn primary block lg", type: "button", onClick: () => act("again", window.AlibiProfile ? AlibiProfile.flair() : {}) }, "🔁 Play again with the same people"),
      h("div", { class: "row nowrap" }, window.AlibiProfile ? h("button", { class: "btn block", type: "button", onClick: () => AlibiProfile.open() }, "🏅 My profile") : null,
        h("button", { class: "btn ghost block", type: "button", onClick: leave }, "Leave"))));
}
function over() {
  if (S.mode === "hide") return hideOver();
  const killers = S.players.filter((p) => p.role === "killer");
  const st = S.mystats || {};
  const iWon = st.won ?? ((S.winner === "killers") === (S.me.role === "killer"));
  if (!endCard && endResult && window.AlibiProfile) endCard = AlibiProfile.resultCard(endResult);
  return h("section", { class: "stack reveal" }, bar("Game over"),
    h("div", { class: "culprit " + (iWon ? "won" : "lost") }, h("span", { class: "bigstamp" + (S.winner === "guests" ? "" : " lost") }, S.winner === "guests" ? "CAUGHT" : "ESCAPED"),
      h("span", { class: "label" }, S.winner === "guests" ? "The guests win" : "The killers win"),
      h("div", { class: "row center" }, killers.map((p) => face(p, "xl"))),
      h("h1", { class: "display" }, killers.map((p) => p.name).join(" & ")),
      h("p", { class: "muted" }, killers.map((p) => p.char?.title).join(" & ")),
      S.jesterWon ? h("p", { class: "tag accent" }, `🃏 ${S.jesterWon} the Jester won too: voted out, just as planned`) : null,
      h("p", { class: "youresult" + (iWon ? " won" : "") }, iWon ? (st.jester ? "Your joke landed. You won! 🃏" : "You won! 🎉") : "You lost this one."), recordLine() ? h("p", { class: "muted small" }, recordLine()) : null),
    endCard,
    S.highlights?.length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "⭐ The weekend's big moments"), h("div", { class: "highlights" }, S.highlights.map((x) => h("div", { class: "hl" }, h("span", { class: "e" }, x.emoji), h("b", {}, x.title), h("span", {}, x.text))))) : null,
    S.awards?.length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "🏅 The weekend's awards"),
      h("div", { class: "awards" }, S.awards.map((a) => h("div", { class: "award" }, h("span", { class: "award-emoji" }, a.emoji),
        h("span", {}, h("b", {}, a.title), h("br"), h("span", {}, a.name), h("small", { class: "muted" }, ` · ${a.detail}`)))))) : null,
    h("div", { class: "card" }, h("span", { class: "label" }, "Everyone"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name), lvl(p), h("br"), h("small", { class: "muted" }, p.char?.title || "")),
      h("span", { class: "spacer" }), h("span", { class: "right" }, h("span", { class: p.role === "killer" ? "no" : "muted" }, p.role === "killer" ? "🔪 killer" : p.alive ? "survived" : p.ejected ? "voted out" : "killed"),
        p.job && S.roleInfo?.[p.job] ? h("small", { class: "muted" }, `${S.roleInfo[p.job][0]} ${S.roleInfo[p.job][1].replace("The ", "the ")}`) : null,
        p.mission ? h("small", { class: "mission-end" + (p.mission.done ? " done" : "") }, `🎯 ${p.mission.text}: ${p.mission.done ? "✅" : "❌"}`) : null))))),
    replay(),
    (S.truth || []).map((d) => h("details", { class: "card stack" }, h("summary", {}, d.showdown ? "⚔️ The final showdown" : `📜 Day ${d.n}: what really happened`),
      d.kills.length ? d.kills.map((k) => h("p", {}, h("b", {}, k.killer), k.shape ? ` (wearing ${k.shape}'s face 🎭)` : "", ` killed ${k.victim} in the ${k.room} at ${k.hour} with the ${k.weapon}.`)) : h("p", { class: "muted" }, "Nobody died."),
      h("div", { class: "grid-wrap" }, h("table", { class: "truth" },
        h("thead", {}, h("tr", {}, h("th", {}, ""), d.grid.map((g) => h("th", {}, g.hour)))),
        h("tbody", {}, S.players.map((p) => h("tr", {}, h("th", {}, p.name), d.grid.map((g) => {
          const r = g.rows.find((x) => x.name === p.name);
          return h("td", {}, r ? r.room : "–", r?.did ? h("small", {}, r.did) : null);
        })))))))),
    emoteBar(),
    h("div", { class: "dock static" }, h("button", { class: "btn primary block lg", type: "button", onClick: () => act("again", window.AlibiProfile ? AlibiProfile.flair() : {}) }, "🔁 Play again with the same people"),
      h("div", { class: "row nowrap" }, window.AlibiProfile ? h("button", { class: "btn block", type: "button", onClick: () => AlibiProfile.open() }, "🏅 My profile") : null,
        h("button", { class: "btn ghost block", type: "button", onClick: leave }, "Leave"))));
}

/* ---------- start ---------- */
if (me) startPolling();
render();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) poll(); });

/* ---------- settings ---------- */
function recordLine() {
  if (!window.AlibiProfile) return "";
  const r = AlibiProfile.load(), lv = AlibiProfile.level(r.xp);
  return r.games ? `Level ${lv.level} ${lv.title} · ${r.wins} won of ${r.games}${r.streak > 1 ? ` · ${r.streak} wins in a row 🔥` : ""}` : "";
}
function settings() {
  if (document.querySelector(".sheet-back.settings")) return;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const back = h("div", { class: "sheet-back settings", onClick: (e) => { if (e.target === back) close(); } });
  const toggle = (label, sub, on, set) => {
    const b = h("button", { class: "swt" + (on ? " on" : ""), type: "button", role: "switch", "aria-checked": String(on), "aria-label": label });
    b.addEventListener("click", () => { on = !on; set(on); b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); sfx("click"); });
    return h("div", { class: "setrow" }, h("span", {}, h("b", {}, label), h("br"), h("small", { class: "muted" }, sub)), b);
  };
  const flag = (key, prop, after) => (on) => { prefs[prop] = on; prefSet(key, on ? "on" : "off"); applyPrefs(); if (after) after(on); };
  const apk = h("a", { class: "btn block", href: "/alibi.apk", download: "Alibi.apk", hidden: true }, "🤖 Get the Android app");
  if (!/AwsaaApp/.test(navigator.userAgent)) fetch("/alibi.apk", { method: "HEAD" }).then((x) => { if (x.ok) apk.hidden = false; }).catch(() => { /* not published yet */ });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Settings" },
    h("div", { class: "row" }, h("h2", { class: "h2" }, "Settings"), h("span", { class: "spacer" }), h("button", { class: "ibtn", type: "button", "aria-label": "Close", onClick: close }, "✕")),
    window.AlibiProfile ? AlibiProfile.chip() : null,
    h("span", { class: "label" }, "Sound and feel"),
    h("div", { class: "setgroup" },
      toggle("Sound", "Footsteps, drums, the ticking clock.", sound.on, (on) => { sound.on = on; prefSet("alibi.sound", on ? "on" : "off"); syncAmbience(); }),
      toggle("Ambience", "The sound of the place, quietly: wind, the sea, a train.", prefs.amb, flag("alibi.amb", "amb", syncAmbience)),
      toggle("Vibration", "A buzz at the big moments, on phones that can.", prefs.buzz, flag("alibi.buzz", "buzz", (on) => { if (on) buzz([30]); }))),
    h("span", { class: "label" }, "Easier to read and play"),
    h("div", { class: "setgroup" },
      toggle("Calm mode", "No animations, no screen shake, no flashes.", prefs.calm, flag("alibi.calm", "calm")),
      toggle("Larger text", "Everything a size bigger.", prefs.big, flag("alibi.big", "big")),
      toggle("High contrast", "Brighter text and clearer edges.", prefs.contrast, flag("alibi.contrast", "contrast")),
      toggle("Tips", "A coach explains each step in your first games.", prefs.tips, flag("alibi.tips", "tips", () => render()))),
    h("button", { class: "btn block", type: "button", onClick: () => { close(); if (window.Tour) window.Tour.open(); else toast("The tutorial did not load. Reload the page."); } }, "▶ Show the tutorial"),
    window.AlibiInstall && window.AlibiInstall.installed() ? null : h("button", { class: "btn block", type: "button", onClick: () => { close(); if (window.AlibiInstall) window.AlibiInstall.install(); } }, "📲 Install Alibi"),
    apk);
  back.append(sheet);
  document.body.append(back);
  document.addEventListener("keydown", onKey);
  sheet.querySelector(".ibtn").focus();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* optional */ });
