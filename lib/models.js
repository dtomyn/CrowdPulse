// The face-analysis model used by attendee cameras and the room sensor.
//
// MediaPipe's code (vision_bundle.mjs + wasm) is an npm dependency, so npm's lockfile pins it by hash. The model file
// isn't on npm, so the server downloads it once from Google, checks it against the SHA-256 below, keeps it in
// data/models and serves it from here. Browsers only ever load code and data from this server, a changed or
// tampered file is refused, and once it's cached cameras keep working without internet.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODELS = {
  'face_landmarker.task': {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    maxBytes: 20 * 1024 * 1024,
  },
};

const pending = new Map(); // name -> Promise<file>
const verified = new Set(); // names already checked since start-up

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function download(m, file) {
  const res = await fetch(m.url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > m.maxBytes) throw new Error('download was larger than expected');
  const got = sha256(buf);
  if (got !== m.sha256) throw new Error(`file did not match its expected SHA-256 (got ${got})`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', buf);
  fs.renameSync(file + '.tmp', file);
  return file;
}

// Resolves to the path of a verified copy of the model, downloading it the first time.
function ensureModel(dataDir, name) {
  const m = Object.hasOwn(MODELS, name) ? MODELS[name] : null;
  if (!m) return Promise.reject(Object.assign(new Error('Unknown model'), { status: 404 }));
  const file = path.join(dataDir, 'models', name);
  if (verified.has(name) && fs.existsSync(file)) return Promise.resolve(file);
  if (fs.existsSync(file)) {
    if (sha256(fs.readFileSync(file)) === m.sha256) { verified.add(name); return Promise.resolve(file); }
    fs.rmSync(file, { force: true }); // changed on disk: fetch a fresh, verified copy
  }
  if (!pending.has(name)) {
    pending.set(name, download(m, file).then(f => { verified.add(name); return f; }).finally(() => pending.delete(name)));
  }
  return pending.get(name);
}

module.exports = { ensureModel, MODELS };
