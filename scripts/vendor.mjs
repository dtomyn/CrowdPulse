// What the site needs besides public/: browser libraries from npm and the face-analysis model.
// Shared by the build (scripts/build.mjs) and the dev server (scripts/dev.mjs).
//
// The libraries come from node_modules, so npm's lockfile pins them by hash. The model isn't on npm: it's
// downloaded once from Google, checked against the SHA-256 below and cached in data/models.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');

// published path -> file or folder in node_modules
export const VENDOR = {
  'vendor/supabase/supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'vendor/qrcode/qrcode.js': 'node_modules/qrcode-generator/dist/qrcode.js',
  'vendor/chart.js/chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
  'vendor/mediapipe/vision_bundle.mjs': 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',
  'vendor/mediapipe/wasm': 'node_modules/@mediapipe/tasks-vision/wasm',
};

export const MODEL = {
  path: 'vendor/models/face_landmarker.task',
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  maxBytes: 20 * 1024 * 1024,
};

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Path to a verified copy of the model, downloading it the first time.
export async function ensureModel() {
  const file = path.join(ROOT, 'data', 'models', path.basename(MODEL.path));
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === MODEL.sha256) return file;
  const res = await fetch(MODEL.url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`model download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MODEL.maxBytes) throw new Error('model download was larger than expected');
  const got = sha256(buf);
  if (got !== MODEL.sha256) throw new Error(`model did not match its expected SHA-256 (got ${got})`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', buf);
  fs.renameSync(file + '.tmp', file);
  return file;
}

// js/config.js pointed at another Supabase project, when SUPABASE_URL and SUPABASE_KEY are set
export function configOverride() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return `// Generated from SUPABASE_URL / SUPABASE_KEY\nwindow.CP_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseKey: key }, null, 2)};\n`;
}
