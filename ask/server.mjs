// Ask CrowdPulse: ask a question about this codebase, get a short answer and an animation of it.
//
//   npm run ask        ->  http://localhost:3100
//
// A question is answered from, in order: the hand-written examples (ask/examples), the cache (ask/.cache, keyed
// on the commit and the question), then Claude Code running headless in this repository with read-only tools.
// Whatever the source, every step is checked against the component map and the real files before it is sent.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadMap, checkStep, checkScene, cleanAnswer, lineParser, LIMITS } from './lib/scene.mjs';
import { systemPrompt, userPrompt, audiences } from './lib/prompt.mjs';
import { claudeCli } from './lib/claude.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const norm = q => String(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function loadExamples(dir = path.join(HERE, 'examples')) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    .map(f => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

export function createApp({ root = path.resolve(HERE, '..'), runner = claudeCli, cacheDir = path.join(HERE, '.cache'), examples = loadExamples() } = {}) {
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'nogit'; } })();
  const cacheFile = (q, audience) => path.join(cacheDir, `${commit}-${crypto.createHash('sha1').update(audience + '|' + norm(q)).digest('hex').slice(0, 16)}.json`);

  async function answer({ question, audience, fresh }, send, signal) {
    const t0 = Date.now();
    const map = loadMap(root); // re-read each time, so edits to the code or the map show up without a restart
    let n = 0, unverified = 0;
    const emitStep = step => { n++; if (!step.verified) unverified++; send({ type: 'step', n, ...step }); };
    const done = source => send({ type: 'done', source, ms: Date.now() - t0, steps: n, unverified });
    const replay = (scene, source) => {
      const r = checkScene(scene, map, root);
      send({ type: 'answer', text: r.answer, source });
      r.steps.forEach(emitStep);
      r.dropped.forEach(reason => send({ type: 'dropped', reason }));
      done(source);
    };

    const example = examples.find(e => norm(e.question) === norm(question));
    if (example && !fresh) return replay(example, 'example');
    const file = cacheFile(question, audience);
    if (!fresh && fs.existsSync(file)) return replay(JSON.parse(fs.readFileSync(file, 'utf8')), 'cache');

    // Live: steps are checked and sent as soon as each line arrives.
    const scene = { question, audience, answer: '', steps: [] };
    const parser = lineParser(o => {
      if (o.type === 'answer' && !scene.answer) {
        scene.answer = cleanAnswer(o.text);
        send({ type: 'answer', text: scene.answer, source: 'claude' });
      } else if (o.type === 'step' && n < LIMITS.maxSteps) {
        const r = checkStep(o, map, root);
        if (r.step) { scene.steps.push(o); emitStep(r.step); } else send({ type: 'dropped', reason: r.dropped });
      }
    });
    await runner({ system: systemPrompt(map, root), prompt: userPrompt(question, audience), root, cacheDir, onText: t => parser.feed(t), signal });
    parser.end();
    if (signal?.aborted) return;
    if (!scene.answer) throw new Error('Claude did not return an answer in the expected format. Try rephrasing the question.');
    if (scene.steps.length && !unverified) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(scene, null, 2)); }
    done('claude');
  }

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && pathname === '/api/map') {
        const map = loadMap(root);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ map, root: root.replace(/\\/g, '/'), commit, audiences,
          examples: examples.map(e => ({ id: e.id, question: e.question, audience: e.audience })) }));
      }
      if (req.method === 'POST' && pathname === '/api/ask') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 4000) break; }
        let p; try { p = JSON.parse(body); } catch { p = {}; }
        const question = String(p.question || '').trim().slice(0, 400);
        const audience = audiences.includes(p.audience) ? p.audience : 'developer';
        if (question.length < 3) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Ask a question first' })); }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const send = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        try { await answer({ question, audience, fresh: !!p.fresh }, send, ac.signal); }
        catch (e) { send({ type: 'error', message: e.message }); }
        return res.end();
      }
      if (req.method === 'GET') {
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
        const file = path.join(HERE, 'public', rel);
        if (!rel.includes('..') && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          return fs.createReadStream(file).pipe(res);
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ASK_PORT) || 3100;
  const app = createApp();
  // local only: this server runs Claude Code on your machine, so it must not be reachable from the network
  app.listen(port, '127.0.0.1', () => console.log(`\n  ✨ Ask CrowdPulse: http://localhost:${port}\n`));
}
