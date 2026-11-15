"""Render the CrowdPulse code tour: a storyboard and a narrated video that shows the code on the left (a VS Code
style editor) and the real app running on the right, filmed one exact frame at a time.

The scenes and narration live in film/tour/tour.js. The app pages run in iframes on a virtual clock against
film/tour/fakesupa.js, an in-page stand-in for the Supabase project (same database functions, same broadcasts).
Every call and broadcast the app makes is traced, and the traces move the editor's execution pointer.
The voice, music bed, sound effects and mixing are shared with the explainer (film/render.py).

Uses the same virtualenv as the explainer (playwright, imageio-ffmpeg, kokoro-onnx, soundfile, numpy):
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_tour.py --storyboard   storyboard, script, captions, CodeTour
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_tour.py --preview      quick 960x540 video
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_tour.py                1440p master (--share adds a 1080p copy)
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_tour.py --shots 42 97.5   stills at those seconds, for checking a scene
Outputs go to film/out as crowdpulse-code-tour*. The stops in the film are also written as a VS Code CodeTour
(.tours/crowdpulse-code-tour.tour), so the same walk can be taken in the real editor.
"""
import argparse
import base64
import html
import http.server
import json
import pathlib
import shutil
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render as base  # noqa: E402  the explainer's voice, sound and frame loop
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT, FILM = base.ROOT, base.FILM
NAME = "crowdpulse-code-tour"
FINAL = FILM / "out"
# the shared helpers write under these names; the finished files are copied to film/out at the end
base.NAME = NAME
base.CACHE = FILM / ".cache" / "tour"
base.OUT = base.CACHE / "out"
base.THUMBNAIL_BOARD = "The pulse broadcast"
# words the voice says better when spelled the way they sound (first match wins, so longer names come first)
base.SAY = {"npm run dev": "N P M run dev", "supa.js": "soopa dot J S", ".js": " dot J S", "cp_do_rate": "C P do rate", "cp_": "C P ", "SQL": "S Q L", "HTML": "H T M L",
            "Supabase": "Soopa base", "Realtime": "real time"}

# ---------------------------------------------------------------- server
VENDOR = {  # same map as scripts/vendor.mjs, minus the Supabase library (replaced by the stand-in below)
    "vendor/qrcode/qrcode.js": "node_modules/qrcode-generator/dist/qrcode.js",
    "vendor/chart.js/chart.umd.js": "node_modules/chart.js/dist/chart.umd.js",
}
STUB = "// film: the Supabase library is replaced by the in-page stand-in (film/tour/fakesupa.js)\nwindow.supabase = { createClient: () => window.top.__server.client(window) };\n"
CONFIG = "window.CP_CONFIG = { supabaseUrl: 'https://film.supabase.co', supabaseKey: 'film' };\n"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ts": "text/plain; charset=utf-8", ".sql": "text/plain; charset=utf-8"}
SOURCE_DIRS = ("public/", "supabase/", "scripts/")


def resolve(path):
    """Maps a URL path to (body, file): the app from public/, the film set from film/tour, and source files under /src/."""
    if path == "vendor/supabase/supabase.js":
        return STUB, None
    if path == "js/config.js":
        return CONFIG, None
    if path.startswith("studio/"):
        for folder in ("tour", "studio"):
            if (FILM / folder / path[7:]).is_file():
                return None, FILM / folder / path[7:]
        return None, None
    if path.startswith("src/"):
        return None, ROOT / path[4:] if path[4:].startswith(SOURCE_DIRS) else None
    if path == "fixture/db.json":
        return None, FILM / "fixture" / "db.json"
    if path in VENDOR:
        return None, ROOT / VENDOR[path]
    return None, ROOT / "public" / path


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip("/") or "index.html"
        body, file = (None, None) if ".." in path.split("/") else resolve(path)
        if body is None and (file is None or not file.is_file()):
            self.send_error(404)
            return
        data = body.encode() if body is not None else file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(pathlib.PurePosixPath(path).suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def start_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def open_director(playwright, port, scale, code, model_dir):
    browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    context = browser.new_context(viewport={"width": base.LAYOUT[0], "height": base.LAYOUT[1]}, device_scale_factor=scale)
    context.add_init_script(path=str(FILM / "studio" / "shim.js"))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and "favicon" not in r.url else None)
    page.goto(f"http://127.0.0.1:{port}/studio/tour.html")
    page.wait_for_function("!!(window.Director && window.__server && window.__buildReport)")
    info = page.evaluate("Director.prepare()")
    lengths = base.make_voice(page.evaluate("Director.script()"), model_dir)
    plan = page.evaluate("l => Director.start(l)", lengths)
    print(f"filming {info['code']} \"{info['title']}\": {plan['lines']} lines, {plan['total'] / 1000:.1f}s", flush=True)
    return browser, page, errors


