/* Alibi as an app: a bar on the home screen offers "Install Alibi", and Settings has the same button.
   On an iPhone or iPad, where Apple has no install button, it shows the Share → Add to Home Screen steps instead. "Not now" hides the bar for a week. */
(() => {
  "use strict";
  const KEY = "alibi.install";
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || /AwsaaApp/.test(navigator.userAgent);       // an installed app, or the Android app
  const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
  const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...o })); } catch { /* private mode */ } };
  let prompt = null, bar = null, timer = 0;

  const hideBar = () => { if (bar) { bar.remove(); bar = null; } clearInterval(timer); };

  /** The browser's own install prompt when it offers one, the steps when it does not. */
  const install = async () => {
    if (prompt) {
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      prompt = null;
      hideBar();
      return !!choice && choice.outcome === "accepted";
    }
    const back = document.createElement("div");
    back.className = "sheet-back";
    back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Install Alibi"><h2 class="h2">Install Alibi</h2><p class="small" id="ins-t"></p><button class="btn primary block" type="button">Got it</button></div>';
    back.querySelector("#ins-t").textContent = ios()
      ? "On your iPhone or iPad: open Alibi in Safari, tap the Share button (the square with an arrow), scroll down and tap “Add to Home Screen”, then “Add”."
      : "In your browser's menu, choose “Install app” or “Add to Home screen”. Alibi then opens like any other app, full screen.";
    back.addEventListener("click", (e) => { if (e.target === back || e.target.tagName === "BUTTON") back.remove(); });
    document.body.append(back);
    back.querySelector("button").focus();
    return false;
  };

  const showBar = () => {
    if (bar || standalone() || !document.querySelector(".home")) return;           // only on the home screen, never over a game
    if (Date.now() - (read().at || 0) < 7 * 864e5) return;                           // said "not now" in the last week
    if (!prompt && !ios()) return;                                                   // nothing to offer on this browser
    bar = document.createElement("div");
    bar.className = "ibar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Install Alibi");
    bar.innerHTML = '<span class="ib-logo" aria-hidden="true">🕵️</span><div class="ib-t"><b>Install Alibi</b><small>Its own icon, full screen, quick to open.</small></div><button class="btn primary sm" type="button" data-a="go">Install</button><button class="ib-x" type="button" data-a="no">Not now</button>';
    bar.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]") && e.target.closest("[data-a]").dataset.a;
      if (a === "go") install();
      if (a === "no") { write({ at: Date.now() }); hideBar(); }
    });
    document.body.append(bar);
    timer = setInterval(() => { if (bar) bar.hidden = !document.querySelector(".home"); }, 1500);
  };

  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); prompt = e; setTimeout(showBar, 1500); });
  addEventListener("appinstalled", () => { prompt = null; hideBar(); });
  addEventListener("load", () => setTimeout(showBar, 2500));
  window.AlibiInstall = { install, installed: standalone };
})();
