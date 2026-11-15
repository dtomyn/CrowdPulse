// Records the answers the Ask CrowdPulse film replays. Each take is a real run of Claude Code on this repository,
// saved with the time every line arrived, so the film can replay it at the speed it really happened.
//
//   node film/ask/record.mjs            record the takes that are missing
//   node film/ask/record.mjs --all      record every take again (do this when the code or the map has changed)
//   node film/ask/record.mjs product    record one take again
//
// Needs the Claude Code CLI, signed in. Rendering the film does not: it only reads film/ask/takes/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadMap, checkStep, cleanAnswer, lineParser } from '../../ask/lib/scene.mjs';
import { systemPrompt, userPrompt, audiences } from '../../ask/lib/prompt.mjs';
import { claudeCli } from '../../ask/lib/claude.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const QUESTION = 'How does a rating get from a phone to the big screen?';
const DIR = path.join(HERE, 'takes');

async function record(audience) {
  const map = loadMap(ROOT), t0 = Date.now();
  const take = { question: QUESTION, audience, recordedAt: new Date().toISOString(), model: process.env.ASK_MODEL || 'sonnet',
    commit: execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(), answer: '', answerAt: 0, steps: [], stepAt: [], doneAt: 0 };
  let verified = 0, dropped = 0;
  const parser = lineParser(o => {
    if (o.type === 'answer' && !take.answer) { take.answer = cleanAnswer(o.text); take.answerAt = Date.now() - t0; }
    else if (o.type === 'step') {
      const { type, ...raw } = o;
      take.steps.push(raw); take.stepAt.push(Date.now() - t0);
      const r = checkStep(raw, map, ROOT);
      if (!r.step) dropped++; else if (r.step.verified) verified++;
    }
  });
  await claudeCli({ system: systemPrompt(map, ROOT), prompt: userPrompt(QUESTION, audience), root: ROOT, cacheDir: path.join(ROOT, 'ask', '.cache'), onText: t => parser.feed(t) });
  parser.end();
  take.doneAt = Date.now() - t0;
  if (!take.answer || !take.steps.length) throw new Error(`${audience}: Claude returned no usable answer`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, audience + '.json'), JSON.stringify(take, null, 2) + '\n');
  console.log(`${audience}: ${take.steps.length} steps (${verified} verified, ${dropped} dropped), first step ${(take.stepAt[0] / 1000).toFixed(1)} s, done ${(take.doneAt / 1000).toFixed(1)} s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const wanted = audiences.filter(a => args.includes('--all') || args.includes(a) || (!args.length && !fs.existsSync(path.join(DIR, a + '.json'))));
  if (!wanted.length) console.log('All takes are recorded. Use --all to record them again.');
  for (const a of wanted) await record(a);
}
