"""Render the CrowdPulse explainer: a storyboard and a narrated video of the real app, filmed one exact frame at a time.

The scenes, camera moves and narration live in film/studio/director.js. The director page embeds the real app pages
(phone, host browser, projector) in iframes, runs them on a virtual clock, and feeds them a scripted audience, so every
frame is deterministic. The voice is Kokoro af_heart, the same voice and settings as C:/DevSource/IRISIdeas.

Requires the IRISIdeas virtualenv (playwright, imageio-ffmpeg, kokoro-onnx, soundfile, numpy) and its Kokoro model files:
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render.py --storyboard   storyboard, script and captions (a few minutes)
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render.py --preview      quick 960x540 video
  C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render.py                1440p master + 1080p copy + everything above
Options: --code E33JW2 picks the session whose report is shown. --kokoro DIR points at the voice model files.
Narration is cached per line in film/vo and only remade when a line changes. A real recording saved as
film/vo/recorded/<id>.wav (ids in script.md) replaces the synthetic line, and the picture retimes to fit it.
"""
import argparse
import base64
import hashlib
import html
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import imageio_ffmpeg
import numpy as np
import soundfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILM = ROOT / "film"
OUT = FILM / "out"
VO = FILM / "vo"
CACHE = FILM / ".cache"
NAME = "crowdpulse-explainer"
LAYOUT = (1600, 900)
SCALE_MASTER, SCALE_PREVIEW, SCALE_BOARD = 1.6, 0.6, 0.8  # 2560x1440, 960x540, 1280x720
VOICE, VOICE_SPEED, VOICE_RATE = "af_heart", 0.97, 24000  # same as IRISIdeas scripts/render_explainer.py
DEFAULT_KOKORO = pathlib.Path("C:/DevSource/IRISIdeas/.venv/kokoro")
RATE = 48000
THUMBNAIL_BOARD = "Reaction storm"
# words the voice says better when spelled the way they sound
SAY = {"npm start": "N P M start", "Q and A": "Q and A", "CSV": "C S V", "JSON": "Jason", "PDF": "P D F"}
CAPTION_MAX = 84


# ---------------------------------------------------------------- voice
def make_voice(lines, model_dir):
    VO.mkdir(parents=True, exist_ok=True)
    (VO / "recorded").mkdir(exist_ok=True)
    book = VO / "made.json"
    made = json.loads(book.read_text(encoding="utf-8")) if book.exists() else {}
    engine = None
    lengths = {}
    for line in lines:
        path = VO / "recorded" / f"{line['id']}.wav"
        if not path.exists():
            path = VO / f"{line['id']}.wav"
            spoken = line["text"]
            for k, v in SAY.items():
                spoken = spoken.replace(k, v)
            key = hashlib.sha1(f"{VOICE}|{VOICE_SPEED}|{spoken}".encode()).hexdigest()
            if made.get(line["id"]) != key or not path.exists():
                if engine is None:
                    from kokoro_onnx import Kokoro
                    engine = Kokoro(str(model_dir / "kokoro-v1.0.onnx"), str(model_dir / "voices-v1.0.bin"))
                audio, rate = engine.create(spoken, voice=VOICE, speed=VOICE_SPEED, lang="en-us")
                soundfile.write(str(path), audio, rate)
                made[line["id"]] = key
                book.write_text(json.dumps(made, indent=1), encoding="utf-8")
                print("voice", line["id"], flush=True)
        line["path"] = str(path)
        lengths[line["id"]] = round(soundfile.info(str(path)).duration * 1000)
    return lengths


# ---------------------------------------------------------------- server
def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server():
    """Runs the app on a spare port against a copy of the data, with the film studio enabled."""
    data = CACHE / "data"
    data.mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "data" / "db.json", data / "db.json")
    port = free_port()
    env = {**os.environ, "PORT": str(port), "CROWDPULSE_STUDIO": "1", "CROWDPULSE_DATA_DIR": str(data), "PUBLIC_URL": "http://192.168.1.20:3000"}
    env.pop("ADMIN_PIN", None)
    proc = subprocess.Popen(["node", "server.js"], cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/config", timeout=1)
            return proc, port
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("the app server did not start: " + proc.stderr.read().decode(errors="replace"))


def open_director(playwright, port, scale, code, model_dir):
    browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    context = browser.new_context(viewport={"width": LAYOUT[0], "height": LAYOUT[1]}, device_scale_factor=scale)
    context.add_init_script(path=str(FILM / "studio" / "shim.js"))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and "favicon" not in r.url else None)
    page.goto(f"http://127.0.0.1:{port}/studio/director.html")
    page.wait_for_function("window.Director && window.__server")
    info = page.evaluate("o => Director.prepare(o)", {"code": code})
    lengths = make_voice(page.evaluate("Director.script()"), model_dir)
    plan = page.evaluate("l => Director.start(l)", lengths)
    print(f"filming {info['code']} \"{info['title']}\": {plan['lines']} lines, {plan['total'] / 1000:.1f}s", flush=True)
    return browser, page, errors


