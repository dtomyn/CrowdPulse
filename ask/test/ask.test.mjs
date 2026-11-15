// Tests for Ask CrowdPulse. Run with: npm run test:ask
//
// They need no network and no Claude: the server tests swap the Claude runner for a scripted one.
// The map and example tests read the real source files, so they fail when the code moves on and an
// anchor or a quoted line no longer exists. That is the point: it is how the answers stay grounded.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMap, checkStep, checkScene, citableFile, findLine, edgeBetween, lineParser, LIMITS } from '../lib/scene.mjs';
import { systemPrompt, userPrompt, outline } from '../lib/prompt.mjs';
import { createApp, loadExamples } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SQL = 'supabase/migrations/20261113000000_crowdpulse.sql';
const map = loadMap(ROOT);
const examples = loadExamples();

describe('component map', () => {
  test('every anchor still exists in the code', () => {
    assert.deepEqual(map.problems, []);
    for (const n of map.nodes) assert.ok(n.cite?.line > 0, `node ${n.id}`);
    for (const e of map.edges) assert.ok(e.cite?.line > 0, `edge ${e.id}`);
  });
  test('every component is connected and inside the canvas', () => {
    const [w, h] = map.viewBox;
    for (const n of map.nodes) {
      assert.ok(map.edges.some(e => e.from === n.id || e.to === n.id), `${n.id} has no connection`);
      assert.ok(n.x >= 95 && n.x <= w - 95 && n.y >= 27 && n.y <= h - 27, `${n.id} is off the canvas`);
    }
  });
  test('no two components overlap, and no pair is connected twice', () => {
    for (const a of map.nodes) for (const b of map.nodes) {
      if (a.id < b.id) assert.ok(Math.abs(a.x - b.x) >= 190 || Math.abs(a.y - b.y) >= 60, `${a.id} overlaps ${b.id}`);
    }
    const pairs = map.edges.map(e => [e.from, e.to].sort().join('|'));
    assert.equal(new Set(pairs).size, pairs.length);
  });
});

describe('citations', () => {
  test('finds a quoted line whatever its indentation', () => {
    const hit = findLine(ROOT, 'public/js/supa.js', "sb.auth.signInAnonymously()");
    assert.ok(hit.line > 0);
    assert.match(hit.text, /signInAnonymously/);
  });
  test('picks the match nearest the line the answer gave', () => {
    const lines = fs.readFileSync(path.join(ROOT, SQL), 'utf8').split(/\r?\n/);
    const all = lines.map((l, i) => (l.includes('if not found then return') ? i + 1 : 0)).filter(Boolean);
    assert.ok(all.length > 1, 'needs a line that appears more than once');
    assert.equal(findLine(ROOT, SQL, 'if not found then return', all.at(-1)).line, all.at(-1));
    assert.equal(findLine(ROOT, SQL, 'if not found then return', 1).line, all[0]);
  });
  test('refuses quotes that are too short to prove anything', () => {
    assert.equal(findLine(ROOT, 'public/js/supa.js', 'CP.'), null);
  });
  test('only the app\'s own source can be cited', () => {
    assert.equal(citableFile(ROOT, 'public/js/supa.js'), 'public/js/supa.js');
    assert.equal(citableFile(ROOT, 'public\\js\\supa.js'), 'public/js/supa.js');
    for (const bad of ['../secrets.txt', 'public/../package-lock.json', 'C:/Windows/win.ini', '/etc/passwd', 'ask/server.mjs', 'film/tour/tour.js', 'node_modules/chart.js/package.json', 'public/js/nope.js', 'public/js', '', null]) {
      assert.equal(citableFile(ROOT, bad), null, String(bad));
    }
  });
});

