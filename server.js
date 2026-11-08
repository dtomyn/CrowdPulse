// CrowdPulse — live audience rating server
const express = require('express');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const store = require('./lib/store');
const { buildReport, publicEvent } = require('./lib/analytics');
const sim = require('./lib/simulator');
const passive = require('./lib/passive');
const { loadTls } = require('./lib/tls');
const { ensureModel } = require('./lib/models');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || ''; // optional: protect admin screens
// HTTPS (`npm run secure`): needed for phone cameras. Uses a self-made certificate unless HTTPS_CERT/HTTPS_KEY are set.
const HTTPS_ON = process.argv.includes('--https') || /^(1|true|yes|on)$/i.test(process.env.HTTPS || '') || !!(process.env.HTTPS_CERT || process.env.HTTPS_KEY);
const REACTIONS = ['👏', '🔥', '😂', '🤯', '❤️', '🤔', '🎉', '😴'];
const BAD_WORDS = /\b(fuck|shit|bitch|cunt|asshole|dick|bastard)\b/gi;

const MAX_PARTICIPANTS = 5000;    // per session: stops a script from filling memory/disk with fake attendees
const MAX_QUESTIONS = 2000;
const MAX_REACTIONS = 100000;
const RESERVED_PIDS = new Set(['presenter', 'system']);
const SETTING_KEYS = ['chat', 'qa', 'reactions', 'publicReport', 'showCrowdMood', 'listed', 'passiveTab', 'passiveCamera', 'passiveRoom'];

store.load();
const app = express();
app.disable('x-powered-by');
// in HTTPS mode the certificate is loaded (or made) just before listening; see start()
const server = HTTPS_ON ? https.createServer({}, app) : http.createServer(app);
// Same-origin only (the socket.io default). Every page that talks to the socket is served by this server.
const io = new Server(server, { maxHttpBufferSize: 256 * 1024 });

// Content Security Policy: pages may only run script files from this server (no inline scripts, no eval), so an
// injected <script> or onerror= in a chat message or session title does nothing even if escaping were ever missed.
//   'wasm-unsafe-eval'  lets MediaPipe compile its WebAssembly (it does not allow JavaScript eval)
//   style 'unsafe-inline'  the pages set many inline styles; styles can't run code
//   Google Fonts         the only outside resource (stylesheet + font files)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' {ws}",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    // admin keys travel in ?key= links, so never leak the URL to other sites
    'Referrer-Policy': 'no-referrer',
    // accelerometer/gyroscope: the Tilt rating style reads the phone's orientation
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), accelerometer=(self), gyroscope=(self), magnetometer=()',
    // older Safari doesn't count same-host websockets as 'self', so name this host's ws/wss address explicitly
    'Content-Security-Policy': CSP.replace('{ws}', /^[a-z0-9.:[\]-]+$/i.test(req.headers.host || '') ? `ws://${req.headers.host} wss://${req.headers.host}` : ''),
  });
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));
// Face analysis for cameras (MediaPipe), served from this server rather than a CDN: the npm lockfile pins it by hash
const MEDIAPIPE = path.join(__dirname, 'node_modules/@mediapipe/tasks-vision');
app.get('/vendor/mediapipe/vision_bundle.mjs', (req, res) => res.type('text/javascript').set('Cache-Control', 'public, max-age=604800').sendFile(path.join(MEDIAPIPE, 'vision_bundle.mjs')));
app.use('/vendor/mediapipe/wasm', express.static(path.join(MEDIAPIPE, 'wasm'), {
  maxAge: '7d', setHeaders: (res, file) => { if (file.endsWith('.wasm')) res.type('application/wasm'); else if (file.endsWith('.js')) res.type('text/javascript'); },
}));
app.get('/vendor/models/:name', async (req, res, next) => {
  try {
    const file = await ensureModel(store.DATA_DIR, req.params.name);
    res.set('Cache-Control', 'public, max-age=604800').type('application/octet-stream').sendFile(file);
  } catch (e) {
    if (e.status) return next(e);
    console.error('  Could not get the face-analysis model:', e.message);
    res.status(503).json({ error: 'The face-analysis model could not be downloaded. Check this computer is online and try again.' });
  }
});
// Brand mark as the favicon (browsers ask for /favicon.ico on every page)
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset=".55" stop-color="#ff5ca8"/><stop offset="1" stop-color="#ffb547"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M8 32h11l8-19 11 38 8-19h10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
app.get('/favicon.ico', (req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(FAVICON));
// The explainer film's director page (film/studio). Only served when rendering the film.
if (process.env.CROWDPULSE_STUDIO) app.use('/studio', express.static(path.join(__dirname, 'film/studio')));

// ---------- helpers ----------
function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal && !/^169\.254/.test(ni.address)) return ni.address;
  }
  return 'localhost';
}
const baseUrl = () => process.env.PUBLIC_URL || `${HTTPS_ON ? 'https' : 'http'}://${lanIp()}:${PORT}`;
// whether phones that open the join link can use their camera
const joinIsSecure = () => /^https:/i.test(baseUrl());
const joinUrl = code => `${baseUrl()}/e/${code}`;

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code;
  do { code = Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join(''); } while (store.events[code]);
  return code;
}
const uid = () => crypto.randomBytes(6).toString('hex');
// Only strings and numbers are accepted as text: anything else (objects, arrays) from a JSON or socket payload becomes ''.
const clean = (s, n) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const filter = s => s.replace(BAD_WORDS, m => m[0] + '*'.repeat(m.length - 1));
const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const getEvent = code => {
  if (typeof code !== 'string') return undefined;
  const k = code.toUpperCase();
  return Object.hasOwn(store.events, k) ? store.events[k] : undefined;
};