def run(page, fps, on_frame, on_board, pace=0.0):
    ms = 1000 / fps
    frame = 0
    while True:
        state = page.evaluate("ms => Director.step(ms)", ms)
        if state == "wait":
            waits = locals().get("waits", 0) + 1
            if waits % 100 == 0:
                print("waiting at", page.evaluate("Director.clock()"), page.evaluate("Director.scene()"), page.evaluate("Director.errors()")[-2:], flush=True)
            time.sleep(0.03)
            continue
        waits = 0
        board = page.evaluate("Director.takeBoard()")
        if board:
            on_board(board)
        if on_frame:
            on_frame(frame)
        elif pace:
            time.sleep(pace)
        frame += 1
        if frame % 150 == 0:
            print(f"frame {frame} ({frame / fps:.0f}s), scene {page.evaluate('Director.scene()')}", flush=True)
        if state == "done":
            return frame


# ---------------------------------------------------------------- text outputs
def clock(ms):
    s = int(ms // 1000)
    return f"{s // 60}:{s % 60:02}"


def stamp(ms, sep=","):
    t = int(ms)
    return f"{t // 3600000:02}:{t // 60000 % 60:02}:{t // 1000 % 60:02}{sep}{t % 1000:03}"


def caption_parts(text):
    parts = []
    for sentence in re.split(r"(?<=[.?!:])\s+", text):
        cur = ""
        for piece in re.split(r"(?<=,)\s+", sentence):
            if cur and len(cur) + len(piece) + 1 > CAPTION_MAX:
                parts.append(cur)
                cur = piece
            else:
                cur = f"{cur} {piece}".strip()
        parts.append(cur)
    return [p for p in parts if p]


def write_captions(tl):
    lines, n = [], 0
    for said in tl["voiced"]:
        parts = caption_parts(said["text"])
        total = sum(map(len, parts)) or 1
        at = said["at"]
        for part in parts:
            end = at + (said["end"] - said["at"]) * len(part) / total
            n += 1
            lines += [str(n), f"{stamp(at)} --> {stamp(end)}", part, ""]
            at = end
    (OUT / f"{NAME}.srt").write_text("\n".join(lines), encoding="utf-8")


def write_script(tl):
    parts = [f"# CrowdPulse explainer: narration script\n\n{clock(tl['total'])} in all. Voice: Kokoro `{VOICE}` at speed {VOICE_SPEED} "
             f"(the IRISIdeas explainer voice). Written by `film/render.py` from `film/studio/director.js`. "
             "To replace a line with a real recording, save it as `film/vo/recorded/<id>.wav`.\n"]
    for ch in tl["chapters"]:
        parts.append(f"\n## {clock(ch['at'])} {ch['title']}\n\n**Shows:** {ch['feature']}\n\n**Camera:** {ch['camera']}\n\n**Sound:** {ch['sound']}\n")
        parts += [f"\n`{clock(s['at'])}` `{s['id']}` {s['text']}\n" for s in tl["voiced"] if s["scene"] == ch["id"]]
    (OUT / "script.md").write_text("".join(parts), encoding="utf-8")


BOARD_CSS = """
:root { --bg:#f4f3fb; --panel:#fff; --ink:#151229; --muted:#5d5880; --line:#e1def0; --accent:#7c5cff; --accent2:#e0428f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#07051a; --panel:#110d2c; --ink:#f3f1ff; --muted:#a7a3c9; --line:#2a2550; --accent:#9d85ff; --accent2:#ff5ca8; } }
:root[data-theme="dark"] { --bg:#07051a; --panel:#110d2c; --ink:#f3f1ff; --muted:#a7a3c9; --line:#2a2550; --accent:#9d85ff; --accent2:#ff5ca8; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.55 Inter, "Segoe UI", system-ui, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 36px 16px 80px; }
.eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 700; color: var(--muted); }
h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.1; margin: 8px 0 10px; letter-spacing: -.02em; }
h1 span { background: linear-gradient(120deg, var(--accent), var(--accent2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lede { color: var(--muted); max-width: 72ch; margin: 0 0 18px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.chip { font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 18px 0 8px; }
nav.toc a { font-size: 13px; text-decoration: none; color: var(--ink); padding: 5px 10px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
nav.toc a time { color: var(--accent); margin-right: 6px; font-variant-numeric: tabular-nums; }
section { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 20px; }
h2 { font-size: 22px; margin: 0 0 4px; }
h2 time { color: var(--accent); font-variant-numeric: tabular-nums; margin-right: 10px; }
dl { display: grid; grid-template-columns: 80px 1fr; gap: 4px 12px; margin: 10px 0 16px; }
dt { color: var(--muted); font-size: 13px; } dd { margin: 0; }
.said { margin: 0 0 18px; padding-left: 14px; border-left: 3px solid var(--accent2); }
.said p { margin: 0 0 6px; } .said time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; margin-right: 8px; }
.boards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 14px; }
figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
figure img { display: block; width: 100%; height: auto; }
figcaption { padding: 10px 12px 12px; font-size: 14px; }
figcaption b { display: block; font-weight: 600; } figcaption time { color: var(--accent); font-variant-numeric: tabular-nums; font-size: 13px; }
"""


def write_storyboard(tl, boards, scale_note):
    secs = []
    for ch in tl["chapters"]:
        figs = "".join(f"<figure><img loading=\"lazy\" alt=\"{html.escape(b['title'])}\" src=\"data:image/jpeg;base64,{b['image']}\"><figcaption>"
                       f"<time>{clock(b['at'])}</time><b>{html.escape(b['title'])}</b>{html.escape(b['why'])}</figcaption></figure>"
                       for b in boards if b["scene"] == ch["id"])
        said = "".join(f"<p><time>{clock(s['at'])}</time>{html.escape(s['text'])}</p>" for s in tl["voiced"] if s["scene"] == ch["id"])
        secs.append(f"<section id=\"{ch['id']}\"><h2><time>{clock(ch['at'])}</time>{html.escape(ch['title'])}</h2><dl>"
                    f"<dt>Shows</dt><dd>{html.escape(ch['feature'])}</dd><dt>Camera</dt><dd>{html.escape(ch['camera'])}</dd>"
                    f"<dt>Sound</dt><dd>{html.escape(ch['sound'])}</dd></dl><div class=\"said\">{said}</div><div class=\"boards\">{figs}</div></section>")
    toc = "".join(f"<a href=\"#{c['id']}\"><time>{clock(c['at'])}</time>{html.escape(c['title'])}</a>" for c in tl["chapters"])
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>CrowdPulse Storyboard</title><style>{BOARD_CSS}</style></head><body><main>"
            "<div class=\"eyebrow\">Explainer storyboard</div><h1>How to use <span>CrowdPulse</span></h1>"
            f"<p class=\"lede\">A {clock(tl['total'])} walkthrough, from creating a session to the report. Every image is a real frame of the render "
            f"({scale_note}), and the narration is the script the Kokoro <code>{VOICE}</code> voice reads. Scenes and camera moves come from "
            "<code>film/studio/director.js</code>.</p>"
            f"<div class=\"meta\"><span class=\"chip\">{clock(tl['total'])} runtime</span><span class=\"chip\">{len(tl['chapters'])} scenes</span>"
            f"<span class=\"chip\">{len(tl['voiced'])} lines</span><span class=\"chip\">2560×1440 master</span><span class=\"chip\">Voice: Kokoro {VOICE}</span></div>"
            f"<nav class=\"toc\">{toc}</nav>" + "".join(secs) + "</main></body></html>")
    path = OUT / "storyboard.html"
    path.write_text(page, encoding="utf-8")
    print("wrote", path, round(path.stat().st_size / 1e6, 1), "MB", flush=True)


