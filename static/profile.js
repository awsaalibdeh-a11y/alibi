/* Alibi: your profile, kept on this phone only. Every finished game adds to your record and earns XP; XP makes levels, levels make titles,
   and achievements unlock badges you can wear next to your name (other players see it in the lobby). One daily challenge a day, with a streak.

   Uses the page's own helpers (h, toast, sfx, MAPLIST) from app.js, at call time only. */
"use strict";

const AlibiProfile = (() => {
  const KEY = "alibi.record";
  const blank = () => ({ games: 0, wins: 0, asKiller: 0, killerWins: 0, streak: 0, best: 0, jobs: {}, jobWins: {}, maps: {}, xp: 0, kills: 0, caught: 0, rightVotes: 0,
    survived: 0, missions: 0, awards: 0, jester: 0, saves: 0, found: 0, haunts: 0, ach: {}, history: [], daily: null, dailies: 0, dailyStreak: 0, badge: null, last: "" });
  const load = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return blank(); } };
  const save = (r) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode: it just won't stick */ } };

  /* ---------- levels: 100 XP to level 2, then a little more for each one ---------- */
  const need = (lv) => 50 * lv * (lv - 1);                         // total XP to reach a level
  const TITLES = [[1, "Houseguest"], [3, "Busybody"], [5, "Snoop"], [8, "Sleuth"], [12, "Inspector"], [16, "Chief Inspector"], [20, "Mastermind"], [30, "Legend"]];
  function level(xp) {
    let lv = 1;
    while (xp >= need(lv + 1) && lv < 99) lv++;
    const into = xp - need(lv), span = need(lv + 1) - need(lv);
    return { level: lv, title: [...TITLES].reverse().find(([l]) => lv >= l)[1], into, span, pct: Math.min(100, Math.round((into / span) * 100)) };
  }

  /* ---------- achievements: each one can unlock a badge ---------- */
  const ACH = [
    ["first_game", "🎟️", "Checked in", "Finish your first game", (r) => r.games >= 1],
    ["first_win", "⭐", "First victory", "Win a game", (r) => r.wins >= 1, "⭐"],
    ["killer_win", "🔪", "Perfect murder", "Win as a killer", (r) => r.killerWins >= 1, "🔪"],
    ["clean", "😇", "Butter wouldn't melt", "Win as a killer without a single vote against you", (r, s) => s && s.won && s.role === "killer" && !s.votesAgainst],
    ["catch", "🕵️", "Gotcha", "Vote out a killer", (r) => r.caught >= 1, "🕵️"],
    ["nose", "👃", "Sharp nose", "Vote for a killer 10 times", (r) => r.rightVotes >= 10],
    ["survivor", "🕯️", "Survivor", "Be alive at the end of 5 games", (r) => r.survived >= 5],
    ["mission", "🎯", "Mission accomplished", "Finish a secret mission", (r) => r.missions >= 1],
    ["agent", "🗂️", "Secret agent", "Finish 10 secret missions", (r) => r.missions >= 10],
    ["doctor", "🩺", "Steady hands", "Save someone as the Doctor", (r, s) => s && s.job === "doctor" && s.saves > 0, "🩺"],
    ["shield", "🛡️", "Human shield", "Fight off an attack as the Bodyguard", (r, s) => s && s.job === "bodyguard" && s.saves > 0, "🛡️"],
    ["closed", "🔎", "Case closed", "Unmask a killer as the Detective", (r) => r.found >= 1],
    ["jester", "🃏", "Last laugh", "Win as the Jester", (r) => r.jester >= 1, "🃏"],
    ["faces", "🎭", "Many faces", "Win as the Shapeshifter", (r) => (r.jobWins.shapeshifter || 0) >= 1, "🎭"],
    ["medium", "🔮", "The other side", "Play as the Medium", (r) => (r.jobs.medium || 0) >= 1, "🔮"],
    ["tracker", "🧭", "Bloodhound", "Play as the Tracker", (r) => (r.jobs.tracker || 0) >= 1, "🧭"],
    ["ghost", "👻", "Poltergeist", "Haunt 5 rooms as a ghost", (r) => r.haunts >= 5, "👻"],
    ["swift", "⚡", "Swift justice", "Win as a guest on day 1", (r, s) => s && s.won && s.role !== "killer" && s.winner === "guests" && s.days === 1],
    ["fire", "🔥", "On fire", "Win 3 games in a row", (r) => r.best >= 3, "🔥"],
    ["champ", "🏆", "Champion", "Win 10 games", (r) => r.wins >= 10, "🏆"],
    ["regular", "🎖️", "Regular", "Play 25 games", (r) => r.games >= 25],
    ["globe", "🗺️", "Globetrotter", "Play on every map", (r) => mapsAll().every((id) => r.maps[id])],
    ["decorated", "🏅", "Decorated", "Win 10 end-of-game awards", (r) => r.awards >= 10],
    ["family", "👨‍👩‍👧", "Full house", "Finish a game with 4 or more people", (r, s) => s && s.humans >= 4],
    ["lv10", "💎", "Inspector", "Reach level 10", (r) => level(r.xp).level >= 10, "💎"],
    ["lv20", "👑", "Mastermind", "Reach level 20", (r) => level(r.xp).level >= 20, "👑"],
    ["owl", "🌙", "Night owl", "Finish 5 daily challenges", (r) => r.dailies >= 5, "🌙"],
    ["dawn", "🌅", "Never found", "Make it to dawn in hide and seek", (r) => (r.jobWins.hider || 0) >= 1, "🙈"],
    ["seeker", "🔦", "Seeker supreme", "Find 3 hiders in one night of hide and seek", (r, s) => s && s.catches >= 3, "🔦"],
    ["walker", "👣", "House walker", "Play 10 games on the house map", (r) => r.games >= 10],
  ].map(([id, emoji, title, desc, test, badge]) => ({ id, emoji, title, desc, test, badge }));
  const mapsAll = () => ((typeof MAPLIST !== "undefined" && MAPLIST.length > 1 ? MAPLIST : [{ id: "wrenmoor" }]).map((m) => m.id));

  /* ---------- the daily challenge: the same one for everyone on the same day ---------- */
  const today = () => new Date().toISOString().slice(0, 10);
  const seed = (s) => { let x = 7; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };
  function daily() {
    const d = today(), n = seed(d);
    const maps = typeof MAPLIST !== "undefined" ? MAPLIST : [];
    const m = maps.length ? maps[n % maps.length] : null;
    const all = [
      ["Win a game", (s) => s.won],
      ["Vote for a killer", (s) => s.rightVotes >= 1],
      ["Look around 3 times in one game", (s) => s.looks >= 3],
      ["Finish your secret mission", (s) => s.mission],
      ["Still be alive when the game ends", (s) => s.survived],
      ["Win one of the end-of-game awards", (s) => s.awards.length > 0],
      ["Play a game with 6 or more guests", (s) => s.players >= 6],
      ["Play a night of hide and seek", (s) => s.mode === "hide", "🙈"],
      ["Find someone in hide and seek", (s) => s.catches >= 1, "🔦"],
      ...(m ? [[`Play a game on ${m.title}`, (s) => s.map === m.id, m.emoji]] : []),
    ];
    const [text, test, emoji] = all[Math.floor(n / 7) % all.length];
    return { date: d, text, test, emoji: emoji || "📅", xp: 100 };
  }

  /* ---------- a finished game: record it, add up the XP, unlock what's earned ---------- */
  function finish(d) {
    const s = d.mystats;
    if (!s) return null;
    const r = load();
    const key = `${d.code}:${s.minutes}:${s.days}`;
    if (r.last === key) return null;                                   // already counted (a reload on the end screen)
    r.last = key;
    const before = level(r.xp);
    const killer = s.role === "killer";
    r.games++;
    if (s.won) { r.wins++; r.streak++; r.best = Math.max(r.best, r.streak); } else r.streak = 0;
    if (killer) { r.asKiller++; if (s.won) r.killerWins++; }
    if (s.job) { r.jobs[s.job] = (r.jobs[s.job] || 0) + 1; if (s.won) r.jobWins[s.job] = (r.jobWins[s.job] || 0) + 1; }
    if (s.map) r.maps[s.map] = (r.maps[s.map] || 0) + 1;
    r.kills += s.kills; r.caught += s.caught ? 1 : 0; r.rightVotes += s.rightVotes; r.survived += s.survived ? 1 : 0;
    r.missions += s.mission ? 1 : 0; r.awards += s.awards.length; r.jester += s.jester ? 1 : 0; r.saves += s.saves; r.found += s.found; r.haunts += s.haunts;
    const hide = s.mode === "hide";
    if (hide) {                                                          // hide and seek counts as a role of its own
      const k = s.seeker ? "seeker" : "hider";
      r.jobs[k] = (r.jobs[k] || 0) + 1;
      if (s.won) r.jobWins[k === "seeker" || s.role === "hunter" ? "seeker" : "hider"] = (r.jobWins[k === "seeker" || s.role === "hunter" ? "seeker" : "hider"] || 0) + 1;
      r.found = r.found || 0;
      r.catches = (r.catches || 0) + (s.catches || 0);
    }
    const gained = [[hide ? "Played hide and seek" : "Played a game", 40]];
    if (s.won && hide) gained.push([s.role === "hider" ? "Made it to dawn" : "The hunt won", s.role === "hider" ? 90 : 60]);
    else if (s.won) gained.push([s.jester ? "The Jester's win" : killer ? "Won as the killer" : "Won the weekend", killer || s.jester ? 90 : 60]);
    if (s.catches) gained.push([`Found ${s.catches} ${s.catches === 1 ? "hider" : "hiders"}`, 20 * s.catches]);
    if (s.kills) gained.push([`${s.kills} murder${s.kills > 1 ? "s" : ""}`, 15 * s.kills]);
    if (s.rightVotes) gained.push([`Voted for a killer ×${s.rightVotes}`, 20 * s.rightVotes]);
    if (s.caught) gained.push(["Caught a killer", 30]);
    if (s.survived && !killer && !hide) gained.push(["Survived", 15]);
    if (s.mission) gained.push(["Secret mission", 40]);
    if (s.awards.length) gained.push([`${s.awards.length} award${s.awards.length > 1 ? "s" : ""}`, 15 * s.awards.length]);
    if (s.saves) gained.push([`Saved a life ×${s.saves}`, 25 * s.saves]);
    if (s.found) gained.push(["Unmasked a killer", 25 * s.found]);
    if (r.streak >= 2 && s.won) gained.push([`${r.streak} wins in a row`, 10 * Math.min(r.streak, 5)]);
    const dc = daily();
    let dailyDone = false;
    if ((!r.daily || r.daily.date !== dc.date || !r.daily.done) && dc.test(s)) {
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      r.dailyStreak = r.daily && r.daily.done && r.daily.date === yesterday ? r.dailyStreak + 1 : 1;
      r.daily = { date: dc.date, done: true };
      r.dailies++;
      dailyDone = true;
      gained.push([`Daily challenge${r.dailyStreak > 1 ? ` (${r.dailyStreak}-day streak)` : ""}`, dc.xp + 10 * Math.min(r.dailyStreak - 1, 5)]);
    }
    const xp = gained.reduce((n, [, x]) => n + x, 0);
    r.xp += xp;
    const after = level(r.xp);
    const fresh = ACH.filter((a) => !r.ach[a.id] && a.test(r, s));
    for (const a of fresh) r.ach[a.id] = Date.now();
    r.history = [{ t: Date.now(), map: s.map, role: s.role, job: hide ? (s.seeker ? "seeker" : "hider") : s.job, won: s.won, xp, practice: s.practice, mode: s.mode }, ...r.history].slice(0, 20);
    save(r);
    return { gained, xp, before, after, beforeXp: r.xp - xp, levelUp: after.level > before.level, fresh, dailyDone };
  }

  const badges = (r = load()) => ACH.filter((a) => a.badge && r.ach[a.id]).map((a) => a.badge);
  function flair() {
    const r = load(), b = badges(r);
    return { level: level(r.xp).level, badge: b.includes(r.badge) ? r.badge : null };
  }

  /* ---------- what the screens show ---------- */
  const ring = (pct, label, size = 3.2) => h("span", { class: "lvring", style: { "--p": String(pct), "--sz": `${size}rem` }, "aria-hidden": "true" },
    h("span", { html: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="bgc"/><circle cx="20" cy="20" r="17" class="fgc" pathLength="100" style="stroke-dashoffset:${100 - pct}"/></svg>` }),
    h("b", {}, label));

  /** The little card on the home screen: level, title, XP to the next level. */
  function chip() {
    const r = load(), lv = level(r.xp);
    return h("button", { class: "profchip", type: "button", onClick: open, "aria-label": `Your profile: level ${lv.level}, ${lv.title}` },
      ring(lv.pct, String(lv.level)),
      h("span", { class: "grow" }, h("b", {}, r.badge && badges(r).includes(r.badge) ? `${r.badge} ` : "", lv.title),
        h("span", { class: "xpbar" }, h("i", { style: { width: `${lv.pct}%` } })),
        h("small", { class: "muted" }, r.games ? `${lv.span - lv.into} XP to level ${lv.level + 1} · ${r.wins} won of ${r.games}` : "Play a game to start earning XP")),
      h("span", { class: "chev", "aria-hidden": "true" }, "›"));
  }

  /** Today's challenge, with its streak. */
  function dailyCard() {
    const r = load(), dc = daily(), done = r.daily && r.daily.date === dc.date && r.daily.done;
    return h("div", { class: "daily" + (done ? " done" : "") }, h("span", { class: "daily-emoji" }, done ? "✅" : dc.emoji),
      h("span", { class: "grow" }, h("small", { class: "label" }, done ? "Daily challenge · done" : "Daily challenge"), h("b", {}, dc.text)),
      h("span", { class: "daily-xp" }, done ? (r.dailyStreak > 1 ? `🔥 ${r.dailyStreak}` : "✓") : `+${dc.xp} XP`));
  }

  /** The end of a game: the XP adding up, a level gained, achievements unlocked. */
  function resultCard(res) {
    if (!res) return null;
    const wrap = h("div", { class: "card xpcard" },
      h("div", { class: "row" }, ring(res.before.pct, String(res.before.level), 3.6),
        h("span", { class: "grow" }, h("span", { class: "label" }, "Experience"), h("b", { class: "xptotal" }, `+${res.xp} XP`),
          h("span", { class: "xpbar big" }, h("i", { class: "fill", style: { width: `${res.before.pct}%` } }))),
        res.levelUp ? h("span", { class: "lvup" }, `Level ${res.after.level}!`) : null),
      h("ul", { class: "xplist" }, res.gained.map(([label, xp], i) => h("li", { style: { animationDelay: `${0.25 + i * 0.12}s` } }, h("span", {}, label), h("b", {}, `+${xp}`)))),
      res.fresh.length ? h("div", { class: "achnew" }, h("span", { class: "label" }, res.fresh.length > 1 ? "New achievements" : "New achievement"),
        h("div", { class: "achrow" }, res.fresh.map((a, i) => h("div", { class: "ach got pop", style: { animationDelay: `${0.6 + i * 0.2}s` } }, h("span", { class: "ach-emoji" }, a.emoji),
          h("b", {}, a.title), h("small", {}, a.badge ? `${a.desc} · unlocks the ${a.badge} badge` : a.desc))))) : null);
    setTimeout(() => {                                                 // the bar fills up, rolling over into the next level
      const bar = wrap.querySelector(".xpbar.big .fill"), lvb = wrap.querySelector(".lvring b"), ringEl = wrap.querySelector(".lvring");
      if (!bar) return;
      const reduce = typeof calm === "function" && calm();
      const finishBar = () => { bar.style.width = `${res.after.pct}%`; lvb.textContent = String(res.after.level); ringEl.style.setProperty("--p", String(res.after.pct)); ringEl.querySelector(".fgc").style.strokeDashoffset = String(100 - res.after.pct); };
      if (reduce || !res.levelUp) { finishBar(); return; }
      bar.style.width = "100%";
      setTimeout(() => { bar.style.transition = "none"; bar.style.width = "0%"; void bar.offsetWidth; bar.style.transition = ""; finishBar(); wrap.classList.add("leveled"); if (typeof sfx === "function") sfx("level"); if (typeof burst === "function") burst(ringEl); }, 900);
    }, 500);
    return wrap;
  }

  /** The profile: everything you've done, and the badges you can wear. */
  function open() {
    if (document.querySelector(".sheet-back.profile")) return;
    const r = load(), lv = level(r.xp), owned = badges(r);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const back = h("div", { class: "sheet-back profile", onClick: (e) => { if (e.target === back) close(); } });
    const stat = (n, label) => h("div", { class: "stat" }, h("b", {}, String(n)), h("small", { class: "muted" }, label));
    const pct = r.games ? Math.round((r.wins / r.games) * 100) : 0;
    const roles = [["guest", "🕯️", "Guest"], ["killer", "🔪", "Killer"], ["detective", "🕵️", "Detective"], ["doctor", "🩺", "Doctor"], ["shapeshifter", "🎭", "Shapeshifter"],
      ["medium", "🔮", "Medium"], ["jester", "🃏", "Jester"], ["tracker", "🧭", "Tracker"], ["bodyguard", "🛡️", "Bodyguard"], ["hider", "🙈", "Hider"], ["seeker", "🔦", "Seeker"]];
    const wear = (b) => { const x = load(); x.badge = x.badge === b ? null : b; save(x); close(); open(); if (typeof render === "function") render(); };
    const maps = typeof MAPLIST !== "undefined" ? MAPLIST : [];
    const sheet = h("div", { class: "sheet wide", role: "dialog", "aria-modal": "true", "aria-label": "Your profile" },
      h("div", { class: "row" }, h("h2", { class: "h2" }, "Your profile"), h("span", { class: "spacer" }), h("button", { class: "ibtn", type: "button", "aria-label": "Close", onClick: close }, "✕")),
      h("div", { class: "profhead" }, ring(lv.pct, String(lv.level), 5),
        h("div", { class: "grow" }, h("span", { class: "label" }, `Level ${lv.level}`), h("h3", { class: "proftitle" }, r.badge && owned.includes(r.badge) ? `${r.badge} ` : "", lv.title),
          h("span", { class: "xpbar big" }, h("i", { style: { width: `${lv.pct}%` } })), h("small", { class: "muted" }, `${r.xp} XP · ${lv.span - lv.into} to level ${lv.level + 1}`))),
      dailyCard(),
      h("div", { class: "stats" }, stat(r.games, "games"), stat(r.wins, "won"), stat(`${pct}%`, "win rate"), stat(r.best, "best streak"), stat(r.kills, "murders"),
        stat(r.caught, "killers caught"), stat(r.missions, "missions"), stat(r.catches || 0, "hiders found"), stat(Object.keys(r.ach).length, "achievements")),
      h("div", { class: "card stack" }, h("span", { class: "label" }, "Badges · wear one next to your name"),
        owned.length ? h("div", { class: "badges" }, owned.map((b) => h("button", { class: "badgebtn" + (r.badge === b ? " on" : ""), type: "button", "aria-pressed": String(r.badge === b), onClick: () => wear(b) }, b)))
          : h("p", { class: "muted small" }, "Unlock badges with achievements (the ones marked with a badge below).")),
      h("div", { class: "card stack" }, h("span", { class: "label" }, `Achievements · ${Object.keys(r.ach).length} of ${ACH.length}`),
        h("div", { class: "achgrid" }, ACH.map((a) => h("div", { class: "ach" + (r.ach[a.id] ? " got" : ""), title: a.desc }, h("span", { class: "ach-emoji" }, r.ach[a.id] ? a.emoji : "🔒"),
          h("b", {}, a.title), h("small", {}, a.desc, a.badge ? ` · ${a.badge}` : ""))))),
      h("div", { class: "card stack" }, h("span", { class: "label" }, "Roles you've played"),
        h("div", { class: "rolestats" }, roles.map(([k, e, t]) => { const n = k === "guest" ? r.games - r.asKiller - Object.entries(r.jobs).filter(([j]) => j !== "shapeshifter").reduce((a, [, x]) => a + x, 0) : k === "killer" ? r.asKiller : r.jobs[k] || 0;
          const w = k === "killer" ? r.killerWins : r.jobWins[k] || 0;
          return h("div", { class: "rolestat" + (n > 0 ? "" : " none") }, h("span", {}, e), h("b", {}, t), h("small", { class: "muted" }, n > 0 ? `${Math.max(0, n)} played${k !== "guest" ? ` · ${w} won` : ""}` : "not yet")); }))),
      maps.length > 1 ? h("div", { class: "card stack" }, h("span", { class: "label" }, `Places you've been · ${maps.filter((m) => r.maps[m.id]).length} of ${maps.length}`),
        h("div", { class: "mapstats" }, maps.map((m) => h("div", { class: "mapstat" + (r.maps[m.id] ? "" : " none"), title: m.title }, h("span", {}, m.emoji), h("small", {}, r.maps[m.id] ? `×${r.maps[m.id]}` : "–"))))) : null,
      r.history.length ? h("div", { class: "card stack" }, h("span", { class: "label" }, "Recent games"),
        h("ol", { class: "history" }, r.history.slice(0, 8).map((x) => { const m = maps.find((y) => y.id === x.map);
          return h("li", {}, h("span", {}, m ? m.emoji : "🎲"), h("span", { class: "grow" }, h("b", {}, x.won ? "Won" : "Lost"), x.mode === "hide" ? ` hide and seek, as ${x.job === "seeker" ? "a seeker" : "a hider"}` : ` as ${x.role === "killer" ? "the killer" : x.job ? `the ${x.job}` : "a guest"}`, x.practice ? " · practice" : ""),
            h("small", { class: "muted" }, `+${x.xp} XP · ${new Date(x.t).toLocaleDateString()}`)); }))) : null,
      r.games ? h("button", { class: "btn ghost sm", type: "button", onClick: async () => { if (await (typeof ask === "function" ? ask({ title: "Reset your profile?", text: "Your level, XP, achievements and record on this phone start again from zero.", ok: "Reset", danger: true }) : confirm("Reset your profile?"))) { save(blank()); close(); open(); if (typeof render === "function") render(); } } }, "Reset profile") : null);
    back.append(sheet);
    document.body.append(back);
    document.addEventListener("keydown", onKey);
    sheet.querySelector(".ibtn").focus();
  }

  return { load, level, finish, flair, chip, dailyCard, resultCard, open, daily, ACH };
})();
window.AlibiProfile = AlibiProfile;
