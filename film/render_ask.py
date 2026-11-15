"""Render the Ask CrowdPulse explainer: a storyboard and a narrated video of the question-answering tool in ask/.

The scenes and narration live in film/ask/ask-film.js. The set holds the real Ask CrowdPulse page in iframes on a
virtual clock, filmed one exact frame at a time. Nothing here calls Claude: the answers are recorded takes
(film/ask/takes, real runs saved by film/ask/record.mjs) and the prepared examples, and film/ask/server.mjs passes
them through the tool's real checks on every render. The voice, music bed, sound effects and mixing are shared
with the other films (film/render.py).

Uses the same virtualenv as the other films (playwright, imageio-ffmpeg, kokoro-onnx, soundfile, numpy):
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_ask.py --storyboard   storyboard, script, captions, YouTube text
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_ask.py --preview      quick 960x540 video
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_ask.py                1440p master (--share adds a 1080p copy)
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_ask.py --shots 42 97.5   stills at those seconds, for checking a scene
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render_ask.py --record --storyboard   record the takes again first (needs Claude Code)
Outputs go to film/out as crowdpulse-ask*.
"""
import argparse
import base64
import html
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render as base  # noqa: E402  the explainer's voice, sound and frame loop
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT, FILM = base.ROOT, base.FILM
NAME = "crowdpulse-ask"
FINAL = FILM / "out"
# the shared helpers write under these names; the finished files are copied to film/out at the end
base.NAME = NAME
base.CACHE = FILM / ".cache" / "ask"
base.OUT = base.CACHE / "out"
base.THUMBNAIL_BOARD = "Riding along with the answer"
# words the voice says better when spelled the way they sound (first match wins, so longer names come first)
base.SAY = {"npm run ask": "N P M run ask", "localhost": "local host", "codebase": "code base"}


def start_server():
    """Runs the film set (film/ask/server.mjs) on a spare port and waits until its data is ready."""
    port = base.free_port()
    proc = subprocess.Popen(["node", "film/ask/server.mjs"], cwd=str(ROOT), env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    problem = "it did not answer"
    for _ in range(150):
        if proc.poll() is not None:
            break
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/studio/data.json", timeout=30)
            return proc, port
        except urllib.error.HTTPError as e:  # the server is up but can't build the film's data: say why
            problem = e.read().decode(errors="replace")
            break
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("the film set did not start: " + (problem if proc.poll() is None or problem != "it did not answer" else proc.stderr.read().decode(errors="replace")))


def open_director(playwright, port, scale, code, model_dir):
    browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    context = browser.new_context(viewport={"width": base.LAYOUT[0], "height": base.LAYOUT[1]}, device_scale_factor=scale, color_scheme="dark")
    context.add_init_script(path=str(FILM / "studio" / "shim.js"))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and "favicon" not in r.url else None)
    page.goto(f"http://127.0.0.1:{port}/studio/ask-film.html")
    page.wait_for_function("!!(window.Director && window.__film)")
    info = page.evaluate("Director.prepare()")
    lengths = base.make_voice(page.evaluate("Director.script()"), model_dir)
    plan = page.evaluate("l => Director.start(l)", lengths)
    print(f"filming \"{info['title']}\": {plan['lines']} lines, {plan['total'] / 1000:.1f}s", flush=True)
    return browser, page, errors


# ---------------------------------------------------------------- text outputs
def write_script(tl):
    clock = base.clock
    parts = [f"# Ask CrowdPulse explainer: narration script\n\n{clock(tl['total'])} in all. Voice: Kokoro `{base.VOICE}` at speed {base.VOICE_SPEED} "
             "(the voice of the other CrowdPulse films). Written by `film/render_ask.py` from `film/ask/ask-film.js`. "
             "To replace a line with a real recording, save it as `film/vo/recorded/<id>.wav`.\n"]
    for ch in tl["chapters"]:
        parts.append(f"\n## {clock(ch['at'])} {ch['title']}\n\n**Shows:** {ch['feature']}\n\n**Camera:** {ch['camera']}\n\n**Sound:** {ch['sound']}\n")
        parts += [f"\n`{clock(s['at'])}` `{s['id']}` {s['text']}\n" for s in tl["voiced"] if s["scene"] == ch["id"]]
    (base.OUT / "script.md").write_text("".join(parts), encoding="utf-8")
    write_youtube(tl)


def write_youtube(tl):
    clock = base.clock
    chapters = "\n".join(f"{clock(c['at'])} {'Intro' if i == 0 else c['title']}" for i, c in enumerate(tl["chapters"]))
    text = f"""TITLE
Ask Your Codebase a Question, Then Watch the Answer | Ask CrowdPulse

ALTERNATIVE TITLES
Animated Answers About Your Code, Checked Against the Code | Ask CrowdPulse
What If Code Questions Were Answered With an Animation? (Claude Code + a Fixed Map)

DESCRIPTION
"{tl.get('question', '')}"

Ask CrowdPulse is a small local tool for questions like that. You ask in plain language, and it answers with a short text and an animation that plays on a map of the app's parts. Every step of the animation quotes a line of the real code, and the quote is looked up in the file before the step is shown.

In this film:
• Asking a question and watching the answer stream in (a recorded run, replayed at its real speed)
• Why the answers can be trusted: quotes are checked, steps between unconnected parts are dropped, invented quotes are flagged
• How it works: a fixed map, Claude Code running read-only in the repository, and one line of JSON per step
• One question answered for three audiences: developer, architect and product owner
• Prepared examples that double as tests, so the explanations can't quietly go stale

Every answer shown is a real one. The two "planted mistakes" are added on purpose and labelled on screen.

Chapters
{chapters}

Try it: npm run ask, then open http://localhost:3100 (see ask/README.md).
"""
    (base.OUT / "youtube.txt").write_text(text, encoding="utf-8")


