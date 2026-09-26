/* Alibi: The Wrenmoor Weekend. The phone: each player's phone shows only their own view of the game, polled from the
   server once a second.

   Screens follow the game's phase: home → lobby → your character and role → each hour: move (pick a room), then the
   room (who's here, talk, what you do) → the body → the meeting (chat, voice, private messages) → vote → the result →
   the next day, the final showdown, or the end with the whole truth.

   Voice is proximity chat: with voice on, you're connected (peer to peer, WebRTC) to the people in the same room as
   you during the day, and to everyone at the meeting. The server only passes the connection messages along. */
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
const LENS = '<svg viewBox="0 0 64 64"><circle cx="27" cy="27" r="13" fill="none" stroke="#b8862b" stroke-width="5"/><path d="M36.5 36.5 L50 50" stroke="#b8862b" stroke-width="7" stroke-linecap="round"/><circle cx="27" cy="27" r="4" fill="#c0392b"/></svg>';

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
const face = (p, cls = "") => h("span", { class: `face ${cls}${p.alive === false ? " dead" : ""}`, style: { "--c": p.color || "#d9a441" }, html: portrait(p.name), "aria-hidden": "true" });

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
      door: () => { noise(0, 0.25, 0.4, 900); tone(196, 0.05, 0.25, "triangle", 0.08); },
      scream: () => { noise(0, 1.6, 0.8, 500); tone(880, 0, 0.9, "sawtooth", 0.05); tone(660, 0.3, 1.0, "sawtooth", 0.04); },
      msg: () => tone(1200, 0, 0.07, "triangle", 0.05),
      dm: () => { tone(988, 0, 0.1, "triangle", 0.07); tone(1319, 0.1, 0.15, "triangle", 0.07); },
      vote: () => { tone(330, 0, 0.2, "triangle"); tone(262, 0.18, 0.4, "triangle"); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.45, "triangle", 0.1)),
      lose: () => { tone(220, 0, 0.4, "sawtooth", 0.06); tone(165, 0.3, 0.8, "sawtooth", 0.06); },
      role: () => { tone(110, 0, 1.2, "sawtooth", 0.05); tone(165, 0.2, 1.1, "sawtooth", 0.04); },
    })[kind]?.();
  } catch { /* no audio */ }
}

