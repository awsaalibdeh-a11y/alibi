"""Alibi: a murder party game where the killer is one of the players, each on their own phone.

The server hands over the page and runs every game (game.py): rooms, the clock, what each phone may see, the bots.
"""

import logging
import os
import secrets

from dotenv import load_dotenv
from flask import Flask, render_template, request

load_dotenv()
logging.basicConfig(level=logging.INFO)

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True

from game import bp  # noqa: E402  (after load_dotenv)

app.register_blueprint(bp)


def _version():
    files = [os.path.join(BASE, "static", f) for f in os.listdir(os.path.join(BASE, "static"))]
    return str(int(max(os.path.getmtime(f) for f in files)))


@app.after_request
def headers(resp):
    h = resp.headers
    if request.path.startswith("/static/"):
        h["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "public, max-age=3600"
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
    if request.headers.get("X-Forwarded-Proto", request.scheme) == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp


CSP = "; ".join([
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "manifest-src 'self'",
])


@app.route("/")
def index():
    resp = app.make_response(render_template("index.html", v=_version()))
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/manifest.webmanifest")
def manifest():
    body = {"name": "Alibi", "short_name": "Alibi", "description": "A murder party game: one of you is the killer.",
            "start_url": "/", "display": "standalone", "background_color": "#16120f", "theme_color": "#16120f",
            "icons": [{"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}]}
    return app.response_class(__import__("json").dumps(body), mimetype="application/manifest+json")


@app.route("/healthz")
def healthz():
    return "ok"


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5085)), debug=False)