// Attendee ids are chosen by the browser and act as its credential, so they must look like one,
// and can't collide with reserved ids, simulator bots or Object.prototype keys (e.g. "__proto__").
const validPid = pid => typeof pid === 'string' && /^[A-Za-z0-9_-]{12,40}$/.test(pid) && !RESERVED_PIDS.has(pid) && !pid.startsWith('bot_');
const newPid = () => 'p_' + crypto.randomBytes(12).toString('base64url');
// What other people see instead of a participant's id, so nobody can copy someone's id and act as them.
const PUB_SALT = crypto.randomBytes(16);
const pubId = pid => (RESERVED_PIDS.has(pid) ? pid : 'u_' + crypto.createHmac('sha256', PUB_SALT).update(String(pid)).digest('base64url').slice(0, 12));

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
function cleanUrl(u) {
  let s = clean(u, 300);
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s; // "zoom.us/j/1" -> https://zoom.us/j/1
  try { const url = new URL(s); return url.protocol === 'https:' || url.protocol === 'http:' ? s : ''; } catch { return ''; }
}
function cleanDate(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function cleanLocation(loc, prev = {}) {
  const l = isObj(loc) ? loc : {};
  const pick = (k, fn) => (k in l ? fn(l[k]) : prev[k] ?? fn(''));
  return {
    mode: ['in-person', 'virtual', 'hybrid'].includes(l.mode) ? l.mode : prev.mode || 'virtual',
    venue: pick('venue', v => clean(v, 120)), address: pick('address', v => clean(v, 200)), url: pick('url', cleanUrl),
  };
}
function mergeSettings(cur, p) {
  const out = { ...cur };
  if (isObj(p)) for (const k of SETTING_KEYS) if (k in p) out[k] = !!p[k];
  return out;
}

// Without ADMIN_PIN, listing and creating sessions (which hands out every admin key) only works from this computer.
// A request relayed by a tunnel or reverse proxy arrives from loopback too, so forwarded requests don't count as local.
function isLocal(req) {
  if (req.get('x-forwarded-for') || req.get('forwarded') || req.get('x-real-ip')) return false;
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
// Wrong-PIN limits. Per address: 10 wrong PINs locks that address out for 5 minutes. Across all addresses: 30 wrong PINs
// within 15 minutes pauses PIN checks from other devices for 15 minutes, so spreading guesses over many addresses
// (or arriving through a tunnel) doesn't help. Requests made on this computer itself are never locked out,
// so a guessing attack can't stop the host from using the dashboard.
const PIN_MIN_LENGTH = 6;
const PER_IP_LIMIT = 10, PER_IP_LOCK_MS = 5 * 60000;
const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_MS = 15 * 60000, GLOBAL_LOCK_MS = 15 * 60000;
const pinFails = new Map(); // ip -> { n, until, last }
let globalFails = [];       // timestamps of recent wrong PINs from other devices
let globalLockUntil = 0;
function checkPin(req, res, next) {
  const local = isLocal(req);
  if (!ADMIN_PIN) {
    if (local) return next();
    return res.status(403).json({ error: 'The host dashboard only works on the computer running CrowdPulse. Set ADMIN_PIN to host from another device.' });
  }
  const now = Date.now();
  const ip = req.socket.remoteAddress || '?';
  const f = pinFails.get(ip);
  if (!local && (globalLockUntil > now || (f && f.until > now))) {
    return res.status(429).json({ error: 'Too many wrong PINs. Try again in a few minutes, or use the dashboard on the computer running CrowdPulse.' });
  }
  if (safeEqual(req.get('x-admin-pin') || '', ADMIN_PIN)) { pinFails.delete(ip); return next(); }
  if (req.get('x-admin-pin') && !local) {
    const n = (f?.n || 0) + 1;
    pinFails.set(ip, n >= PER_IP_LIMIT ? { n: 0, until: now + PER_IP_LOCK_MS, last: now } : { n, until: 0, last: now });
    globalFails = globalFails.filter(t => now - t < GLOBAL_WINDOW_MS); globalFails.push(now);
    if (globalFails.length >= GLOBAL_LIMIT) {
      globalLockUntil = now + GLOBAL_LOCK_MS; globalFails = [];
      console.warn(`  ⚠️  ${GLOBAL_LIMIT} wrong admin PINs in ${GLOBAL_WINDOW_MS / 60000} minutes: PIN sign-in from other devices is paused for ${GLOBAL_LOCK_MS / 60000} minutes.`);
    }
  }
  res.status(401).json({ error: 'Admin PIN required' });
}
const hasKey = (req, ev) => safeEqual(req.get('x-admin-key') || '', ev.adminKey) || safeEqual(typeof req.query.key === 'string' ? req.query.key : '', ev.adminKey);
function checkKey(req, res, next) {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (!hasKey(req, ev)) return res.status(403).json({ error: 'Forbidden' });
  req.ev = ev; next();
}

// presence: code -> Map(pid -> socket count)
const presence = new Map();
const online = code => (presence.get(code)?.size || 0);
function markOnline(code, pid, delta) {
  if (!presence.has(code)) presence.set(code, new Map());
  const m = presence.get(code);
  const n = (m.get(pid) || 0) + delta;
  if (n <= 0) m.delete(pid); else m.set(pid, n);
}

function summary(ev) {
  return {
    ...publicEvent(ev), adminKey: ev.adminKey, joinUrl: joinUrl(ev.code),
    stats: {
      participants: Object.keys(ev.participants).filter(k => k !== 'presenter').length, online: online(ev.code),
      ratings: ev.ratings.length, messages: ev.messages.length, reactions: ev.reactions.length,
      avg: ev.lastPulse?.avg ?? null,
      attention: ev.lastPulse?.passive?.index ?? null, cameraOptIns: passive.consentCount(ev),
    },
    simulating: sim.running(ev.code),
  };
}

// ---------- REST API ----------
app.get('/api/config', (req, res) => res.json({ pinRequired: !!ADMIN_PIN, baseUrl: baseUrl(), secure: joinIsSecure(), reactions: REACTIONS }));

app.get('/api/events', checkPin, (req, res) => {
  res.json(Object.values(store.events).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)).map(summary));
});