/** A burst of falling confetti for the winners (skipped if the phone asks for less motion). */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bits = ["🎉", "✨", "🥳", "🕯️", "🎊"];
  const wrap = h("div", { class: "confetti", "aria-hidden": "true" }, Array.from({ length: 28 }, (_, i) => h("span", {
    style: { left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 0.6}s`, animationDuration: `${1.8 + Math.random() * 1.4}s`, "--spin": `${Math.random() * 720 - 360}deg` } }, bits[i % bits.length])));
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 3800);
}

/* ---------- doors: every way in and out of a room, or the house, swings a pair of doors ---------- */
const doorState = { busy: false };
/** Which doors to show between two views: into a room, out of one, into the house when the game begins. */
function doorFor(a, b) {
  const place = (id) => { const r = b.rooms?.find((x) => x.id === id); return r ? `${r.emoji} ${r.name}` : ""; };
  if (b.phase === "room" && a.phase === "move" && b.here) return { label: place(b.here.room), sub: b.here.dark ? "You push the door open… into pitch darkness." : "You push the door open…" };
  if (b.phase === "body" && a.phase === "move" && b.body) return { label: `${b.body.room}`, sub: "You push the door open… and freeze." };
  if (a.phase === "room" && ["move", "body", "quiet", "showdown"].includes(b.phase)) return { label: "🚪 Back to the hall", sub: "The door clicks shut behind you." };
  if (a.phase === "lobby" && b.phase === "roles") return { label: "🏰 Wrenmoor Manor", sub: "The weekend begins." };
  return null;
}
/** Two wooden doors swing shut over the screen, the next screen is drawn behind them, and they swing open onto it. */
function doors({ label, sub }, then) {
  if (doorState.busy || matchMedia("(prefers-reduced-motion: reduce)").matches) { then(); return; }
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
  }, 900);
}

/* ---------- connection ---------- */
// this tab's seat first (two tabs are two players); the last seat on this phone lets a closed browser rejoin
let me = (() => { try { return JSON.parse(sessionStorage.getItem(ME) || localStorage.getItem(ME) || "null"); } catch { return null; } })();
let S = null;                   // the latest view from the server
let clockSkew = 0;              // server time minus ours
let ui = { tab: "chat", room: null, take: null, put: false, strike: null, look: false, revealed: false, draft: null, dm: null, seen: {} };
let lastPhaseKey = "";
let freshScreen = true;                 // animate a screen in only when it changes, not on every update

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
  const key = `${d.phase}|${d.day}|${d.hour}`;
  const door = before && key !== lastPhaseKey ? doorFor(before, d) : null;
  if (key !== lastPhaseKey) {                                   // a new phase: reset what was half-picked and make a sound
    lastPhaseKey = key;
    freshScreen = true;
    ui = { ...ui, room: null, take: null, put: false, strike: null, look: false, draft: null };
    if (d.phase === "roles") ui.revealed = false;
    const won = d.winner && (d.winner === "killers") === (d.me.role === "killer");
    if (before && d.phase === "over" && won) confetti();
    if (before && ["body", "showdown"].includes(d.phase)) { try { navigator.vibrate?.([90, 60, 180]); } catch { /* ignore */ } }
    if (before) sfx({ roles: "role", move: "hour", room: door ? null : "door", body: "scream", showdown: "scream", vote: "vote",
      over: d.winner && ((d.winner === "killers") === (d.me.role === "killer")) ? "win" : "lose" }[d.phase] || "tick");
    if (!ui.dm) window.scrollTo({ top: 0 });
  }
  if (before) {
    const n = (x) => (x?.chat?.length || 0) + (x?.roomchat?.length || 0);
    if (n(d) > n(before)) sfx("msg");
    const incoming = (d.dms || []).filter((m) => m.to === d.me.pid).length - (before.dms || []).filter((m) => m.to === d.me.pid).length;
    if (incoming > 0) sfx("dm");
  }
  if (door) return doors(door, () => { render(); syncVoice(); });
  render();
  syncVoice();
}
let polling = null;
async function poll() {
  if (!me) return;
  try {
    const q = new URLSearchParams({ pid: me.pid, token: me.token, v: S?.v ?? "" });
    const r = await fetch(`/api/game/${me.code}?${q}`, { cache: "no-store" });
    if (r.status === 404 || r.status === 403) { const d = await r.json().catch(() => ({})); stopVoice(); me = null; S = null; saveMe(); clearInterval(polling); toast(d.error || "That game is over."); render(); return; }
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

/* ---------- rendering, keeping what you're typing ---------- */
function render() {
  if (doorState.busy) return;                                    // the doors are shut: draw the next screen when they open
  const active = document.activeElement?.dataset?.keep || null;
  const kept = Object.fromEntries([...document.querySelectorAll("[data-keep]")].map((el) => [el.dataset.keep, el.value]));
  const logs = Object.fromEntries([...document.querySelectorAll("[data-log]")].map((el) => [el.dataset.log, el.scrollHeight - el.scrollTop - el.clientHeight < 80]));
  const el = h("div", {}, screen(), me && S ? dmPanel() : null);
  if (freshScreen) { el.firstChild?.classList.add("enter"); freshScreen = false; }
  $app.replaceChildren(el);
  for (const [k, v] of Object.entries(kept)) { const x = el.querySelector(`[data-keep="${k}"]`); if (x && v) x.value = v; }
  if (active) { const x = el.querySelector(`[data-keep="${active}"]`); if (x) { x.focus({ preventScroll: true }); try { x.setSelectionRange(x.value.length, x.value.length); } catch { /* ignore */ } } }
  for (const x of el.querySelectorAll("[data-log]")) if (logs[x.dataset.log] !== false) x.scrollTop = x.scrollHeight;
}

function screen() {
  if (!me) return home();
  if (!S) return h("section", { class: "loading" }, h("span", { class: "lens", html: LENS }), h("p", { class: "loadline" }, "Joining the game…"));
  const fn = { lobby, roles, move, room, body, quiet, talk, vote, result, showdown, over }[S.phase] || lobby;
  return fn();
}

const unread = () => (S.dms || []).filter((m) => m.to === S.me.pid && m.t > (ui.seen[m.from] || 0)).length;
const bar = (title, ...right) => h("div", { class: "bar" },
  h("span", { class: "logo-sm", html: LENS }), h("span", { class: "title" }, title), h("span", { class: "spacer" }), ...right,
  S && S.phase !== "lobby" ? h("button", { class: "ibtn", type: "button", "aria-label": "Private messages", title: "Private messages", onClick: () => { ui.dm = "list"; render(); } }, "✉️",
    unread() ? h("span", { class: "badge" }, String(unread())) : null) : null,
  S ? h("button", { class: "ibtn" + (voice.on ? " live" : ""), type: "button", "aria-pressed": String(voice.on), "aria-label": voice.on ? "Voice on: tap to leave" : "Join voice", title: voice.on ? "Voice on" : "Voice chat", onClick: toggleVoice },
    voice.on ? "🎙️" : "🔇", h("span", { class: "badge soft", "data-voice-count": "" }, "")) : null,
  h("button", { class: "ibtn", type: "button", "aria-label": sound.on ? "Sound on" : "Sound off", title: sound.on ? "Sound on" : "Sound off",
    onClick: () => { sound.on = !sound.on; try { localStorage.setItem("alibi.sound", sound.on ? "on" : "off"); } catch { /* ignore */ } render(); } }, sound.on ? "🔊" : "🔈"),
  S && !["lobby", "over"].includes(S.phase) ? h("button", { class: "ibtn", type: "button", "aria-label": "Leave the game", title: "Leave the game",
    onClick: () => { if (confirm(S.me.alive ? "Leave the game? A bot takes over your seat and the game carries on." : "Leave the game? You can't come back to it.")) leave(); } }, "🚪") : null);
const who = (pid) => S.players.find((p) => p.pid === pid);
const roomName = (id) => S.rooms.find((r) => r.id === id)?.name || id;
const roomOf = (id) => S.rooms.find((r) => r.id === id);
const roleChip = () => h("button", { class: "tag role-chip", type: "button", onClick: () => { ui.revealed = !ui.revealed; render(); } },
  ui.revealed ? `${S.me.role === "killer" ? "🔪 Killer" : "🕯️ Guest"} · ${S.me.char?.title || ""}` : "👁 My role");
const ghostBanner = () => (!S.me.alive ? h("div", { class: "ghost stack" },
  h("span", {}, "👻 ", S.me.ejected ? "You were voted out." : "You're dead.", " Stay and watch everything (only other ghosts can hear you), or leave: the game carries on at its own pace either way."),
  h("div", { class: "row" }, h("span", { class: "spacer" }),
    h("button", { class: "btn sm ghost", type: "button", onClick: () => { if (confirm("Leave for good? You can't come back to this game.")) leave(); } }, "Leave the game"))) : null);
const voiceTip = () => (!voice.on && S.players.some((p) => p.voice && p.pid !== S.me.pid) ? h("button", { class: "tipbtn", type: "button", onClick: toggleVoice }, "🎙️ Others are on voice: tap to join") : null);

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
      doors({ label: "🏰 Wrenmoor Manor", sub: "The front doors creak open…" }, () => { render(); startPolling(); });
    } catch (e) { toast(e.message, 4000); }
  };
  const join = () => { const c = code.value.trim().toUpperCase(); if (c.length !== 4) { toast("Game codes have 4 letters."); code.focus(); return; } go("join", { code: c }); };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  return h("section", { class: "home" },
    h("div", { class: "hero" }, h("div", { class: "logo" }, h("span", { html: LENS }), h("span", { class: "label" }, "The Wrenmoor Weekend")),
      h("h1", { class: "display" }, "Alibi"),
      h("p", { class: "tagline" }, "A weekend at the manor. A will to be read at dusk. And one of you has decided not to wait.")),
    joinCode ? h("div", { class: "card invite" }, h("b", {}, `You're invited to game ${joinCode}.`), h("p", { class: "muted small" }, "Type your name and tap Join.")) : null,
    h("label", { class: "field" }, h("span", {}, "Your name"), name),
    h("div", { class: "stack" },
      h("div", { class: "joinrow" }, code, h("button", { class: "btn" + (joinCode ? " primary" : ""), type: "button", onClick: join }, "Join a game")),
      h("button", { class: "btn primary block", type: "button", onClick: () => go("create") }, "👨‍👩‍👧 Start a game for family or friends"),
      h("button", { class: "btn block", type: "button", onClick: () => go("queue") }, "🌍 Find a game online"),
      h("button", { class: "btn block", type: "button", onClick: () => go("bots") }, "🤖 Play with bots")),
    h("div", { class: "card" }, h("span", { class: "label" }, "How to play"),
      h("ol", { class: "howto" },
        h("li", {}, h("span", {}, h("b", {}, "Everyone on their own phone. "), "4 to 8 guests, each with a character; bots fill empty chairs. One of you is secretly the killer (two in a big game).")),
        h("li", {}, h("span", {}, h("b", {}, "Every hour, choose a room. "), "Then see who else came, talk to them (typing or voice), and decide what to do: look around, pick something up, put it back…")),
        h("li", {}, h("span", {}, h("b", {}, "The killer strikes "), "when they're alone with someone and already carrying a weapon. Storms and power cuts help: a dark room hides who's in it.")),
        h("li", {}, h("span", {}, h("b", {}, "Find the body, look back. "), "You only know what you saw. Everyone sees where they died, roughly when, how, and what's missing.")),
        h("li", {}, h("span", {}, h("b", {}, "Meet, whisper, vote. "), "Share your day (the killer lies), message anyone privately, vote someone out. If the killers catch up, there's a final showdown: survive the day.")))),
    h("p", { class: "muted small center" }, "Voice needs a microphone and works best on Wi-Fi."));
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
  return h("section", { class: "stack" },
    bar(S.public ? "Finding players" : "Your game", h("button", { class: "btn ghost sm", type: "button", onClick: leave }, "Leave")),
    S.public
      ? h("div", { class: "card stack" }, h("h1", { class: "h2" }, "Looking for players…"),
        h("p", { class: "muted" }, "The game starts when the timer runs out, or as soon as 8 people join. Empty chairs get bots."), h("div", {}, S.start_at ? timer(S.start_at) : null))
      : h("div", { class: "card codecard" }, h("span", { class: "label" }, "Game code"), h("div", { class: "bigcode" }, S.code),
        h("p", { class: "muted small" }, "Everyone opens this site on their own phone and joins with the code, or with the link."),
        h("button", { class: "btn primary", type: "button", onClick: share }, "📤 Send the link")),
    h("div", { class: "card" }, h("span", { class: "label" }, `Guests · ${S.players.length} of 8`),
      h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("b", {}, p.name, p.pid === S.me.pid ? " (you)" : ""),
        p.bot ? h("span", { class: "tag" }, "🤖 bot") : p.host ? h("span", { class: "tag" }, "host") : null, p.voice ? h("span", { class: "tag" }, "🎙️") : null, h("span", { class: "spacer" }),
        p.bot ? null : h("span", { class: p.ready ? "yes" : "muted" }, p.ready ? "✓ Ready" : "Not ready"))))),
    !S.public && S.me.host ? h("div", { class: "card row" }, h("span", {}, h("b", {}, "Bots"), h("br"), h("small", { class: "muted" }, "Fill empty chairs. At least 4 in all; more guests open more rooms.")), h("span", { class: "spacer" }),
      h("div", { class: "stepper" }, h("button", { type: "button", "aria-label": "One bot fewer", disabled: !bots.length, onClick: () => act("bots", { n: bots.length - 1 }) }, "−"),
        h("b", {}, String(bots.length)), h("button", { type: "button", "aria-label": "One more bot", disabled: S.players.length >= 8, onClick: () => act("bots", { n: bots.length + 1 }) }, "+"))) : null,
    !S.public ? h("button", { class: "btn block " + (mine?.ready ? "" : "primary"), type: "button", onClick: () => act("ready", { on: !mine?.ready }) }, mine?.ready ? "Not ready yet" : "I'm ready") : null,
    !S.public ? h("p", { class: "muted small center" }, S.start_at ? ["Everyone's ready. Starting in ", timer(S.start_at)]
      : `${humans.filter((p) => p.ready).length} of ${humans.length} ready. It starts as soon as everyone is.${S.players.length < 4 ? " Bots will fill it up to 4." : ""}`) : null,
    h("p", { class: "muted small center" }, "Tip: turn on voice 🔇 up top to talk while you wait."));
}
async function leave() {
  try { await post(`/api/game/${me.code}`, { pid: me.pid, token: me.token, type: "leave" }); } catch { /* ignore */ }
  clearInterval(polling);
  doors({ label: "Farewell, Wrenmoor", sub: "The front doors close behind you." }, () => {
    stopVoice();
    me = null; S = null; ui.dm = null; saveMe(); render();
  });
}

