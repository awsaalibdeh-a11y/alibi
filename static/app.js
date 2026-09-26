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

/* ---------- connection ---------- */
// this tab's seat first (two tabs are two players); the last seat on this phone lets a closed browser rejoin
let me = (() => { try { return JSON.parse(sessionStorage.getItem(ME) || localStorage.getItem(ME) || "null"); } catch { return null; } })();
let S = null;                   // the latest view from the server
let clockSkew = 0;              // server time minus ours
let ui = { tab: "chat", room: null, take: null, put: false, strike: null, look: false, revealed: false, draft: null, dm: null, seen: {} };
let lastPhaseKey = "";

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
  if (key !== lastPhaseKey) {                                   // a new phase: reset what was half-picked and make a sound
    const sameWalk = d.phase === "walk" && lastPhaseKey.startsWith(`walk|${d.day}|`);   // just a new hour while walking: a chime, no jump
    lastPhaseKey = key;
    if (sameWalk) {
      if (before) sfx("hour");
    } else {
      ui = { ...ui, room: null, take: null, put: false, strike: null, look: false, draft: null };
      if (d.phase === "roles") ui.revealed = false;
      if (before) sfx({ roles: "role", move: "hour", room: "door", walk: "hour", body: "scream", showdown: "scream", vote: "vote",
        over: d.winner && ((d.winner === "killers") === (d.me.role === "killer")) ? "win" : "lose" }[d.phase] || "tick");
      if (!ui.dm) window.scrollTo({ top: 0 });
    }
  }
  if (before) {
    const n = (x) => (x?.chat?.length || 0) + (x?.roomchat?.length || 0);
    if (n(d) > n(before)) sfx("msg");
    const incoming = (d.dms || []).filter((m) => m.to === d.me.pid).length - (before.dms || []).filter((m) => m.to === d.me.pid).length;
    if (incoming > 0) sfx("dm");
  }
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
  if (S.phase === "walk") return new Set(S.players.filter((p) => (S.near || []).includes(p.pid) && talking(p)).map((p) => p.pid));
  if (["body", "quiet", "talk", "vote", "result", "showdown", "over", "lobby"].includes(S.phase)) return new Set(S.players.filter((p) => talking(p) && p.alive === S.me.alive).map((p) => p.pid));
  return new Set();
}
function syncVoice() {
  const want = voiceTargets();
  for (const [pid, pr] of voice.peers) {
    const stale = pr.pc.connectionState !== "connected" && Date.now() - pr.at > 15000;
    if (!want.has(pid) || ["failed", "closed"].includes(pr.pc.connectionState) || stale) dropPeer(pid);
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
  const active = document.activeElement?.dataset?.keep || null;
  const kept = Object.fromEntries([...document.querySelectorAll("[data-keep]")].map((el) => [el.dataset.keep, el.value]));
  const logs = Object.fromEntries([...document.querySelectorAll("[data-log]")].map((el) => [el.dataset.log, el.scrollHeight - el.scrollTop - el.clientHeight < 80]));
  const el = h("div", {}, screen(), me && S ? dmPanel() : null);
  $app.replaceChildren(el);
  for (const [k, v] of Object.entries(kept)) { const x = el.querySelector(`[data-keep="${k}"]`); if (x && v) x.value = v; }
  if (active) { const x = el.querySelector(`[data-keep="${active}"]`); if (x) { x.focus({ preventScroll: true }); try { x.setSelectionRange(x.value.length, x.value.length); } catch { /* ignore */ } } }
  for (const x of el.querySelectorAll("[data-log]")) if (logs[x.dataset.log] !== false) x.scrollTop = x.scrollHeight;
  fpMount();                                                     // the first-person view lives outside the re-rendered page
}

function screen() {
  if (!me) return home();
  if (!S) return h("section", { class: "loading" }, h("span", { class: "lens", html: LENS }), h("p", { class: "loadline" }, "Joining the game…"));
  const fn = { lobby, roles, move, room, walk, body, quiet, talk, vote, result, showdown, over }[S.phase] || lobby;
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
    onClick: () => { sound.on = !sound.on; try { localStorage.setItem("alibi.sound", sound.on ? "on" : "off"); } catch { /* ignore */ } render(); } }, sound.on ? "🔊" : "🔈"));
const who = (pid) => S.players.find((p) => p.pid === pid);
const roomName = (id) => (id === "hall" ? "The hall" : S.rooms.find((r) => r.id === id)?.name || id);
const roomOf = (id) => S.rooms.find((r) => r.id === id);
const roleChip = () => h("button", { class: "tag role-chip", type: "button", onClick: () => { ui.revealed = !ui.revealed; render(); } },
  ui.revealed ? `${S.me.role === "killer" ? "🔪 Killer" : "🕯️ Guest"} · ${S.me.char?.title || ""}` : "👁 My role");
const ghostBanner = () => (!S.me.alive ? h("div", { class: "ghost stack" },
  h("span", {}, "👻 ", S.me.ejected ? "You were voted out." : "You're dead.", " Stay and watch everything (only other ghosts can hear you), or leave: the game carries on at its own pace either way."),
  h("div", { class: "row" }, h("span", { class: "spacer" }),
    h("button", { class: "btn sm ghost", type: "button", onClick: () => { if (confirm("Leave for good? You can't come back to this game.")) leave(); } }, "Leave the game"))) : null);
