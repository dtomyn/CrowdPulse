// Presenter control room
(function () {
  const { $, $$, esc, h } = CP;
  const code = CP.codeFromPath();
  const key = new URLSearchParams(location.search).get('key') || CP.store.get('cp.keys', {})[code];
  CP.backdrop({ intensity: .2 });
  $('#brand').outerHTML = CP.brand;
  if (key) { const keys = CP.store.get('cp.keys', {}); keys[code] = key; CP.store.set('cp.keys', keys); history.replaceState(null, '', location.pathname); }

  const socket = io({ transports: ['websocket', 'polling'] });
  let S = null, summary = null, simulating = false;
  const gauge = CP.gauge($('#gauge')), dist = CP.distBars($('#dist'));
  const chart = CP.pulseChart($('#chart'), { windowMs: 900000 });
  const reactCounts = {};
  const emit = (name, p) => new Promise(res => socket.emit(name, p, r => { if (r?.error) CP.toast('⚠️ ' + r.error); res(r); }));

  socket.on('connect', () => socket.emit('admin-join', { code, key }, res => {
    if (res.error) { document.querySelector('main').innerHTML = `<div class="card empty" style="max-width:520px;margin:60px auto"><span class="big">🔒</span>${esc(res.error)}. Open this session from the <a href="/admin">host dashboard</a>.</div>`; return; }
    S = res; summary = res.summary; simulating = summary.simulating;
    S.reactionsCount?.forEach?.(() => {});
    init();
  }));

  function init() {
    const ev = S.event;
    document.documentElement.style.setProperty('--accent', ev.accent);
    document.title = ev.title + ' · Control Room';
    $('#title').textContent = ev.title; $('#code').textContent = ev.code;
    $('#code').onclick = () => CP.copy(summary.joinUrl, 'Join link copied');
    $('#qr').src = `/api/events/${code}/qr.svg`; $('#link').textContent = summary.joinUrl;
    $('#copyLink').onclick = () => CP.copy(summary.joinUrl, 'Join link copied');
    $('#stageLink').href = `/stage/${code}`; $('#reportLink').href = `/report/${code}?key=${key}`;
    $('#csv').href = `/api/events/${code}/export.csv?key=${key}`;
    chart.setStart(ev.startedAt); chart.set(S.history); chart.markers(S.markers);
    const last = S.markers[S.markers.length - 1]; $('#curMarker').textContent = last ? 'Now: ' + last.label : '';
    S.reactions.forEach(e => (reactCounts[e] ||= 0));
    paintReacts(); paintStatus(); paintSettings(); renderChat(); renderQA(S.allQuestions ? null : S.questions); renderPolls(); paintSim();
    if (S.pulse) onPulse(S.pulse);
  }

  // ---------- status / buttons ----------
  function paintStatus() {
    const ev = S.event;
    $('#pill').innerHTML = `<span class="pill ${ev.status}">${ev.status.toUpperCase()}</span>`;
    const b = $('#mainBtns'); b.innerHTML = '';
    const add = (html, fn) => { const el = h(html); el.onclick = fn; b.appendChild(el); };
    if (ev.status === 'scheduled') add(`<button class="btn primary">🎬 Go live</button>`, async () => { await emit('admin:start'); CP.confetti(90); });
    if (ev.status === 'live') add(`<button class="btn danger">🏁 End session</button>`, async () => { if (confirm('End the session? Attendees will be asked for feedback.')) await emit('admin:end'); });
    if (ev.status === 'ended') {
      add(`<button class="btn">↺ Reopen</button>`, () => emit('admin:reopen'));
      add(`<a class="btn primary" href="/report/${code}?key=${key}">📊 View report</a>`, () => {});
    }
  }
  setInterval(() => {
    if (!S) return; const ev = S.event;
    const ms = ev.status === 'live' ? Date.now() - ev.startedAt : ev.status === 'ended' ? ev.endedAt - ev.startedAt : new Date(ev.startsAt) - Date.now();
    $('#timer').textContent = ev.status === 'scheduled' ? (ms > 0 ? 'Starts in ' + CP.fmtClock(ms) : 'Ready') : CP.fmtClock(ms);
    $('#timer').style.color = ev.status === 'live' && ms > ev.durationMin * 60000 ? 'var(--warn)' : '';
  }, 1000);

  socket.on('event', ev => {
    const was = S.event.status; S.event = ev;
    if (was !== ev.status) { chart.setStart(ev.startedAt); paintStatus(); }
    paintSettings();
  });
  socket.on('admin-summary', s => { summary = s; simulating = s.simulating; paintSim(); $('#kJoined').textContent = s.stats.participants + ' joined'; });
  socket.on('feedback-count', n => CP.toast(`💌 ${n} feedback response${n === 1 ? '' : 's'}`, 1500));

  // ---------- pulse ----------
  let lastAlert = 0;
  const alertAt = {};
  function onPulse(p) {
    S.pulse = p;
    gauge.set(p.avg, p.avg == null ? 'Waiting for ratings' : CP.mood(p.avg).label);
    dist.set(p.dist);
    if (p.avg != null) chart.live({ t: p.t, avg: p.avg, online: p.online });
    $('#kOnline').textContent = p.online; $('#kRaters').textContent = p.n;
    $('#kRatePct').textContent = p.online ? Math.round((p.n / p.online) * 100) + '% of room' : '–';
    $('#kEnergy').textContent = p.energy; $('#kRpm').textContent = p.rpm + ' reactions/min';
    $('#kTrend').textContent = p.momentum > 0.5 ? '↗ ' + p.momentum : p.momentum < -0.5 ? '↘ ' + Math.abs(p.momentum) : '→';
    $('#kTrend').style.color = p.momentum > 2 ? 'var(--good)' : p.momentum < -2 ? 'var(--bad)' : '';
    $('#pulseSub').textContent = `${p.n} active rating${p.n === 1 ? '' : 's'}`;
    coach(p);
  }
  // Presenter coach: contextual nudges based on the room's trajectory
  function coach(p) {
    // each kind of nudge has its own 45s cooldown, so a mood dip is never hidden by an earlier "energy is high" note
    const now = Date.now();
    if (now - lastAlert < 8000 || p.avg == null || p.n < 3) return;
    const candidates = [
      [p.momentum <= -6, 'drop', 'warn', '📉', `Mood dropped ${Math.abs(p.momentum)} pts in the last 30s. Try a quick poll, a story or a question to re-engage.`],
      [p.avg < 45, 'cool', 'warn', '🧊', 'The room is running cool. A change of pace or an interactive moment could help.'],
      [p.momentum >= 6, 'jump', 'good', '🚀', `Mood jumped ${p.momentum} pts — whatever you just did, it landed!`],
      [p.energy >= 70, 'energy', 'good', '🔥', 'Energy is through the roof. Great moment to drop a key message.'],
      [p.online > 4 && p.n / p.online < 0.4, 'raters', 'warn', '🙋', 'Less than half the room is rating. Remind people to scan the QR code.'],
    ];
    const pick = candidates.find(([hit, kind]) => hit && now - (alertAt[kind] || 0) >= 45000);
    if (!pick) return;
    const [, kind, ...a] = pick;
    lastAlert = alertAt[kind] = now;
    const el = h(`<div class="alert ${a[0]}" data-kind="${kind}"><span style="font-size:1.4rem">${a[1]}</span><div style="flex:1">${a[2]}</div><button class="btn sm ghost">✕</button></div>`);
    el.querySelector('button').onclick = () => el.remove();
    $('#alerts').prepend(el); setTimeout(() => el.remove(), 20000);
    while ($('#alerts').children.length > 2) $('#alerts').lastElementChild.remove();
  }
  socket.on('pulse', onPulse);
  socket.on('history-point', p => chart.commit(p));
  socket.on('marker', m => { chart.addMarker(m); $('#curMarker').textContent = 'Now: ' + m.label; });

  $$('#win button').forEach(b => b.onclick = () => { $$('#win button').forEach(x => x.classList.toggle('on', x === b)); chart.setWindow(+b.dataset.w); });

  // ---------- reactions ----------
  function paintReacts() {
    $('#reacts').innerHTML = Object.entries(reactCounts).map(([e, n]) => `<div data-e="${e}"><span>${e}</span><b>${n}</b></div>`).join('');
    $('#reactTotal').textContent = Object.values(reactCounts).reduce((a, b) => a + b, 0) + ' this visit';
  }
  socket.on('reaction', r => {
    reactCounts[r.e] = (reactCounts[r.e] || 0) + 1;
    const cell = $(`#reacts [data-e="${r.e}"]`);
    if (cell) { cell.querySelector('b').textContent = reactCounts[r.e]; cell.classList.add('bump'); setTimeout(() => cell.classList.remove('bump'), 200); }
    $('#reactTotal').textContent = Object.values(reactCounts).reduce((a, b) => a + b, 0) + ' this visit';
    if (Math.random() < 0.5) CP.floatEmoji(r.e, { size: 1.6 });
  });

  // ---------- markers ----------
  ['👋 Intro', '📖 Agenda', '🧠 Deep dive', '💻 Live demo', '📊 Results', '☕ Break', '🙋 Q&A', '🎯 Wrap-up'].forEach(l => {
    const b = h(`<button type="button">${l}</button>`); b.onclick = () => emit('admin:marker', { label: l }); $('#markerChips').appendChild(b);
  });
  $('#markerForm').onsubmit = e => { e.preventDefault(); const v = $('#markerIn').value.trim(); if (!v) return; emit('admin:marker', { label: v }); $('#markerIn').value = ''; };

  // ---------- polls ----------
  const addOpt = (v = '') => {
    const row = h(`<div class="opt-row"><input class="input" maxlength="80" placeholder="Option" value="${esc(v)}"><button type="button" class="btn sm ghost icon">✕</button></div>`);
    row.querySelector('button').onclick = () => row.remove(); $('#pollOpts').appendChild(row);
  };
  addOpt(); addOpt();
  $('#addOpt').onclick = () => { if ($$('#pollOpts input').length < 6) addOpt(); };
  const TEMPLATES = [
    ['Pace check', 'How is the pace?', ['Too slow 🐢', 'Just right 👌', 'Too fast 🐇']],
    ['Go deeper?', 'Should we go deeper on this topic?', ['Yes, dig in!', 'Move on', 'Cover it later']],
    ['Experience', 'How experienced are you with this topic?', ['Brand new', 'Some experience', 'Expert']],
    ['Yes / No', 'Quick vote:', ['Yes 👍', 'No 👎']],
  ];
  TEMPLATES.forEach(([l, q, opts]) => {
    const b = h(`<button type="button">${l}</button>`);
    b.onclick = () => { $('#pollQ').value = q; $('#pollOpts').innerHTML = ''; opts.forEach(addOpt); };
    $('#pollTemplates').appendChild(b);
  });
  $('#launchPoll').onclick = async () => {
    const r = await emit('admin:poll-create', { question: $('#pollQ').value, options: $$('#pollOpts input').map(i => i.value) });
    if (r?.ok) { CP.toast('🚀 Poll launched'); $('#pollQ').value = ''; $('#pollOpts').innerHTML = ''; addOpt(); addOpt(); setTab('polls'); }
  };
  function renderPolls() {
    const host = $('#polls');
    if (!S.polls.length) { host.innerHTML = `<div class="empty"><span class="big">📊</span>Launch a poll from the tools panel.</div>`; return; }
    host.innerHTML = '';
    [...S.polls].reverse().forEach(p => {
      const total = Math.max(1, p.total);
      const max = Math.max(...p.options.map(o => o.votes));
      const el = h(`<div class="card" style="padding:14px"><div class="row"><span class="pill ${p.open ? 'live' : ''}">${p.open ? 'OPEN' : 'CLOSED'}</span><span class="spacer"></span><span class="dim" style="font-size:.8rem">${p.total} votes</span>${p.open ? '<button class="btn sm">Close</button>' : ''}</div>
        <h3 style="margin-top:8px">${esc(p.question)}</h3>
        ${p.options.map(o => `<div class="poll-opt ${o.votes === max && max > 0 ? 'mine' : ''}" style="cursor:default"><div class="fill" style="width:${(o.votes / total) * 100}%"></div><span>${esc(o.text)}</span><span>${o.votes} · ${Math.round((o.votes / total) * 100)}%</span></div>`).join('')}</div>`);
      el.querySelector('button')?.addEventListener('click', () => emit('admin:poll-close', { id: p.id }));
      host.appendChild(el);
    });
  }
  socket.on('polls', ps => { S.polls = ps; renderPolls(); });

  // ---------- broadcast ----------
  $('#annForm').onsubmit = e => { e.preventDefault(); const v = $('#annIn').value.trim(); if (!v) return; emit('admin:announce', { text: v }); $('#annIn').value = ''; CP.toast('📣 Sent to everyone'); };
  $('#confetti').onclick = () => emit('admin:confetti');
  socket.on('confetti', () => CP.confetti());

  // ---------- settings ----------
  const SETTINGS = [['chat', '💬 Live chat'], ['qa', '🙋 Q&A'], ['reactions', '🎆 Reactions'], ['showCrowdMood', '📊 Show crowd mood to attendees'], ['publicReport', '🏆 Share report with attendees']];
  function paintSettings() {
    const host = $('#settings'); host.innerHTML = '';
    SETTINGS.forEach(([k, l]) => {
      const el = h(`<label class="switch"><input type="checkbox" ${S.event.settings[k] ? 'checked' : ''}><span class="track"></span>${l}</label>`);
      el.querySelector('input').onchange = e => emit('admin:settings', { [k]: e.target.checked });
      host.appendChild(el);
    });
  }

  // ---------- simulator ----------
  $('#simCount').oninput = e => ($('#simN').textContent = e.target.value);
  $('#simBtn').onclick = async () => {
    const r = await emit('admin:simulate', { on: !simulating, count: +$('#simCount').value });
    simulating = r.simulating; paintSim();
    if (simulating && S.event.status === 'scheduled') CP.toast('🤖 Bots are in the lobby — hit "Go live" to see them rate');
  };
  function paintSim() {
    $('#simBtn').textContent = simulating ? '⏹ Stop simulation' : '▶ Start simulation';
    $('#simBtn').className = 'btn sm ' + (simulating ? 'danger' : 'good');
    $('#simPill').innerHTML = simulating ? '<span class="pill">🤖 DEMO AUDIENCE</span>' : '';
  }

  // ---------- reset ----------
  $('#reset').onclick = async () => {
    if (!confirm('Wipe all ratings, chat, questions, polls and feedback for this session? This cannot be undone.')) return;
    await emit('admin:reset'); location.reload();
  };

  // ---------- chat ----------
  function renderChat() {
    const list = $('#chat'); list.innerHTML = '';
    S.messages.forEach(m => list.appendChild(wireMsg(CP.renderMsg(m, 'presenter', true))));
    list.scrollTop = list.scrollHeight;
  }
  function wireMsg(el) {
    el.querySelector('[data-act=pin]')?.addEventListener('click', () => emit('admin:msg-pin', { id: el.dataset.id }));
    el.querySelector('[data-act=del]')?.addEventListener('click', () => emit('admin:msg-delete', { id: el.dataset.id }));
    return el;
  }
  socket.on('chat', m => {
    const list = $('#chat'); const near = list.scrollHeight - list.scrollTop - list.clientHeight < 140;
    list.appendChild(wireMsg(CP.renderMsg(m, 'presenter', true)));
    if (near) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    while (list.children.length > 300) list.firstElementChild.remove();
  });
  socket.on('chat-delete', id => $(`#chat [data-id="${id}"]`)?.remove());
  socket.on('pinned', m => CP.toast(m ? '📌 Message pinned' : '📌 Unpinned'));
  $('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (!v) return; emit('admin:chat', { text: v }); $('#chatIn').value = ''; };

  // ---------- Q&A ----------
  function renderQA(qs) {
    if (qs) S.questions = qs;
    const host = $('#qa'); const list = S.questions;
    $('#qaN').textContent = list.filter(q => !q.answered).length || '';
    if (!list.length) { host.innerHTML = `<div class="empty"><span class="big">🙋</span>Questions from the audience land here, sorted by upvotes.</div>`; return; }
    host.innerHTML = '';
    list.forEach(q => {
      const el = h(`<div class="q ${q.answered ? 'answered' : ''}"><div class="vote" style="cursor:default">▲<span class="n">${q.votes}</span></div>
        <div class="qtext">${esc(q.text)}<div class="meta">${esc(q.avatar)} ${esc(q.name)} · ${CP.fmtTime(q.t)}</div>
        <div class="acts"><button class="btn sm" data-a="spotlight">🔦 Spotlight</button><button class="btn sm" data-a="answer">${q.answered ? '↩ Unmark' : '✅ Answered'}</button><button class="btn sm ghost danger" data-a="hide">Hide</button></div></div></div>`);
      $$('[data-a]', el).forEach(b => b.onclick = () => emit('admin:q', { id: q.id, action: b.dataset.a }));
      host.appendChild(el);
    });
  }
  socket.on('questions', qs => renderQA(qs));
  socket.on('spotlight', () => CP.toast('🔦 Question spotlighted on all screens'));

  // ---------- tabs ----------
  function setTab(t) { $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === t)); }
  $$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  socket.on('reset', () => location.reload());
})();