/* ---------- your character and your secret ---------- */
function roles() {
  const killer = S.me.role === "killer";
  const fellow = S.players.filter((p) => p.role === "killer" && p.pid !== S.me.pid);
  return h("section", { class: "stack" }, bar("The Wrenmoor Weekend"),
    h("div", { class: "card prologue" }, h("span", { class: "label" }, "Prologue"), h("p", { class: "lead" }, S.prologue)),
    h("div", { class: "card charcard" }, face(who(S.me.pid), "big"), h("div", {}, h("span", { class: "label" }, "You are playing"), h("h2", { class: "h2" }, S.me.char?.title), h("p", {}, S.me.char?.blurb))),
    !ui.revealed ? h("button", { class: "btn primary block", type: "button", onClick: () => { ui.revealed = true; render(); } }, "Cover your screen, then tap to see your secret")
      : h("div", { class: "rolecard " + (killer ? "killer" : "guest") },
        h("div", { class: "role-emoji" }, killer ? "🔪" : "🕯️"),
        h("h1", { class: "who" }, killer ? "You are the killer" : "You are a guest"),
        h("p", {}, killer ? "Come into a room already carrying a weapon, and strike when you're alone with someone. Then lie about where you were." : "Go about your day. Notice who you're with, who picks up what, and who lies about it later."),
        fellow.length ? h("p", { class: "small" }, "Your partner in crime: ", h("b", {}, fellow.map((p) => p.name).join(", "))) : null),
    h("div", { class: "card" }, h("span", { class: "label" }, "The guests"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name), h("br"), h("small", { class: "muted" }, p.char?.title || "")))))),
    h("p", { class: "muted small center" }, "The day begins in ", timer(S.deadline)));
}

