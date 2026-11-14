// Local preview: serves public/ (edits show on reload) plus the vendored files, at http://localhost:3000.
// Talks to the Supabase project in public/js/config.js, or to another one with SUPABASE_URL and SUPABASE_KEY
// (for example a local `npx supabase start`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, VENDOR, MODEL, ensureModel, configOverride } from './vendor.mjs';

// --local: use the local Supabase stack (`npm run db:start`)
if (process.argv.includes('--local')) {
  const st = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  process.env.SUPABASE_URL = st.API_URL;
  process.env.SUPABASE_KEY = st.PUBLISHABLE_KEY || st.ANON_KEY;
}

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png' };
const config = configOverride();

function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  if (rel.split('/').includes('..')) return null;
  if (rel === 'js/config.js' && config) return { body: config, type: TYPES['.js'] };
  for (const [to, from] of Object.entries(VENDOR)) {
    if (rel === to) return { file: path.join(ROOT, from) };
    if (rel.startsWith(to + '/')) return { file: path.join(ROOT, from, rel.slice(to.length + 1)) };
  }
  return { file: path.join(ROOT, 'public', rel) };
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    let r = resolve(pathname);
    if (pathname === '/' + MODEL.path) r = { file: await ensureModel() };
    if (r?.file && fs.existsSync(r.file) && fs.statSync(r.file).isDirectory()) r.file = path.join(r.file, 'index.html');
    if (!r || (r.file && !fs.existsSync(r.file))) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': r.type || TYPES[path.extname(r.file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (r.body) res.end(r.body); else fs.createReadStream(r.file).pipe(res);
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('Error');
  }
}).listen(PORT, () => {
  console.log(`\n  ✨ CrowdPulse preview: http://localhost:${PORT}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL && config ? process.env.SUPABASE_URL : 'the project in public/js/config.js'}\n`);
});