app.post('/api/events', checkPin, (req, res) => {
  const b = req.body || {};
  const title = clean(b.title, 120);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const code = newCode();
  const ev = {
    code, adminKey: crypto.randomBytes(24).toString('hex'), title,
    description: clean(b.description, 2000), presenter: clean(b.presenter, 80),
    startsAt: cleanDate(b.startsAt) || new Date().toISOString(), durationMin: Math.max(5, Math.min(1440, Number(b.durationMin) || 60)),
    location: cleanLocation(b.location),
    accent: isColor(b.accent) ? b.accent : '#7c5cff',
    settings: mergeSettings({
      chat: true, qa: true, reactions: true, publicReport: false, showCrowdMood: true,
      listed: false, // shown on the home page's "Happening now" list (off unless the host opts in)
      // passive signals: tab focus is on by default; cameras and the room microphone are opt-in by the host
      passiveTab: true, passiveCamera: false, passiveRoom: false,
    }, b.settings),
    status: 'scheduled', createdAt: Date.now(), startedAt: null, endedAt: null,
    participants: {}, ratings: [], reactions: [], messages: [], questions: [], polls: [], feedback: {},
    pulseHistory: [], markers: [], announcements: [], passive: [], passiveLatest: {}, roomSignals: [],
  };
  store.events[code] = ev; store.save();
  res.json(summary(ev));
});

app.put('/api/events/:code', checkKey, (req, res) => {
  const ev = req.ev, b = req.body || {};
  if (clean(b.title, 120)) ev.title = clean(b.title, 120);
  if ('description' in b) ev.description = clean(b.description, 2000);
  if ('presenter' in b) ev.presenter = clean(b.presenter, 80);
  if (cleanDate(b.startsAt)) ev.startsAt = cleanDate(b.startsAt);
  if (Number(b.durationMin) > 0) ev.durationMin = Math.max(5, Math.min(1440, Number(b.durationMin)));
  if (b.location) ev.location = cleanLocation(b.location, ev.location);
  if (isColor(b.accent)) ev.accent = b.accent;
  if (b.settings) ev.settings = mergeSettings(ev.settings, b.settings);
  store.save(); broadcastEvent(ev);
  res.json(summary(ev));
});

app.delete('/api/events/:code', checkKey, (req, res) => {
  sim.stop(req.ev.code, simApi);
  io.to(req.ev.code).emit('deleted');
  delete store.events[req.ev.code]; store.save();
  res.json({ ok: true });
});

app.post('/api/events/:code/duplicate', checkKey, (req, res) => {
  const src = req.ev; const code = newCode();
  const copy = JSON.parse(JSON.stringify(src));
  Object.assign(copy, {
    code, adminKey: crypto.randomBytes(24).toString('hex'), title: src.title.slice(0, 113) + ' (copy)', status: 'scheduled', createdAt: Date.now(), startedAt: null, endedAt: null,
    participants: {}, ratings: [], reactions: [], messages: [], questions: [], polls: [], feedback: {}, pulseHistory: [], markers: [], announcements: [],
    passive: [], passiveLatest: {}, roomSignals: [], latest: {},
  });
  delete copy.lastPulse; delete copy.dirty;
  store.events[code] = copy; store.save();
  res.json(summary(copy));
});

// Sessions the host chose to list on the home page: live ones first, then those starting soon. Anyone can read this,
// so it only carries what the join page already shows, plus the crowd mood when the host shares it with attendees.
const LIST_MAX = 50, LIST_AHEAD_MS = 7 * 86400000;
app.get('/api/live', (req, res) => {
  const now = Date.now();
  const list = Object.values(store.events).filter(ev => {
    if (!ev.settings?.listed) return false;
    if (ev.status === 'live') return true;
    if (ev.status !== 'scheduled') return false;
    const t = new Date(ev.startsAt).getTime(); // skip sessions that were never started and are long overdue
    return t > now - (ev.durationMin || 60) * 60000 && t < now + LIST_AHEAD_MS;
  }).map(ev => ({
    code: ev.code, title: ev.title, presenter: ev.presenter, status: ev.status, startsAt: ev.startsAt, startedAt: ev.startedAt,
    durationMin: ev.durationMin, accent: ev.accent, location: { mode: ev.location?.mode, venue: ev.location?.venue || '' },
    online: online(ev.code),
    mood: ev.status === 'live' && ev.settings.showCrowdMood && ev.lastPulse?.avg != null ? Math.round(ev.lastPulse.avg) : null,
  })).sort((a, b) => (a.status === b.status ? (a.status === 'live' ? b.online - a.online : new Date(a.startsAt) - new Date(b.startsAt)) : a.status === 'live' ? -1 : 1));
  res.set('Cache-Control', 'no-store').json(list.slice(0, LIST_MAX));
});