describe('step checks', () => {
  const good = { from: 'event', to: 'supa', payload: 'rate', caption: 'The page emits a rate action.', cite: { file: 'public/js/event.js', line: 1, quote: "socket.emit('rate', { v: pending, mode })" } };
  test('a grounded step passes and gets its real line number', () => {
    const { step } = checkStep(good, map, ROOT);
    assert.equal(step.verified, true);
    assert.equal(step.edge, 'event>supa');
    assert.ok(step.cite.line > 1, 'the wrong line number in the answer is corrected');
  });
  test('a step may travel against the direction a connection was drawn in', () => {
    const { step } = checkStep({ ...good, from: 'supa', to: 'event' }, map, ROOT);
    assert.equal(step.edge, 'event>supa');
  });
  test('an invented quote is kept but marked unverified', () => {
    const { step } = checkStep({ ...good, cite: { file: 'public/js/event.js', quote: 'socket.emit("teleport", everything)' } }, map, ROOT);
    assert.equal(step.verified, false);
    assert.match(step.problem, /quote not found/);
    assert.equal(step.cite, undefined);
  });
  test('a step with no citation is unverified', () => {
    const { cite, ...bare } = good;
    assert.equal(checkStep(bare, map, ROOT).step.verified, false);
  });
  test('a step between components that are not connected is dropped', () => {
    assert.ok(!edgeBetween(map, 'event', 'tables'));
    assert.match(checkStep({ ...good, from: 'event', to: 'tables' }, map, ROOT).dropped, /not connected/);
  });
  test('a step that names an invented component is dropped', () => {
    assert.match(checkStep({ ...good, to: 'kafka' }, map, ROOT).dropped, /unknown component/);
    assert.match(checkStep({ at: 'redis', caption: 'x', cite: good.cite }, map, ROOT).dropped, /unknown component/);
  });
  test('a step with no caption is dropped, and long text is clipped', () => {
    assert.ok(checkStep({ ...good, caption: '  ' }, map, ROOT).dropped);
    const { step } = checkStep({ ...good, caption: 'x'.repeat(900), payload: 'y'.repeat(90) }, map, ROOT);
    assert.ok(step.caption.length <= LIMITS.caption && step.payload.length <= LIMITS.payload);
  });
});

describe('stream parser', () => {
  const collect = chunks => { const out = []; const p = lineParser(o => out.push(o)); chunks.forEach(c => p.feed(c)); p.end(); return out; };
  test('emits each object as soon as its line is complete, however the text is chunked', () => {
    const text = '{"type":"answer","text":"hi"}\n{"type":"step","at":"api","caption":"c"}\n';
    for (const size of [1, 7, 1000]) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
      assert.deepEqual(collect(chunks).map(o => o.type), ['answer', 'step'], `chunk size ${size}`);
    }
    const seen = []; const p = lineParser(o => seen.push(o));
    p.feed('{"type":"answer","text":"hi"}\n{"type":"st');
    assert.equal(seen.length, 1, 'the first object is out before the second line finishes');
  });
  test('ignores code fences, prose and broken lines', () => {
    const out = collect(['```json\n', 'Here you go:\n', '{"type":"answer","text":"a"}\n', '{"type":"step", broken\n', '\n', '```\n', '{"type":"step","at":"api","caption":"last line, no newline"}']);
    assert.deepEqual(out.map(o => o.type), ['answer', 'step']);
  });
});

