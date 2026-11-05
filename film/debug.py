"""Debug helper for the explainer: runs the film to given times and saves a frame (and optional JS results) at each.

  python film/debug.py 40 47.5 60 --js "doc('full').querySelector('#lobby').innerHTML.slice(0,300)"
Frames are written to film/.cache/debug-<seconds>.jpg. In --js, the director's helpers aren't in scope; use
document.querySelector('#f-full').contentDocument and so on, or window.__server for the fake server.
"""
import argparse
import sys
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import render  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("times", nargs="+", type=float)
    ap.add_argument("--js", action="append", default=[])
    ap.add_argument("--scale", type=float, default=0.6)
    args = ap.parse_args()
    render.CACHE.mkdir(parents=True, exist_ok=True)
    proc, port = render.start_server()
    try:
        with sync_playwright() as pw:
            browser, page, errors = render.open_director(pw, port, args.scale, "DSN26F", render.DEFAULT_KOKORO)
            wanted = sorted(args.times)
            started = time.time()
            while wanted:
                state = page.evaluate("ms => Director.step(ms)", 1000 / 30)
                if state == "wait":
                    time.sleep(0.03)
                    continue
                now = page.evaluate("Director.clock()") / 1000
                if now >= wanted[0]:
                    time.sleep(0.3)
                    path = render.CACHE / f"debug-{wanted[0]:05.1f}.jpg"
                    path.write_bytes(page.screenshot(type="jpeg", quality=80))
                    print(f"{now:.1f}s scene={page.evaluate('Director.scene()')} -> {path}", flush=True)
                    for js in args.js:
                        try:
                            print("  js:", page.evaluate(f"() => {{ const f = n => document.querySelector('#f-' + n); const doc = n => f(n).contentDocument; return {js}; }}"), flush=True)
                        except Exception as e:  # noqa: BLE001
                            print("  js error:", e, flush=True)
                    wanted.pop(0)
                if state == "done":
                    break
            print(f"done in {time.time() - started:.0f}s; errors:", errors + page.evaluate("Director.errors()"), flush=True)
            browser.close()
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