app.get('/api/events/:code/public', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'No event with that code' });
  res.json({ ...publicEvent(ev), joinUrl: joinUrl(ev.code) });
});

app.get('/api/events/:code/qr.svg', async (req, res, next) => {
  try {
    const ev = getEvent(req.params.code);
    if (!ev) return res.status(404).end();
    const dark = typeof req.query.dark === 'string' && /^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(req.query.dark) ? '#' + req.query.dark : '#0b0820';
    const svg = await QRCode.toString(joinUrl(ev.code), {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      color: { dark, light: req.query.light === 'none' ? '#0000' : '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  } catch (e) { next(e); }
});

app.get('/api/events/:code/report', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (!hasKey(req, ev) && !ev.settings.publicReport) return res.status(403).json({ error: 'The presenter has not published this report.' });
  res.json(buildReport(ev));
});

app.get('/api/events/:code/export.csv', checkKey, (req, res) => {
  const ev = req.ev; const s = ev.startedAt || ev.createdAt;
  // quote every cell, and defuse text that a spreadsheet would run as a formula (=, +, -, @)
  const esc = v => `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : String(v ?? '')).replace(/"/g, '""')}"`;
  const rows = [['type', 'seconds_from_start', 'participant', 'value', 'mode_or_extra']];
  const name = pid => ev.participants[pid]?.name || pid;
  ev.ratings.forEach(r => rows.push(['rating', Math.round((r.t - s) / 1000), name(r.pid), r.v, r.mode]));
  ev.reactions.forEach(r => rows.push(['reaction', Math.round((r.t - s) / 1000), name(r.pid), r.e, '']));
  ev.messages.filter(m => !m.deleted).forEach(m => rows.push(['chat', Math.round((m.t - s) / 1000), m.name, m.text, m.pinned ? 'pinned' : '']));
  ev.questions.forEach(q => rows.push(['question', Math.round((q.t - s) / 1000), q.name, q.text, `${q.votes.length} votes`]));
  ev.pulseHistory.forEach(p => rows.push(['crowd_pulse', Math.round((p.t - s) / 1000), '', p.avg, `${p.online} online`]));
  // passive signals are exported as crowd-level figures only, never per person
  ev.pulseHistory.filter(p => p.att != null || p.focus != null).forEach(p => rows.push(['crowd_attention', Math.round((p.t - s) / 1000), '', p.att,
    `tab_focus=${p.focus ?? ''}; camera_attention=${p.cam ?? ''}; positive=${p.pos ?? ''}; fatigue=${p.fat ?? ''}; room_attention=${p.room ?? ''}; laughter=${p.laugh ?? ''}; applause=${p.clap ?? ''}`]));
  Object.entries(ev.feedback).forEach(([pid, f]) => rows.push(['feedback', '', name(pid), f.stars, `nps=${f.nps}; word=${f.word}; ${f.comment || ''}`]));
  res.type('text/csv').attachment(`crowdpulse-${ev.code}.csv`).send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

// Pretty routes
app.get('/e/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/event.html')));
app.get('/stage/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/stage.html')));
app.get('/report/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/report.html')));
app.get('/admin/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/control.html')));

// Errors: log them, never send a stack trace to the browser
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Request failed:', req.method, req.path, err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : 'Bad request' });
});

// ---------- core actions (shared by sockets + simulator) ----------
const lastAction = new Map(); // `${code}:${pid}:${kind}` -> ts
function throttled(code, pid, kind, ms) {
  const k = `${code}:${pid}:${kind}`; const now = Date.now();
  if (now - (lastAction.get(k) || 0) < ms) return true;
  lastAction.set(k, now); return false;
}
// forget throttle stamps and PIN lockouts once they no longer matter, so the maps can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastAction) if (now - t > 60000) lastAction.delete(k);
  for (const [ip, f] of pinFails) if (f.until < now && now - f.last > 15 * 60000) pinFails.delete(ip);
}, 60000).unref();