# ---------------------------------------------------------------- sound
def env_adsr(n, a, r, rate=RATE):
    e = np.ones(n, dtype=np.float32)
    na, nr = min(n, int(a * rate)), min(n, int(r * rate))
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


def note_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(track, start, sig):
    """Adds sig into track at start, clipped to the track's bounds."""
    if start >= len(track) or start + len(sig) <= 0:
        return
    if start < 0:
        sig, start = sig[-start:], 0
    end = min(len(track), start + len(sig))
    track[start:end] += sig[:end - start]


def make_music(seconds):
    """A warm, unobtrusive bed: pads, a soft arpeggio, sub bass and a light pulse that enters after the intro."""
    n = int(seconds * RATE) + RATE
    L = np.zeros(n, np.float32)
    R = np.zeros(n, np.float32)
    bpm = 96
    beat = 60 / bpm
    bar = beat * 4
    chords = [[48, 55, 59, 62, 64], [45, 52, 55, 59, 64], [41, 48, 52, 55, 60], [43, 50, 55, 59, 62]]  # Cmaj9 Am9 Fmaj9 G6
    rng = np.random.default_rng(7)
    t_chord = bar * 2
    k = 0
    while k * t_chord < seconds:
        notes = chords[k % 4] if k * t_chord < seconds - t_chord else [48, 55, 60, 64, 67]
        start = int(k * t_chord * RATE)
        length = int((t_chord + 1.2) * RATE)
        t = np.arange(length) / RATE
        pad = np.zeros(length, np.float32)
        for m in notes[1:]:
            f = note_hz(m + 12)
            for det in (-0.12, 0.0, 0.11):
                ph = rng.uniform(0, 6.28)
                for h in range(1, 7):
                    pad += (np.sin(2 * np.pi * f * (1 + det / 100) * h * t + ph * h) / h ** 1.8).astype(np.float32)
        pad *= env_adsr(length, 1.1, 1.3) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.18 * t)) * 0.010
        add(L, start, pad)
        add(R, start, np.roll(pad, 240))
        # sub bass on beats 1 and 3
        for b in range(0, 8, 2):
            s0 = start + int(b * beat * RATE)
            ln = int(beat * 1.8 * RATE)
            tb = np.arange(ln) / RATE
            bass = np.sin(2 * np.pi * note_hz(notes[0] - 12) * tb) * np.exp(-tb * 1.6) * env_adsr(ln, 0.02, 0.2) * 0.08
            add(L, s0, bass)
            add(R, s0, bass)
        # arpeggio, 8th notes, after the intro
        if k * t_chord > 6:
            pattern = [notes[1], notes[2], notes[3], notes[4], notes[3] + 12, notes[4], notes[2] + 12, notes[3]]
            for i in range(16):
                s0 = start + int(i * beat / 2 * RATE)
                ln = int(0.5 * RATE)
                ta = np.arange(ln) / RATE
                f = note_hz(pattern[i % 8] + 12)
                pl = (np.sin(2 * np.pi * f * ta) + 0.3 * np.sin(4 * np.pi * f * ta)) * np.exp(-ta * 7) * 0.022
                pan = 0.5 + 0.35 * np.sin(i * 0.8)
                add(L, s0, pl * (1 - pan))
                add(R, s0, pl * pan)
        k += 1
    # pulse: soft kick on every beat, hat on the off-beat, from 8s until 6s before the end
    kl = int(0.28 * RATE)
    tk = np.arange(kl) / RATE
    kick = np.sin(2 * np.pi * (45 * tk + 60 * (1 - np.exp(-tk * 28)) / 28)) * np.exp(-tk * 11) * 0.11
    hl = int(0.05 * RATE)
    hat = rng.normal(0, 1, hl) * np.exp(-np.arange(hl) / RATE * 90) * 0.012
    hat = np.diff(np.concatenate([[0], hat])).astype(np.float32)
    b = 0
    while b * beat < seconds - 6:
        tb = b * beat
        if tb > 8:
            s0 = int(tb * RATE)
            add(L, s0, kick)
            add(R, s0, kick)
            s1 = int((tb + beat / 2) * RATE)
            add(L, s1, hat * 0.8)
            add(R, s1, hat)
        b += 1
    out = np.stack([L, R], axis=1)[:int(seconds * RATE)]
    fade_in, fade_out = int(2.5 * RATE), int(4 * RATE)
    out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    return out


