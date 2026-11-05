// The film's in-page stand-in for server.js: the same socket protocol and rules, run on the film clock,
// with a scripted audience so every take is identical.
(function () {
  const REACTIONS = ['👏', '🔥', '😂', '🤯', '❤️', '🤔', '🎉', '😴'];
  const NAMES = ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Kai', 'Isla', 'Omar', 'Priya', 'Leo', 'Yuki', 'Sven', 'Amara', 'Diego', 'Nora', 'Ezra',
    'Lena', 'Ravi', 'Chloe', 'Mateo', 'Freya', 'Jonas', 'Aisha', 'Theo', 'Ines', 'Hugo', 'Maya', 'Felix', 'Sara', 'Arjun', 'Elsa', 'Kofi',
    'Luna', 'Max', 'Rosa', 'Ivan', 'Nia', 'Oscar', 'Tara', 'Ben', 'Wren', 'Hana', 'Rafa', 'Mila', 'Otto', 'June', 'Cyrus', 'Pia'];
  const AVATARS = ['🦊', '🐼', '🐙', '🦄', '🐯', '🐸', '🦉', '🐨', '🐧', '🦁', '🐳', '🦖', '🐝', '🦋', '🐢', '🦩'];
  const COLORS = ['#ff6b9d', '#7c5cff', '#2ee6a6', '#ffb547', '#3ec5ff', '#ff7a45', '#c86bff', '#5ef0ff'];
  const MODES = ['slider', 'slider', 'slider', 'smiley', 'stars', 'dial', 'weather', 'thermo', 'emoji', 'thumbs'];
  const LINES = {
    high: ['This is fantastic 🔥', 'Love this section!', 'Wow, mind blown 🤯', 'Super clear explanation', 'Best talk today', 'So useful, thanks!',
      'Great demo!!', 'This is gold 💯', 'Amazing visuals', 'Taking so many notes', '👏👏👏', 'Brilliant point'],
    mid: ['Interesting', 'Makes sense', 'Good point', 'Following along', 'Nice', 'Hmm, curious about this', 'Solid so far', 'Agree with that'],
    low: ['A bit lost here', 'Could you slow down?', 'Not sure I follow', 'Slides are hard to read'],
  };
  const LOBBY = ['Hi everyone 👋', 'Excited for this one!', 'Hello from the back row', 'Good afternoon!', 'Joining from Toronto 🍁', 'Can’t wait'];

  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clamp = v => Math.max(0, Math.min(100, v));
  let idn = 0;
  const uid = () => 'f' + (++idn).toString(36);
  const clone = (win, d) => (d === undefined ? undefined : win.JSON.parse(JSON.stringify(d)));

  const S = (window.__server = {
    ev: null, sockets: new Set(), bots: [], moodTarget: 62, react: 1, chatty: 1, online: new Map(), pending: [],
    distract: 0, passiveLatest: {}, room: null,
  });

  S.init = base => {
    S.ev = {
      ...base, status: 'scheduled', startedAt: null, endedAt: null, createdAt: Date.now() - 600000,
      participants: {}, ratings: [], latest: {}, reactions: [], messages: [], questions: [], polls: [], feedback: {},
      pulseHistory: [], markers: [], announcements: [], lastPulse: null,
    };
    setInterval(tick, 1000);
  };

  // ---------- sockets ----------
  S.connect = win => {
    const sock = { win, token: win.__film.token, handlers: {}, admin: false, pid: null, watching: false };
    sock.on = (n, f) => { (sock.handlers[n] ||= []).push(f); return sock; };
    sock.off = () => sock;
    sock.emit = (n, p, ack) => { handle(sock, n, p, ack); return sock; };
    S.sockets.add(sock);
    win.setTimeout(() => fire(sock, 'connect'), 0);
    return sock;
  };
  const alive = sock => { try { return sock.win.__film && sock.win.__film.token === sock.token; } catch { return false; } };
  function fire(sock, n, d) { if (!alive(sock)) return drop(sock); (sock.handlers[n] || []).forEach(f => { try { f(clone(sock.win, d)); } catch (e) { console.error(e); } }); }
  function send(sock, n, d) { if (!alive(sock)) return drop(sock); sock.win.setTimeout(() => fire(sock, n, d), 0); }
  function drop(sock) { if (!S.sockets.has(sock)) return; S.sockets.delete(sock); if (sock.pid && !sock.admin) markOnline(sock.pid, -1); }
  const emitAll = (n, d) => [...S.sockets].forEach(k => send(k, n, d));
  const emitAdmins = (n, d) => [...S.sockets].filter(k => k.admin).forEach(k => send(k, n, d));
  const ackTo = (sock, ack, d) => { if (typeof ack === 'function') sock.win.setTimeout(() => { if (alive(sock)) ack(clone(sock.win, d)); }, 0); };

  function markOnline(pid, delta) { const n = (S.online.get(pid) || 0) + delta; if (n <= 0) S.online.delete(pid); else S.online.set(pid, n); }

  // ---------- views ----------
  const pub = () => { const e = S.ev; return { code: e.code, title: e.title, description: e.description, presenter: e.presenter, startsAt: e.startsAt, durationMin: e.durationMin, location: e.location, accent: e.accent, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt, createdAt: e.createdAt, settings: e.settings }; };
  const summary = () => ({ ...pub(), adminKey: S.ev.adminKey, joinUrl: S.ev.joinUrl, stats: { participants: Object.keys(S.ev.participants).filter(k => k !== 'presenter').length, online: S.online.size, ratings: S.ev.ratings.length, messages: S.ev.messages.length, reactions: S.ev.reactions.length, avg: S.ev.lastPulse?.avg ?? null,
    attention: S.ev.lastPulse?.passive?.index ?? null, cameraOptIns: Object.values(S.ev.participants).filter(p => p.passiveCamera).length }, simulating: false });
  const questionsView = () => S.ev.questions.filter(q => !q.hidden).map(q => ({ id: q.id, name: q.name, avatar: q.avatar, text: q.text, t: q.t, votes: q.votes.length, voters: q.votes, answered: q.answered }))
    .sort((a, b) => (a.answered - b.answered) || (b.votes - a.votes) || (a.t - b.t));
  const pollsView = () => S.ev.polls.map(p => ({ id: p.id, question: p.question, options: p.options, open: p.open, total: Object.keys(p.voters).length, t: p.t }));
  const snapshot = pid => ({
    event: pub(), messages: S.ev.messages.filter(m => !m.deleted).slice(-150), questions: questionsView(), polls: pollsView(),
    myVotes: Object.fromEntries(S.ev.polls.map(p => [p.id, p.voters[pid]])), pulse: S.ev.lastPulse, history: S.ev.pulseHistory.slice(-720),
    markers: S.ev.markers, announcement: null, myRating: pid && S.ev.latest[pid] ? S.ev.ratings[S.ev.latest[pid].i]?.v : null,
    myFeedback: pid ? S.ev.feedback[pid] || null : null, reactions: REACTIONS,
  });
  const broadcastEvent = () => { emitAll('event', pub()); emitAdmins('admin-summary', summary()); };
  const emitQuestions = () => emitAll('questions', questionsView());
  const emitPolls = () => emitAll('polls', pollsView());

  // ---------- actions ----------
  const A = (S.actions = {
    join(p) {
      const old = S.ev.participants[p.pid];
      S.ev.participants[p.pid] = { id: p.pid, name: p.name || old?.name || 'Guest', avatar: p.avatar || old?.avatar || '🙂', color: p.color || old?.color || '#7c5cff', joinedAt: old?.joinedAt || Date.now() };
    },
    rate(pid, v, mode) {
      if (S.ev.status !== 'live' || !S.ev.participants[pid]) return;
      v = Math.max(0, Math.min(100, Math.round(+v))); const now = Date.now(); const last = S.ev.latest[pid];
      if (last && now - last.t < 1500) { Object.assign(S.ev.ratings[last.i], { v, t: now, mode }); last.t = now; }
      else { S.ev.ratings.push({ pid, v, t: now, mode }); S.ev.latest[pid] = { i: S.ev.ratings.length - 1, t: now }; }
    },
    react(pid, e) {
      if (S.ev.status !== 'live' || !REACTIONS.includes(e)) return;
      S.ev.reactions.push({ pid, e, t: Date.now() });
      emitAll('reaction', { e, pid, color: S.ev.participants[pid]?.color });
    },
    chat(pid, text) {
      const p = S.ev.participants[pid]; if (!p || !text || S.ev.status === 'ended') return;
      const msg = { id: uid(), pid, name: p.name, avatar: p.avatar, color: p.color, text: String(text).slice(0, 280), t: Date.now(), role: pid === 'presenter' ? 'presenter' : 'guest' };
      S.ev.messages.push(msg); emitAll('chat', msg);
    },
    ask(pid, text) {
      const p = S.ev.participants[pid]; if (!p || !text) return null;
      const q = { id: uid(), pid, name: p.name, avatar: p.avatar, text: String(text).slice(0, 240), t: Date.now(), votes: [], answered: false, hidden: false };
      S.ev.questions.push(q); emitQuestions(); return q;
    },
    voteQuestion(pid, qid) {
      const q = S.ev.questions.find(x => x.id === qid); if (!q) return;
      const i = q.votes.indexOf(pid); if (i >= 0) q.votes.splice(i, 1); else q.votes.push(pid);
      emitQuestions();
    },
    pollVote(pid, pollId, idx) {
      const poll = S.ev.polls.find(p => p.id === pollId); if (!poll || !poll.open || !(idx >= 0 && idx < poll.options.length)) return;
      if (pid in poll.voters) poll.options[poll.voters[pid]].votes--;
      poll.voters[pid] = idx; poll.options[idx].votes++; emitPolls();
    },
    feedback(pid, f) { S.ev.feedback[pid] = { ...f, t: Date.now() }; emitAdmins('feedback-count', Object.keys(S.ev.feedback).length); },
  });

  function systemMsg(text) {
    const msg = { id: uid(), pid: 'system', name: 'CrowdPulse', avatar: '✨', color: S.ev.accent, text, t: Date.now(), role: 'system' };
    S.ev.messages.push(msg); emitAll('chat', msg);
  }

  const ADMIN = {
    'admin:start'() { if (S.ev.status === 'live') return; S.ev.status = 'live'; S.ev.startedAt = Date.now(); systemMsg('🎬 The session is now live! Rate along as you go.'); broadcastEvent(); },
    'admin:end'() { S.ev.status = 'ended'; S.ev.endedAt = Date.now(); S.ev.polls.forEach(p => { p.open = false; }); systemMsg('🏁 The session has ended — thanks for joining! Please leave a quick review.'); broadcastEvent(); emitPolls(); },
    'admin:settings'(p) { Object.assign(S.ev.settings, p); broadcastEvent(); },
    'admin:chat'(p) { A.chat('presenter', p.text); },
    'admin:msg-pin'(p) { S.ev.messages.forEach(x => { x.pinned = x.id === p.id ? !x.pinned : false; }); const m = S.ev.messages.find(x => x.id === p.id); emitAll('pinned', m?.pinned ? m : null); },
    'admin:msg-delete'(p) { const m = S.ev.messages.find(x => x.id === p.id); if (m) { m.deleted = true; emitAll('chat-delete', m.id); } },
    'admin:q'(p) {
      const q = S.ev.questions.find(x => x.id === p.id); if (!q) return;
      if (p.action === 'answer') q.answered = !q.answered;
      if (p.action === 'hide') q.hidden = true;
      if (p.action === 'spotlight') emitAll('spotlight', { text: q.text, name: q.name, avatar: q.avatar });
      emitQuestions();
    },
    'admin:poll-create'(p) {
      const options = (p.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
      if (!p.question || options.length < 2) return { error: 'A poll needs a question and at least 2 options' };
      S.ev.polls.forEach(x => { x.open = false; });
      S.ev.polls.push({ id: uid(), question: p.question, options: options.map(text => ({ text, votes: 0 })), voters: {}, open: true, t: Date.now() });
      emitPolls();
    },
    'admin:poll-close'(p) { const poll = S.ev.polls.find(x => x.id === p.id); if (poll) poll.open = false; emitPolls(); },
    'admin:marker'(p) { const m = { label: p.label, t: Date.now() }; S.ev.markers.push(m); emitAll('marker', m); systemMsg(`📍 Now: ${p.label}`); },
    'admin:announce'(p) { const a = { text: p.text, t: Date.now() }; emitAll('announce', a); },
    'admin:confetti'() { emitAll('confetti'); },
    'admin:simulate'() { return { simulating: false }; },
  };

  function handle(sock, n, p, ack) {
    const ev = S.ev; p = p ?? {};
    if (n === 'join') {
      const pid = p.pid; A.join(p);
      if (sock.pid !== pid) { sock.pid = pid; markOnline(pid, 1); }
      ackTo(sock, ack, { pid, me: ev.participants[pid], ...snapshot(pid) });
      emitAdmins('admin-summary', summary());
      return;
    }
    if (n === 'watch') { sock.watching = true; return ackTo(sock, ack, { ...snapshot(), joinUrl: ev.joinUrl }); }
    if (n === 'admin-join') {
      sock.admin = true; sock.pid = 'presenter';
      ev.participants.presenter ||= { id: 'presenter', name: ev.presenter || 'Presenter', avatar: '🎤', color: ev.accent };
      return ackTo(sock, ack, { ...snapshot(), summary: summary(), feedbackCount: Object.keys(ev.feedback).length });
    }
    if (n.startsWith('admin:')) { const out = ADMIN[n]?.(p); return ackTo(sock, ack, out || { ok: true }); }
    const pid = sock.pid; if (!pid) return;
    if (n === 'profile') A.join({ ...ev.participants[pid], ...p, pid });
    if (n === 'rate') A.rate(pid, p.v, p.mode);
    if (n === 'react') A.react(pid, p);
    if (n === 'chat') A.chat(pid, p);
    if (n === 'ask') A.ask(pid, p);
    if (n === 'vote-q') A.voteQuestion(pid, p);
    if (n === 'poll-vote') A.pollVote(pid, p.pollId, +p.idx);
    if (n === 'feedback') { A.feedback(pid, p); ackTo(sock, ack, { ok: true }); }
    if (n === 'passive' && ev.status === 'live') S.passiveLatest[pid] = { t: Date.now(), vis: p.vis, att: p.cam?.att, pos: p.cam?.pos, fat: p.cam?.fat };
    if (n === 'passive-off' && S.passiveLatest[pid]) delete S.passiveLatest[pid].att;
    if (n === 'typing') [...S.sockets].filter(k => k !== sock).forEach(k => send(k, 'typing', { name: ev.participants[pid]?.name }));
  }

  // ---------- scripted audience ----------
  S.addBots = (count, overMs = 0) => {
    for (let i = 0; i < count; i++) {
      const n = S.bots.length + S.pending.length;
      const bot = { pid: 'bot' + n, name: NAMES[n % NAMES.length], avatar: AVATARS[n % AVATARS.length], color: COLORS[n % COLORS.length],
        mode: MODES[n % MODES.length], camera: n % 9 < 4, away: false, nextPassive: 0, bias: (rnd() - 0.5) * 26, jitter: 2 + rnd() * 6, chatty: 0.01 + rnd() * 0.03, reacty: 0.008 + rnd() * 0.025, v: null };
      bot.joinAt = Date.now() + (count > 1 ? (overMs * i) / (count - 1) : 0) * (0.85 + rnd() * 0.3);
      S.pending.push(bot);
    }
  };
  S.botSay = (i, text) => A.chat(S.bots[i % S.bots.length].pid, text);
  S.botAsk = (i, text) => A.ask(S.bots[i % S.bots.length].pid, text);
  S.upvote = (qid, n, overMs) => { for (let i = 0; i < n; i++) setTimeout(() => A.voteQuestion(S.bots[(i * 7) % S.bots.length].pid, qid), (overMs * i) / Math.max(1, n - 1)); };
  S.burst = (emojis, n, overMs) => { for (let i = 0; i < n; i++) setTimeout(() => A.react(S.bots[Math.floor(rnd() * S.bots.length)].pid, pick(emojis)), rnd() * overMs); };
  S.question = text => S.ev.questions.find(q => q.text === text);

  // Same rules as lib/passive.js aggregate(): crowd figures only, and nothing below 5 contributors
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  function aggregate(now) {
    const st = S.ev.settings;
    const fresh = Object.values(S.passiveLatest).filter(x => now - x.t < 15000);
    const tab = fresh.filter(x => x.vis != null), cam = fresh.filter(x => x.att != null);
    const out = { minCrowd: 5, nTab: tab.length, nCam: cam.length, focus: null, away: null, attention: null, positive: null, fatigue: null, room: null, index: null };
    if (st.passiveTab !== false && tab.length >= 5) { out.focus = r1(mean(tab.map(x => x.vis)) * 100); out.away = Math.round((tab.filter(x => x.vis < 0.5).length / tab.length) * 100); }
    if (st.passiveCamera && cam.length >= 5) { out.attention = r1(mean(cam.map(x => x.att))); out.positive = r1(mean(cam.map(x => x.pos))); out.fatigue = r1(mean(cam.map(x => x.fat))); }
    if (st.passiveRoom && S.room) out.room = { ...S.room };
    const parts = [out.attention, out.room?.attention, out.focus].filter(v => v != null);
    out.index = parts.length ? r1(mean(parts)) : null;
    return out;
  }
  function roomTick(now) {
    if (!S.ev.settings.passiveRoom || S.ev.status !== 'live' || !S.bots.length) return;
    const recent = S.ev.reactions.filter(r => now - r.t < 4000);
    const laughs = recent.filter(r => r.e === '😂').length, claps = recent.filter(r => r.e === '👏' || r.e === '🎉').length;
    const avg = mean(S.bots.map(b => b.v ?? 60));
    const faces = Math.round(S.bots.length * 0.8), attention = clamp(avg * 0.7 + 26 - S.distract * 40 + (rnd() - 0.5) * 6);
    S.room = { faces, looking: Math.round(faces * attention / 100), attention: Math.round(attention), laughter: Math.round(clamp(laughs * 18 + rnd() * 6)), applause: Math.round(clamp(claps * 12 + rnd() * 5)), level: Math.round(clamp(30 + laughs * 8 + claps * 6)) };
  }

  function tick() {
    const ev = S.ev, now = Date.now();
    // arrivals
    for (const b of [...S.pending]) {
      if (b.joinAt > now) continue;
      S.pending.splice(S.pending.indexOf(b), 1); S.bots.push(b);
      A.join({ pid: b.pid, name: b.name, avatar: b.avatar, color: b.color }); markOnline(b.pid, 1);
      if (ev.status === 'scheduled' && rnd() < 0.18) A.chat(b.pid, pick(LOBBY));
    }
    const live = ev.status === 'live';
    for (const b of S.bots) {
      if (live && (b.v == null || rnd() < 0.35)) {
        const goal = clamp(S.moodTarget + b.bias + (rnd() - 0.5) * 2 * b.jitter);
        b.v = b.v == null ? goal : b.v + (goal - b.v) * 0.55;
        let v = Math.round(b.v);
        if (['smiley', 'stars', 'weather', 'emoji'].includes(b.mode)) v = Math.round(v / 25) * 25;
        A.rate(b.pid, v, b.mode);
      }
      const mood = b.v ?? 60;
      if (live && rnd() < b.reacty * S.react * (mood > 75 ? 1.6 : 1)) A.react(b.pid, mood > 78 ? pick(['🔥', '👏', '🤯', '❤️', '🎉']) : mood > 55 ? pick(['👏', '😂', '🤔', '❤️', '👏']) : pick(['🤔', '😴']));
      if (live && rnd() < b.chatty * S.chatty * 0.35) A.chat(b.pid, pick(mood > 72 ? LINES.high : mood > 50 ? LINES.mid : LINES.low));
      // passive signals, as lib/passive.js receives them: attention follows mood, minus any scripted distraction
      if (live && now >= b.nextPassive) {
        b.nextPassive = now + 4500 + rnd() * 1500;
        const a = clamp(mood * 0.7 + 28 - S.distract * 42 + (rnd() - 0.5) * 10);
        if (rnd() < 0.5) b.away = rnd() < Math.max(0.03, (80 - a) / 70);
        const cam = ev.settings.passiveCamera && b.camera ? { att: clamp(a - (b.away ? 35 : 0)), pos: clamp((mood - 36) * 1.25 + (rnd() - 0.5) * 14), fat: clamp((84 - a) * 0.45 + rnd() * 6) } : null;
        S.passiveLatest[b.pid] = { t: now, vis: b.away ? 0.1 + rnd() * 0.3 : 0.88 + rnd() * 0.12, att: cam?.att, pos: cam?.pos, fat: cam?.fat };
        ev.participants[b.pid].passiveCamera = !!cam;
      }
      const poll = ev.polls.find(p => p.open);
      if (poll && !(b.pid in poll.voters) && rnd() < 0.22) {
        const r = rnd(); A.pollVote(b.pid, poll.id, poll.options.length === 3 ? (r < 0.64 ? 1 : r < 0.86 ? 2 : 0) : Math.floor(r * poll.options.length));
      }
    }
    if (S.tickNo % 2 === 0) roomTick(now);
    // pulse, as server.js computes it
    if (ev.status === 'scheduled' && S.online.size) emitAll('pulse', { t: now, avg: null, n: 0, online: S.online.size, dist: [0, 0, 0, 0, 0], energy: 0, rpm: 0, mpm: 0, momentum: 0, elapsed: 0 });
    if (!live) return;
    const vals = [];
    for (const [pid, l] of Object.entries(ev.latest)) { const r = ev.ratings[l.i]; if (r && (S.online.has(pid) || now - r.t < 180000)) vals.push(r.v); }
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const dist = [0, 0, 0, 0, 0]; vals.forEach(v => dist[Math.min(4, Math.floor(v / 20))]++);
    const rr = ev.reactions.filter(r => now - r.t < 60000).length, mm = ev.messages.filter(m => now - m.t < 60000).length;
    const onlineN = S.online.size;
    const energy = Math.min(100, Math.round(((rr + mm * 2) / Math.max(1, onlineN)) * 25));
    const prev = ev.pulseHistory.length ? ev.pulseHistory[Math.max(0, ev.pulseHistory.length - 6)] : null;
    const pulse = { t: now, avg: avg == null ? null : Math.round(avg * 10) / 10, n: vals.length, online: onlineN, dist, energy, rpm: rr, mpm: mm,
      momentum: avg != null && prev?.avg != null ? Math.round((avg - prev.avg) * 10) / 10 : 0, elapsed: now - ev.startedAt, passive: aggregate(now) };
    ev.lastPulse = pulse; emitAll('pulse', pulse);
    S.tickNo = (S.tickNo || 0) + 1;
    if (S.tickNo % 2 === 0) { const pp = pulse.passive; const point = { t: now, avg: pulse.avg, n: pulse.n, online: onlineN, energy, att: pp.index, focus: pp.focus, cam: pp.attention, pos: pp.positive, fat: pp.fatigue, room: pp.room?.attention ?? null, laugh: pp.room?.laughter ?? null, clap: pp.room?.applause ?? null, nCam: pp.nCam }; ev.pulseHistory.push(point); emitAll('history-point', point); emitAdmins('admin-summary', summary()); }
  }
})();
