// Attendee experience
(function () {
  const { $, $$, esc, h } = CP;
  const code = CP.codeFromPath();
  const bg = CP.backdrop();
  $('#brandMark').outerHTML = `<a href="./" class="brand-mark" style="flex:none"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg></a>`;

  let me = CP.profile();
  let myPub = me.pid; // replaced by the server's public id for us on join
  let state = null; // snapshot from server
  let myRating = null, mode = CP.store.get('cp.mode', 'slider'), widget = null;
  let tab = 'rate', unread = { chat: 0, qa: 0, polls: 0 };
  let gauge = null, dist = null, chart = null;
  const socket = CP.connect({ code, ticker: 'fallback' });
  // passive signals (tab focus + opt-in on-device camera); see js/passive.js
  const pv = CP.passive.init({ socket, code, onShowPanel: () => { if (!matchMedia('(min-width: 901px)').matches) setTab('rate'); } });

  const paintMe = () => { $('#meAv').textContent = me.avatar; $('#meBtn').style.setProperty('--c', me.color); $('#meName').textContent = me.name; };
  paintMe();

  // ---------- connection ----------
  function join() {
    socket.emit('join', { code, ...me }, res => {
      if (res.error) { $('#mainCol').innerHTML = `<div class="card empty"><span class="big">🔍</span>${esc(res.error)}<br><br><a class="btn" href="./">Try another code</a></div>`; $('#evTitle').textContent = 'Not found'; return; }
      state = res; myRating = res.myRating;
      // the server may hand out a fresh id (e.g. an old or invalid one); others only ever see our public id
      if (res.pid && res.pid !== me.pid) { me = { ...me, pid: res.pid }; CP.saveProfile(me); }
      myPub = res.pub || me.pid;
      if (!CP.store.get('cp.welcomed.' + code)) { CP.store.set('cp.welcomed.' + code, 1); setTimeout(profileModal, 400, true); }
      renderAll();
    });
  }
  socket.on('connect', join);
  socket.on('disconnect', () => CP.toast('📡 Reconnecting…'));

  // ---------- top-level render ----------
  function renderAll() {
    const ev = state.event;
    document.documentElement.style.setProperty('--accent', ev.accent);
    document.title = ev.title + ' · CrowdPulse';
    $('#evTitle').textContent = ev.title;
    $('#evSub').innerHTML = [ev.presenter && '🎤 ' + esc(ev.presenter), CP.locationText(ev.location)].filter(Boolean).join(' &nbsp;·&nbsp; ');
    $('#statusPill').innerHTML = `<span class="pill ${ev.status}">${ev.status === 'live' ? 'LIVE' : ev.status === 'ended' ? 'ENDED' : 'SOON'}</span>`;
    $('#tabs [data-tab=qa]').classList.toggle('hidden', !ev.settings.qa);
    $('#mobnav [data-tab=qa]').classList.toggle('hidden', !ev.settings.qa);
    $('#chatForm').classList.toggle('hidden', !ev.settings.chat || ev.status === 'ended');
    $('#askForm').classList.toggle('hidden', ev.status === 'ended');
    pv.update(ev);
    renderMain(); renderChat(); renderQA(); renderPolls();
    if (state.announcement && Date.now() - state.announcement.t < 30000) banner(state.announcement.text);
  }

  function renderMain() {
    const ev = state.event, col = $('#mainCol');
    gauge = dist = chart = null; col.innerHTML = '';
    if (ev.status === 'scheduled') { renderLobby(col); pv.mount(col); return; }
    if (ev.status === 'ended') return renderEnded(col);

    // LIVE
    col.appendChild(h(`<div id="pollPop"></div>`));
    const rate = h(`<section class="card glow">
      <div class="card-title"><h3>How's it going?</h3><span class="eyebrow">Your rating</span></div>
      <div class="modes" id="modes">${Object.entries(CP.raters).map(([k, r]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}"><span>${r.icon}</span>${r.label}</button>`).join('')}</div>
      <div id="rater"></div><div class="sent" id="sent">Change your rating anytime — it updates live</div></section>`);
    col.appendChild(rate);
    $$('#modes button', rate).forEach(b => b.onclick = () => {
      mode = b.dataset.m; CP.store.set('cp.mode', mode);
      $$('#modes button', rate).forEach(x => x.classList.toggle('on', x === b)); mountRater();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    mountRater();

    if (ev.settings.reactions) {
      const rb = h(`<section class="card"><div class="card-title"><h3>React</h3><span class="eyebrow">Tap away</span></div>
        <div class="reactbar">${state.reactions.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div></section>`);
      col.appendChild(rb);
      $$('button', rb).forEach(b => b.onclick = () => { socket.emit('react', b.dataset.e); CP.burst(b, b.dataset.e, 4); try { navigator.vibrate?.(5); } catch { /* */ } });
    }
    pv.mount(col); // optional "share attention" offer / camera panel (only when the host allows cameras)

    if (ev.settings.showCrowdMood) {
      const crowd = h(`<section class="card"><div class="card-title"><h3>The room right now</h3><span class="eyebrow" id="crowdN"></span></div>
        <div class="crowd"><div id="cGauge"></div><div><div id="cDist" style="height:130px"></div>
        <div class="mini-stats"><div><b id="sOnline">0</b><small>online</small></div><div><b id="sEnergy">0</b><small>energy</small></div><div><b id="sMom">–</b><small>trend</small></div></div></div></div>
        <div class="you-vs" id="youVs"></div>
        <div class="pv-crowd" id="pvCrowd"></div>
        <canvas id="cChart" style="width:100%;height:150px;margin-top:14px"></canvas></section>`);
      col.appendChild(crowd);
      gauge = CP.gauge($('#cGauge', crowd)); dist = CP.distBars($('#cDist', crowd));
      chart = CP.pulseChart($('#cChart', crowd), { windowMs: 10 * 60 * 1000 });
      chart.setStart(ev.startedAt); chart.set(state.history); chart.markers(state.markers || []);
      pv.crowdSlot($('#pvCrowd', crowd));
      if (state.pulse) onPulse(state.pulse);
    }
    renderPollPop();
  }

  function mountRater() {
    const host = $('#rater'); if (!host) return;
    host.style.opacity = 0; host.style.transform = 'scale(.96)';
    setTimeout(() => {
      widget = CP.raters[mode].mount(host, myRating, sendRating);
      host.style.transition = 'opacity .35s, transform .45s cubic-bezier(.2,1.4,.4,1)'; host.style.opacity = 1; host.style.transform = 'none';
    }, 120);
  }

  let sendT = null, pending = null;
  function sendRating(v) {
    myRating = v; pending = v; bg.setMood(v);
    if (sendT) return;
    sendT = setTimeout(() => {
      socket.emit('rate', { v: pending, mode }); sendT = null;
      const s = $('#sent'); if (s) { s.textContent = `✓ Sent ${Math.round(pending)} ${CP.mood(pending).emoji}`; s.classList.add('ok'); clearTimeout(s._t); s._t = setTimeout(() => { s.classList.remove('ok'); }, 1500); }
      updateYouVs();
    }, 250);
  }

  function updateYouVs() {
    const el = $('#youVs'); const p = state?.pulse; if (!el || !p || p.avg == null || myRating == null) { if (el) el.textContent = ''; return; }
    const d = Math.round(myRating - p.avg);
    el.innerHTML = d === 0 ? `You're perfectly in sync with the room 🎯` : `You're <b style="color:${d > 0 ? 'var(--good)' : 'var(--warn)'}">${Math.abs(d)} pts ${d > 0 ? 'happier' : 'cooler'}</b> than the room average`;
  }

  // ---------- lobby ----------
  function renderLobby(col) {
    const ev = state.event;
    const card = h(`<section class="card glow lobby">
      <div class="eyebrow">You're in! The session starts soon</div>
      <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6"/>
        <circle id="ringArc" cx="50" cy="50" r="44" fill="none" stroke="url(#lg)" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="100 100"/>
        <defs><linearGradient id="lg"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="#ff5ca8"/></linearGradient></defs></svg>
        <div class="cd"><b id="cd">--:--</b><small id="cdl">until start</small></div></div>
      <h2>${esc(ev.title)}</h2>
      ${ev.presenter ? `<div class="muted" style="margin-top:4px">with ${esc(ev.presenter)}</div>` : ''}
      <div class="muted" style="margin-top:6px;font-size:.9rem">🗓️ ${CP.fmtDate(ev.startsAt)} · ${ev.durationMin} min</div>
      <div style="margin-top:6px;font-size:.9rem">${CP.locationText(ev.location)}</div>
      ${ev.description ? `<p class="muted" style="max-width:520px;margin:16px auto 0;white-space:pre-wrap">${esc(ev.description)}</p>` : ''}
      <div class="card" style="margin-top:20px;text-align:left;background:rgba(0,0,0,.2)">
        <h3>Warm up while you wait 🎚️</h3>
        <p class="muted" style="font-size:.9rem;margin:6px 0 12px">Pick your favourite way to rate. Once the presenter goes live you can change your rating anytime.</p>
        <div class="modes" id="modes" style="flex-wrap:wrap">${Object.entries(CP.raters).map(([k, r]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}"><span>${r.icon}</span>${r.label}</button>`).join('')}</div>
        <div id="rater"></div>
      </div></section>`);
    col.appendChild(card);
    $$('#modes button', card).forEach(b => b.onclick = () => { mode = b.dataset.m; CP.store.set('cp.mode', mode); $$('#modes button', card).forEach(x => x.classList.toggle('on', x === b)); mountRater(); });
    widget = null; const host = $('#rater', card); CP.raters[mode].mount(host, myRating ?? 60, v => { myRating = null; bg.setMood(v); });
    const target = new Date(ev.startsAt).getTime(), from = ev.createdAt;
    const tick = () => {
      if (!document.body.contains(card)) return;
      const left = target - Date.now();
      $('#cd').textContent = left > 0 ? CP.fmtClock(left) : 'Any moment';
      $('#cdl').textContent = left > 0 ? 'until start' : 'waiting for presenter';
      $('#ringArc').setAttribute('stroke-dasharray', `${Math.max(0, Math.min(100, (left / Math.max(1, target - from)) * 100))} 100`);
      setTimeout(tick, 1000);
    };
    tick();
  }

  // ---------- ended: feedback ----------
  function renderEnded(col) {
    const ev = state.event;
    if (state.myFeedback) {
      col.appendChild(h(`<section class="card glow center" style="padding:40px 20px">
        <div style="font-size:4rem">💜</div><h2>Thanks for the feedback!</h2>
        <p class="muted">Your review helps ${esc(ev.presenter || 'the presenter')} get even better.</p>
        ${ev.settings.publicReport ? `<a class="btn primary" href="${CP.page('report.html', { code })}">📊 See the session report</a>` : '<p class="dim" style="font-size:.85rem">The presenter may share the full report later.</p>'}
      </section>`));
      return;
    }
    const f = { stars: null, nps: null, aspects: {}, word: '', comment: '' };
    const card = h(`<section class="card glow">
      <div class="eyebrow">That's a wrap 🎬</div><h2 style="margin:6px 0 18px">How was "${esc(ev.title)}"?</h2>
      <div class="field" style="text-align:center">Overall<div class="fb-stars" id="fbStars">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}">⭐</button>`).join('')}</div></div>
      <div class="field" style="margin-top:18px">How likely are you to recommend this session? <span class="dim">(0–10)</span>
        <div class="nps" id="fbNps">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-n="${i}" style="--mc:${CP.moodColor(i * 10)}">${i}</button>`).join('')}</div>
        <div class="row dim" style="font-size:.72rem;justify-content:space-between"><span>Not likely</span><span>Extremely likely</span></div></div>
      <div class="field" style="margin-top:14px">Rate the details
        ${['content', 'delivery', 'visuals', 'pace'].map(a => `<div class="aspect"><span style="text-transform:capitalize;color:var(--text)">${a}</span><div class="dots" data-a="${a}">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-v="${i}" aria-label="${a} ${i}"></button>`).join('')}</div></div>`).join('')}</div>
      <label class="field" style="margin-top:16px">Describe it in one word<input class="input" id="fbWord" maxlength="24" placeholder="e.g. inspiring"></label>
      <label class="field" style="margin-top:12px">Anything else? <span class="dim">(optional)</span><textarea class="input" id="fbComment" maxlength="1000" placeholder="What worked, what could be better…"></textarea></label>
      <button class="btn primary" id="fbSend" style="width:100%;margin-top:18px">Send feedback 💌</button></section>`);
    col.appendChild(card);
    $$('#fbStars button', card).forEach(b => b.onclick = () => { f.stars = +b.dataset.s; $$('#fbStars button', card).forEach((x, i) => x.classList.toggle('on', i < f.stars)); });
    $$('#fbNps button', card).forEach(b => b.onclick = () => { f.nps = +b.dataset.n; $$('#fbNps button', card).forEach(x => x.classList.toggle('on', x === b)); });
    $$('.dots', card).forEach(d => $$('button', d).forEach(b => b.onclick = () => { f.aspects[d.dataset.a] = +b.dataset.v; $$('button', d).forEach((x, i) => x.classList.toggle('on', i < +b.dataset.v)); }));
    $('#fbSend', card).onclick = () => {
      if (!f.stars) { CP.toast('⭐ Pick a star rating first'); $('#fbStars', card).classList.add('shake'); setTimeout(() => $('#fbStars', card).classList.remove('shake'), 500); return; }
      f.word = $('#fbWord', card).value; f.comment = $('#fbComment', card).value;
      socket.emit('feedback', f, () => { state.myFeedback = f; CP.confetti(); renderMain(); });
    };
  }

  // ---------- chat ----------
  function renderChat() {
    const list = $('#chat'); list.innerHTML = '';
    state.messages.forEach(m => list.appendChild(CP.renderMsg(m, myPub)));
    if (!state.messages.length) list.innerHTML = `<div class="empty"><span class="big">💬</span>Be the first to say hi!</div>`;
    list.scrollTop = list.scrollHeight;
    const p = state.messages.find(m => m.pinned); setPinned(p);
  }
  function addMsg(m) {
    state.messages.push(m);
    const list = $('#chat'); list.querySelector('.empty')?.remove();
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    list.appendChild(CP.renderMsg(m, myPub));
    if (near || m.pid === myPub) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    if (tab !== 'chat' && m.pid !== myPub) bumpUnread('chat');
  }
  function setPinned(m) {
    $('#pinned').innerHTML = m ? `<div class="pinned">📌 <div style="min-width:0"><b style="color:${esc(m.color)}">${esc(m.name)}</b> ${esc(m.text)}</div></div>` : '';
  }
  socket.on('chat', addMsg);
  socket.on('chat-delete', id => { state.messages = state.messages.filter(m => m.id !== id); $(`#chat [data-id="${id}"]`)?.remove(); });
  socket.on('pinned', setPinned);
  let typT;
  socket.on('typing', ({ name, pid }) => {
    if (pid === myPub) return; // our own typing comes back on the channel too
    $('#typing').textContent = `${name} is typing…`; clearTimeout(typT); typT = setTimeout(() => ($('#typing').textContent = ''), 2000); });
  let lastTyping = 0;
  $('#chatIn').addEventListener('input', () => { if (Date.now() - lastTyping > 1500) { lastTyping = Date.now(); socket.emit('typing'); } });
  $('#chatForm').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#chatIn').value.trim(); if (!v) return;
    socket.emit('chat', v); $('#chatIn').value = '';
  });

  // ---------- Q&A ----------
  function renderQA() {
    const host = $('#qa');
    if (!state.questions.length) { host.innerHTML = `<div class="empty"><span class="big">🙋</span>No questions yet. Got one? Ask away!</div>`; return; }
    host.innerHTML = '';
    state.questions.forEach(q => {
      const mine = q.voters.includes(myPub);
      const el = h(`<div class="q ${q.answered ? 'answered' : ''}"><button class="vote ${mine ? 'on' : ''}" aria-label="Upvote">▲<span class="n">${q.votes}</span></button>
        <div class="qtext">${esc(q.text)}<div class="meta">${esc(q.avatar)} ${esc(q.name)} · ${CP.fmtTime(q.t)} ${q.answered ? '· ✅ Answered' : ''}</div></div></div>`);
      el.querySelector('.vote').onclick = () => socket.emit('vote-q', q.id);
      host.appendChild(el);
    });
  }
  socket.on('questions', qs => { const grew = qs.length > state.questions.length; state.questions = qs; renderQA(); if (grew && tab !== 'qa') bumpUnread('qa'); });
  $('#askForm').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#askIn').value.trim(); if (!v) return;
    socket.emit('ask', v); $('#askIn').value = ''; CP.toast('🙋 Question sent!');
  });

  // ---------- polls ----------
  function pollCard(p) {
    const my = state.myVotes[p.id];
    const total = Math.max(1, p.total);
    const showResults = !p.open || my != null;
    const el = h(`<div class="card ${p.open ? 'poll-pop' : ''}" style="padding:16px">
      <div class="row"><span class="pill ${p.open ? 'live' : ''}">${p.open ? 'POLL OPEN' : 'CLOSED'}</span><span class="spacer"></span><span class="dim" style="font-size:.8rem">${p.total} vote${p.total === 1 ? '' : 's'}</span></div>
      <h3 style="margin-top:10px">${esc(p.question)}</h3>
      ${p.options.map((o, i) => `<button class="poll-opt ${my === i ? 'mine' : ''}" data-i="${i}" ${p.open ? '' : 'disabled'}><div class="fill"></div><span>${esc(o.text)}</span><span>${showResults ? Math.round((o.votes / total) * 100) + '%' : ''}</span></button>`).join('')}
    </div>`);
    requestAnimationFrame(() => $$('.poll-opt', el).forEach((b, i) => { b.querySelector('.fill').style.width = showResults ? (p.options[i].votes / total) * 100 + '%' : '0%'; }));
    $$('.poll-opt', el).forEach(b => b.onclick = () => { state.myVotes[p.id] = +b.dataset.i; socket.emit('poll-vote', { pollId: p.id, idx: +b.dataset.i }); CP.burst(b, '✅', 4); });
    return el;
  }
  function renderPolls() {
    const host = $('#polls');
    if (!state.polls.length) { host.innerHTML = `<div class="empty"><span class="big">📊</span>No polls yet — the presenter can launch one anytime.</div>`; return; }
    host.innerHTML = ''; [...state.polls].reverse().forEach(p => host.appendChild(pollCard(p)));
  }
  function renderPollPop() {
    const host = $('#pollPop'); if (!host) return;
    const p = state.polls.find(x => x.open); host.innerHTML = '';
    if (p) host.appendChild(pollCard(p));
  }
  socket.on('polls', ps => {
    const newOpen = ps.find(p => p.open && !state.polls.find(o => o.id === p.id));
    state.polls = ps; renderPolls(); renderPollPop();
    if (newOpen) { CP.toast('📊 New poll: ' + newOpen.question); if (tab !== 'polls' && tab !== 'rate') bumpUnread('polls'); }
  });

  // ---------- live pulse ----------
  function onPulse(p) {
    state.pulse = p;
    if (gauge) gauge.set(p.avg, p.avg == null ? 'Waiting for ratings' : `${CP.mood(p.avg).label} · ${p.n} rating${p.n === 1 ? '' : 's'}`);
    if (dist) dist.set(p.dist);
    if (chart && p.avg != null) chart.live({ t: p.t, avg: p.avg, online: p.online, att: p.passive?.index ?? null });
    pv.paintCrowd(p.passive);
    const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    set('sOnline', p.online); set('sEnergy', p.energy);
    set('sMom', p.momentum > 0.5 ? '↗ ' + p.momentum : p.momentum < -0.5 ? '↘ ' + Math.abs(p.momentum) : '→');
    set('crowdN', CP.fmtClock(p.elapsed) + ' elapsed');
    if (myRating == null) bg.setMood(p.avg);
    updateYouVs();
  }
  socket.on('pulse', onPulse);
  socket.on('history-point', p => { state.history.push(p); chart?.commit(p); });
  socket.on('marker', m => { state.markers.push(m); chart?.addMarker(m); });
  socket.on('reaction', r => CP.floatEmoji(r.e));
  socket.on('confetti', () => CP.confetti());
  socket.on('announce', a => banner(a.text));
  socket.on('spotlight', q => {
    const el = h(`<div class="spot"><div class="card glow"><div class="eyebrow">🔦 Question in the spotlight</div><p style="margin:14px 0">"${esc(q.text)}"</p><div class="muted" style="font-size:1rem;font-family:var(--font)">${esc(q.avatar)} ${esc(q.name)}</div></div></div>`);
    el.onclick = () => el.remove(); document.body.appendChild(el); setTimeout(() => el.remove(), 7000);
  });
  socket.on('event', ev => {
    const changed = ev.status !== state.event.status;
    const settingsChanged = JSON.stringify(ev.settings) !== JSON.stringify(state.event.settings);
    state.event = ev;
    if (changed && ev.status === 'live') { CP.confetti(80); CP.toast('🎬 We are live!'); }
    if (changed || settingsChanged) renderAll(); else { $('#evTitle').textContent = ev.title; }
  });
  socket.on('reset', () => location.reload());
  socket.on('deleted', () => { $('#mainCol').innerHTML = `<div class="card empty"><span class="big">👋</span>This session was removed by the host.</div>`; });

  function banner(text) {
    $$('.banner').forEach(b => b.remove());
    const b = h(`<div class="banner"><span style="font-size:1.4rem">📣</span><div style="flex:1">${esc(text)}</div><button class="btn sm ghost" style="color:white;border-color:rgba(255,255,255,.4)">✕</button></div>`);
    b.querySelector('button').onclick = () => b.remove(); document.body.appendChild(b); setTimeout(() => b.remove(), 12000);
  }

  // ---------- tabs ----------
  function setTab(t) {
    if (t === 'rate' && matchMedia('(min-width: 901px)').matches) t = 'chat';
    tab = t; document.body.dataset.tab = t;
    $$('#tabs button, #mobnav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === t));
    if (unread[t] != null) { unread[t] = 0; paintUnread(); }
    if (t === 'chat') { const l = $('#chat'); l.scrollTop = l.scrollHeight; }
  }
  function bumpUnread(t) { unread[t]++; paintUnread(); }
  function paintUnread() {
    for (const t of Object.keys(unread)) $$(`[data-tab="${t}"] .dot`).forEach(d => { d.textContent = unread[t] > 99 ? '99+' : unread[t]; d.classList.toggle('hidden', !unread[t]); });
  }
  $$('#tabs button, #mobnav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  if (matchMedia('(min-width: 901px)').matches) { tab = 'chat'; }

  // ---------- profile ----------
  function profileModal(first = false) {
    let av = me.avatar, col = me.color;
    const m = h(`<div class="modal-back"><div class="modal card glow">
      <div class="eyebrow">${first ? 'Welcome! 👋' : 'Your profile'}</div><h2 style="margin:6px 0 16px">${first ? 'How should the room see you?' : 'Edit your profile'}</h2>
      <label class="field">Display name<input class="input" id="pfName" maxlength="32" value="${esc(me.name)}"></label>
      <div class="field" style="margin-top:14px">Avatar<div class="avatar-grid">${CP.AVATARS.map(a => `<button type="button" class="${a === av ? 'on' : ''}">${a}</button>`).join('')}</div></div>
      <div class="field" style="margin-top:14px">Colour<div class="row wrap-row" style="gap:8px">${CP.COLORS.map(c => `<button type="button" data-c="${c}" style="width:30px;height:30px;border-radius:50%;background:${c};border:2px solid ${c === col ? '#fff' : 'transparent'};cursor:pointer"></button>`).join('')}</div></div>
      <button class="btn primary" id="pfSave" style="width:100%;margin-top:20px">${first ? "Let's go →" : 'Save'}</button>
      <button type="button" class="pv-link" id="pfShare" style="display:block;margin:14px auto 0">🔒 What does this page share?</button></div></div>`);
    document.body.appendChild(m);
    $$('.avatar-grid button', m).forEach(b => b.onclick = () => { av = b.textContent; $$('.avatar-grid button', m).forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-c]', m).forEach(b => b.onclick = () => { col = b.dataset.c; $$('[data-c]', m).forEach(x => (x.style.borderColor = x === b ? '#fff' : 'transparent')); });
    $('#pfShare', m).onclick = () => pv.infoSheet();
    $('#pfSave', m).onclick = () => {
      me = { ...me, name: $('#pfName', m).value.trim() || me.name, avatar: av, color: col };
      CP.saveProfile(me); paintMe(); socket.emit('profile', me); m.remove();
    };
  }
  $('#meBtn').onclick = () => profileModal(false);
})();