# ---------------------------------------------------------------- text outputs
def write_script(tl):
    clock = base.clock
    parts = [f"# CrowdPulse code tour: narration script\n\n{clock(tl['total'])} in all. Voice: Kokoro `{base.VOICE}` at speed {base.VOICE_SPEED} "
             "(the explainer's voice). Written by `film/render_tour.py` from `film/tour/tour.js`. "
             "To replace a line with a real recording, save it as `film/vo/recorded/<id>.wav`.\n"]
    for ch in tl["chapters"]:
        parts.append(f"\n## {clock(ch['at'])} {ch['title']}\n\n**Code (left):** {ch['code']}\n\n**App (right):** {ch['app']}\n\n**Sound:** {ch['sound']}\n")
        parts += [f"\n`{clock(s['at'])}` `{s['id']}` {s['text']}\n" for s in tl["voiced"] if s["scene"] == ch["id"]]
    (base.OUT / "script.md").write_text("".join(parts), encoding="utf-8")


def write_storyboard(tl, boards, scale_note):
    clock, esc = base.clock, html.escape
    secs = []
    for ch in tl["chapters"]:
        figs = "".join(f"<figure><img loading=\"lazy\" alt=\"{esc(b['title'])}\" src=\"data:image/jpeg;base64,{b['image']}\"><figcaption>"
                       f"<time>{clock(b['at'])}</time><b>{esc(b['title'])}</b>{esc(b['why'])}</figcaption></figure>" for b in boards if b["scene"] == ch["id"] and "image" in b)
        said = "".join(f"<p><time>{clock(s['at'])}</time>{esc(s['text'])}</p>" for s in tl["voiced"] if s["scene"] == ch["id"])
        secs.append(f"<section id=\"{ch['id']}\"><h2><time>{clock(ch['at'])}</time>{esc(ch['title'])}</h2><dl>"
                    f"<dt>Code</dt><dd>{esc(ch['code'])}</dd><dt>App</dt><dd>{esc(ch['app'])}</dd>"
                    f"<dt>Sound</dt><dd>{esc(ch['sound'])}</dd></dl><div class=\"said\">{said}</div><div class=\"boards\">{figs}</div></section>")
    toc = "".join(f"<a href=\"#{c['id']}\"><time>{clock(c['at'])}</time>{esc(c['title'])}</a>" for c in tl["chapters"])
    css = base.BOARD_CSS.replace("minmax(min(340px, 100%), 1fr)", "minmax(min(520px, 100%), 1fr)")  # wider frames: the code has to be readable
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>CrowdPulse Code Tour Storyboard</title><style>{css}</style></head><body><main>"
            "<div class=\"eyebrow\">Code tour storyboard</div><h1>How the <span>CrowdPulse</span> code works</h1>"
            f"<p class=\"lede\">A {clock(tl['total'])} tour for someone who wants to understand the code: how it is laid out, and what runs on the app's main paths. "
            "The code is on the left, in a VS Code style editor showing the real source files; the app runs on the right. A line turns yellow when the app "
            f"actually makes that call or receives that broadcast. Every image is a real frame of the render ({scale_note}), and the narration is the script the "
            f"Kokoro <code>{base.VOICE}</code> voice reads. Scenes come from <code>film/tour/tour.js</code>.</p>"
            f"<div class=\"meta\"><span class=\"chip\">{clock(tl['total'])} runtime</span><span class=\"chip\">{len(tl['chapters'])} scenes</span>"
            f"<span class=\"chip\">{len(tl['voiced'])} lines</span><span class=\"chip\">2560×1440 master</span><span class=\"chip\">Voice: Kokoro {base.VOICE}</span></div>"
            f"<nav class=\"toc\">{toc}</nav>" + "".join(secs) + "</main></body></html>")
    path = base.OUT / "storyboard.html"
    path.write_text(page, encoding="utf-8")
    stills = base.CACHE / "boards"
    shutil.rmtree(stills, ignore_errors=True)
    stills.mkdir(parents=True)
    for i, b in enumerate(b for b in boards if "image" in b):
        (stills / f"{i:02}-{int(b['at'] / 1000):03}s.jpg").write_bytes(base64.b64decode(b["image"]))
    write_tour(tl)


