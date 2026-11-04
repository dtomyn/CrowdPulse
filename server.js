// CrowdPulse — live audience rating server
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const store = require('./lib/store');
const { buildReport, publicEvent } = require('./lib/analytics');
const sim = require('./lib/simulator');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || ''; // optional: protect admin screens
const REACTIONS = ['👏', '🔥', '😂', '🤯', '❤️', '🤔', '🎉', '😴'];
const BAD_WORDS = /\b(fuck|shit|bitch|cunt|asshole|dick|bastard)\b/gi;

store.load();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));
// The explainer film's director page (film/studio). Only served when rendering the film.
if (process.env.CROWDPULSE_STUDIO) app.use('/studio', express.static(path.join(__dirname, 'film/studio')));

// ---------- helpers ----------
function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal && !/^169\.254/.test(ni.address)) return ni.address;
  }
  return 'localhost';
}
const baseUrl = () => process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`;
const joinUrl = code => `${baseUrl()}/e/${code}`;

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code;
  do { code = Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join(''); } while (store.events[code]);
  return code;
}
const uid = () => crypto.randomBytes(6).toString('hex');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const filter = s => s.replace(BAD_WORDS, m => m[0] + '*'.repeat(m.length - 1));
const getEvent = code => store.events[String(code || '').toUpperCase()];

function checkPin(req, res, next) {
  if (!ADMIN_PIN || req.get('x-admin-pin') === ADMIN_PIN) return next();
  res.status(401).json({ error: 'Admin PIN required' });
}
function checkKey(req, res, next) {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (req.get('x-admin-key') !== ev.adminKey && req.query.key !== ev.adminKey) return res.status(403).json({ error: 'Forbidden' });
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
    },
    simulating: sim.running(ev.code),
  };
}

// ---------- REST API ----------
app.get('/api/config', (req, res) => res.json({ pinRequired: !!ADMIN_PIN, baseUrl: baseUrl(), reactions: REACTIONS }));

app.get('/api/events', checkPin, (req, res) => {
  res.json(Object.values(store.events).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)).map(summary));
});

app.post('/api/events', checkPin, (req, res) => {
  const b = req.body || {};
  const title = clean(b.title, 120);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const mode = ['in-person', 'virtual', 'hybrid'].includes(b.location?.mode) ? b.location.mode : 'virtual';
  const code = newCode();
  const ev = {
    code, adminKey: uid() + uid(), title,
    description: clean(b.description, 2000), presenter: clean(b.presenter, 80),
    startsAt: b.startsAt || new Date().toISOString(), durationMin: Math.max(5, Math.min(1440, Number(b.durationMin) || 60)),
    location: { mode, venue: clean(b.location?.venue, 120), address: clean(b.location?.address, 200), url: clean(b.location?.url, 300) },
    accent: /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : '#7c5cff',
    settings: {
      chat: b.settings?.chat !== false, qa: b.settings?.qa !== false, reactions: b.settings?.reactions !== false,
      publicReport: !!b.settings?.publicReport, showCrowdMood: b.settings?.showCrowdMood !== false,
    },
    status: 'scheduled', createdAt: Date.now(), startedAt: null, endedAt: null,
    participants: {}, ratings: [], reactions: [], messages: [], questions: [], polls: [], feedback: {},
    pulseHistory: [], markers: [], announcements: [],
  };
  store.events[code] = ev; store.save();
  res.json(summary(ev));
});

app.put('/api/events/:code', checkKey, (req, res) => {
  const ev = req.ev, b = req.body || {};
  if (b.title) ev.title = clean(b.title, 120);
  if ('description' in b) ev.description = clean(b.description, 2000);
  if ('presenter' in b) ev.presenter = clean(b.presenter, 80);
  if (b.startsAt) ev.startsAt = b.startsAt;
  if (b.durationMin) ev.durationMin = Math.max(5, Math.min(1440, Number(b.durationMin)));
  if (b.location) ev.location = { ...ev.location, ...b.location };
  if (b.accent && /^#[0-9a-f]{6}$/i.test(b.accent)) ev.accent = b.accent;
  if (b.settings) ev.settings = { ...ev.settings, ...b.settings };
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
    code, adminKey: uid() + uid(), title: src.title + ' (copy)', status: 'scheduled', createdAt: Date.now(), startedAt: null, endedAt: null,
    participants: {}, ratings: [], reactions: [], messages: [], questions: [], polls: [], feedback: {}, pulseHistory: [], markers: [], announcements: [],
  });
  delete copy.lastPulse;
  store.events[code] = copy; store.save();
  res.json(summary(copy));
});

app.get('/api/events/:code/public', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'No event with that code' });
  res.json({ ...publicEvent(ev), joinUrl: joinUrl(ev.code) });
});

app.get('/api/events/:code/qr.svg', async (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).end();
  const svg = await QRCode.toString(joinUrl(ev.code), {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    color: { dark: req.query.dark ? '#' + req.query.dark.replace(/[^0-9a-f]/gi, '') : '#0b0820', light: req.query.light === 'none' ? '#0000' : '#ffffff' },
  });
  res.type('image/svg+xml').send(svg);
});

app.get('/api/events/:code/report', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const isAdmin = req.get('x-admin-key') === ev.adminKey || req.query.key === ev.adminKey;
  if (!isAdmin && !ev.settings.publicReport) return res.status(403).json({ error: 'The presenter has not published this report.' });
  res.json(buildReport(ev));
});

app.get('/api/events/:code/export.csv', checkKey, (req, res) => {
  const ev = req.ev; const s = ev.startedAt || ev.createdAt;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['type', 'seconds_from_start', 'participant', 'value', 'mode_or_extra']];
  const name = pid => ev.participants[pid]?.name || pid;
  ev.ratings.forEach(r => rows.push(['rating', Math.round((r.t - s) / 1000), name(r.pid), r.v, r.mode]));
  ev.reactions.forEach(r => rows.push(['reaction', Math.round((r.t - s) / 1000), name(r.pid), r.e, '']));
  ev.messages.filter(m => !m.deleted).forEach(m => rows.push(['chat', Math.round((m.t - s) / 1000), m.name, m.text, m.pinned ? 'pinned' : '']));
  ev.questions.forEach(q => rows.push(['question', Math.round((q.t - s) / 1000), q.name, q.text, `${q.votes.length} votes`]));
  ev.pulseHistory.forEach(p => rows.push(['crowd_pulse', Math.round((p.t - s) / 1000), '', p.avg, `${p.online} online`]));
  Object.entries(ev.feedback).forEach(([pid, f]) => rows.push(['feedback', '', name(pid), f.stars, `nps=${f.nps}; word=${f.word}; ${f.comment || ''}`]));
  res.type('text/csv').attachment(`crowdpulse-${ev.code}.csv`).send(rows.map(r => r.map(esc).join(',')).join('\n'));
});

// Pretty routes
app.get('/e/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/event.html')));
app.get('/stage/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/stage.html')));
app.get('/report/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/report.html')));
app.get('/admin/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/control.html')));

// ---------- core actions (shared by sockets + simulator) ----------
const lastAction = new Map(); // `${code}:${pid}:${kind}` -> ts
function throttled(code, pid, kind, ms) {
  const k = `${code}:${pid}:${kind}`; const now = Date.now();
  if (now - (lastAction.get(k) || 0) < ms) return true;
  lastAction.set(k, now); return false;
}

const actions = {
  join(code, p) {
    const ev = getEvent(code); if (!ev) return null;
    const existing = ev.participants[p.pid];
    ev.participants[p.pid] = {
      id: p.pid, name: clean(p.name, 32) || existing?.name || 'Guest', avatar: clean(p.avatar, 8) || existing?.avatar || '🙂',
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : existing?.color || '#7c5cff',
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
      Object.assign(ev.ratings[last.i], { v, t: now, mode });
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
    if (throttled(code, pid, 'react', 250)) return;
    ev.reactions.push({ pid, e, t: Date.now() });
    io.to(code).emit('reaction', { e, pid, color: ev.participants[pid]?.color });
    store.save();
  },
  chat(code, pid, text) {
    const ev = getEvent(code); if (!ev || !ev.settings.chat || ev.status === 'ended') return;
    const p = ev.participants[pid]; text = filter(clean(text, 280));
    if (!p || !text || throttled(code, pid, 'chat', 700)) return;
    const msg = { id: uid(), pid, name: p.name, avatar: p.avatar, color: p.color, text, t: Date.now(), role: pid === 'presenter' ? 'presenter' : 'guest' };
    ev.messages.push(msg); if (ev.messages.length > 5000) ev.messages.shift();
    io.to(code).emit('chat', msg); store.save();
  },
  ask(code, pid, text) {
    const ev = getEvent(code); if (!ev || !ev.settings.qa || ev.status === 'ended') return;
    const p = ev.participants[pid]; text = filter(clean(text, 240));
    if (!p || !text || throttled(code, pid, 'ask', 5000)) return;
    ev.questions.push({ id: uid(), pid, name: p.name, avatar: p.avatar, text, t: Date.now(), votes: [], answered: false, hidden: false });
    emitQuestions(ev); store.save();
  },
  voteQuestion(code, pid, qid) {
    const ev = getEvent(code); if (!ev) return;
    const q = ev.questions.find(x => x.id === qid); if (!q || !ev.participants[pid]) return;
    const i = q.votes.indexOf(pid);
    if (i >= 0) q.votes.splice(i, 1); else q.votes.push(pid);
    emitQuestions(ev); store.save();
  },
  pollVote(code, pid, pollId, idx) {
    const ev = getEvent(code); if (!ev) return;
    const poll = ev.polls.find(p => p.id === pollId);
    if (!poll || !poll.open || !ev.participants[pid] || !(idx >= 0 && idx < poll.options.length)) return;
    if (pid in poll.voters) poll.options[poll.voters[pid]].votes--;
    poll.voters[pid] = idx; poll.options[idx].votes++;
    emitPolls(ev); store.save();
  },
  feedback(code, pid, f) {
    const ev = getEvent(code); if (!ev || !ev.participants[pid]) return;
    const n = (x, lo, hi) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Math.round(Number(x)))) : null);
    const aspects = {};
    for (const k of ['content', 'delivery', 'visuals', 'pace']) if (f.aspects?.[k] != null) aspects[k] = n(f.aspects[k], 1, 5);
    ev.feedback[pid] = { stars: n(f.stars, 1, 5), nps: n(f.nps, 0, 10), word: filter(clean(f.word, 24)), comment: filter(clean(f.comment, 1000)), aspects, t: Date.now() };
    io.to('admin:' + code).emit('feedback-count', Object.keys(ev.feedback).length);
    store.save();
  },
};

const simApi = { ...actions, get: getEvent, onChange: code => { const ev = getEvent(code); if (ev) broadcastEvent(ev); } };

function questionsView(ev) {
  return ev.questions.filter(q => !q.hidden).map(q => ({ id: q.id, name: q.name, avatar: q.avatar, text: q.text, t: q.t, votes: q.votes.length, voters: q.votes, answered: q.answered }))
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
    messages: ev.messages.filter(m => !m.deleted).slice(-150),
    questions: questionsView(ev),
    polls: pollsView(ev),
    myVotes: Object.fromEntries(ev.polls.map(p => [p.id, p.voters[pid]])),
    pulse: ev.lastPulse || null,
    history: ev.pulseHistory.slice(-720),
    markers: ev.markers,
    announcement: ev.announcements[ev.announcements.length - 1] || null,
    myRating: pid && ev.latest?.[pid] ? ev.ratings[ev.latest[pid].i]?.v : null,
    myFeedback: pid ? ev.feedback[pid] || null : null,
    reactions: REACTIONS,
  };
}

// ---------- live pulse loop ----------
let tickNo = 0;
setInterval(() => {
  tickNo++;
  const now = Date.now();
  for (const ev of Object.values(store.events)) {
    if (ev.status === 'scheduled' && presence.get(ev.code)?.size) { // lobby headcount for the stage view
      io.to(ev.code).emit('pulse', { t: now, avg: null, n: 0, online: online(ev.code), dist: [0, 0, 0, 0, 0], energy: 0, rpm: 0, mpm: 0, momentum: 0, elapsed: 0 });
    }
    if (ev.status !== 'live') continue;
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
    };
    ev.lastPulse = pulse;
    io.to(ev.code).emit('pulse', pulse);
    if (tickNo % 5 === 0) {
      const point = { t: now, avg: pulse.avg, n: pulse.n, online: onlineN, energy };
      ev.pulseHistory.push(point);
      io.to(ev.code).emit('history-point', point);
      io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
      store.save();
    }
  }
}, 1000);

// ---------- sockets ----------
io.on('connection', socket => {
  let ctx = { code: null, pid: null, admin: false };

  socket.on('join', (p, ack) => {
    const ev = getEvent(p?.code);
    if (!ev) return ack?.({ error: 'No event with that code' });
    const pid = clean(p.pid, 40) || uid();
    actions.join(ev.code, { ...p, pid, bot: false });
    if (ctx.pid !== pid || ctx.code !== ev.code) markOnline(ev.code, pid, 1);
    ctx = { code: ev.code, pid, admin: false };
    socket.join(ev.code);
    ack?.({ pid, me: ev.participants[pid], ...snapshot(ev, pid) });
    io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
  });

  socket.on('watch', (p, ack) => { // stage / big-screen view (read-only)
    const ev = getEvent(p?.code); if (!ev) return ack?.({ error: 'No event' });
    socket.join(ev.code); ack?.({ ...snapshot(ev), joinUrl: joinUrl(ev.code) });
  });

  socket.on('profile', p => {
    if (!ctx.pid) return; const ev = getEvent(ctx.code); if (!ev) return;
    actions.join(ctx.code, { ...ev.participants[ctx.pid], ...p, pid: ctx.pid });
  });
  socket.on('rate', p => ctx.pid && actions.rate(ctx.code, ctx.pid, p?.v, p?.mode));
  socket.on('react', e => ctx.pid && actions.react(ctx.code, ctx.pid, e));
  socket.on('chat', text => ctx.pid && actions.chat(ctx.code, ctx.pid, text));
  socket.on('ask', text => ctx.pid && actions.ask(ctx.code, ctx.pid, text));
  socket.on('vote-q', qid => ctx.pid && actions.voteQuestion(ctx.code, ctx.pid, qid));
  socket.on('poll-vote', p => ctx.pid && actions.pollVote(ctx.code, ctx.pid, p?.pollId, Number(p?.idx)));
  socket.on('feedback', (f, ack) => { if (ctx.pid) { actions.feedback(ctx.code, ctx.pid, f || {}); ack?.({ ok: true }); } });
  socket.on('typing', () => ctx.pid && socket.to(ctx.code).emit('typing', { name: getEvent(ctx.code)?.participants[ctx.pid]?.name }));

  // ----- presenter controls -----
  socket.on('admin-join', (p, ack) => {
    const ev = getEvent(p?.code);
    if (!ev || p.key !== ev.adminKey) return ack?.({ error: 'Invalid admin key' });
    ctx = { code: ev.code, pid: 'presenter', admin: true };
    socket.join(ev.code); socket.join('admin:' + ev.code);
    ev.participants.presenter ||= { id: 'presenter', name: ev.presenter || 'Presenter', avatar: '🎤', color: ev.accent, joinedAt: Date.now(), presenter: true };
    ack?.({ ...snapshot(ev), summary: summary(ev), feedbackCount: Object.keys(ev.feedback).length, allQuestions: ev.questions });
  });

  const admin = (name, fn) => socket.on(name, (p, ack) => {
    if (!ctx.admin) return ack?.({ error: 'Not authorised' });
    const ev = getEvent(ctx.code); if (!ev) return;
    const out = fn(ev, p || {}); store.save(); ack?.(out || { ok: true });
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
      feedback: {}, pulseHistory: [], markers: [], announcements: [], latest: {}, lastPulse: null });
    broadcastEvent(ev); emitPolls(ev); emitQuestions(ev); io.to(ev.code).emit('reset');
  });
  admin('admin:settings', (ev, p) => { ev.settings = { ...ev.settings, ...p }; broadcastEvent(ev); });
  admin('admin:chat', (ev, p) => { actions.chat(ev.code, 'presenter', p.text); });
  admin('admin:msg-delete', (ev, p) => {
    const m = ev.messages.find(x => x.id === p.id); if (m) { m.deleted = true; io.to(ev.code).emit('chat-delete', m.id); }
  });
  admin('admin:msg-pin', (ev, p) => {
    ev.messages.forEach(x => { x.pinned = x.id === p.id ? !x.pinned : false; });
    const m = ev.messages.find(x => x.id === p.id);
    io.to(ev.code).emit('pinned', m?.pinned ? m : null);
  });
  admin('admin:q', (ev, p) => {
    const q = ev.questions.find(x => x.id === p.id); if (!q) return;
    if (p.action === 'answer') q.answered = !q.answered;
    if (p.action === 'hide') q.hidden = true;
    if (p.action === 'spotlight') io.to(ev.code).emit('spotlight', { text: q.text, name: q.name, avatar: q.avatar });
    emitQuestions(ev);
  });
  admin('admin:poll-create', (ev, p) => {
    const options = (p.options || []).map(o => clean(o, 80)).filter(Boolean).slice(0, 6);
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
    ev.announcements.push(a); io.to(ev.code).emit('announce', a);
  });
  admin('admin:confetti', ev => io.to(ev.code).emit('confetti'));
  admin('admin:simulate', (ev, p) => {
    if (p.on) sim.start(ev.code, simApi, Math.max(3, Math.min(150, Number(p.count) || 24)));
    else sim.stop(ev.code, simApi);
    return { simulating: sim.running(ev.code) };
  });

  socket.on('disconnect', () => {
    if (ctx.code && ctx.pid && !ctx.admin) {
      markOnline(ctx.code, ctx.pid, -1);
      const ev = getEvent(ctx.code); if (ev) io.to('admin:' + ev.code).emit('admin-summary', summary(ev));
    }
  });
});

function systemMsg(ev, text) {
  const msg = { id: uid(), pid: 'system', name: 'CrowdPulse', avatar: '✨', color: ev.accent, text, t: Date.now(), role: 'system' };
  ev.messages.push(msg); io.to(ev.code).emit('chat', msg);
}

process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

server.listen(PORT, () => {
  console.log(`\n  ✨ CrowdPulse is live\n`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log(`  Network: ${baseUrl()}  (QR codes point here so phones on your Wi-Fi can join)`);
  if (ADMIN_PIN) console.log('  Admin PIN protection is ON');
  console.log('');
});