const actions = {
  join(code, p) {
    const ev = getEvent(code); if (!ev) return null;
    const existing = Object.hasOwn(ev.participants, p.pid) ? ev.participants[p.pid] : null;
    if (!existing && Object.keys(ev.participants).length >= MAX_PARTICIPANTS) return null;
    ev.participants[p.pid] = {
      ...existing,
      id: p.pid, name: clean(p.name, 32) || existing?.name || 'Guest', avatar: clean(p.avatar, 8) || existing?.avatar || '🙂',
      color: isColor(p.color) ? p.color : existing?.color || '#7c5cff',
      joinedAt: existing?.joinedAt || Date.now(), lastSeen: Date.now(), bot: !!p.bot,
    };
    if (p.bot) markOnline(code, p.pid, 1);
    store.save();
    return ev.participants[p.pid];
  },
  leave(code, pid) { markOnline(code, pid, -1); },
  rate(code, pid, v, mode) {
    const ev = getEvent(code); if (!ev || ev.status !== 'live' || !ev.participants[pid]) return;
    v = Math.max(0, Math.min(100, Math.round(Number(v))));
    if (!Number.isFinite(v)) return;
    const now = Date.now();
    const last = ev.latest?.[pid];
    ev.latest = ev.latest || {};
    // collapse rapid-fire slider drags into one sample
    if (last && now - last.t < 1500 && ev.ratings[last.i]?.pid === pid) {
      Object.assign(ev.ratings[last.i], { v, t: now, mode: clean(mode, 12) || 'slider' });
      last.t = now;
    } else {
      ev.ratings.push({ pid, v, t: now, mode: clean(mode, 12) || 'slider' });
      ev.latest[pid] = { i: ev.ratings.length - 1, t: now };
    }
    ev.participants[pid].lastSeen = now;
    ev.dirty = true; store.save();
  },
  react(code, pid, e) {
    const ev = getEvent(code); if (!ev || ev.status !== 'live' || !ev.settings.reactions || !REACTIONS.includes(e)) return;
    if (throttled(code, pid, 'react', 250) || ev.reactions.length >= MAX_REACTIONS) return;
    ev.reactions.push({ pid, e, t: Date.now() });
    io.to(code).emit('reaction', { e, pid: pubId(pid), color: ev.participants[pid]?.color });
    store.save();
  },
  chat(code, pid, text) {
    const ev = getEvent(code); if (!ev || !ev.settings.chat || ev.status === 'ended') return;
    const p = ev.participants[pid]; text = filter(clean(text, 280));
    if (!p || !text || throttled(code, pid, 'chat', 700)) return;
    const msg = { id: uid(), pid, name: p.name, avatar: p.avatar, color: p.color, text, t: Date.now(), role: pid === 'presenter' ? 'presenter' : 'guest' };
    ev.messages.push(msg); if (ev.messages.length > 5000) ev.messages.shift();
    io.to(code).emit('chat', msgView(msg)); store.save();
  },
  ask(code, pid, text) {
    const ev = getEvent(code); if (!ev || !ev.settings.qa || ev.status === 'ended') return;
    const p = ev.participants[pid]; text = filter(clean(text, 240));
    if (!p || !text || ev.questions.length >= MAX_QUESTIONS || throttled(code, pid, 'ask', 5000)) return;
    ev.questions.push({ id: uid(), pid, name: p.name, avatar: p.avatar, text, t: Date.now(), votes: [], answered: false, hidden: false });
    emitQuestions(ev); store.save();
  },
  voteQuestion(code, pid, qid) {
    const ev = getEvent(code); if (!ev) return;
    const q = ev.questions.find(x => x.id === qid); if (!q || q.hidden || !ev.participants[pid]) return;
    if (throttled(code, pid, 'vote-q', 300)) return;
    const i = q.votes.indexOf(pid);
    if (i >= 0) q.votes.splice(i, 1); else q.votes.push(pid);
    emitQuestions(ev); store.save();
  },
  pollVote(code, pid, pollId, idx) {
    const ev = getEvent(code); if (!ev) return;
    const poll = ev.polls.find(p => p.id === pollId);
    if (!poll || !poll.open || !ev.participants[pid] || !Number.isInteger(idx) || !(idx >= 0 && idx < poll.options.length)) return;
    if (Object.hasOwn(poll.voters, pid)) poll.options[poll.voters[pid]].votes--;
    poll.voters[pid] = idx; poll.options[idx].votes++;
    emitPolls(ev); store.save();
  },
  feedback(code, pid, f) {
    const ev = getEvent(code); if (!ev || !ev.participants[pid] || !isObj(f)) return;
    if (throttled(code, pid, 'feedback', 1000)) return;
    const n = (x, lo, hi) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Math.round(Number(x)))) : null);
    const aspects = {};
    for (const k of ['content', 'delivery', 'visuals', 'pace']) if (isObj(f.aspects) && f.aspects[k] != null) aspects[k] = n(f.aspects[k], 1, 5);
    ev.feedback[pid] = { stars: n(f.stars, 1, 5), nps: n(f.nps, 0, 10), word: filter(clean(f.word, 24)), comment: filter(clean(f.comment, 1000)), aspects, t: Date.now() };
    io.to('admin:' + code).emit('feedback-count', Object.keys(ev.feedback).length);
    store.save();
  },
};

const simApi = {
  ...actions, get: getEvent, onChange: code => { const ev = getEvent(code); if (ev) broadcastEvent(ev); },
  passive(code, pid, p) { const ev = getEvent(code); if (ev?.status === 'live') passive.record(ev, pid, p); },
  room(code, r) { const ev = getEvent(code); if (ev?.status === 'live') passive.recordRoom(ev, r); },
};