describe('prompt', () => {
  const sys = systemPrompt(map, ROOT);
  test('gives Claude every component, every connection and the code outline', () => {
    for (const n of map.nodes) assert.ok(sys.includes(`- ${n.id}: `), n.id);
    for (const e of map.edges) assert.ok(sys.includes(`- ${e.from} <-> ${e.to}: `), e.id);
    assert.match(sys, /## public\/js\/supa\.js/);
    assert.match(sys, /create function public\.cp_tick\(/);
  });
  test('stays small enough to answer quickly', () => {
    assert.ok(sys.length < 90_000, `system prompt is ${sys.length} characters`);
    assert.ok(outline(ROOT).split('\n').length > 150);
  });
  test('the audience changes the instructions', () => {
    assert.notEqual(userPrompt('q', 'developer'), userPrompt('q', 'product'));
    assert.equal(userPrompt('q', 'nobody'), userPrompt('q', 'developer'));
  });
});

// The demonstrations. Each example is a question with a prepared answer; every step must be playable on the
// map and every quote must be in the code today.
describe('examples', () => {
  test('there is a spread of questions for each audience', () => {
    assert.ok(examples.length >= 6);
    assert.deepEqual([...new Set(examples.map(e => e.audience))].sort(), ['architect', 'developer', 'product']);
  });
  for (const ex of examples) {
    test(`${ex.id}: "${ex.question}"`, () => {
      const r = checkScene(ex, map, ROOT);
      assert.deepEqual(r.dropped, []);
      assert.equal(r.steps.length, ex.steps.length);
      assert.ok(r.steps.length >= 4 && r.steps.length <= LIMITS.maxSteps);
      assert.ok(r.answer.length > 80 && r.answer === ex.answer, 'answer fits without clipping');
      r.steps.forEach((s, i) => {
        assert.ok(s.verified, `step ${i + 1}: ${s.problem}`);
        assert.equal(s.caption, ex.steps[i].caption, `step ${i + 1} caption fits without clipping`);
        assert.ok(s.caption.length <= 160, `step ${i + 1} caption is ${s.caption.length} characters`);
      });
      const seen = new Set(r.steps.flatMap(s => (s.at ? [s.at] : [s.from, s.to])));
      assert.ok(seen.size >= 3, 'visits at least three components');
    });
  }
});

describe('server', () => {
  let app, base, cacheDir, calls;
  const script = { text: '', error: null };
  const runner = async ({ system, prompt, onText }) => {
    calls.push({ system, prompt });
    if (script.error) throw new Error(script.error);
    for (const piece of script.text.match(/[\s\S]{1,23}/g) || []) { onText(piece); await new Promise(r => setImmediate(r)); }
  };
  const ask = async body => {
    const res = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, events: res.ok ? text.trim().split('\n').map(l => JSON.parse(l)) : [], text };
  };
  const line = o => JSON.stringify(o) + '\n';
  const RATE = { type: 'step', from: 'event', to: 'supa', payload: 'rate', caption: 'The page emits a rate action.', cite: { file: 'public/js/event.js', line: 3, quote: "socket.emit('rate', { v: pending, mode })" } };
  const TICK = { type: 'step', at: 'pulse', caption: 'cp_tick does the work.', cite: { file: SQL, line: 1, quote: 'create function public.cp_tick(' } };

  before(async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-test-'));
    app = createApp({ root: ROOT, runner, cacheDir });
    await new Promise(r => app.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.address().port}`;
  });
  after(() => { app.close(); fs.rmSync(cacheDir, { recursive: true, force: true }); });
  const reset = (text, error = null) => { calls = []; script.text = text; script.error = error; };

  test('serves the page and the resolved map', async () => {
    assert.match(await (await fetch(base + '/')).text(), /Ask CrowdPulse/);
    const m = await (await fetch(base + '/api/map')).json();
    assert.equal(m.map.nodes.length, map.nodes.length);
    assert.equal(m.examples.length, examples.length);
    assert.equal((await fetch(base + '/../package.json')).status, 404);
  });

  test('an example question is answered instantly, without calling Claude', async () => {
    reset('');
    const { events } = await ask({ question: '  how does an attendee JOIN a session ', audience: 'developer' });
    assert.equal(calls.length, 0);
    assert.equal(events[0].type, 'answer');
    assert.equal(events.at(-1).source, 'example');
    assert.equal(events.filter(e => e.type === 'step').length, examples.find(e => e.id === '03-join').steps.length);
    assert.equal(events.at(-1).unverified, 0);
  });

  test('a new question goes to Claude and its steps are checked as they stream', async () => {
    reset('```json\n' + line({ type: 'answer', text: 'It is rated, then averaged.' }) + line(RATE)
      + line({ type: 'step', from: 'event', to: 'tables', caption: 'The page writes the table.', cite: RATE.cite })   // not connected: dropped
      + line({ type: 'step', at: 'api', caption: 'Something invented.', cite: { file: SQL, quote: 'perform public.cp_do_magic(e)' } }) // unverified
      + line(TICK) + '```\n');
    const { events } = await ask({ question: 'How is a rating averaged?', audience: 'architect' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /technical architect/);
    assert.match(calls[0].prompt, /How is a rating averaged\?/);
    assert.deepEqual(events.map(e => e.type), ['answer', 'step', 'dropped', 'step', 'step', 'done']);
    const steps = events.filter(e => e.type === 'step');
    assert.deepEqual(steps.map(s => s.verified), [true, false, true]);
    assert.deepEqual(steps.map(s => s.n), [1, 2, 3]);
    assert.ok(steps[0].cite.line > 3);
    assert.deepEqual({ source: events.at(-1).source, steps: events.at(-1).steps, unverified: events.at(-1).unverified }, { source: 'claude', steps: 3, unverified: 1 });
  });

  test('an answer with an unverified step is not saved, so asking again asks Claude again', async () => {
    reset(line({ type: 'answer', text: 'Second try.' }) + line(RATE) + line(TICK));
    const { events } = await ask({ question: 'How is a rating averaged?', audience: 'architect' });
    assert.equal(calls.length, 1);
    assert.equal(events.at(-1).source, 'claude');
  });

  test('a fully verified answer is saved for this commit and replayed without Claude', async () => {
    reset('');
    const again = await ask({ question: 'how is a rating averaged', audience: 'architect' });
    assert.equal(calls.length, 0);
    assert.equal(again.events.at(-1).source, 'cache');
    assert.equal(again.events[0].text, 'Second try.');
    assert.equal(again.events.filter(e => e.type === 'step').length, 2);
  });

  test('the saved answer is per audience, and "fresh" skips it', async () => {
    reset(line({ type: 'answer', text: 'For developers.' }) + line(TICK));
    assert.equal((await ask({ question: 'How is a rating averaged?', audience: 'developer' })).events.at(-1).source, 'claude');
    reset(line({ type: 'answer', text: 'Fresh.' }) + line(TICK));
    const fresh = await ask({ question: 'How is a rating averaged?', audience: 'architect', fresh: true });
    assert.equal(fresh.events[0].text, 'Fresh.');
    assert.equal(calls.length, 1);
  });

  test('a question with nothing to animate gets an answer and no steps, and is not saved', async () => {
    reset(line({ type: 'answer', text: 'That is not something this codebase does.' }));
    const q = { question: 'What is the capital of France?', audience: 'developer' };
    const first = await ask(q);
    assert.deepEqual(first.events.map(e => e.type), ['answer', 'done']);
    assert.equal(first.events.at(-1).steps, 0);
    await ask(q);
    assert.equal(calls.length, 2);
  });

  test('failures are reported in the stream, not as a hung request', async () => {
    reset('', 'The claude command was not found.');
    assert.deepEqual((await ask({ question: 'Does chat use Realtime?' })).events, [{ type: 'error', message: 'The claude command was not found.' }]);
    reset('Sorry, I cannot help with that.');
    const garbled = await ask({ question: 'Does chat use Realtime?' });
    assert.equal(garbled.events.at(-1).type, 'error');
    assert.match(garbled.events.at(-1).message, /expected format/);
  });

  test('empty and oversized questions are handled', async () => {
    reset(line({ type: 'answer', text: 'ok' }));
    assert.equal((await ask({ question: ' ' })).status, 400);
    await ask({ question: 'why '.repeat(500) });
    assert.ok(calls[0].prompt.length < 700, 'the question is cut to 400 characters');
  });
});
