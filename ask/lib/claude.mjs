// Runs the Claude Code CLI headless, inside the repository, with read-only tools, and streams its text out.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// runner({ system, prompt, root, cacheDir, onText, signal }) -> Promise<void>
export async function claudeCli({ system, prompt, root, cacheDir, onText, signal }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const sysFile = path.join(cacheDir, 'system-prompt.txt');
  fs.writeFileSync(sysFile, system); // a file, because the prompt is longer than a Windows command line allows
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt-file', sysFile, '--tools', 'Read,Grep,Glob', '--strict-mcp-config',
    '--model', process.env.ASK_MODEL || 'sonnet'];
  const win = process.platform === 'win32';
  const child = spawn('claude', win ? args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args,
    { cwd: root, shell: win, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  signal?.addEventListener('abort', () => child.kill());
  child.stdin.end(prompt);

  let buf = '', streamed = false, err = '';
  const handle = line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const d = m.type === 'stream_event' && m.event?.type === 'content_block_delta' ? m.event.delta : null;
    if (d?.type === 'text_delta' && d.text) { streamed = true; onText(d.text); }
    // no partial messages seen (older CLI): fall back to the final result text
    else if (m.type === 'result' && !streamed && typeof m.result === 'string') onText(m.result + '\n');
    if (m.type === 'result' && m.is_error) err = String(m.result || 'Claude returned an error');
  };
  child.stdout.setEncoding('utf8').on('data', chunk => {
    buf += chunk;
    let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', c => { stderr += c; });

  await new Promise((resolve, reject) => {
    child.on('error', e => reject(new Error(e.code === 'ENOENT' ? 'The claude command was not found. Install Claude Code and sign in.' : e.message)));
    child.on('close', code => {
      if (buf.trim()) handle(buf);
      if (signal?.aborted) return resolve();
      if (err) return reject(new Error(err));
      if (code !== 0 && !streamed) return reject(new Error(stderr.trim().split('\n').pop() || `claude exited with code ${code}`));
      resolve();
    });
  });
}