def make_sfx(cues, seconds):
    rng = np.random.default_rng(3)
    n = int(seconds * RATE) + RATE
    track = np.zeros(n, np.float32)

    def tone(f0, f1, dur, decay, amp):
        t = np.arange(int(dur * RATE)) / RATE
        f = f0 + (f1 - f0) * t / dur
        return (np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * decay) * amp).astype(np.float32)

    def noise(dur, decay, amp):
        t = np.arange(int(dur * RATE)) / RATE
        return (rng.normal(0, 1, len(t)) * np.exp(-t * decay) * amp).astype(np.float32)

    sounds = {
        "click": lambda: tone(2400, 1800, 0.03, 160, 0.16) + noise(0.03, 260, 0.05),
        "key": lambda: tone(1700, 1500, 0.02, 220, 0.06) + noise(0.02, 300, 0.03),
        "pop": lambda: tone(500, 1300, 0.12, 30, 0.14),
        "chime": lambda: sum(tone(f, f, 1.6, 2.6, a) for f, a in ((1046.5, .07), (1568, .05), (2093, .035), (2637, .02))),
    }

    def whoosh():
        dur = 0.9
        x = rng.normal(0, 1, int(dur * RATE)).astype(np.float32)
        t = np.arange(len(x)) / dur / RATE
        alpha = 0.02 + 0.25 * np.sin(np.pi * t) ** 2
        y = np.zeros_like(x)
        acc = 0.0
        for i in range(len(x)):
            acc += alpha[i] * (x[i] - acc)
            y[i] = acc
        return y * np.sin(np.pi * t) ** 2 * 0.22

    sounds["whoosh"] = whoosh
    cache = {}
    for c in cues:
        name = c["name"]
        if name not in sounds:
            continue
        if name not in cache:
            cache[name] = sounds[name]()
        s = cache[name] * float(c.get("gain", 1))
        add(track, int(c["t"] / 1000 * RATE), s)
    return track[:int(seconds * RATE)]