// Anything sent to attendees carries public ids (pubId), never the ids people use to act as themselves
const msgView = m => (m ? { ...m, pid: pubId(m.pid) } : m);
function questionsView(ev) {
  return ev.questions.filter(q => !q.hidden).map(q => ({ id: q.id, name: q.name, avatar: q.avatar, text: q.text, t: q.t, votes: q.votes.length, voters: q.votes.map(pubId), answered: q.answered }))
    .sort((a, b) => (a.answered - b.answered) || (b.votes - a.votes) || (a.t - b.t));
}
function pollsView(ev) {
  return ev.polls.map(p => ({ id: p.id, question: p.question, options: p.options, open: p.open, total: Object.keys(p.voters).length, t: p.t }));
}
const emitQuestions = ev => io.to(ev.code).emit('questions', questionsView(ev));
const emitPolls = ev => io.to(ev.code).emit('polls', pollsView(ev));
function broadcastEvent(ev) {
  io.to(ev.code).emit('event', publicEvent(ev));
  io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
}

function snapshot(ev, pid) {
  return {
    event: publicEvent(ev),
    messages: ev.messages.filter(m => !m.deleted).slice(-150).map(msgView),
    questions: questionsView(ev),
    polls: pollsView(ev),
    myVotes: Object.fromEntries(ev.polls.map(p => [p.id, pid && Object.hasOwn(p.voters, pid) ? p.voters[pid] : undefined])),
    pulse: ev.lastPulse || null,
    history: ev.pulseHistory.slice(-720),
    markers: ev.markers,
    announcement: ev.announcements[ev.announcements.length - 1] || null,
    myRating: pid && ev.latest && Object.hasOwn(ev.latest, pid) ? ev.ratings[ev.latest[pid].i]?.v : null,
    myFeedback: pid && Object.hasOwn(ev.feedback, pid) ? ev.feedback[pid] : null,
    reactions: REACTIONS,
  };
}

// ---------- live pulse loop ----------
let tickNo = 0;
setInterval(() => {
  tickNo++;
  const now = Date.now();
  for (const ev of Object.values(store.events)) {
    try { tickEvent(ev, now); } catch (e) { console.error('Pulse failed for', ev.code, e); }
  }
}, 1000);

function tickEvent(ev, now) {
  if (ev.status === 'scheduled' && presence.get(ev.code)?.size) { // lobby headcount for the stage view
    io.to(ev.code).emit('pulse', { t: now, avg: null, n: 0, online: online(ev.code), dist: [0, 0, 0, 0, 0], energy: 0, rpm: 0, mpm: 0, momentum: 0, elapsed: 0 });
  }
  if (ev.status !== 'live') return;
  const onlineMap = presence.get(ev.code) || new Map();
  const vals = [];
  for (const [pid, l] of Object.entries(ev.latest || {})) {
    const r = ev.ratings[l.i]; if (!r) continue;
    if (onlineMap.has(pid) || now - r.t < 180000) vals.push(r.v);
  }
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const dist = [0, 0, 0, 0, 0]; vals.forEach(v => dist[Math.min(4, Math.floor(v / 20))]++);
  const recentReacts = ev.reactions.filter(r => now - r.t < 60000).length;
  const recentMsgs = ev.messages.filter(m => now - m.t < 60000).length;
  const onlineN = onlineMap.size;
  const energy = Math.min(100, Math.round(((recentReacts + recentMsgs * 2) / Math.max(1, onlineN)) * 25));
  const prev = ev.pulseHistory.length ? ev.pulseHistory[Math.max(0, ev.pulseHistory.length - 6)] : null;
  const pulse = {
    t: now, avg: avg == null ? null : Math.round(avg * 10) / 10, n: vals.length, online: onlineN, dist, energy,
    rpm: recentReacts, mpm: recentMsgs, momentum: avg != null && prev?.avg != null ? Math.round((avg - prev.avg) * 10) / 10 : 0,
    elapsed: now - ev.startedAt,
    passive: passive.aggregate(ev, onlineMap, now),
  };
  ev.lastPulse = pulse;
  io.to(ev.code).emit('pulse', pulse);
  if (tickNo % 5 === 0) {
    const point = { t: now, avg: pulse.avg, n: pulse.n, online: onlineN, energy, ...passive.historyFields(pulse.passive) };
    ev.pulseHistory.push(point);
    io.to(ev.code).emit('history-point', point);
    io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
    store.save();
  }
}

