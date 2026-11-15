// The film set's server for the Ask CrowdPulse explainer (started by film/render_ask.py).
//
// It serves the real Ask CrowdPulse app (ask/server.mjs) with Claude switched off, the film's own files under
// /studio/, the app's source under /src/ (for the film's code panel), and /studio/data.json: everything the
// director replays. Recorded answers (film/ask/takes) go through the real checks (ask/lib/scene.mjs) here, at
// render time, so what the film shows as verified, unverified or dropped is what the tool would really show.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp, loadExamples } from '../../ask/server.mjs';
import { loadMap, checkStep, checkScene, citableFile } from '../../ask/lib/scene.mjs';
import { systemPrompt, outline, audiences } from '../../ask/lib/prompt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

// Two deliberate mistakes, added to the developer take for the "what if the model is wrong" scene.
const PLANTED = [
  { after: 2, step: { from: 'event', to: 'tables', payload: 'rating', caption: 'The phone writes the rating straight into the ratings table.',
    cite: { file: 'public/js/event.js', line: 112, quote: "socket.emit('rate', { v: pending, mode })" } } },
  { after: 4, step: { at: 'api', caption: 'The database emails the presenter every time the average changes.',
    cite: { file: 'supabase/migrations/20261113000000_crowdpulse.sql', line: 640, quote: 'perform public.cp_email_presenter(e.code, avg_);' } } },
];

function checked(map, steps, times) {
  const events = []; let n = 0, unverified = 0;
  steps.forEach((raw, i) => {
    const r = checkStep(raw, map, ROOT), t = times[i]; // t: when the line arrived (a step's own `at` is a component id)
    if (r.step) { n++; if (!r.step.verified) unverified++; events.push({ type: 'step', n, ...r.step, t, raw }); }
    else events.push({ type: 'dropped', reason: r.dropped, t, raw });
  });
  return { events, n, unverified };
}

function testRun() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'ask/test/'], { cwd: ROOT, encoding: 'utf8' });
  const lines = (r.stdout || '').split(/\r?\n/).filter(l => /^\s*[✔✖▶]/.test(l) && !/^✔/.test(l)).map(l => l.replace(/\s+\(\d+(\.\d+)?ms\)$/, ''));
  const num = k => Number((r.stdout.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1] || 0);
  return { lines, tests: num('tests'), pass: num('pass'), fail: num('fail') };
}

function data() {
  const map = loadMap(ROOT);
  if (map.problems.length) throw new Error('the component map has stale anchors: ' + map.problems.join('; '));
  const takes = {};
  for (const a of audiences) {
    const file = path.join(HERE, 'takes', a + '.json');
    if (!fs.existsSync(file)) throw new Error(`no recorded take for "${a}": run node film/ask/record.mjs`);
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = checked(map, t.steps, t.stepAt);
    takes[a] = { question: t.question, audience: a, recordedAt: t.recordedAt, commit: t.commit, model: t.model, firstStepMs: t.stepAt[0], doneMs: t.doneAt,
      events: [{ type: 'answer', text: t.answer, source: 'claude', t: t.answerAt }, ...c.events, { type: 'done', source: 'claude', ms: t.doneAt, steps: c.n, unverified: c.unverified, t: t.doneAt }] };
  }
  // the planted answer: the developer take with two bad steps added, 0.9 s apart so each verdict can be seen
  const dev = JSON.parse(fs.readFileSync(path.join(HERE, 'takes', 'developer.json'), 'utf8'));
  const steps = dev.steps.slice(0, 6);
  [...PLANTED].reverse().forEach(p => steps.splice(Math.min(p.after, steps.length), 0, { ...p.step, planted: true }));
  const pc = checked(map, steps, steps.map((_, i) => 900 + i * 900));
  const end = 900 + steps.length * 900;
  const planted = { question: dev.question, audience: 'developer',
    events: [{ type: 'answer', text: dev.answer, source: 'claude', t: 300 }, ...pc.events, { type: 'done', source: 'Answer with two planted mistakes', ms: end, steps: pc.n, unverified: pc.unverified, t: end }] };
  const examples = loadExamples().map(e => {
    const r = checkScene(e, map, ROOT);
    return { id: e.id, question: e.question, audience: e.audience,
      events: [{ type: 'answer', text: r.answer, source: 'example', t: 0 }, ...r.steps.map((s, i) => ({ type: 'step', n: i + 1, ...s, t: 0 })), { type: 'done', source: 'example', ms: 0, steps: r.steps.length, unverified: r.steps.filter(s => !s.verified).length, t: 0 }] };
  });
  const sys = systemPrompt(map, ROOT), out = outline(ROOT);
  return { root: ROOT.replace(/\\/g, '/'), map, takes, planted, examples, tests: testRun(),
    counts: { nodes: map.nodes.length, edges: map.edges.length, anchors: map.nodes.length + map.edges.length, files: (out.match(/^## /gm) || []).length },
    prompt: { chars: sys.length, outlineLines: out.split('\n').length, outline: out.split('\n').slice(0, 400) } };
}

const app = createApp({ root: ROOT, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ask-film-')),
  runner: async () => { throw new Error('the film never calls Claude: it replays film/ask/takes'); } });

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    if (pathname === '/studio/data.json') return send(200, TYPES['.json'], JSON.stringify(data()));
    if (pathname.startsWith('/studio/')) {
      const rel = pathname.slice(8);
      for (const dir of [HERE, path.join(HERE, '..', 'studio')]) {
        const f = path.join(dir, rel);
        if (!rel.includes('..') && fs.existsSync(f) && fs.statSync(f).isFile()) return send(200, TYPES[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
      }
      return send(404, 'text/plain', 'Not found');
    }
    if (pathname.startsWith('/src/')) {
      const rel = citableFile(ROOT, decodeURIComponent(pathname.slice(5)));
      return rel ? send(200, 'text/plain; charset=utf-8', fs.readFileSync(path.join(ROOT, rel))) : send(404, 'text/plain', 'Not found');
    }
    app.emit('request', req, res);
  } catch (e) { console.error(e); send(500, 'text/plain', String(e.message || e)); }
});
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log('film set on port ' + server.address().port));