def write_tour(tl):
    """The film's stops as a CodeTour (the VS Code extension vsls-contrib.codetour reads .tours/*.tour)."""
    seen, steps = set(), []
    for s in tl.get("steps", []):
        if (s["file"], s["line"]) not in seen:
            seen.add((s["file"], s["line"]))
            steps.append({"file": s["file"], "line": s["line"], "title": s["title"], "description": f"**{s['title']}**\n\n{s['description']}"})
    tour = {"$schema": "https://aka.ms/codetour-schema", "title": "CrowdPulse code tour", "description": "The stops from the code tour film (film/out/crowdpulse-code-tour.mp4)", "steps": steps}
    (base.OUT / "code.tour").write_text(json.dumps(tour, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


base.open_director, base.write_script, base.write_storyboard = open_director, write_script, write_storyboard

PUBLISH = {"storyboard.html": f"{NAME}-storyboard.html", "script.md": f"{NAME}-script.md", f"{NAME}.srt": f"{NAME}.srt", "thumbnail.jpg": f"{NAME}-thumbnail.jpg",
           f"{NAME}.mp4": f"{NAME}.mp4", f"{NAME}-preview.mp4": f"{NAME}-preview.mp4", f"{NAME}-1080p.mp4": f"{NAME}-1080p.mp4"}


def publish(started):
    """Copies what this run wrote to film/out (and the CodeTour to .tours/)."""
    FINAL.mkdir(parents=True, exist_ok=True)
    for src, dst in PUBLISH.items():
        f = base.OUT / src
        if f.exists() and f.stat().st_mtime >= started:
            shutil.copyfile(f, FINAL / dst)
            print("wrote", FINAL / dst, round(f.stat().st_size / 1e6, 1), "MB", flush=True)
    tour = base.OUT / "code.tour"
    if tour.exists() and tour.stat().st_mtime >= started:
        (ROOT / ".tours").mkdir(exist_ok=True)
        shutil.copyfile(tour, ROOT / ".tours" / f"{NAME}.tour")
        print("wrote", ROOT / ".tours" / f"{NAME}.tour", flush=True)


def shots(playwright, port, args, model_dir):
    """Runs the film to the given times and saves a still at each (film/.cache/tour/shot-<seconds>.jpg)."""
    browser, page, errors = open_director(playwright, port, args.scale, None, model_dir)
    wanted = sorted(args.shots)
    while wanted:
        state = page.evaluate("ms => Director.step(ms)", 1000 / 30)
        if state == "wait":
            time.sleep(0.03)
            continue
        now = page.evaluate("Director.clock()") / 1000
        if now >= wanted[0]:
            time.sleep(0.3)
            path = base.CACHE / f"shot-{wanted[0]:05.1f}.jpg"
            path.write_bytes(page.screenshot(type="jpeg", quality=82))
            print(f"{now:.1f}s scene={page.evaluate('Director.scene()')} -> {path}", flush=True)
            wanted.pop(0)
        if state == "done":
            break
    errors += page.evaluate("Director.errors()")
    browser.close()
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboard", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--shots", nargs="+", type=float, help="save stills at these times (seconds) instead of rendering")
    ap.add_argument("--scale", type=float, default=1.0, help="device scale for --shots")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--kokoro", default=str(base.DEFAULT_KOKORO))
    ap.add_argument("--share", action="store_true", help="also write a 1080p copy of the master")
    args = ap.parse_args()
    args.code = None
    model_dir = pathlib.Path(args.kokoro)
    if not (model_dir / "kokoro-v1.0.onnx").exists():
        raise SystemExit(f"Kokoro model files not found in {model_dir}")
    base.OUT.mkdir(parents=True, exist_ok=True)
    started = time.time() - 1
    server, port = start_server()
    try:
        with sync_playwright() as pw:
            if args.shots:
                errors = shots(pw, port, args, model_dir)
            elif args.storyboard:
                errors = base.storyboard_pass(pw, port, args, model_dir)
            else:
                errors = base.render_video(pw, port, args, model_dir)
    finally:
        server.shutdown()
    if not args.shots:
        publish(started)
    if errors:
        print("\n".join(["PAGE ERRORS:"] + errors[:30]), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