// ---------- sockets ----------
io.on('connection', socket => {
  let ctx = { code: null, pid: null, admin: false };
  // Every handler runs inside try/catch: socket.io doesn't catch handler errors, so one bad payload would stop the server.
  // The last argument is only treated as an acknowledgement callback when it really is a function.
  const on = (name, fn) => socket.on(name, (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
    try { fn(args[0], ack); } catch (e) { console.error(`Socket "${name}" failed:`, e); ack?.({ error: 'Something went wrong' }); }
  });
  // leave the session this socket was in before (a socket can switch sessions or rejoin)
  function leaveCurrent() {
    if (ctx.code && ctx.pid && !ctx.admin) markOnline(ctx.code, ctx.pid, -1);
    if (ctx.code) { socket.leave(ctx.code); socket.leave('admin:' + ctx.code); }
    ctx = { code: null, pid: null, admin: false };
  }

  on('join', (p, ack) => {
    const ev = getEvent(p?.code);
    if (!ev) return ack?.({ error: 'No event with that code' });
    const pid = validPid(p.pid) ? p.pid : newPid();
    if (ctx.code !== ev.code || ctx.pid !== pid || ctx.admin) {
      if (!actions.join(ev.code, { ...p, pid, bot: false })) return ack?.({ error: 'This session is full' });
      leaveCurrent();
      markOnline(ev.code, pid, 1);
    } else actions.join(ev.code, { ...p, pid, bot: false });
    ctx = { code: ev.code, pid, admin: false };
    socket.join(ev.code);
    ack?.({ pid, pub: pubId(pid), me: ev.participants[pid], ...snapshot(ev, pid) });
    io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
  });

  on('watch', (p, ack) => { // stage / big-screen view (read-only)
    const ev = getEvent(p?.code); if (!ev) return ack?.({ error: 'No event' });
    socket.join(ev.code); ack?.({ ...snapshot(ev), joinUrl: joinUrl(ev.code) });
  });

  on('profile', p => {
    if (!ctx.pid || ctx.admin || !isObj(p)) return; const ev = getEvent(ctx.code); if (!ev) return;
    if (throttled(ctx.code, ctx.pid, 'profile', 1000)) return;
    actions.join(ctx.code, { ...ev.participants[ctx.pid], name: p.name, avatar: p.avatar, color: p.color, pid: ctx.pid, bot: false });
  });
  on('rate', p => ctx.pid && actions.rate(ctx.code, ctx.pid, p?.v, p?.mode));
  on('react', e => ctx.pid && actions.react(ctx.code, ctx.pid, e));
  on('chat', text => ctx.pid && actions.chat(ctx.code, ctx.pid, text));
  on('ask', text => ctx.pid && actions.ask(ctx.code, ctx.pid, text));
  on('vote-q', qid => ctx.pid && actions.voteQuestion(ctx.code, ctx.pid, qid));
  on('poll-vote', p => ctx.pid && actions.pollVote(ctx.code, ctx.pid, p?.pollId, typeof p?.idx === 'number' ? p.idx : Number.NaN));
  // passive signals from an attendee's own device (numbers only; see lib/passive.js)
  on('passive', p => {
    if (!ctx.pid || ctx.admin) return; const ev = getEvent(ctx.code); if (!ev || ev.status !== 'live') return;
    if (throttled(ctx.code, ctx.pid, 'passive', 1500)) return;
    passive.record(ev, ctx.pid, p || {}); store.save();
  });
  on('passive-off', () => { const ev = getEvent(ctx.code); if (ev && ctx.pid) { passive.stopCamera(ev, ctx.pid); store.save(); } });
  on('feedback', (f, ack) => { if (ctx.pid) { actions.feedback(ctx.code, ctx.pid, f || {}); ack?.({ ok: true }); } });
  on('typing', () => ctx.pid && !throttled(ctx.code, ctx.pid, 'typing', 1000) && socket.to(ctx.code).emit('typing', { name: getEvent(ctx.code)?.participants[ctx.pid]?.name }));

  // ----- presenter controls -----
  on('admin-join', (p, ack) => {
    const ev = getEvent(p?.code);
    if (!ev || !safeEqual(p.key, ev.adminKey)) return ack?.({ error: 'Invalid admin key' });
    leaveCurrent();
    ctx = { code: ev.code, pid: 'presenter', admin: true };
    socket.join(ev.code); socket.join('admin:' + ev.code);
    ev.participants.presenter ||= { id: 'presenter', name: ev.presenter || 'Presenter', avatar: '🎤', color: ev.accent, joinedAt: Date.now(), presenter: true };
    ack?.({ ...snapshot(ev), summary: summary(ev), feedbackCount: Object.keys(ev.feedback).length, allQuestions: ev.questions });
  });

  const admin = (name, fn) => on(name, (p, ack) => {
    if (!ctx.admin) return ack?.({ error: 'Not authorised' });
    const ev = getEvent(ctx.code); if (!ev) return ack?.({ error: 'Event not found' });
    const out = fn(ev, isObj(p) ? p : {}); store.save(); ack?.(out || { ok: true });
  });

  admin('admin:start', ev => {
    if (ev.status === 'live') return;
    ev.status = 'live'; ev.startedAt = ev.startedAt || Date.now(); ev.endedAt = null;
    systemMsg(ev, '🎬 The session is now live! Rate along as you go.');
    broadcastEvent(ev);
  });
  admin('admin:end', ev => {
    ev.status = 'ended'; ev.endedAt = Date.now();
    ev.polls.forEach(p => { p.open = false; });
    systemMsg(ev, '🏁 The session has ended — thanks for joining! Please leave a quick review.');
    broadcastEvent(ev); emitPolls(ev);
  });
  admin('admin:reopen', ev => { ev.status = 'live'; ev.endedAt = null; broadcastEvent(ev); });
  admin('admin:reset', ev => {
    Object.assign(ev, { status: 'scheduled', startedAt: null, endedAt: null, ratings: [], reactions: [], messages: [], questions: [], polls: [],
      feedback: {}, pulseHistory: [], markers: [], announcements: [], latest: {}, lastPulse: null, passive: [], passiveLatest: {}, roomSignals: [] });
    broadcastEvent(ev); emitPolls(ev); emitQuestions(ev); io.to(ev.code).emit('reset');
  });
  admin('admin:settings', (ev, p) => { ev.settings = mergeSettings(ev.settings, p); broadcastEvent(ev); });
  admin('admin:chat', (ev, p) => { actions.chat(ev.code, 'presenter', p.text); });
  admin('admin:msg-delete', (ev, p) => {
    const m = ev.messages.find(x => x.id === p.id); if (m) { m.deleted = true; io.to(ev.code).emit('chat-delete', m.id); }
  });
  admin('admin:msg-pin', (ev, p) => {
    ev.messages.forEach(x => { x.pinned = x.id === p.id ? !x.pinned : false; });
    const m = ev.messages.find(x => x.id === p.id);
    io.to(ev.code).emit('pinned', m?.pinned ? msgView(m) : null);
  });
  admin('admin:q', (ev, p) => {
    const q = ev.questions.find(x => x.id === p.id); if (!q) return;
    if (p.action === 'answer') q.answered = !q.answered;
    if (p.action === 'hide') q.hidden = true;
    if (p.action === 'spotlight') io.to(ev.code).emit('spotlight', { text: q.text, name: q.name, avatar: q.avatar });
    emitQuestions(ev);
  });
  admin('admin:poll-create', (ev, p) => {
    const options = (Array.isArray(p.options) ? p.options : []).map(o => clean(o, 80)).filter(Boolean).slice(0, 6);
    const question = clean(p.question, 160);
    if (!question || options.length < 2) return { error: 'A poll needs a question and at least 2 options' };
    ev.polls.forEach(x => { x.open = false; });
    ev.polls.push({ id: uid(), question, options: options.map(text => ({ text, votes: 0 })), voters: {}, open: true, t: Date.now() });
    emitPolls(ev);
  });
  admin('admin:poll-close', (ev, p) => { const poll = ev.polls.find(x => x.id === p.id); if (poll) poll.open = false; emitPolls(ev); });
  admin('admin:marker', (ev, p) => {
    const label = clean(p.label, 60); if (!label) return;
    const m = { label, t: Date.now() }; ev.markers.push(m);
    io.to(ev.code).emit('marker', m);
    systemMsg(ev, `📍 Now: ${label}`);
  });
  admin('admin:announce', (ev, p) => {
    const a = { text: clean(p.text, 200), t: Date.now() };
    if (!a.text) return { error: 'Write a message first' };
    ev.announcements.push(a); io.to(ev.code).emit('announce', a);
  });
  admin('admin:confetti', ev => io.to(ev.code).emit('confetti'));
  // the presenter device's room reading: face counts from its camera, laughter/applause from its microphone
  admin('admin:room', (ev, p) => { if (ev.status === 'live' && !throttled(ev.code, 'presenter', 'room', 800)) passive.recordRoom(ev, p); });
  admin('admin:simulate', (ev, p) => {
    if (p.on) sim.start(ev.code, simApi, Math.max(3, Math.min(150, Number(p.count) || 24)));
    else sim.stop(ev.code, simApi);
    return { simulating: sim.running(ev.code) };
  });

  on('disconnect', () => {
    const { code, admin: wasAdmin } = ctx;
    leaveCurrent();
    const ev = !wasAdmin && getEvent(code); if (ev) io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
  });
});

