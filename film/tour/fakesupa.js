// The code tour's in-page stand-in for the Supabase project: the same database functions (supabase/migrations)
// and Realtime broadcasts, replayed in JavaScript on the film clock, with a scripted audience so every take is
// identical. Each page gets it through a stub of vendor/supabase/supabase.js (see film/render_tour.py).
// Every function call and broadcast is reported to S.trace, which is what drives the editor in the film.
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
  const RPC_MS = 0, CAST_MS = 0; // answers arrive on the next timer turn; zero, so a page can finish loading while the film clock is held

  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  let idn = 0;
  const uid = () => 'f' + (++idn).toString(36);
  const now = () => Date.now();
  const clone = (win, d) => (d == null ? null : win.JSON.parse(JSON.stringify(d)));

  const S = (window.__server = {
    ev: null, parts: {}, ratings: [], reactions: [], messages: [], questions: [], polls: [], feedback: {}, history: [], markers: [],
    admins: new Set(), subs: new Set(), bots: [], pending: [], throttles: {}, moodTarget: 62, react: 1, chatty: 1, trace: null, report: null, others: [],
  });
  const tell = t => { try { S.trace?.(t); } catch (e) { console.error(e); } };

  S.init = base => {
    S.ev = { ...base, status: 'scheduled', startedAt: null, endedAt: null, createdAt: now() - 600000, lastPulse: null, lastTick: 0, lastHistory: 0 };
    setInterval(audience, 1000);
  };

  // ---------- Realtime ----------
  const alive = sub => { try { return sub.win.__film && sub.win.__film.token === sub.token; } catch { return false; } };
  function send(topic, event, v) {
    tell({ kind: 'cast', topic, event, v });
    for (const sub of [...S.subs]) {
      if (!alive(sub)) { S.subs.delete(sub); continue; }
      if (sub.topic !== topic) continue;
      sub.win.setTimeout(() => sub.fns.forEach(fn => { try { fn({ event, payload: { v: clone(sub.win, v) } }); } catch (e) { console.error(e); } }), CAST_MS);
    }
  }
  const ev = c => (S.ev && String(c || '').toUpperCase() === S.ev.code ? S.ev : null);
  const toAll = (event, v) => send('ev:' + S.ev.code, event, v);
  const toAdmins = (event, v) => send('adm:' + S.ev.code, event, v);

  // ---------- the client each page gets from supabase.createClient() ----------
  S.client = win => {
    const me = 'u-' + (win.name || 'page'), token = win.__film.token;
    const session = { access_token: 'film', user: { id: me } };
    return {
      auth: {
        getSession: async () => ({ data: { session }, error: null }), signInAnonymously: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null }), signInWithOtp: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      realtime: { setAuth: async () => {} },
      rpc: (fn, args = {}) => new Promise(done => {
        let data = null, error = null;
        try { if (!API[fn]) throw new Error('no such function: ' + fn); data = API[fn](me, args) ?? null; } catch (e) { error = { message: String(e.message || e) }; console.error(e); }
        tell({ kind: 'rpc', win, fn, args, res: data, error });
        win.setTimeout(() => done({ data: clone(win, data), error }), RPC_MS);
      }),
      channel: topic => {
        const sub = { win, token, topic, fns: [] };
        const ch = { on(_type, _filter, fn) { sub.fns.push(fn); return ch; }, subscribe(cb) { S.subs.add(sub); win.setTimeout(() => cb?.('SUBSCRIBED'), 0); return ch; } };
        return ch;
      },
      removeAllChannels() { for (const sub of [...S.subs]) if (sub.win === win) S.subs.delete(sub); },
    };
  };

  // ---------- views of the data sent to browsers (cp_event_json, cp_snapshot, ...) ----------
  const eventJson = () => { const e = S.ev; return { code: e.code, title: e.title, description: e.description, presenter: e.presenter, startsAt: e.startsAt, durationMin: e.durationMin, location: e.location, accent: e.accent, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt, createdAt: e.createdAt, settings: e.settings }; };
  const msgJson = m => ({ id: m.id, pid: m.pub, name: m.name, avatar: m.avatar, color: m.color, text: m.text, t: m.t, role: m.role, pinned: !!m.pinned });
  const people = () => Object.values(S.parts).filter(p => p.pid !== 'presenter');
  const online = n => people().filter(p => p.lastSeen > n - 45000).length;
  const questionsView = () => S.questions.filter(q => !q.hidden).map(q => ({ id: q.id, name: q.name, avatar: q.avatar, text: q.text, t: q.t, votes: q.votes.length, voters: [...q.votes], answered: q.answered }))
    .sort((a, b) => (a.answered - b.answered) || (b.votes - a.votes) || (a.t - b.t));
  const pollsView = () => S.polls.map(p => ({ id: p.id, question: p.question, options: p.options.map((text, i) => ({ text, votes: Object.values(p.voters).filter(v => v === i).length })), open: p.open, total: Object.keys(p.voters).length, t: p.t }));
  const summary = () => ({ ...eventJson(), adminKey: S.ev.adminKey, simulating: false, stats: { participants: people().length, online: online(now()), ratings: S.ratings.length,
    messages: S.messages.length, reactions: S.reactions.length, avg: S.ev.lastPulse?.avg ?? null, attention: S.ev.lastPulse?.passive?.index ?? null, cameraOptIns: 0 } });
  const snapshot = pid => {
    const part = S.parts[pid];
    return { event: eventJson(), messages: S.messages.filter(m => !m.deleted).slice(-150).map(msgJson), questions: questionsView(), polls: pollsView(),
      myVotes: Object.fromEntries(S.polls.filter(p => pid in p.voters).map(p => [p.id, p.voters[pid]])), pulse: S.ev.lastPulse, history: S.history.slice(-720),
      markers: S.markers, announcement: null, myRating: part?.rating ?? null, myFeedback: S.feedback[pid] || null, reactions: REACTIONS };
  };
  const broadcastEvent = () => { toAll('event', eventJson()); toAdmins('admin-summary', summary()); };
  const throttleOk = (pid, kind, ms) => { const k = pid + '|' + kind, n = now(); if (S.throttles[k] > n - ms) return false; S.throttles[k] = n; return true; };

  // ---------- core actions (cp_upsert_participant, cp_do_rate, cp_do_react, cp_do_chat, ...) ----------
  function upsert(pid, p = {}, bot = false) {
    const old = S.parts[pid], n = now();
    return (S.parts[pid] = { pid, pub: old?.pub || (pid === 'presenter' ? 'presenter' : 'u_' + uid()), name: p.name || old?.name || 'Guest', avatar: p.avatar || old?.avatar || '🙂',
      color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : old?.color || '#7c5cff', joinedAt: old?.joinedAt || n, lastSeen: n, bot,
      rating: old?.rating ?? null, ratingT: old?.ratingT ?? null, ratingRow: old?.ratingRow ?? null, vis: old?.vis ?? null, visT: old?.visT ?? 0 });
  }
  function doRate(pid, v, mode) {
    const part = S.parts[pid], n = now();
    if (S.ev.status !== 'live' || !part || !Number.isFinite(+v)) return;
    const val = Math.round(clamp(+v));
    if (part.ratingRow != null && n - part.ratingT < 1500) Object.assign(S.ratings[part.ratingRow], { v: val, t: n, mode }); // rapid drags collapse into one sample
    else { S.ratings.push({ pid: part.pub, v: val, t: n, mode: mode || 'slider' }); part.ratingRow = S.ratings.length - 1; }
    Object.assign(part, { rating: val, ratingT: n, lastSeen: n });
  }
  function doReact(pid, e) {
    if (S.ev.status !== 'live' || !REACTIONS.includes(e) || !throttleOk(pid, 'react', 250)) return;
    S.reactions.push({ pid, e, t: now() }); // reaches screens with the next pulse (see cp_tick)
  }
  function addMsg(part, text, role) {
    const m = { id: uid(), pub: part.pub, name: part.name, avatar: part.avatar, color: part.color, text: String(text).slice(0, 280), t: now(), role };
    S.messages.push(m); toAll('chat', msgJson(m));
  }
  const systemMsg = text => addMsg({ pub: 'system', name: 'CrowdPulse', avatar: '✨', color: S.ev.accent }, text, 'system');
  function doChat(pid, text) {
    const part = S.parts[pid];
    if (!part || !String(text || '').trim() || S.ev.status === 'ended' || S.ev.settings.chat === false) return;
    addMsg(part, text, pid === 'presenter' ? 'presenter' : 'guest');
  }
  function doAsk(pid, text) {
    const part = S.parts[pid]; if (!part || !String(text || '').trim()) return;
    S.questions.push({ id: uid(), name: part.name, avatar: part.avatar, text: String(text).slice(0, 240), t: now(), votes: [], answered: false, hidden: false });
    toAll('questions', questionsView());
  }
  function doVoteQ(pid, qid) {
    const q = S.questions.find(x => x.id === qid), part = S.parts[pid]; if (!q || !part) return;
    const i = q.votes.indexOf(part.pub); if (i >= 0) q.votes.splice(i, 1); else q.votes.push(part.pub);
    toAll('questions', questionsView());
  }
  function doPollVote(pid, pollId, idx) {
    const poll = S.polls.find(p => p.id === pollId); if (!poll || !poll.open || !(idx >= 0 && idx < poll.options.length)) return;
    poll.voters[pid] = +idx; toAll('polls', pollsView());
  }

  // ---------- the database functions browsers may call (the grants at the bottom of the migration) ----------
  const API = {
    cp_event_public: (me, { _c }) => (ev(_c) ? eventJson() : null),
    cp_list_live: () => {
      const e = S.ev, live = e.status === 'live';
      const ours = { code: e.code, title: e.title, presenter: e.presenter, status: e.status, startsAt: e.startsAt, startedAt: e.startedAt, durationMin: e.durationMin, accent: e.accent,
        location: { mode: e.location?.mode, venue: e.location?.venue || '' }, online: online(now()), mood: live && e.lastPulse?.avg != null ? Math.round(e.lastPulse.avg) : null };
      return [ours, ...S.others].sort((a, b) => (a.status === b.status ? 0 : a.status === 'live' ? -1 : 1));
    },
    cp_join(me, { _c, _p }) {
      if (!ev(_c)) return { error: 'No event with that code' };
      const part = upsert(me, _p || {});
      toAdmins('admin-summary', summary());
      return { pid: me, pub: part.pub, me: { id: part.pub, name: part.name, avatar: part.avatar, color: part.color }, ...snapshot(me) };
    },
    cp_watch: (me, { _c }) => (ev(_c) ? snapshot(null) : { error: 'No event' }),
    cp_act(me, { _c, _action, _p }) {
      if (!ev(_c)) return { error: 'Event not found' };
      const part = S.parts[me]; if (!part) return { error: 'Join the session first' };
      part.lastSeen = now();
      switch (_action) {
        case 'heartbeat': break;
        case 'rate': doRate(me, _p?.v, _p?.mode); break;
        case 'react': doReact(me, _p); break;
        case 'chat': doChat(me, _p); break;
        case 'ask': doAsk(me, _p); break;
        case 'vote-q': doVoteQ(me, _p); break;
        case 'poll-vote': doPollVote(me, _p?.pollId, _p?.idx); break;
        case 'feedback': S.feedback[me] = { ..._p, t: now() }; toAdmins('feedback-count', Object.keys(S.feedback).length); break;
        case 'passive': if (throttleOk(me, 'passive', 1500) && S.ev.status === 'live') Object.assign(part, { vis: clamp(+_p?.vis, 0, 1), visT: now() }); break;
        case 'passive-off': break;
        case 'profile': if (_p && typeof _p === 'object' && throttleOk(me, 'profile', 1000)) upsert(me, _p); break;
        case 'typing': if (throttleOk(me, 'typing', 1000)) toAll('typing', { name: part.name, pid: part.pub }); break;
        default: return { error: 'Unknown action' };
      }
      return { ok: true };
    },
    cp_admin_join(me, { _c, _key }) {
      const e = ev(_c); if (!e) return { error: 'Event not found' };
      if (!S.admins.has(me)) { if (!_key || _key !== e.adminKey) return { error: 'Invalid admin key' }; S.admins.add(me); }
      if (!S.parts.presenter) { upsert('presenter', { name: e.presenter || 'Presenter', avatar: '🎤', color: e.accent }); S.parts.presenter.lastSeen = 0; }
      return { ...snapshot('presenter'), summary: summary(), feedbackCount: Object.keys(S.feedback).length };
    },
    cp_admin(me, { _c, _action, _p }) {
      const e = ev(_c); if (!e) return { error: 'Event not found' };
      if (!S.admins.has(me)) return { error: 'Not authorised' };
      const p = _p && typeof _p === 'object' ? _p : {}, n = now();
      switch (_action) {
        case 'start': if (e.status !== 'live') { Object.assign(e, { status: 'live', startedAt: e.startedAt ?? n, endedAt: null }); systemMsg('🎬 The session is now live! Rate along as you go.'); broadcastEvent(); } break;
        case 'end': Object.assign(e, { status: 'ended', endedAt: n }); S.polls.forEach(x => { x.open = false; }); systemMsg('🏁 The session has ended — thanks for joining! Please leave a quick review.'); broadcastEvent(); toAll('polls', pollsView()); break;
        case 'reopen': Object.assign(e, { status: 'live', endedAt: null }); broadcastEvent(); break;
        case 'settings': Object.assign(e.settings, p); broadcastEvent(); break;
        case 'chat': doChat('presenter', p.text); break;
        case 'q': {
          const q = S.questions.find(x => x.id === p.id); if (!q) break;
          if (p.action === 'answer') q.answered = !q.answered;
          if (p.action === 'hide') q.hidden = true;
          if (p.action === 'spotlight') toAll('spotlight', { text: q.text, name: q.name, avatar: q.avatar });
          toAll('questions', questionsView()); break;
        }
        case 'poll-create': {
          const options = (Array.isArray(p.options) ? p.options : []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
          if (!p.question || options.length < 2) return { error: 'A poll needs a question and at least 2 options' };
          S.polls.forEach(x => { x.open = false; });
          S.polls.push({ id: uid(), question: p.question, options, voters: {}, open: true, t: n }); toAll('polls', pollsView()); break;
        }
        case 'poll-close': { const poll = S.polls.find(x => x.id === p.id); if (poll) poll.open = false; toAll('polls', pollsView()); break; }
        case 'marker': if (p.label) { const m = { label: String(p.label).slice(0, 60), t: n }; S.markers.push(m); toAll('marker', m); systemMsg('📍 Now: ' + m.label); } break;
        case 'announce': toAll('announce', { text: p.text, t: n }); break;
        case 'confetti': toAll('confetti', true); break;
        case 'room': case 'simulate': case 'sim': break;
        default: return { error: 'Unknown action' };
      }
      return { ok: true };
    },
    cp_report_access: (me, { _c }) => (ev(_c) ? { ok: true, admin: S.admins.has(me) } : { ok: false, error: 'Event not found' }),

    // The live pulse: called every ~2s by the control room and stage screen; only one call per 1.8s does any work.
    cp_tick(me, { _c }) {
      const e = ev(_c), n = now();
      if (!e || !['scheduled', 'live'].includes(e.status) || e.lastTick >= n - 1800) return null;
      const prevTick = e.lastTick; e.lastTick = n;
      const on = online(n);
      if (e.status === 'scheduled') {
        if (on > 0) toAll('pulse', { t: n, avg: null, n: 0, online: on, dist: [0, 0, 0, 0, 0], energy: 0, rpm: 0, mpm: 0, momentum: 0, elapsed: 0 });
        if (n - e.lastHistory >= 5000) { e.lastHistory = n; toAdmins('admin-summary', summary()); }
        return { ok: true };
      }
      const vals = people().filter(p => p.ratingT != null && (p.lastSeen > n - 45000 || p.ratingT > n - 180000)).map(p => p.rating);
      const avg = r1(mean(vals)), dist = [0, 0, 0, 0, 0];
      vals.forEach(v => dist[Math.min(4, Math.floor(v / 20))]++);
      const rr = S.reactions.filter(r => r.t > n - 60000).length, rm = S.messages.filter(m => m.t > n - 60000).length;
      const energy = Math.min(100, Math.round(((rr + rm * 2) / Math.max(1, on)) * 25));
      const prev = S.history.length ? S.history[Math.max(0, S.history.length - 6)].avg : null;
      const momentum = avg != null && prev != null ? r1(avg - prev) : 0;
      // passive signals: crowd figures only once 5+ people contribute. The tour films tab focus only.
      const tab = people().filter(p => p.vis != null && p.visT > n - 15000);
      const tabOn = e.settings.passiveTab !== false && tab.length >= 5;
      const focus = tabOn ? r1(mean(tab.map(p => p.vis)) * 100) : null, away = tabOn ? Math.round((tab.filter(p => p.vis < 0.5).length / tab.length) * 100) : null;
      const passive = { minCrowd: 5, nTab: tab.length, nCam: 0, focus, away, attention: null, positive: null, fatigue: null, room: null, index: focus };
      const reacts = S.reactions.filter(r => r.t > Math.max(prevTick, n - 4000)).slice(0, 60).map(r => ({ e: r.e, color: S.parts[r.pid]?.color }));
      const pulse = { t: n, avg, n: vals.length, online: on, dist, energy, rpm: rr, mpm: rm, momentum, elapsed: n - e.startedAt, passive };
      e.lastPulse = pulse;
      toAll('pulse', { ...pulse, reacts });
      if (n - e.lastHistory >= 5000) {
        const point = { t: n, avg, n: vals.length, online: on, energy, att: focus, focus, cam: null, pos: null, fat: null, room: null, laugh: null, clap: null, nCam: 0 };
        S.history.push(point); e.lastHistory = n;
        toAll('history-point', point); toAdmins('admin-summary', summary());
      }
      return { ok: true };
    },
  };

  // the host ends the session (or any other admin action), without a page being involved
  S.admin = (action, p) => API.cp_admin([...S.admins][0], { _c: S.ev.code, _action: action, _p: p });

  // ---------- scripted audience ----------
  S.addBots = (count, overMs = 0) => {
    for (let i = 0; i < count; i++) {
      const n = S.bots.length + S.pending.length;
      const bot = { pid: 'bot' + n, name: NAMES[n % NAMES.length], avatar: AVATARS[n % AVATARS.length], color: COLORS[n % COLORS.length], mode: MODES[n % MODES.length],
        bias: (rnd() - 0.5) * 26, jitter: 2 + rnd() * 6, chatty: 0.01 + rnd() * 0.03, reacty: 0.008 + rnd() * 0.025, v: null };
      bot.joinAt = now() + (count > 1 ? (overMs * i) / (count - 1) : 0) * (0.85 + rnd() * 0.3);
      S.pending.push(bot);
    }
  };
  S.burst = (emojis, n, overMs) => { for (let i = 0; i < n; i++) setTimeout(() => { delete S.throttles['bot' + (i % S.bots.length) + '|react']; doReact(S.bots[i % S.bots.length].pid, pick(emojis)); }, rnd() * overMs); };
  S.botSay = (i, text) => doChat(S.bots[i % S.bots.length].pid, text);

  function audience() {
    const e = S.ev, n = now();
    for (const b of [...S.pending]) {
      if (b.joinAt > n) continue;
      S.pending.splice(S.pending.indexOf(b), 1); S.bots.push(b);
      upsert(b.pid, b, true);
      if (e.status === 'scheduled' && rnd() < 0.18) doChat(b.pid, pick(LOBBY));
    }
    const live = e.status === 'live';
    for (const b of S.bots) {
      const part = S.parts[b.pid]; part.lastSeen = n;
      if (!live) continue;
      if (b.v == null || rnd() < 0.35) {
        const goal = clamp(S.moodTarget + b.bias + (rnd() - 0.5) * 2 * b.jitter);
        b.v = b.v == null ? goal : b.v + (goal - b.v) * 0.55;
        let v = Math.round(b.v);
        if (['smiley', 'stars', 'weather', 'emoji'].includes(b.mode)) v = Math.round(v / 25) * 25;
        doRate(b.pid, v, b.mode);
      }
      const mood = b.v ?? 60;
      if (rnd() < b.reacty * S.react * (mood > 75 ? 1.6 : 1)) doReact(b.pid, mood > 78 ? pick(['🔥', '👏', '🤯', '❤️', '🎉']) : mood > 55 ? pick(['👏', '😂', '🤔', '❤️', '👏']) : pick(['🤔', '😴']));
      if (rnd() < b.chatty * S.chatty * 0.35) doChat(b.pid, pick(mood > 72 ? LINES.high : mood > 50 ? LINES.mid : LINES.low));
      if (rnd() < 0.2) Object.assign(part, { vis: rnd() < 0.08 ? 0.2 + rnd() * 0.2 : 0.9 + rnd() * 0.1, visT: n });
    }
  }
})();