def write_narration(tl, path):
    track = np.zeros(int(tl["total"] / 1000 * VOICE_RATE) + VOICE_RATE, np.float32)
    for said in tl["voiced"]:
        rec = VO / "recorded" / f"{said['id']}.wav"
        audio, rate = soundfile.read(str(rec if rec.exists() else VO / f"{said['id']}.wav"), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != VOICE_RATE:
            audio = np.interp(np.arange(int(len(audio) * VOICE_RATE / rate)) * rate / VOICE_RATE, np.arange(len(audio)), audio).astype(np.float32)
        add(track, int(said["at"] / 1000 * VOICE_RATE), audio)
    soundfile.write(str(path), track, VOICE_RATE)


def mix(ffmpeg, video, tl, final):
    seconds = tl["total"] / 1000
    narration, music, fx = CACHE / "narration.wav", CACHE / "music.wav", CACHE / "sfx.wav"
    write_narration(tl, narration)
    soundfile.write(str(music), make_music(seconds), RATE)
    soundfile.write(str(fx), make_sfx(tl["cues"], seconds), RATE)
    graph = ("[1:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=160:makeup=1.6,asplit[voice][key];"
             "[2:a]volume=0.9[m];[m][key]sidechaincompress=threshold=0.02:ratio=7:attack=25:release=650[bed];"
             "[3:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.8[fx];"
             "[bed][voice][fx]amix=inputs=3:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11:linear=false,aresample=48000[out]")
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(video), "-i", str(narration), "-i", str(music), "-i", str(fx), "-filter_complex", graph,
                    "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", str(final)], check=True)


# ---------------------------------------------------------------- passes
def storyboard_pass(playwright, port, args, model_dir):
    browser, page, errors = open_director(playwright, port, SCALE_BOARD, args.code, model_dir)
    boards = []

    def on_board(b):
        time.sleep(0.25)  # let charts that start from real-time observers draw
        b["image"] = base64.b64encode(page.screenshot(type="jpeg", quality=74)).decode()
        boards.append(b)
        print("board", clock(b["at"]), b["title"], flush=True)

    run(page, args.fps, None, on_board, pace=0.004)
    tl = page.evaluate("Director.timeline()")
    errors += page.evaluate("Director.errors()")
    browser.close()
    write_storyboard(tl, boards, "1280×720 storyboard pass")
    write_captions(tl)
    write_script(tl)
    (OUT / "timeline.json").write_text(json.dumps(tl, indent=1), encoding="utf-8")
    print("storyboard", len(boards), "frames,", clock(tl["total"]), "errors:", errors or "none", flush=True)
    return errors


