// Stage / big-screen view
(function () {
  const { $, esc, h } = CP;
  const code = CP.codeFromPath();
  const bg = CP.backdrop({ intensity: .34, stars: 140 });
  const socket = CP.connect({ code, ticker: 'always' });
  const gauge = CP.gauge($('#gauge'), { big: true });
  const chart = CP.pulseChart($('#chart'), { windowMs: 0 });
  let S = null, joinUrl = '';
  $('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();

  socket.on('connect', () => socket.emit('watch', { code }, res => {
    if (res.error) { document.body.innerHTML = '<div class="empty" style="margin-top:20vh">Session not found</div>'; return; }
    S = res; joinUrl = CP.joinUrl(code); render();
  }));

  function render() {
    const ev = S.event;
    document.documentElement.style.setProperty('--accent', ev.accent);
    document.title = ev.title + ' · Stage';
    $('#title').textContent = ev.title; $('#code').textContent = ev.code;
    $('#qr').src = CP.qrFor(code); $('#host').textContent = CP.siteLabel();
    $('#pill').innerHTML = `<span class="pill ${ev.status}">${ev.status === 'live' ? 'LIVE' : ev.status.toUpperCase()}</span>`;
    chart.setStart(ev.startedAt); chart.set(S.history); chart.markers(S.markers);
    const m = S.markers[S.markers.length - 1]; $('#marker').textContent = m ? '· ' + m.label : '';
    $('#ticker').innerHTML = ''; S.messages.slice(-12).forEach(addMsg);
    if (S.pulse) onPulse(S.pulse);
    lobby(); pollOverlay();
  }

  // Esc or ✕ hides the lobby/wrap-up overlay for the current status; Esc again brings it back.
  // Keyed on status so the wrap-up screen still appears after a dismissed lobby.
  let dismissedFor = null;
  function setLobbyDismissed(on) { if (!S) return; dismissedFor = on ? S.event.status : null; lobby(); }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !S || S.event.status === 'live') return;
    setLobbyDismissed(dismissedFor !== S.event.status);
  });

  function lobby() {
    const ev = S.event, L = $('#lobby');
    if (ev.status === 'live' || dismissedFor === ev.status) { L.classList.add('hidden'); return; }
    L.classList.remove('hidden');
    const close = `<button class="btn sm lobby-x" id="lobbyX" title="Hide (Esc)" aria-label="Hide overlay">✕</button>`;
    if (ev.status === 'ended') {
      L.innerHTML = `${close}<div><div class="eyebrow">That's a wrap</div><h1 style="font-size:clamp(2.4rem,7vh,5rem);margin-top:2vh">Thank you! 💜</h1>
        <p class="muted" style="font-size:clamp(1rem,2.4vh,1.6rem)">Scan to leave a quick review</p><div class="qr" style="width:min(32vh,320px)"><img src="${CP.qrFor(code)}"></div><div class="c">${ev.code}</div></div>`;
      $('#lobbyX').onclick = () => setLobbyDismissed(true);
      return;
    }
    L.innerHTML = `${close}<div><div class="eyebrow">Starting soon · ${esc(CP.fmtDate(ev.startsAt))}</div>
      <h1 style="font-size:clamp(2rem,6vh,4.4rem);margin-top:1.5vh;max-width:80vw">${esc(ev.title)}</h1>
      ${ev.presenter ? `<div class="muted" style="font-size:clamp(1rem,2.2vh,1.5rem)">with ${esc(ev.presenter)}</div>` : ''}
      <div class="qr"><img src="${CP.qrFor(code)}"></div>
      <div class="muted" style="font-size:clamp(1rem,2.2vh,1.4rem)">Scan or go to <b>${esc(CP.siteLabel())}</b> and enter</div>
      <div class="c gradient-text">${ev.code}</div>
      <div class="crowd-dots" id="dots"></div><div class="muted" id="dotsN" style="margin-top:1vh"></div></div>`;
    $('#lobbyX').onclick = () => setLobbyDismissed(true);
    paintDots();
  }
  function paintDots() {
    const d = $('#dots'); if (!d) return;
    const n = S.pulse?.online ?? 0; const avatars = [...new Set(S.messages.map(m => m.avatar))];
    const have = d.children.length;
    for (let i = have; i < Math.min(n, 80); i++) d.appendChild(h(`<span style="animation-delay:${(i - have) * 40}ms">${avatars[i % Math.max(1, avatars.length)] || CP.AVATARS[i % CP.AVATARS.length]}</span>`));
    while (d.children.length > n) d.lastElementChild.remove();
    $('#dotsN').textContent = n ? `${n} ${n === 1 ? 'person has' : 'people have'} joined` : 'Be the first to join!';
  }

  function onPulse(p) {
    S.pulse = p;
    gauge.set(p.avg, p.avg == null ? 'Rate along on your phone' : `${CP.mood(p.avg).label} · ${p.n} voices`);
    bg.setMood(p.avg);
    CP.countUp($('#kOnline'), p.online, { dur: 600 }); CP.countUp($('#kEnergy'), p.energy, { dur: 600 }); CP.countUp($('#kRpm'), p.rpm, { dur: 600 });
    $('#timer').textContent = CP.fmtClock(p.elapsed);
    const att = p.passive?.index ?? null;
    if (p.avg != null || att != null) chart.live({ t: p.t, avg: p.avg, online: p.online, att });
    // attention tile appears only once the crowd is big enough for a passive figure
    $('#attTile').classList.toggle('hidden', att == null); $('.s-stats').classList.toggle('has-att', att != null);
    if (att != null) CP.countUp($('#kAtt'), Math.round(att), { dur: 600 });
  }
  socket.on('pulse', onPulse);
  setInterval(() => { if (S && S.event.status !== 'live') paintDots(); }, 2000);
  socket.on('admin-summary', () => {});
  socket.on('history-point', p => chart.commit(p));
  socket.on('marker', m => { chart.addMarker(m); $('#marker').textContent = '· ' + m.label; });
  socket.on('reaction', r => CP.floatEmoji(r.e, { size: 2.4 + Math.random() * 2 }));
  socket.on('confetti', () => CP.confetti(260));
  function addMsg(m) {
    const t = $('#ticker'); t.appendChild(CP.renderMsg(m, null));
    while (t.children.length > 12) t.firstElementChild.remove();
  }
  socket.on('chat', m => { S.messages.push(m); addMsg(m); });
  socket.on('chat-delete', id => $(`#ticker [data-id="${id}"]`)?.remove());
  socket.on('event', ev => { const ch = ev.status !== S.event.status; S.event = ev; if (ch) { if (ev.status === 'live') CP.confetti(200); render(); } });
  socket.on('polls', ps => { S.polls = ps; pollOverlay(); });
  socket.on('reset', () => location.reload());
  function pollOverlay() {
    document.querySelector('.poll-ov')?.remove();
    const p = S.polls.find(x => x.open); if (!p) return;
    const total = Math.max(1, p.total);
    const el = h(`<div class="card glow poll-ov"><div class="row"><span class="pill live">LIVE POLL</span><span class="spacer"></span><b>${p.total} votes</b></div>
      <h2 style="margin:12px 0 6px">${esc(p.question)}</h2>${p.options.map(o => `<div class="poll-opt" style="cursor:default;font-size:1.1rem"><div class="fill" style="width:${(o.votes / total) * 100}%"></div><span>${esc(o.text)}</span><span>${Math.round((o.votes / total) * 100)}%</span></div>`).join('')}</div>`);
    document.body.appendChild(el);
  }
  socket.on('announce', a => {
    document.querySelector('.banner')?.remove();
    const b = h(`<div class="banner">📣 ${esc(a.text)}</div>`); document.body.appendChild(b); setTimeout(() => b.remove(), 12000);
  });
  socket.on('spotlight', q => {
    const el = h(`<div class="spot"><div class="card glow"><div class="eyebrow" style="font-family:var(--font)">🔦 Audience question</div><p style="margin:3vh 0">"${esc(q.text)}"</p><div class="muted" style="font-size:.6em;font-family:var(--font)">${esc(q.avatar)} ${esc(q.name)}</div></div></div>`);
    el.onclick = () => el.remove(); document.body.appendChild(el); setTimeout(() => el.remove(), 10000);
  });
})();