function systemMsg(ev, text) {
  const msg = { id: uid(), pid: 'system', name: 'CrowdPulse', avatar: '✨', color: ev.accent, text, t: Date.now(), role: 'system' };
  ev.messages.push(msg); if (ev.messages.length > 5000) ev.messages.shift();
  io.to(ev.code).emit('chat', msg);
}

process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

async function start() {
  if (ADMIN_PIN && ADMIN_PIN.length < PIN_MIN_LENGTH) {
    console.error(`\n  ADMIN_PIN must be at least ${PIN_MIN_LENGTH} characters (a short PIN can be guessed). Choose a longer one and start again.\n`);
    process.exit(1);
  }
  let tls = null;
  if (HTTPS_ON) {
    try {
      tls = await loadTls(store.DATA_DIR);
      server.setSecureContext({ cert: tls.cert, key: tls.key });
    } catch (e) {
      console.error(`\n  Could not set up HTTPS: ${e.message}\n`);
      process.exit(1);
    }
  }
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `\n  Port ${PORT} is already in use. Stop the other copy of CrowdPulse, or start with a different PORT.\n` : e);
    process.exit(1);
  });
  server.listen(PORT, () => {
    const scheme = HTTPS_ON ? 'https' : 'http';
    console.log(`\n  ✨ CrowdPulse is live${HTTPS_ON ? ' (HTTPS)' : ''}\n`);
    console.log(`  Admin:   ${scheme}://localhost:${PORT}/admin`);
    console.log(`  Network: ${baseUrl()}  (QR codes point here so phones on your Wi-Fi can join)`);
    if (ADMIN_PIN) console.log('  Admin PIN protection is ON');
    if (tls && tls.source !== 'custom') {
      console.log(`\n  🔒 Using a self-made certificate (${tls.source === 'new' ? 'just created' : 'saved'}: ${path.relative(process.cwd(), tls.file)})`);
      console.log('     Browsers will warn that the connection is "not private" the first time. That is expected:');
      console.log('     tap "Advanced" → "Proceed" (Chrome/Android) or "Show Details" → "visit this website" (Safari/iPhone).');
      console.log(`     To check it's really this laptop, the certificate's SHA-256 fingerprint is:\n     ${tls.fingerprint}`);
    } else if (tls) {
      console.log(`\n  🔒 Using your certificate: ${tls.file}`);
    } else if (!joinIsSecure()) {
      console.log('\n  📷 Phones can only use attendee cameras over https. To turn it on, start with:  npm run secure');
    }
    console.log('');
  });
}
start();