def write_storyboard(tl, boards, scale_note):
    clock, esc = base.clock, html.escape
    secs = []
    for ch in tl["chapters"]:
        figs = "".join(f"<figure><img loading=\"lazy\" alt=\"{esc(b['title'])}\" src=\"data:image/jpeg;base64,{b['image']}\"><figcaption>"
                       f"<time>{clock(b['at'])}</time><b>{esc(b['title'])}</b>{esc(b['why'])}</figcaption></figure>" for b in boards if b["scene"] == ch["id"] and "image" in b)
        said = "".join(f"<p><time>{clock(s['at'])}</time>{esc(s['text'])}</p>" for s in tl["voiced"] if s["scene"] == ch["id"])
        secs.append(f"<section id=\"{ch['id']}\"><h2><time>{clock(ch['at'])}</time>{esc(ch['title'])}</h2><dl>"
                    f"<dt>Shows</dt><dd>{esc(ch['feature'])}</dd><dt>Camera</dt><dd>{esc(ch['camera'])}</dd>"
                    f"<dt>Sound</dt><dd>{esc(ch['sound'])}</dd></dl><div class=\"said\">{said}</div><div class=\"boards\">{figs}</div></section>")
    toc = "".join(f"<a href=\"#{c['id']}\"><time>{clock(c['at'])}</time>{esc(c['title'])}</a>" for c in tl["chapters"])
    css = base.BOARD_CSS.replace("minmax(min(340px, 100%), 1fr)", "minmax(min(480px, 100%), 1fr)")
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>Ask CrowdPulse Storyboard</title><style>{css}</style></head><body><main>"
            "<div class=\"eyebrow\">Explainer storyboard</div><h1><span>Ask CrowdPulse</span>: answers you can watch</h1>"
            f"<p class=\"lede\">A {clock(tl['total'])} film about the question-answering tool in <code>ask/</code>. The pages on screen are the real tool. "
            "The answers are real too: recorded runs of Claude Code, replayed at the speed they happened, and passed through the tool's checks again on every render. "
            f"Every image is a real frame of the render ({scale_note}), and the narration is the script the Kokoro <code>{base.VOICE}</code> voice reads. "
            "Scenes come from <code>film/ask/ask-film.js</code>; re-render with <code>film/render_ask.py</code>.</p>"
            f"<div class=\"meta\"><span class=\"chip\">{clock(tl['total'])} runtime</span><span class=\"chip\">{len(tl['chapters'])} scenes</span>"
            f"<span class=\"chip\">{len(tl['voiced'])} lines</span><span class=\"chip\">2560×1440 master</span><span class=\"chip\">Voice: Kokoro {base.VOICE}</span></div>"
            f"<nav class=\"toc\">{toc}</nav>" + "".join(secs) + "</main></body></html>")
    (base.OUT / "storyboard.html").write_text(page, encoding="utf-8")
    stills = base.CACHE / "boards"
    shutil.rmtree(stills, ignore_errors=True)
    stills.mkdir(parents=True)
    for i, b in enumerate(b for b in boards if "image" in b):
        (stills / f"{i:02}-{int(b['at'] / 1000):03}s.jpg").write_bytes(base64.b64decode(b["image"]))


base.open_director, base.write_script, base.write_storyboard = open_director, write_script, write_storyboard

PUBLISH = {"storyboard.html": f"{NAME}-storyboard.html", "script.md": f"{NAME}-script.md", "youtube.txt": f"{NAME}-youtube.txt", f"{NAME}.srt": f"{NAME}.srt",
           "thumbnail.jpg": f"{NAME}-thumbnail.jpg", f"{NAME}.mp4": f"{NAME}.mp4", f"{NAME}-preview.mp4": f"{NAME}-preview.mp4", f"{NAME}-1080p.mp4": f"{NAME}-1080p.mp4"}


def publish(started):
    """Copies what this run wrote to film/out."""
    FINAL.mkdir(parents=True, exist_ok=True)
    for src, dst in PUBLISH.items():
        f = base.OUT / src
        if f.exists() and f.stat().st_mtime >= started:
            shutil.copyfile(f, FINAL / dst)
            print("wrote", FINAL / dst, round(f.stat().st_size / 1e6, 1), "MB", flush=True)


def shots(playwright, port, args, model_dir):
    """Runs the film to the given times and saves a still at each (film/.cache/ask/shot-<seconds>.jpg)."""
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
    ap.add_argument("--record", action="store_true", help="record the takes again with Claude Code before rendering")
    args = ap.parse_args()
    args.code = None
    model_dir = pathlib.Path(args.kokoro)
    if not (model_dir / "kokoro-v1.0.onnx").exists():
        raise SystemExit(f"Kokoro model files not found in {model_dir}")
    if args.record:
        subprocess.run(["node", "film/ask/record.mjs", "--all"], cwd=str(ROOT), check=True)
    base.OUT.mkdir(parents=True, exist_ok=True)
    started = time.time() - 1
    proc, port = start_server()
    try:
        with sync_playwright() as pw:
            if args.shots:
                errors = shots(pw, port, args, model_dir)
            elif args.storyboard:
                errors = base.storyboard_pass(pw, port, args, model_dir)
            else:
                errors = base.render_video(pw, port, args, model_dir)
    finally:
        proc.terminate()
    if not args.shots:
        publish(started)
    if errors:
        print("\n".join(["PAGE ERRORS:"] + errors[:30]), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