def render_video(playwright, port, args, model_dir):
    preview = args.preview
    scale = SCALE_PREVIEW if preview else SCALE_MASTER
    fps = 24 if preview else args.fps
    browser, page, errors = open_director(playwright, port, scale, args.code, model_dir)
    suffix = "-preview" if preview else ""
    silent = CACHE / f"{NAME}{suffix}-silent.mp4"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    enc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-r", str(fps), "-i", "-",
                            "-vf", "scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv,format=yuv420p",
                            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                            "-c:v", "libx264", "-preset", "veryfast" if preview else "medium", "-crf", "26" if preview else "17",
                            "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
    boards = []
    last = {"shot": None}
    started = time.time()

    def on_frame(i):
        shot = page.screenshot(type="jpeg", quality=70 if preview else 93)
        last["shot"] = shot
        enc.stdin.write(shot)

    def on_board(b):
        boards.append(b)

    def frame_with_board(i):
        on_frame(i)
        if boards and "image" not in boards[-1]:
            b = boards[-1]
            b["image"] = base64.b64encode(downscale(ffmpeg, last["shot"])).decode()
            if b["title"] == THUMBNAIL_BOARD and not preview:
                (OUT / "thumbnail.jpg").write_bytes(last["shot"])

    frames = run(page, fps, frame_with_board, on_board)
    enc.stdin.close()
    enc.wait()
    tl = page.evaluate("Director.timeline()")
    errors += page.evaluate("Director.errors()")
    browser.close()
    print(f"frames {frames} in {time.time() - started:.0f}s, errors: {errors or 'none'}", flush=True)
    (CACHE / f"timeline{suffix}.json").write_text(json.dumps(tl), encoding="utf-8")
    write_storyboard(tl, boards, "960×540 preview" if preview else "from the 1440p master, shown at 1280×720")
    write_captions(tl)
    write_script(tl)
    finish(ffmpeg, silent, tl, preview)
    return errors


def finish(ffmpeg, silent, tl, preview):
    """Adds the sound to the silent picture, and makes the 1080p copy of a master."""
    suffix = "-preview" if preview else ""
    final = OUT / f"{NAME}{suffix}.mp4"
    mix(ffmpeg, silent, tl, final)
    print("wrote", final, round(final.stat().st_size / 1e6, 1), "MB", flush=True)
    if not preview:
        share = OUT / f"{NAME}-1080p.mp4"
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(final), "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "medium",
                        "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(share)], check=True)
        print("wrote", share, round(share.stat().st_size / 1e6, 1), "MB", flush=True)


def downscale(ffmpeg, jpeg):
    p = subprocess.run([ffmpeg, "-loglevel", "error", "-f", "mjpeg", "-i", "-", "-vf", "scale=1280:-2", "-q:v", "5", "-f", "mjpeg", "-"], input=jpeg, capture_output=True, check=True)
    return p.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storyboard", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--code", default="E33JW2")
    ap.add_argument("--kokoro", default=str(DEFAULT_KOKORO))
    ap.add_argument("--remix", action="store_true", help="rebuild only the sound on the last render's silent picture")
    args = ap.parse_args()
    if args.remix:
        suffix = "-preview" if args.preview else ""
        silent, saved = CACHE / f"{NAME}{suffix}-silent.mp4", CACHE / f"timeline{suffix}.json"
        if not saved.exists():
            saved = OUT / "timeline.json"  # the storyboard pass writes the same timeline
        if not silent.exists() or not saved.exists():
            raise SystemExit("nothing to remix: render the video first")
        finish(imageio_ffmpeg.get_ffmpeg_exe(), silent, json.loads(saved.read_text(encoding="utf-8")), args.preview)
        return
    model_dir = pathlib.Path(args.kokoro)
    if not (model_dir / "kokoro-v1.0.onnx").exists():
        raise SystemExit(f"Kokoro model files not found in {model_dir}")
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    proc, port = start_server()
    try:
        with sync_playwright() as pw:
            errors = storyboard_pass(pw, port, args, model_dir) if args.storyboard else render_video(pw, port, args, model_dir)
    finally:
        proc.terminate()
    if errors:
        print("\n".join(["PAGE ERRORS:"] + errors[:30]), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