const voiceTip = () => (!voice.on && S.players.some((p) => p.voice && p.pid !== S.me.pid) ? h("button", { class: "tipbtn", type: "button", onClick: toggleVoice }, "🎙️ Others are on voice: tap to join") : null);

/* ---------- home ---------- */
const playStyle = () => { try { return localStorage.getItem("alibi.style") || "live"; } catch { return "live"; } };
const STYLE_INFO = { live: ["🚶 First person", "Walk the house live: see who's there, who takes what, lock doors."], classic: ["🗺️ Classic", "Pick a room each hour, then meet whoever came."] };
function styleChoice(current, pick, disabled = false) {
  return h("div", { class: "seg", role: "radiogroup", "aria-label": "How to play" }, Object.entries(STYLE_INFO).map(([k, [label, sub]]) =>
    h("button", { type: "button", class: current === k ? "on" : "", role: "radio", "aria-checked": String(current === k), disabled, onClick: () => pick(k) }, h("b", {}, label), h("small", {}, sub))));
}
function home() {
  const joinCode = (location.hash.match(/join\/(\w{4})/i) || [])[1]?.toUpperCase() || "";
  const name = h("input", { class: "input", placeholder: "Your name", maxlength: "16", value: localStorage.getItem("alibi.name") || "", "aria-label": "Your name", autocomplete: "nickname", "data-keep": "name" });
  const code = h("input", { class: "input code-in", placeholder: "CODE", maxlength: "4", "aria-label": "Game code", autocapitalize: "characters", autocomplete: "off", "data-keep": "code", value: joinCode });
  const go = async (mode, extra = {}) => {
    const n = name.value.trim();
    if (!n) { name.focus(); toast("Type your name first."); return; }
    try { localStorage.setItem("alibi.name", n); } catch { /* ignore */ }
    try {
      const d = await post("/api/play", { name: n, mode, style: playStyle(), ...extra });
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
    h("div", { class: "hero" }, h("div", { class: "logo" }, h("span", { html: LENS }), h("span", { class: "label" }, "The Wrenmoor Weekend")),
      h("h1", { class: "display" }, "Alibi"),
      h("p", { class: "tagline" }, "A weekend at the manor. A will to be read at dusk. And one of you has decided not to wait.")),
    joinCode ? h("div", { class: "card invite" }, h("b", {}, `You're invited to game ${joinCode}.`), h("p", { class: "muted small" }, "Type your name and tap Join.")) : null,
    h("label", { class: "field" }, h("span", {}, "Your name"), name),
    h("div", { class: "field" }, h("span", {}, "How do you want to play?"), styleChoice(playStyle(), (k) => { try { localStorage.setItem("alibi.style", k); } catch { /* ignore */ } render(); })),
    h("div", { class: "stack" },
      h("div", { class: "joinrow" }, code, h("button", { class: "btn" + (joinCode ? " primary" : ""), type: "button", onClick: join }, "Join a game")),
      h("button", { class: "btn primary block", type: "button", onClick: () => go("create") }, "👨‍👩‍👧 Start a game for family or friends"),
      h("button", { class: "btn block", type: "button", onClick: () => go("queue") }, "🌍 Find a game online"),
      h("button", { class: "btn block", type: "button", onClick: () => go("bots") }, "🤖 Play with bots")),
    h("div", { class: "card" }, h("span", { class: "label" }, "How to play"),
      h("ol", { class: "howto" },
        h("li", {}, h("span", {}, h("b", {}, "Everyone on their own phone. "), "4 to 8 guests, each with a character; bots fill empty chairs. One of you is secretly the killer (two in a big game).")),
        h("li", {}, h("span", {}, h("b", {}, "Walk the house, or pick a room. "), "In first person you roam the manor live and see who's in each room; in classic you pick a room each hour. Either way: talk to whoever's there, pick things up (quietly, if you like), lock a door…")),
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
    h("div", { class: "card stack" }, h("span", { class: "label" }, !S.public && S.me.host ? "How you'll play (you choose)" : "How you'll play"),
      styleChoice(S.style, (k) => act("style", { style: k }), S.public || !S.me.host)),
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
  stopVoice();
  me = null; S = null; ui.dm = null; saveMe(); clearInterval(polling); render();
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
    h("div", { class: "meta" }, h("span", { class: "tag" }, S.showdown ? "⚔️ Showdown" : `Day ${S.day}`), h("span", { class: "tag hour" }, `🕰️ ${S.hours[S.hour]}`), timer(S.deadline), roleChip()),
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
function msgEl(m) {
  return h("div", { class: "cmsg" + (m.pid === S.me.pid ? " mine" : "") + (m.ghost ? " ghostmsg" : "") },
    face({ name: m.name, color: m.color }, "sm"),
    h("div", {}, h("b", { style: { color: m.color } }, m.name, m.bot ? " 🤖" : "", m.ghost ? " 👻" : ""),
      m.claim ? h("div", { class: "claim" }, m.claim.map((c) => h("span", {}, h("i", {}, c.hour), " ", c.room))) : h("p", {}, m.text)));
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
      h("div", { class: "chatlog", "data-log": "dm" }, thread.map((m) => msgEl({ ...m, pid: m.from, color: who(m.from)?.color, bot: who(m.from)?.bot, name: who(m.from)?.name || m.name })),
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

/* ---------- first person: walking the house ----------
   A raycaster on a canvas: the server sends the floor plan once, then (a few times a second) where you are and what you
   can see from there. You walk locally and the server checks each step. Nothing here is drawn from a file: walls are
   painted column by column, people are their portraits on a coat in their colour, objects are emoji on little tables. */
const FOV = 0.7;
const PAL = {                     // wall, wallpaper stripe, wainscot, picture rail; floor (near, far); ceiling (top, horizon)
  library: { wall: [74, 96, 72], stripe: [84, 108, 82], low: [104, 72, 46], rail: [186, 142, 74], floor: ["#7a5436", "#3e2a1a"], ceil: ["#3a2d22", "#5a4836"], art: 1 },
  kitchen: { wall: [232, 222, 198], stripe: [218, 206, 182], low: [132, 160, 150], rail: [104, 118, 110], floor: ["#c4bbaf", "#78716a"], ceil: ["#d9d0c0", "#f1e9da"], win: 1 },
  garden: { wall: [64, 120, 62], stripe: [56, 108, 54], low: [46, 90, 44], rail: [76, 136, 70], floor: ["#679a4f", "#34522a"], ceil: ["#7fb4e0", "#d9ebf6"] },
  study: { wall: [124, 62, 50], stripe: [136, 72, 58], low: [78, 50, 32], rail: [198, 158, 84], floor: ["#654229", "#321f13"], ceil: ["#302219", "#4c3a2d"], art: 1 },
  ballroom: { wall: [224, 206, 160], stripe: [236, 220, 178], low: [160, 128, 76], rail: [206, 166, 64], floor: ["#d1ab70", "#7e5c31"], ceil: ["#4a3b2c", "#76644c"], win: 1 },
  cellar: { wall: [112, 104, 96], stripe: [100, 92, 85], low: [76, 70, 63], rail: [62, 58, 54], floor: ["#514b44", "#25221f"], ceil: ["#171513", "#2d2925"] },
  hall: { wall: [160, 66, 62], stripe: [176, 78, 72], low: [90, 58, 38], rail: [216, 176, 96], floor: ["#963535", "#4f1a1a"], ceil: ["#34281f", "#56463a"], art: 1 },
};
const ART = [[46, 74, 110], [128, 58, 44], [70, 104, 60], [150, 118, 50]];
const ITEM_EMOJI = { candlestick: "🕯️", "heavy atlas": "📕", "kitchen knife": "🔪", "rolling pin": "🥖", "garden shears": "✂️", rope: "🪢", "iron poker": "🏑",
  "silk scarf": "🧣", "letter opener": "🗡️", "brass paperweight": "🪨", "wine bottle": "🍾", "piano wire": "🎼" };
const LV = { root: null, cv: null, ctx: null, mini: null, miniBg: null, hud: null, acts: null, feedEl: null, log: null, stickEl: null, talkLabel: null, typingEl: null,
  on: false, raf: 0, pos: null, snap: null, shown: new Map(), keys: {}, stick: null, look: null, lastTs: 0, lastSend: 0, busy: false,
  seen: new Set(), feed: [], bubbles: new Map(), chatKey: "", actKey: "", hudKey: "", day: -1, figs: new Map(), bodies: new Map(), items: new Map(),
  W: 480, H: 300, z: new Float32Array(480), shades: new Map() };
const $fp = h("div", { id: "fp", hidden: true });
$app.after($fp);

const houseCell = (x, y) => (S.house.map[Math.floor(y)] || "")[Math.floor(x)] || "#";
const placeAt = (x, y) => S.house.legend[houseCell(x, y)];
const doorRoom = (ch) => (ch !== "h" && ch === ch.toLowerCase() && ch !== "#" ? S.house.legend[ch] : null);
function shutFor(room) { const l = LV.snap?.locks?.[room]; return l != null && room !== LV.snap?.here; }
function blocked(x, y) {
  if (LV.snap && !LV.snap.alive) return x < 0.3 || y < 0.3 || x > S.house.map[0].length - 0.3 || y > S.house.map.length - 0.3;   // ghosts drift through walls
  const ch = houseCell(x, y);
  if (ch === "#") return true;
  const room = doorRoom(ch);
  return !!(room && shutFor(room));
}
const clear = (x, y) => { const r = S.house.radius; return !blocked(x - r, y - r) && !blocked(x + r, y - r) && !blocked(x - r, y + r) && !blocked(x + r, y + r); };
function shade(rgb, s) {
  const lv = Math.max(0, Math.min(24, Math.round(s * 24)));
  let arr = LV.shades.get(rgb);
  if (!arr) LV.shades.set(rgb, (arr = []));
  return (arr[lv] ||= `rgb(${(rgb[0] * lv) / 24 | 0},${(rgb[1] * lv) / 24 | 0},${(rgb[2] * lv) / 24 | 0})`);
}

/* people, bodies and objects, drawn once each and reused */
const portraitURL = (name) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(portrait(name).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140" '));
function figure(name, color, shadow = false) {
  const key = shadow ? "·shadow" : `${name}|${color}`;
  if (LV.figs.has(key)) return LV.figs.get(key);
  const f = h("canvas", { width: 120, height: 300 });
  const c = f.getContext("2d");
  const coat = shadow ? "#141219" : color, dark = shadow ? "#0c0b10" : "#2b231d", skin = shadow ? "#141219" : "#e4bb98";
  c.fillStyle = dark; c.fillRect(38, 224, 18, 66); c.fillRect(64, 224, 18, 66);
  c.fillStyle = "#16110d"; c.fillRect(33, 284, 25, 13); c.fillRect(62, 284, 25, 13);
  c.fillStyle = coat;
  c.beginPath(); c.moveTo(22, 104); c.lineTo(98, 104); c.quadraticCurveTo(108, 106, 104, 128); c.lineTo(96, 236); c.lineTo(24, 236); c.lineTo(16, 128); c.quadraticCurveTo(12, 106, 22, 104); c.fill();
  c.fillRect(6, 114, 16, 96); c.fillRect(98, 114, 16, 96);
  c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(58, 110, 4, 124);
  c.fillStyle = skin; c.beginPath(); c.arc(14, 214, 8, 0, 7); c.arc(106, 214, 8, 0, 7); c.fill();
  c.beginPath(); c.ellipse(60, 60, 28, 36, 0, 0, 7); c.fill();
  LV.figs.set(key, f);
  if (!shadow) {
    const img = new Image();
    img.onload = () => { c.clearRect(0, 0, 120, 103); c.drawImage(img, 0, 0, 120, 108, 0, 0, 120, 108); f.ready = true; LV.bodies.delete(name); };
    img.src = portraitURL(name);
  }
  return f;
}
function bodyImage(b) {
  if (LV.bodies.has(b.name)) return LV.bodies.get(b.name);
  const f = figure(b.name, b.color);
  const c = h("canvas", { width: 300, height: 120 });
  const x = c.getContext("2d");
  x.fillStyle = "rgba(128,16,12,0.85)"; x.beginPath(); x.ellipse(150, 100, 140, 18, 0, 0, 7); x.fill();
  x.save(); x.translate(4, 116); x.rotate(-Math.PI / 2); x.drawImage(f, 0, 0, 112, 280); x.restore();
  x.globalCompositeOperation = "source-atop"; x.fillStyle = "rgba(120,120,128,0.55)"; x.fillRect(0, 0, 300, 90);
  if (f.ready) LV.bodies.set(b.name, c);
  return c;
}
function itemImage(item) {
  if (LV.items.has(item)) return LV.items.get(item);
  const c = h("canvas", { width: 100, height: 100 });
  const x = c.getContext("2d");
  x.fillStyle = "#7a5230"; x.fillRect(8, 60, 84, 9); x.fillStyle = "#5c3d22"; x.fillRect(14, 69, 7, 31); x.fillRect(79, 69, 7, 31);
  x.font = "42px serif"; x.textAlign = "center"; x.textBaseline = "bottom"; x.fillText(ITEM_EMOJI[item] || "❔", 50, 62);
  LV.items.set(item, c);
  return c;
}

/* the view */
function fpRoot() {
  if (LV.root) return LV.root;
  LV.cv = h("canvas", { class: "fp-canvas", width: LV.W, height: LV.H, "aria-label": "The house, seen through your eyes" });
  LV.ctx = LV.cv.getContext("2d");
  LV.mini = h("canvas", { class: "fp-mini", width: 10, height: 10, "aria-hidden": "true" });
  LV.hud = h("div", { class: "fp-hud" });
  LV.feedEl = h("div", { class: "fp-feed", "aria-live": "polite" });
  LV.stickEl = h("div", { class: "fp-stick", hidden: true }, h("i"));
  const view = h("div", { class: "fp-view" }, LV.cv, LV.mini, LV.hud, LV.feedEl, LV.stickEl, h("div", { class: "fp-cross" }));
  view.addEventListener("pointerdown", (e) => {
    const r = view.getBoundingClientRect();
    view.setPointerCapture(e.pointerId);
    if (e.clientX - r.left < r.width / 2) {
      LV.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      Object.assign(LV.stickEl.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px` });
      LV.stickEl.hidden = false;
    } else LV.look = { id: e.pointerId, x: e.clientX };
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => {
    if (LV.stick?.id === e.pointerId) {
      LV.stick.dx = e.clientX - LV.stick.x0; LV.stick.dy = e.clientY - LV.stick.y0;
      const m = Math.hypot(LV.stick.dx, LV.stick.dy) || 1, k = Math.min(1, 44 / m);
      LV.stickEl.firstChild.style.transform = `translate(${LV.stick.dx * k}px, ${LV.stick.dy * k}px)`;
    } else if (LV.look?.id === e.pointerId && LV.pos) { LV.pos.a += (e.clientX - LV.look.x) * 0.0085; LV.look.x = e.clientX; }
  });
  const end = (e) => { if (LV.stick?.id === e.pointerId) { LV.stick = null; LV.stickEl.hidden = true; } if (LV.look?.id === e.pointerId) LV.look = null; };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", end);
  LV.acts = h("div", { class: "fp-actions" });
  LV.log = h("div", { class: "chatlog small-log", "data-log": "walk" });
  LV.talkLabel = h("span", { class: "label" }, "Out loud");
  LV.typingEl = h("p", { class: "typing-line" });
  LV.root = h("div", { class: "fp stack" }, view, LV.acts,
    h("div", { class: "card stack" }, LV.talkLabel, LV.log, LV.typingEl,
      composer("walk", "Say something out loud…", (t) => act("walk:say", { text: t }), "room")),
    h("p", { class: "muted small center" }, "Left side: drag to walk · Right side: drag to look · Computer: WASD or arrows, Q/E to turn"));
  return LV.root;
}
function fpMount() {
  const want = !!(me && S && S.phase === "walk" && S.house);
  if (!want) {
    if (LV.on) { LV.on = false; cancelAnimationFrame(LV.raf); }
    $fp.hidden = true;
    document.body.classList.remove("walking");
    return;
  }
  if (LV.day !== S.day) { LV.day = S.day; LV.pos = null; LV.snap = null; LV.shown.clear(); LV.seen.clear(); LV.feed = []; LV.bubbles.clear(); LV.actKey = LV.chatKey = LV.hudKey = ""; }
  const root = fpRoot();
  if (!root.isConnected) $fp.replaceChildren(root);
  $fp.hidden = false;
  document.body.classList.add("walking");
  LV.talkLabel.textContent = S.me.alive ? "Out loud: only the people in the same place hear you" : "Ghost whispers: only the dead hear you";
  const t = S.typing?.room || [];
  LV.typingEl.textContent = t.length ? `${t.join(", ")} ${t.length > 1 ? "are" : "is"} typing…` : "";
  if (!LV.on) { LV.on = true; LV.lastTs = 0; LV.raf = requestAnimationFrame(fpFrame); }
}
window.addEventListener("keydown", (e) => {
  if (!LV.on || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  const k = e.key.toLowerCase();
  LV.keys[k] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { LV.keys[e.key.toLowerCase()] = false; });
window.addEventListener("blur", () => { LV.keys = {}; });

function fpFrame(ts) {
  if (!LV.on) return;
  const dt = Math.min(0.05, (ts - (LV.lastTs || ts)) / 1000);
  LV.lastTs = ts;
  if (LV.pos && LV.snap) {
    fpMove(dt);
    const k = Math.min(1, dt * 10);
    for (const o of LV.shown.values()) { o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    fpDraw();
    fpMini();
    fpFeed(ts);
    fpActions();
  }
  if (ts - LV.lastSend > 150 && !LV.busy) fpSync();
  LV.raf = requestAnimationFrame(fpFrame);
}
function fpMove(dt) {
  const p = LV.pos, k = LV.keys;
  let f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
  let st = (k.d ? 1 : 0) - (k.a ? 1 : 0);
  const turn = (k.arrowright || k.e ? 1 : 0) - (k.arrowleft || k.q ? 1 : 0);
  if (LV.stick) { f += Math.max(-1, Math.min(1, -LV.stick.dy / 44)); st += Math.max(-1, Math.min(1, LV.stick.dx / 44)); }
  p.a += turn * 2.3 * dt;
  const len = Math.hypot(f, st);
  if (len < 0.08) return;
  const sp = (S.house.walk * dt * (LV.snap.alive ? 1 : 1.3)) / Math.max(1, len);
  const mx = (Math.cos(p.a) * f - Math.sin(p.a) * st) * sp, my = (Math.sin(p.a) * f + Math.cos(p.a) * st) * sp;
  if (clear(p.x + mx, p.y)) p.x += mx;
  if (clear(p.x, p.y + my)) p.y += my;
}
async function fpSync() {
  LV.busy = true;
  LV.lastSend = performance.now();
  const body = { pid: me.pid, token: me.token };
  if (LV.pos) Object.assign(body, { x: LV.pos.x, y: LV.pos.y, a: LV.pos.a });
  try {
    const r = await fetch(`/api/game/${me.code}/walk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) fpAccept(await r.json());
  } catch { /* a moment offline: try again */ } finally { LV.busy = false; }
}
function fpAccept(s) {
  if (s.now) clockSkew = s.now * 1000 - Date.now();
  if (s.phase !== "walk") { poll(); return; }
  if (!LV.pos || Math.hypot(s.me.x - LV.pos.x, s.me.y - LV.pos.y) > 1.6) LV.pos = { x: s.me.x, y: s.me.y, a: LV.pos ? LV.pos.a : s.me.a };
  const seen = new Set();
  for (const o of s.others) {
    seen.add(o.pid);
    const cur = LV.shown.get(o.pid);
    if (cur) Object.assign(cur, { tx: o.x, ty: o.y, name: o.name, color: o.color, ghost: o.ghost, dark: o.dark });
    else LV.shown.set(o.pid, { ...o, tx: o.x, ty: o.y });
  }
  for (const k of [...LV.shown.keys()]) if (!seen.has(k)) LV.shown.delete(k);
  const now = performance.now();
  for (const f of s.feed) {
    if (LV.seen.has(`f${f.id}`)) continue;
    LV.seen.add(`f${f.id}`);
    LV.feed.push({ ...f, until: now + 5200 });
    sfx({ kill: "scream", found: "scream", take: "msg", put: "msg", lock: "door" }[f.kind]);
  }
  for (const m of s.chat) {
    if (LV.seen.has(`c${m.id}`)) continue;
    LV.seen.add(`c${m.id}`);
    LV.bubbles.set(m.pid, { text: m.text.length > 38 ? `${m.text.slice(0, 36)}…` : m.text, until: now + 4800 });
    if (m.pid !== S.me.pid) sfx("msg");
  }
  const chatKey = s.chat.map((m) => m.id).join();
  if (chatKey !== LV.chatKey) {
    LV.chatKey = chatKey;
    const atBottom = LV.log.scrollHeight - LV.log.scrollTop - LV.log.clientHeight < 60;
    LV.log.replaceChildren(...(s.chat.length ? s.chat.map(msgEl) : [h("p", { class: "muted small center" }, "Walk up to someone and say hello.")]));
    if (atBottom) LV.log.scrollTop = LV.log.scrollHeight;
  }
  LV.snap = s;
  fpHud();
}
function fpHud() {
  const s = LV.snap, lock = s.locks[s.here];
  const key = [s.here, s.dark, s.hour, s.carrying, lock == null ? "" : Math.ceil(lock)].join("|");
  if (key === LV.hudKey) return;
  LV.hudKey = key;
  const r = roomOf(s.here);
  LV.hud.replaceChildren(...[h("span", { class: "fp-tag" }, r ? `${r.emoji} ${r.name}` : "🚪 The hall", s.dark ? " · pitch dark" : ""),
    h("span", { class: "fp-tag" }, "🕰️ ", S.hours[s.hour] || ""),
    s.carrying ? h("span", { class: "fp-tag gold" }, `${ITEM_EMOJI[s.carrying] || "✋"} ${s.carrying}`) : null,
    r && lock != null ? h("span", { class: "fp-tag red" }, lock < 0 ? "🌧 Rain: nobody gets in" : `🔒 Locked · ${Math.ceil(lock)}s`) : null].filter(Boolean));
}
function fpActions() {
  const s = LV.snap, p = LV.pos, H = S.house, out = [];
  const near = (x, y, r) => Math.hypot(x - p.x, y - p.y) <= r;
  if (s.alive) {
    if (!s.carrying) for (const it of s.items) if (near(it.x, it.y, H.reach)) out.push(["walk:take", { item: it.item }, `✋ Take the ${it.item}`]);
    const spot = s.carrying && H.spots[s.carrying];
    if (spot && roomOf(s.here)?.items.includes(s.carrying) && near(spot[0], spot[1], H.reach + 0.6)) out.push(["walk:put", {}, `↩️ Put back the ${s.carrying}`]);
    if (S.me.role === "killer" && s.carrying && !s.struck && roomOf(s.here)) {
      for (const o of s.others) if (!o.ghost && who(o.pid)?.role !== "killer" && near(o.x, o.y, H.killReach)) out.push(["walk:strike", { target: o.pid }, `🔪 Strike ${o.name || "the shape in the dark"}`, "danger"]);
    }
    if (s.bodies.length && !s.showdown) out.push(["walk:report", {}, "🚨 Report the body", "danger"]);
    const lock = s.locks[s.here];
    if (roomOf(s.here) && lock !== -1) out.push(lock > 0 ? ["walk:unlock", {}, "🔓 Unlock the door"] : ["walk:lock", {}, "🔒 Lock the door"]);
  }
  const key = `${s.alive}|${out.map((a) => a[2]).join("|")}`;
  if (key === LV.actKey) return;
  LV.actKey = key;
  LV.acts.replaceChildren(...out.map(([type, extra, label, cls]) => h("button", { class: `btn sm ${cls || ""}`, type: "button", onClick: () => { sfx("tick"); act(type, extra); } }, label)),
    ...(out.length ? [] : [h("span", { class: "muted small" }, s.alive ? "Walk up to people and things to do something." : "👻 You're a ghost: drift through the walls and watch.")]));
}
function fpFeed(ts) {
  LV.feed = LV.feed.filter((f) => f.until > ts).slice(-3);
  const key = LV.feed.map((f) => f.id).join();
  if (key === LV.feedEl.dataset.key) return;
  LV.feedEl.dataset.key = key;
  LV.feedEl.replaceChildren(...LV.feed.map((f) => h("div", { class: `fp-note ${f.kind}` }, f.text)));
}
function fpDraw() {
  const { ctx, W, H } = LV, p = LV.pos, s = LV.snap;
  const pal = PAL[placeAt(p.x, p.y)] || PAL.hall;
  const dim = s.dark ? 0.2 : 1;
  let gr = ctx.createLinearGradient(0, 0, 0, H / 2);
  gr.addColorStop(0, pal.ceil[0]); gr.addColorStop(1, pal.ceil[1]);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H / 2);
  gr = ctx.createLinearGradient(0, H / 2, 0, H);
  gr.addColorStop(0, pal.floor[1]); gr.addColorStop(1, pal.floor[0]);
  ctx.fillStyle = gr; ctx.fillRect(0, H / 2, W, H / 2);
  const dx = Math.cos(p.a), dy = Math.sin(p.a), px = -dy * FOV, py = dx * FOV;
  for (let x = 0; x < W; x++) {
    const cam = (2 * x) / W - 1, rx = dx + px * cam, ry = dy + py * cam;
    let mx = Math.floor(p.x), my = Math.floor(p.y);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
    const stX = rx < 0 ? -1 : 1, stY = ry < 0 ? -1 : 1;
    let sx = rx < 0 ? (p.x - mx) * ddx : (mx + 1 - p.x) * ddx, sy = ry < 0 ? (p.y - my) * ddy : (my + 1 - p.y) * ddy;
    let side = 0, prev = houseCell(p.x, p.y), hit = "#";
    for (let n = 0; n < 80; n++) {
      if (sx < sy) { sx += ddx; mx += stX; side = 0; } else { sy += ddy; my += stY; side = 1; }
      const ch = houseCell(mx, my), room = doorRoom(ch);
      if (ch === "#" || (room && shutFor(room))) { hit = ch; break; }
      prev = ch;
    }
    const dist = Math.max(0.05, side === 0 ? sx - ddx : sy - ddy);
    const lh = H / dist, top = (H - lh) / 2;
    let wx = side === 0 ? p.y + dist * ry : p.x + dist * rx;
    wx -= Math.floor(wx);
    const sh = Math.max(0.22, Math.min(1, 1.35 - dist / 9)) * (side ? 0.82 : 1) * dim;
    if (hit !== "#") {                                           // a locked door, seen from outside
      ctx.fillStyle = shade(Math.floor(wx * 5) % 2 ? [128, 86, 48] : [112, 74, 40], sh); ctx.fillRect(x, top, 1, lh);
      if (wx > 0.43 && wx < 0.57) { ctx.fillStyle = shade([226, 186, 74], sh); ctx.fillRect(x, top + lh * 0.47, 1, lh * 0.09); }
    } else {
      const pl = PAL[S.house.legend[prev]] || PAL.hall;
      const up = lh * 0.62, rail = Math.max(1, lh * 0.025);
      ctx.fillStyle = shade(Math.floor(wx * 8) % 2 ? pl.stripe : pl.wall, sh); ctx.fillRect(x, top, 1, up);
      ctx.fillStyle = shade(pl.rail, sh); ctx.fillRect(x, top + up, 1, rail);
      ctx.fillStyle = shade(pl.low, sh); ctx.fillRect(x, top + up + rail, 1, lh - up - rail);
      if ((pl.art || pl.win) && wx > 0.22 && wx < 0.78 && (mx * 7 + my * 13) % 3 === 0) {
        const edge = wx < 0.27 || wx > 0.73;
        ctx.fillStyle = shade(edge ? [98, 70, 30] : pl.win ? [176, 212, 236] : ART[(mx + my) % ART.length], sh);
        ctx.fillRect(x, top + lh * 0.15, 1, lh * 0.3);
      }
    }
    LV.z[x] = dist;
  }
  const inv = 1 / (px * dy - dx * py);
  const project = (x, y) => { const sx = x - p.x, sy = y - p.y; return { tx: inv * (dy * sx - dx * sy), ty: inv * (-py * sx + px * sy) }; };
  const sprites = [];
  for (const o of LV.shown.values()) sprites.push({ x: o.x, y: o.y, img: o.dark ? figure("", "", true) : figure(o.name, o.color), h: 0.82, alpha: o.ghost ? 0.45 : 1, name: o.dark ? "" : o.name, pid: o.pid });
  for (const b of s.bodies) sprites.push({ x: b.x, y: b.y, img: bodyImage(b), h: 0.3, alpha: 1, name: s.dark ? "" : `✝ ${b.name}` });
  for (const it of s.items) sprites.push({ x: it.x, y: it.y, img: itemImage(it.item), h: 0.46, alpha: s.dark ? 0.35 : 1 });
  for (const sp of sprites) Object.assign(sp, project(sp.x, sp.y));
  const now = performance.now();
  sprites.filter((sp) => sp.ty > 0.12).sort((a, b) => b.ty - a.ty).forEach((sp) => {
    const unit = H / sp.ty, hgt = unit * sp.h, wid = hgt * (sp.img.width / sp.img.height);
    const scr = (W / 2) * (1 + sp.tx / sp.ty), left = scr - wid / 2, top = H / 2 + unit / 2 - hgt;
    const x0 = Math.max(0, Math.floor(left)), x1 = Math.min(W, Math.ceil(left + wid));
    ctx.globalAlpha = sp.alpha;
    let run = -1;
    for (let x = x0; x <= x1; x++) {
      const vis = x < x1 && sp.ty < LV.z[x];
      if (vis && run < 0) run = x;
      if (!vis && run >= 0) {
        ctx.drawImage(sp.img, ((run - left) / wid) * sp.img.width, 0, ((x - run) / wid) * sp.img.width, sp.img.height, run, top, x - run, hgt);
        run = -1;
      }
    }
    ctx.globalAlpha = 1;
    const mid = Math.max(0, Math.min(W - 1, Math.round(scr)));
    if (sp.ty < LV.z[mid] && sp.ty < 7) {
      const size = Math.max(9, Math.min(15, 30 / sp.ty));
      ctx.font = `700 ${size}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      const bub = sp.pid && LV.bubbles.get(sp.pid);
      if (bub && bub.until > now) {
        const tw = ctx.measureText(bub.text).width + 12, by = top - size - 10;
        ctx.fillStyle = "rgba(255,253,248,0.94)"; ctx.fillRect(scr - tw / 2, by - size - 4, tw, size + 8);
        ctx.fillStyle = "#2a1f16"; ctx.fillText(bub.text, scr, by + 3);
      }
      if (sp.name) {
        ctx.fillStyle = "rgba(20,14,10,0.6)"; ctx.fillText(sp.name, scr + 1, top - 3);
        ctx.fillStyle = "#fff8ea"; ctx.fillText(sp.name, scr, top - 4);
      }
    }
  });
  for (const [room, [ddx, ddy]] of Object.entries(S.house.doors)) {    // a sign over every door, seen from the hall
    if (s.here === room) continue;
    const { tx, ty } = project(ddx + 0.5, ddy + 0.5);
    if (ty < 0.3 || ty > 9) continue;
    const scr = (W / 2) * (1 + tx / ty), col = Math.round(scr);
    if (col < 0 || col >= W || LV.z[col] < ty - 0.6) continue;
    const r = roomOf(room), size = Math.max(9, Math.min(16, 34 / ty));
    ctx.font = `700 ${size}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const label = `${r?.emoji || ""} ${r?.name || room}${s.locks[room] != null ? " 🔒" : ""}`;
    const y = H / 2 - H / ty / 2 - 4, tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(42,31,22,0.72)"; ctx.fillRect(scr - tw / 2, y - size - 2, tw, size + 5);
    ctx.fillStyle = "#fbefd2"; ctx.fillText(label, scr, y + 1);
  }
  if (s.dark) { ctx.fillStyle = "rgba(10,8,16,0.55)"; ctx.fillRect(0, 0, W, H); }
}
function fpMini() {
  const map = S.house.map, k = 5, c = LV.mini.getContext("2d"), s = LV.snap;
  if (LV.mini.width !== map[0].length * k) { LV.mini.width = map[0].length * k; LV.mini.height = map.length * k; LV.miniBg = null; }
  if (!LV.miniBg) {
    LV.miniBg = h("canvas", { width: LV.mini.width, height: LV.mini.height });
    const b = LV.miniBg.getContext("2d");
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      const pl = PAL[S.house.legend[ch]];
      b.fillStyle = ch === "#" ? "#2a1f16" : pl ? `rgb(${pl.wall.join(",")})` : "#999";
      b.fillRect(x * k, y * k, k, k);
    }));
  }
  c.clearRect(0, 0, LV.mini.width, LV.mini.height);
  c.drawImage(LV.miniBg, 0, 0);
  for (const [room, [x, y]] of Object.entries(S.house.doors)) if (s.locks[room] != null) { c.fillStyle = "#c0392b"; c.fillRect(x * k, y * k, k, k); }
  for (const b of s.bodies) { c.fillStyle = "#b3261e"; c.fillRect(b.x * k - 2, b.y * k - 2, 4, 4); }
  for (const o of LV.shown.values()) { c.fillStyle = o.dark ? "#000" : o.color; c.beginPath(); c.arc(o.x * k, o.y * k, 2.2, 0, 7); c.fill(); }
  const p = LV.pos;
  c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(p.x * k, p.y * k); c.lineTo((p.x + Math.cos(p.a) * 1.6) * k, (p.y + Math.sin(p.a) * 1.6) * k); c.stroke();
  c.fillStyle = "#fff"; c.beginPath(); c.arc(p.x * k, p.y * k, 2.8, 0, 7); c.fill();
}
function walk() {
  return h("section", { class: "stack" }, bar(S.showdown ? "The last day" : `Day ${S.day}`), ghostBanner(), dayHeader(),
    S.showdown ? h("div", { class: "card warn" }, h("b", {}, "The final showdown. "), S.me.role === "killer" ? "Catch every guest before dusk." : "Stay alive until dusk: keep moving, lock yourself in.") : null,
    voiceTip());
}

/* ---------- start ---------- */
if (me) startPolling();
render();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me) poll(); });
