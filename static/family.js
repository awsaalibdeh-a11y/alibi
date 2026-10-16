/* Alibi ↔ Homebase: a game you start from your family's chat.

   In Homebase, the 🎮 button in the family chat opens Alibi with a one-time link (#family=...). This page keeps it for the tab, cleans the address bar, and
   shows "Start the family game". When the game is created, the code goes back to Homebase with that link (it works once, for that family only), and the
   family chat gets the code and a Join button. This page may only answer the Homebase addresses the server lists in the page. */
(() => {
  "use strict";
  const KEY = "alibi.family";
  const ALLOWED = ((document.querySelector('meta[name="homebase-origins"]') || {}).content || "").split(/\s+/).filter(Boolean);
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { pending = null; }
  if (pending && !ALLOWED.includes(pending.b)) pending = null;

  const decode = (c) => { try { return JSON.parse(decodeURIComponent(escape(atob(c.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(c.length / 4) * 4, "="))))); } catch { return null; } };
  const clear = () => { pending = null; try { sessionStorage.removeItem(KEY); } catch { /* private mode */ } };

  const fromHash = () => {
    const m = location.hash.match(/^#family=([A-Za-z0-9_-]+)$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);          // the key must not stay in the address bar or the history
    const d = decode(m[1]);
    if (!d || !d.b || !d.t || !ALLOWED.includes(d.b)) { if (typeof toast === "function") toast("That family link is not valid. Start the game again from Homebase.", 5000); return; }
    pending = { b: d.b, t: d.t, n: String(d.n || "").slice(0, 16), f: String(d.f || "").slice(0, 40) };
    try { sessionStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* private mode */ }
    if (typeof render === "function" && typeof me !== "undefined" && !me) render();   // the home screen shows the family card
  };

  /** The game exists: send its code to the family chat. One try; if it fails the lobby's own "Send the link" still works. */
  const announce = async (code) => {
    const p = pending;
    if (!p) return;
    clear();
    try {
      const r = await fetch(p.b + "/api/ext/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: p.t, code, game: "alibi" }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "no");
      toast("Your family has been told in the Homebase chat.", 5000);
    } catch (e) { toast("Could not tell your family in Homebase. Send them the code yourself.", 7000); }
  };

  window.AlibiFamily = { pending: () => pending, announce };
  addEventListener("hashchange", fromHash);
  fromHash();
})();
