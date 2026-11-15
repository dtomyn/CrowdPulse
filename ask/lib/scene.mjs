// The scene format and its checks.
//
// An answer is one short text plus a list of steps. Each step plays on the fixed component map (ask/map.json):
// either something travels between two connected components ({ from, to }) or something happens inside one ({ at }).
// Every step cites a line of the real code by quoting it. A step whose quote can't be found in the file is kept
// but marked unverified; a step that points at a component or connection that doesn't exist is dropped.
import fs from 'node:fs';
import path from 'node:path';

// Only the app's own source can be cited (not the films, not this tool, not node_modules).
const CITABLE = [/^public\//, /^supabase\//, /^scripts\//, /^\.github\//, /^README\.md$/, /^package\.json$/];
export const LIMITS = { caption: 220, payload: 28, answer: 700, minQuote: 6, maxSteps: 10 };

const squash = s => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const fileCache = new Map();
function readLines(root, file) {
  const full = path.join(root, file);
  const stat = fs.statSync(full);
  const hit = fileCache.get(full);
  if (hit && hit.mtime === stat.mtimeMs) return hit.lines;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  fileCache.set(full, { mtime: stat.mtimeMs, lines });
  return lines;
}

// A repo-relative path with forward slashes, or null if it isn't a citable file that exists.
export function citableFile(root, file) {
  if (typeof file !== 'string' || !file) return null;
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) return null;
  if (!CITABLE.some(re => re.test(rel))) return null;
  const full = path.join(root, rel);
  try { if (!fs.statSync(full).isFile()) return null; } catch { return null; }
  return rel;
}

// Finds the line that contains `quote` (whitespace-insensitive). With several matches, the one nearest `hint` wins.
export function findLine(root, file, quote, hint = 0) {
  const q = squash(quote);
  if (q.length < LIMITS.minQuote) return null;
  const lines = readLines(root, file);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!squash(lines[i]).includes(q)) continue;
    if (best === null || Math.abs(i + 1 - hint) < Math.abs(best - hint)) best = i + 1;
  }
  return best === null ? null : { line: best, text: clip(squash(lines[best - 1]), 240) };
}

// Loads the component map and turns each anchor's text into a line number.
export function loadMap(root, mapFile = path.join(root, 'ask', 'map.json')) {
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const problems = [];
  const resolve = (what, anchor) => {
    const file = citableFile(root, anchor?.file);
    if (!file) { problems.push(`${what}: no such file ${anchor?.file}`); return null; }
    const hit = findLine(root, file, anchor.find);
    if (!hit) { problems.push(`${what}: "${anchor.find}" not found in ${file}`); return null; }
    return { file, line: hit.line, text: hit.text };
  };
  const ids = new Set();
  for (const n of map.nodes) {
    if (ids.has(n.id)) problems.push(`node ${n.id}: duplicate id`);
    ids.add(n.id);
    n.cite = resolve(`node ${n.id}`, n.anchor);
  }
  for (const e of map.edges) {
    e.id = `${e.from}>${e.to}`;
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push(`edge ${e.id}: unknown node`);
    e.cite = resolve(`edge ${e.id}`, e.anchor);
  }
  map.problems = problems;
  return map;
}

export function edgeBetween(map, a, b) {
  return map.edges.find(e => (e.from === a && e.to === b) || (e.from === b && e.to === a)) || null;
}

// Checks one step. Returns { step } (cleaned, with `verified` and the resolved citation) or { dropped: reason }.
export function checkStep(raw, map, root) {
  if (!raw || typeof raw !== 'object') return { dropped: 'not an object' };
  const has = id => map.nodes.some(n => n.id === id);
  const caption = typeof raw.caption === 'string' ? squash(raw.caption) : '';
  if (!caption) return { dropped: 'no caption' };

  const step = { caption: clip(caption, LIMITS.caption), verified: false };
  if (raw.from != null || raw.to != null) {
    if (!has(raw.from) || !has(raw.to)) return { dropped: `unknown component: ${raw.from} -> ${raw.to}` };
    const edge = edgeBetween(map, raw.from, raw.to);
    if (!edge) return { dropped: `${raw.from} and ${raw.to} are not connected on the map` };
    Object.assign(step, { from: raw.from, to: raw.to, edge: edge.id });
  } else {
    if (!has(raw.at)) return { dropped: `unknown component: ${raw.at}` };
    step.at = raw.at;
  }
  if (typeof raw.payload === 'string' && raw.payload.trim()) step.payload = clip(squash(raw.payload), LIMITS.payload);

  const c = raw.cite;
  const file = citableFile(root, c?.file);
  if (!file) step.problem = c?.file ? `can't cite ${c.file}` : 'no citation';
  else {
    const hit = typeof c.quote === 'string' ? findLine(root, file, c.quote, Number(c.line) || 0) : null;
    if (hit) { step.cite = { file, line: hit.line, text: hit.text }; step.verified = true; }
    else step.problem = `quote not found in ${file}`;
  }
  return { step };
}

export function cleanAnswer(text) {
  return typeof text === 'string' ? clip(squash(text), LIMITS.answer) : '';
}

// Checks a whole stored scene (an example or a cached answer).
export function checkScene(scene, map, root) {
  const steps = [], dropped = [];
  for (const raw of (scene.steps || []).slice(0, LIMITS.maxSteps)) {
    const r = checkStep(raw, map, root);
    if (r.step) steps.push(r.step); else dropped.push(r.dropped);
  }
  return { answer: cleanAnswer(scene.answer), steps, dropped };
}

// Claude streams one JSON object per line. This turns arbitrary text chunks into objects as soon as a line is
// complete, and ignores anything that isn't a JSON object (blank lines, code fences, stray prose).
export function lineParser(onObject) {
  let buf = '';
  const take = line => {
    const t = line.trim().replace(/^```(?:json|ndjson)?/, '').replace(/```$/, '').trim();
    if (!t.startsWith('{')) return;
    try { const o = JSON.parse(t); if (o && typeof o === 'object') onObject(o); } catch { /* not a complete object */ }
  };
  return {
    feed(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf.trim()) take(buf); buf = ''; },
  };
}
