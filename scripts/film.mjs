// Runs the film scripts (film/render*.py) with the project's own Python virtual environment, or in Docker.
//
//   npm run film:setup                    create .venv, install film/requirements.txt, fetch the voice model
//   npm run film:tour -- --storyboard     run film/render_tour.py in .venv (also film:explainer, film:ask)
//   npm run film:tour -- --docker --storyboard    the same inside the image built from film/Dockerfile
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const VENV = path.join(ROOT, '.venv');
const VENV_PYTHON = path.join(VENV, WIN ? 'Scripts/python.exe' : 'bin/python');
const FILMS = { explainer: 'film/render.py', tour: 'film/render_tour.py', ask: 'film/render_ask.py' };
const IMAGE = 'crowdpulse-film';
const MIN_PYTHON = [3, 12];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.error) fail(`could not run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// A Python new enough to make the virtual environment with.
function findPython() {
  const [major, minor] = MIN_PYTHON;
  const check = `import sys; sys.exit(0 if sys.version_info >= (${major}, ${minor}) else 1)`;
  for (const [cmd, ...pre] of [['python'], ['python3'], ['py', '-3']]) {
    if (spawnSync(cmd, [...pre, '-c', check], { stdio: 'ignore' }).status === 0) return [cmd, ...pre];
  }
  fail(`Python ${major}.${minor} or newer is needed (https://www.python.org/downloads/). Or render in Docker: add --docker to a film command.`);
}

function setup() {
  if (!fs.existsSync(VENV_PYTHON)) {
    const [cmd, ...pre] = findPython();
    console.log('creating .venv');
    run(cmd, [...pre, '-m', 'venv', VENV]);
  }
  run(VENV_PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'film/requirements.txt']);
  // Windows films with the Edge that comes with it; elsewhere Playwright's own Chromium is used
  if (!WIN) run(VENV_PYTHON, ['-m', 'playwright', 'install', 'chromium']);
  run(VENV_PYTHON, ['film/get_voice.py']);
  console.log('\nReady. Try: npm run film:tour -- --storyboard');
}

function docker(script, args) {
  if (args.includes('--record')) fail('--record needs the Claude Code CLI, which is not in the Docker image. Record without --docker, then render.');
  run('docker', ['build', '-t', IMAGE, 'film']);
  run('docker', ['run', '--rm', '--init', '--ipc=host', '-v', `${ROOT}:/work`, IMAGE, script, ...args]);
}

const [what, ...rest] = process.argv.slice(2);
const args = rest.filter(a => a !== '--docker');
if (what === 'setup') setup();
else if (FILMS[what]) {
  if (rest.includes('--docker')) docker(FILMS[what], args);
  else {
    if (!fs.existsSync(VENV_PYTHON)) fail('The film environment is not set up yet. Run: npm run film:setup');
    run(VENV_PYTHON, [FILMS[what], ...args]);
  }
} else fail(`usage: node scripts/film.mjs <setup|${Object.keys(FILMS).join('|')}> [--docker] [options]`);
