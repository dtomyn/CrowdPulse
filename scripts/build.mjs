// Builds the static site into dist/: public/ plus the vendored libraries and the face-analysis model.
// dist/ is what GitHub Pages serves (see .github/workflows/pages.yml).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VENDOR, MODEL, ensureModel, configOverride } from './vendor.mjs';

const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
for (const [to, from] of Object.entries(VENDOR)) fs.cpSync(path.join(ROOT, from), path.join(DIST, to), { recursive: true });
const model = await ensureModel();
fs.mkdirSync(path.dirname(path.join(DIST, MODEL.path)), { recursive: true });
fs.copyFileSync(model, path.join(DIST, MODEL.path));
const config = configOverride();
if (config) fs.writeFileSync(path.join(DIST, 'js/config.js'), config);
fs.writeFileSync(path.join(DIST, '.nojekyll'), ''); // serve files as they are (no Jekyll processing)

const count = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? count(path.join(dir, d.name)) : 1), 0);
console.log(`Built dist/ (${count(DIST)} files)${config ? ' for ' + process.env.SUPABASE_URL : ''}`);
