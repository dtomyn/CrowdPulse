// Builds what Claude is given for every question: the component map, and an outline of the code (the notable
// lines of each source file with their line numbers). With both in hand most questions need no file reads,
// which is what keeps answers quick.
import fs from 'node:fs';
import path from 'node:path';

const SOURCES = ['public/js', 'public', 'supabase/functions/report', 'supabase/functions/_shared', 'supabase/migrations', 'scripts', '.github/workflows'];
const SKIP = /\.(css|png|svg|ico|json)$|(^|\/)(raters|simulator)\.js$/;
const NOTABLE = {
  js: /socket\.(emit|on)\(|CP\.(call|rpc|report|connect|passive|simulator|roomSensor)\b|sb\.(auth|rpc|channel)|^\s*(async )?function \w+|^\s{0,2}CP\.\w+ = |Deno\.serve|createClient|\.rpc\(|^import |^export |ticker ===|setInterval\(/,
  sql: /^create (table|function|policy|index)|^grant|^revoke|cp_send\(|^\s+when '[\w:-]+' then|row level security|^-- -{5,}|^alter default|realtime\.send|auth\.uid\(\) is null|cp_is_admin\(e\.code\)|cp_is_host\(\) then|cp_throttle_ok\(|insert into public\.\w+/,
  html: /<script |Content-Security-Policy|<title>/,
  yml: /^\s*- (run|uses):|^on:|branches:/,
};
const kindOf = f => (/\.(js|mjs|ts)$/.test(f) ? 'js' : /\.sql$/.test(f) ? 'sql' : /\.html$/.test(f) ? 'html' : /\.ya?ml$/.test(f) ? 'yml' : null);

export function sourceFiles(root) {
  const out = [];
  for (const dir of SOURCES) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).sort()) {
      const rel = `${dir}/${name}`;
      if (fs.statSync(path.join(root, rel)).isFile() && kindOf(rel) && !SKIP.test(rel)) out.push(rel);
    }
  }
  return out;
}

export function outline(root) {
  const parts = [];
  for (const rel of sourceFiles(root)) {
    const re = NOTABLE[kindOf(rel)];
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
    const picked = [];
    lines.forEach((l, i) => { if (re.test(l)) picked.push(`${i + 1}: ${l.trim().slice(0, 150)}`); });
    if (picked.length) parts.push(`## ${rel} (${lines.length} lines)\n${picked.join('\n')}`);
  }
  return parts.join('\n\n');
}

const AUDIENCES = {
  developer: 'a developer who will change this code. Name the functions and events involved.',
  architect: 'a technical architect. Talk about components, boundaries, who is trusted with what, and trade-offs.',
  product: 'a product owner. Use plain language about what the user sees and why; keep function names out of the captions (the citations still point at code).',
};
export const audiences = Object.keys(AUDIENCES);

export function systemPrompt(map, root) {
  const nodes = map.nodes.map(n => `- ${n.id}: ${n.label} (${n.sub}). ${n.does}${n.cite ? ` [${n.cite.file}:${n.cite.line}]` : ''}`).join('\n');
  const edges = map.edges.map(e => `- ${e.from} <-> ${e.to}: ${e.label}${e.cite ? ` [${e.cite.file}:${e.cite.line}]` : ''}`).join('\n');
  return `You explain the CrowdPulse codebase (this repository) with a short answer and a short animation.
The animation plays on a fixed map of the app's components. You do not draw anything: you list steps, and each
step either moves something between two connected components or highlights one component.

# Output format: NDJSON, nothing else
One JSON object per line. No markdown, no code fences, no text before or after.

Line 1, always:
{"type":"answer","text":"<the answer in 2 or 3 plain sentences>"}

Then 3 to 8 lines, in the order things happen:
{"type":"step","from":"<node id>","to":"<node id>","payload":"<what travels, at most 24 characters>","caption":"<one sentence, at most 160 characters>","cite":{"file":"<repo path>","line":<number>,"quote":"<text copied exactly from that one line, 10 to 80 characters>"}}
or, for something that happens inside one component:
{"type":"step","at":"<node id>","caption":"...","cite":{...}}

# Rules
- "from" and "to" must be directly connected on the map below (either direction). To cross the map, use several steps.
- One claim per step, and the citation is the line that proves that claim. Only state what the code shows.
- "quote" must be copied character for character from a single line: from the outline below or from a file you
  read. A step whose quote is not in the file is shown to the user as unverified.
- Answer from the outline when you can. Read a file only to confirm a specific line, and use at most 3 tool calls.
  Speed matters: the user is watching the animation arrive.
- If the question is not about this codebase, or nothing on the map can show it, write only the answer line and
  say so there.

# Component map
Nodes:
${nodes}

Connections:
${edges}

# Code outline (line number: text)
${outline(root)}
`;
}

export function userPrompt(question, audience) {
  return `Audience: ${AUDIENCES[audience] || AUDIENCES.developer}\n\nQuestion: ${question}`;
}
