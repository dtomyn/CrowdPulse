"""Download the Kokoro voice model the films' narration uses, and check it against fixed SHA-256 hashes.

  python film/get_voice.py [folder]     default folder: film/models/kokoro (or KOKORO_DIR)
Files that are already there and match are left alone. `npm run film:setup` runs this for you.
Uses only the standard library, so it runs before the film's packages are installed.
"""
import hashlib
import os
import pathlib
import sys
import urllib.request

DEFAULT_DIR = pathlib.Path(__file__).resolve().parent / "models" / "kokoro"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {  # name -> (sha256, bytes)
    "kokoro-v1.0.onnx": ("7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5", 325532387),
    "voices-v1.0.bin": ("bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28214398),
}


def model_dir(given=None):
    """The folder the model is read from: the one given, else KOKORO_DIR, else film/models/kokoro."""
    return pathlib.Path(given or os.environ.get("KOKORO_DIR") or DEFAULT_DIR)


def missing(folder):
    """Names of the model files that aren't in the folder (by size; `ensure` checks the hashes)."""
    return [name for name, (_, size) in FILES.items() if not (folder / name).is_file() or (folder / name).stat().st_size != size]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for name, (want, size) in FILES.items():
        path = folder / name
        if path.is_file() and path.stat().st_size == size and sha256(path) == want:
            print("ok", path, flush=True)
            continue
        print(f"downloading {name} ({size / 1e6:.0f} MB)", flush=True)
        tmp = path.with_name(name + ".tmp")
        h, got = hashlib.sha256(), 0
        with urllib.request.urlopen(RELEASE + name, timeout=60) as res, open(tmp, "wb") as out:
            while chunk := res.read(1 << 20):
                got += len(chunk)
                if got > size:
                    break
                h.update(chunk)
                out.write(chunk)
        if got != size or h.hexdigest() != want:
            tmp.unlink(missing_ok=True)
            raise SystemExit(f"{name} did not match its expected size and SHA-256 (got {got} bytes, {h.hexdigest()})")
        tmp.replace(path)
        print("ok", path, flush=True)


if __name__ == "__main__":
    ensure(model_dir(sys.argv[1] if len(sys.argv) > 1 else None))