/* ---------- each hour, step 1: where do you go? ---------- */
function dayHeader() {
  return h("div", { class: "dayhead" },
    h("div", { class: "meta" }, h("span", { class: "tag" }, S.showdown ? "⚔️ Showdown" : `Day ${S.day}`), h("span", { class: "tag hour" }, `🕰️ ${S.hours[S.hour]}`, h("span", { class: "hourdots", "aria-hidden": "true" }, S.hours.map((_, i) => h("i", { class: i < S.hour ? "done" : i === S.hour ? "now" : "" })))), timer(S.deadline), roleChip()),
    S.beat ? h("p", { class: "beat" }, "📜 ", S.beat.text) : null,
    S.me.carrying ? h("p", { class: "carry" }, "You're carrying the ", h("b", {}, S.me.carrying), ".") : null);
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
function move() {
  if (!S.me.alive) return h("section", { class: "stack" }, bar(`Day ${S.day}`), ghostBanner(), dayHeader(), h("p", { class: "lead" }, "The living are choosing where to go…"), ghostChat());
  const locked = S.beat?.fx === "rain" ? S.beat.room : null;
  const moved = S.moved;
  if (moved && !ui.changing) {
    return h("section", { class: "stack" }, bar(S.showdown ? "The last day" : `Day ${S.day}`), dayHeader(),
      h("div", { class: "card center stack" }, h("span", { class: "big-emoji" }, roomOf(moved).emoji), h("b", {}, `Heading to the ${roomName(moved)}…`),
        h("p", { class: "muted small" }, "Waiting for everyone to choose."), h("button", { class: "btn ghost sm", type: "button", onClick: () => { ui.changing = true; render(); } }, "Change my mind")),
      lastHour());
  }
  return h("section", { class: "stack" }, bar(S.showdown ? "The last day" : `Day ${S.day}`), dayHeader(),
    S.showdown ? h("div", { class: "card warn" }, h("b", {}, "The final showdown. "), S.me.role === "killer" ? "Catch every guest alone before dusk." : "Stay alive until dusk. Don't be caught alone with the killer.") : null,
    h("h2", { class: "h2" }, `Where will you be at ${S.hours[S.hour]}?`),
    h("div", { class: "rooms" }, S.rooms.map((r) => h("button", { class: "roombtn", type: "button", disabled: r.id === locked, onClick: () => { ui.changing = false; act("move", { room: r.id }); } },
      h("span", { class: "big-emoji" }, r.emoji), h("b", {}, r.name), h("small", {}, r.id === locked ? "Locked by the rain" : r.act)))),
    lastHour(), voiceTip());
}

/* ---------- each hour, step 2: in the room ---------- */
function room() {
  if (!S.me.alive) return h("section", { class: "stack" }, bar(`Day ${S.day}`), ghostBanner(), dayHeader(), h("p", { class: "lead" }, "The living are in their rooms…"), ghostChat());
  const here = S.here;
  if (!here) return h("section", { class: "stack" }, bar(`Day ${S.day}`), dayHeader());
  const r = roomOf(here.room);
  const killer = S.me.role === "killer";
  const a = S.acted || {};                                       // what you've chosen so far: saved as you tap, used when the hour ends
  const choose = (patch) => act("do", { act: a.act === "look" ? "look" : "act", take: a.take || null, sneak: !!a.sneak, put: !!a.put, strike: a.strike || null, ...patch });
  const people = here.dark
    ? h("div", { class: "card dark" }, h("b", {}, "It's pitch dark."), h("p", {}, here.count ? `You can hear ${here.count === 1 ? "someone" : `${here.count} people`} breathing nearby.` : "You seem to be alone… probably."))
    : h("div", { class: "card" }, h("span", { class: "label" }, here.people.length ? "Here with you" : "Nobody else is here"),
      here.people.length ? h("div", { class: "plist" }, here.people.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name, p.bot ? " 🤖" : ""), h("br"), h("small", { class: "muted" }, p.char)),
        h("span", { class: "spacer" }), who(p.pid)?.voice ? h("span", { class: "tag" }, "🎙️") : null,
        h("button", { class: "btn sm ghost", type: "button", onClick: () => { ui.dm = p.pid; render(); } }, "✉️ Whisper")))) : h("p", { class: "muted small" }, "A quiet moment to yourself."));
  const opt = (on, label, fn, cls = "") => h("button", { class: `optbtn ${cls}${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), onClick: fn }, label);
  const home = S.me.carrying && S.rooms.find((x) => x.items.includes(S.me.carrying))?.id === here.room;
  const victims = here.people.filter((p) => who(p.pid)?.role !== "killer");
  const canStrike = killer && S.me.carrying && (here.dark ? here.count === 1 : victims.length === 1 && here.people.length === 1);
  const looking = a.act === "look";
  const doPanel = h("div", { class: "card stack" }, h("span", { class: "label" }, "What do you do?"),
    h("div", { class: "opts2" },
      opt(!looking, `✨ ${r.act}`, () => choose({ act: "act" })),
      opt(looking, "🔍 Look around", () => choose({ act: "look" }))),
    !S.me.carrying ? h("div", { class: "opts2" }, here.items.map((it) => opt(a.take === it, `✋ Take the ${it}`, () => choose({ take: a.take === it ? null : it }))),
      !here.items.length ? h("p", { class: "muted small" }, "Nothing here worth taking: someone got there first.") : null) : null,
    a.take ? opt(!!a.sneak, "🤫 Sneak it: only someone looking around will notice", () => choose({ sneak: !a.sneak }), "sneak") : null,
    home ? opt(!!a.put, `↩️ Put back the ${S.me.carrying}`, () => choose({ put: !a.put })) : null,
    killer ? (canStrike ? opt(!!a.strike, here.dark ? `🔪 Strike whoever is in the dark (with the ${S.me.carrying})` : `🔪 Strike ${victims[0].name} (with the ${S.me.carrying})`,
      () => choose({ strike: a.strike ? null : (here.dark ? "dark" : victims[0].pid) }), "strike")
      : h("p", { class: "muted small" }, S.me.carrying ? "🔪 You can only strike when you're alone with one person." : "🔪 Take a weapon: you can strike from the next hour.")) : null,
    S.leaving ? h("p", { class: "center muted small" }, "✓ Ready to move on. Waiting for the others, or the clock.")
      : h("button", { class: "btn primary block", type: "button", onClick: async () => { if (!S.acted) await choose({}); act("leave_room"); } }, "Leave the room ▸"),
    h("p", { class: "muted small center" }, "Your choice is saved as you tap it. Stay up to a minute to talk."));
  return h("section", { class: "stack" }, bar(`${r.emoji} ${r.name}`), dayHeader(), people,
    here.gone?.length ? h("p", { class: "gone" }, "🕳️ Gone from this room: ", here.gone.map((i) => `the ${i}`).join(", "), ". Someone's taken it.") : null,
    h("div", { class: "card stack" }, h("span", { class: "label" }, here.dark ? "Whispers in the dark" : "Talk here"),
      h("div", { class: "chatlog small-log", "data-log": "room" }, (S.roomchat || []).map(msgEl),
        !(S.roomchat || []).length ? h("p", { class: "muted small center" }, here.people.length || here.count ? "Say hello. Only the people in this room can read it." : "Nobody to talk to.") : null),
      typingLine(S.typing?.room),
      here.people.length || here.count ? composer("room", "Say something to the room…", (t) => act("room", { text: t }), "room") : null),
    doPanel, voiceTip());
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
function msgEl(m) {
  return h("div", { class: "cmsg" + (m.pid === S.me.pid ? " mine" : "") + (m.ghost ? " ghostmsg" : "") },
    face({ name: m.name, color: m.color }, "sm"),
    h("div", {}, h("b", { style: { color: m.color } }, m.name, m.bot ? " 🤖" : "", m.ghost ? " 👻" : ""),
      m.claim ? h("div", { class: "claim" }, m.claim.map((c) => h("span", {}, h("i", {}, c.hour), " ", c.room))) : h("p", {}, m.text),
      m.id && !m.noReact ? reactRow(m) : null));
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
const typingLine = (names) => (names?.length ? h("p", { class: "typing-line" }, `${names.join(", ")} ${names.length > 1 ? "are" : "is"} typing…`) : null);
function ghostChat() {
  return h("div", { class: "card stack" }, h("span", { class: "label" }, "Ghost chat"),
    h("div", { class: "chatlog", "data-log": "ghost" }, (S.chat || []).filter((m) => m.ghost).map(msgEl)),
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
function bodyCard(compact = false) {
  const b = S.body;
  if (!b) return null;
  return h("div", { class: "paper body-card" + (compact ? " compact" : "") }, h("span", { class: "stamp" }, "DECEASED"),
    h("span", { class: "label" }, "The body"),
    h("h2", {}, b.victim), h("p", { class: "muted small" }, b.char),
    h("p", {}, `Found in the ${b.room} ${b.foundAt === "dusk" ? "at dusk" : `at ${b.foundAt}`}${b.foundBy.length ? ` by ${b.foundBy.join(" and ")}` : ""}.`),
    h("p", {}, h("b", {}, "Died around "), b.hour, ", ", b.cause, "."),
    S.missing?.length ? h("p", {}, h("b", {}, "Missing from the house: "), S.missing.map((m) => `the ${m.item} (${m.room})`).join(", "), ".") : h("p", {}, "Nothing is missing from the house."));
}
function body() {
  return h("section", { class: "stack" }, bar(`Day ${S.day}`),
    h("div", { class: "scream" }, h("span", { class: "label" }, "A scream rings through Wrenmoor"), h("h1", { class: "display" }, `${S.body?.victim || "Someone"} is dead.`)),
    ghostBanner(), bodyCard(), dayLog(), storyLog(), h("p", { class: "muted small center" }, "The meeting starts in ", timer(S.deadline)));
}
function quiet() {
  return h("section", { class: "stack" }, bar(`Day ${S.day}`), h("div", { class: "scream calm" }, h("span", { class: "label" }, `Day ${S.day} ends`), h("h1", { class: "display" }, "Nobody died today.")),
    h("p", { class: "lead" }, "But the killer is still among you, and someone has been picking things up…"),
    S.missing?.length ? h("div", { class: "card" }, h("b", {}, "Missing: "), S.missing.map((m) => `the ${m.item} (${m.room})`).join(", ")) : null, dayLog(),
    h("p", { class: "muted small center" }, "The meeting starts in ", timer(S.deadline)));
}
function showdown() {
  const guests = S.players.filter((p) => p.alive && p.pid !== S.me.pid);
  return h("section", { class: "stack" }, bar("The final showdown"),
    h("div", { class: "scream" }, h("span", { class: "label" }, "The killers have caught up"), h("h1", { class: "display" }, "One last day.")),
    h("div", { class: "card" }, S.me.alive
      ? (S.me.role === "killer" ? h("p", {}, "No more meetings. Catch every guest alone before dusk and the manor is yours.") : h("p", {}, "No more meetings, no more votes. Survive until dusk and the guests win. Don't let yourself be caught alone with the killer."))
      : h("p", {}, "Watch from beyond: the last day decides everything.")),
    h("div", { class: "row center" }, guests.map((p) => face(p))), h("p", { class: "muted small center" }, "The day begins in ", timer(S.deadline)));
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
    h("button", { class: "btn primary block", type: "button", style: { marginTop: "1rem" }, onClick: () => { close(); act("claim", { claim: ui.draft }); } }, "Post it in the meeting"));
  document.body.append(scrim, sheet);
}
function talk() {
  const alive = S.players.filter((p) => p.alive && !p.bot);
  const readyN = alive.filter((p) => p.readyToVote).length;
  const claimed = who(S.me.pid)?.claimed;
  const tabs = h("div", { class: "tabs" }, [["chat", "💬 Meeting"], ["evidence", "🔎 Evidence"], ["people", "👥 Who said what"]].map(([k, l]) =>
    h("button", { type: "button", class: ui.tab === k ? "on" : "", onClick: () => { ui.tab = k; render(); } }, l)));
  let main;
  if (ui.tab === "evidence") main = h("div", { class: "stack" }, bodyCard(true) || h("div", { class: "card" }, "Nobody died today.", S.missing?.length ? ` Missing: ${S.missing.map((m) => `the ${m.item}`).join(", ")}.` : ""), dayLog(), storyLog());
  else if (ui.tab === "people") {
    main = h("div", { class: "plist card" }, S.players.map((p) => {
      const c = [...(S.chat || [])].reverse().find((m) => m.pid === p.pid && m.claim);
      return h("div", { class: "prow top" }, face(p), h("div", { class: "grow" }, h("b", {}, p.name, p.alive ? "" : p.ejected ? " · voted out" : " · dead"), h("small", { class: "muted" }, ` ${p.char?.title || ""}`),
        c ? h("div", { class: "claim" }, c.claim.map((x) => h("span", {}, h("i", {}, x.hour), " ", x.room))) : h("small", { class: "muted", style: { display: "block" } }, p.alive ? "Hasn't shared their day" : "")),
        p.pid !== S.me.pid && p.alive === S.me.alive ? h("button", { class: "btn sm ghost", type: "button", onClick: () => { ui.dm = p.pid; render(); } }, "✉️") : null);
    }));
  } else {
    main = h("div", { class: "stack" }, h("div", { class: "chatlog", "data-log": "meeting" }, (S.chat || []).map(msgEl),
      !(S.chat || []).length ? h("p", { class: "muted small center" }, "Nobody has said anything yet. Start with where you were.") : null),
      typingLine(S.typing?.meet),
      composer("chat", S.me.alive ? "Say something to everyone…" : "Whisper to the other ghosts…", (t) => act("chat", { text: t }), "meet"));
  }
  return h("section", { class: "stack" }, bar(`Day ${S.day} · the meeting`, timer(S.deadline)), ghostBanner(), voiceTip(), tabs, main,
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
    h("div", { class: "pick" }, alive.filter((p) => p.pid !== S.me.pid).map((p) => opt(p.pid, face(p, "sm"), h("span", {}, h("b", {}, p.name), h("small", { class: "muted" }, ` ${p.char?.title || ""}`), p.voted ? h("small", { class: "muted" }, " · voted") : null))),
      opt("skip", h("span", { class: "face sm skip" }, "–"), h("b", {}, "Skip: not sure yet"))),
    h("details", { class: "card" }, h("summary", {}, "Evidence"), bodyCard(true), dayLog()));
}

function result() {
  const e = S.ejected;
  return h("section", { class: "stack center-col" }, bar("The vote"),
    e ? [h("h1", { class: "display" }, `${e.name} is out.`), h("p", { class: "lead " + (e.role === "killer" ? "yes" : "no") }, e.role === "killer" ? "They were a killer! 🔪" : "They were innocent…")]
      : h("h1", { class: "display" }, "Nobody is out."),
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
      h("h1", { class: "display" }, killers.map((p) => p.name).join(" & ")),
      h("p", { class: "muted" }, killers.map((p) => p.char?.title).join(" & ")),
      h("p", { class: "lead" }, iWon ? "You won! 🎉" : "You lost this one.")),
    S.awards?.length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "The weekend's awards"),
      h("div", { class: "awards" }, S.awards.map((a) => h("div", { class: "award" }, h("span", { class: "award-emoji" }, a.emoji),
        h("span", {}, h("b", {}, a.title), h("br"), h("span", {}, a.name), h("small", { class: "muted" }, ` · ${a.detail}`)))))) : null,
    h("div", { class: "card" }, h("span", { class: "label" }, "Everyone"), h("div", { class: "plist" }, S.players.map((p) => h("div", { class: "prow" }, face(p), h("span", {}, h("b", {}, p.name), h("br"), h("small", { class: "muted" }, p.char?.title || "")),
      h("span", { class: "spacer" }), h("span", { class: p.role === "killer" ? "no" : "muted" }, p.role === "killer" ? "🔪 killer" : p.alive ? "survived" : p.ejected ? "voted out" : "killed"))))),
    (S.truth || []).map((d) => h("div", { class: "card stack" }, h("span", { class: "label" }, d.showdown ? "The final showdown" : `Day ${d.n}: what really happened`),
      d.kills.length ? d.kills.map((k) => h("p", {}, h("b", {}, k.killer), ` killed ${k.victim} in the ${k.room} at ${k.hour} with the ${k.weapon}.`)) : h("p", { class: "muted" }, "Nobody died."),
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
