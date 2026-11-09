// Post-session report
(async function () {
  const { $, $$, esc } = CP;
  const code = CP.codeFromPath();
  const key = new URLSearchParams(location.search).get('key') || CP.store.get('cp.keys', {})[code];
  CP.backdrop({ intensity: .22 });
  $('#brand').outerHTML = CP.brand;

  const r = await fetch(`/api/events/${code}/report`, { headers: key ? { 'x-admin-key': key } : {} });
  const R = await r.json();
  if (!r.ok) { $('#root').innerHTML = `<div class="card empty" style="max-width:520px;margin:15vh auto"><span class="big">🔒</span>${esc(R.error)}</div>`; return; }
  if (key) {
    $('#csv').href = `/api/events/${code}/export.csv?key=${key}`; $('#csv').classList.remove('hidden');
    $('#back').href = `/admin/${code}?key=${key}`; $('#back').classList.remove('hidden');
  }
  $('#print').onclick = () => print();
  $('#json').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(R, null, 2)], { type: 'application/json' }));
    a.download = `crowdpulse-${code}-report.json`; a.click();
  };

  const ev = R.event, K = R.kpis;
  document.documentElement.style.setProperty('--accent', ev.accent);
  document.title = ev.title + ' · Report';

  // ---------- Chart.js theme ----------
  Chart.defaults.color = 'rgba(243,241,255,.65)';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.borderColor = 'rgba(255,255,255,.07)';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(14,10,43,.95)';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.animation.duration = 1400;
  const PAL = ['#7c5cff', '#ff5ca8', '#2ee6d6', '#ffb547', '#3ec5ff', '#b6f35c', '#ff7a45', '#c86bff'];
  const mins = ms => CP.fmtClock(ms);
  const nf = v => (v == null ? '—' : v);

  const markerPlugin = {
    id: 'markers',
    afterDatasetsDraw(chart, _, opts) {
      const { ctx, chartArea: a, scales: { x } } = chart;
      (opts.list || []).forEach(m => {
        const px = x.getPixelForValue(m.t); if (px < a.left || px > a.right) return;
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '600 11px Inter'; ctx.fillText(m.label, px + 4, a.top + 12); ctx.restore();
      });
    },
  };

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const has = R.timeline.some(p => p.avg != null);
  const P = R.passive || null;
  const TEAL = '#2ee6d6';

  // ---------- skeleton ----------
  $('#root').innerHTML = `
  <section class="hero">
    <div>
      <div class="eyebrow">Session report · ${ev.status === 'ended' ? 'Final' : 'Live snapshot'}</div>
      <h1 style="margin-top:10px">${esc(ev.title)}</h1>
      <div class="muted" style="margin-top:10px">${[ev.presenter && '🎤 ' + esc(ev.presenter), '🗓️ ' + CP.fmtDate(ev.startedAt || ev.startsAt), '⏱️ ' + mins(R.durationMs), CP.locationText(ev.location)].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
      <div class="row wrap-row" style="margin-top:18px;gap:10px"><span class="pill">${esc(K.grade.label)}</span>${K.nps != null ? `<span class="pill">NPS ${K.nps > 0 ? '+' : ''}${K.nps}</span>` : ''}${K.avgStars != null ? `<span class="pill">⭐ ${K.avgStars} / 5</span>` : ''}<span class="pill">${K.engagementRate}% engaged</span></div>
    </div>
    <div class="grade" id="grade"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7"/>
      <circle class="arc" cx="50" cy="50" r="44" fill="none" stroke="${CP.moodColor(K.overall ?? 50)}" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" style="filter:drop-shadow(0 0 8px ${CP.moodColor(K.overall ?? 50)})"/></svg>
      <div class="gl"><div class="letter gradient-text">${esc(K.grade.letter)}</div><div class="score"><span id="ovNum">0</span> / 100</div></div></div>
  </section>

  <section class="kpis reveal" id="kpis"></section>

  <section class="g-2-1 sec">
    <div class="card reveal"><div class="card-title"><h3>📈 Crowd mood timeline</h3><span class="eyebrow">avg rating · audience size</span></div><div class="chart-box tall"><canvas id="cTimeline"></canvas></div></div>
    <div class="card reveal"><div class="card-title"><h3>💡 Key insights</h3></div><div class="insights" id="insights"></div></div>
  </section>
${P ? `
  <section class="sec" id="passive">
    <div class="card reveal"><div class="card-title"><h3>👁️ Passive signals</h3><span class="eyebrow">what the room showed · crowd figures only</span></div>
      <div class="ps-sources" id="psSources"></div><div class="kpis" id="psKpis"></div></div>
    <div class="g-2-1 sec">
      <div class="card reveal"><div class="card-title"><h3>🎯 Rating vs. attention</h3><span class="eyebrow">said · shown · heard</span></div><div class="chart-box tall"><canvas id="cPassive"></canvas></div></div>
      <div class="card reveal"><div class="card-title"><h3>🔎 How the room behaved</h3></div><div class="ps-side" id="psSide"></div></div>
    </div>
    <div class="card sec reveal">
      <div class="ps-sub" style="margin-top:0"><h3>🎭 Said vs. shown</h3><span class="eyebrow">where ratings and attention pulled apart</span></div><div class="g3" id="psGaps"></div>
      <div id="psAudioWrap"><div class="ps-sub"><h3>😂 Laughs &amp; applause</h3><span class="eyebrow">room microphone</span></div><div class="g3" id="psAudio"></div></div>
      <div class="privacy"><span>🔒</span><div>Measured on attendees' own devices. Only crowd figures from ${P.minCrowd}+ people are shown, no images or audio are stored, and these signals never change the rating score.</div></div>
    </div>
  </section>` : ''}

  <section class="card sec reveal"><div class="card-title"><h3>🌡️ Time spent in each mood zone</h3><span class="eyebrow">high ${nf(K.high)} · low ${nf(K.low)} · volatility ${nf(K.volatility)}</span></div><div class="zone-strip" id="zones"></div>
    <div class="row dim" style="justify-content:space-between;font-size:.75rem;margin-top:6px"><span>😫 Rough</span><span>😕 Meh</span><span>😐 Okay</span><span>🙂 Good</span><span>🤩 Amazing</span></div></section>

  <section class="sec reveal"><div class="card"><div class="card-title"><h3>⚡ Key moments</h3><span class="eyebrow">biggest peaks &amp; dips</span></div><div class="g3" id="moments"></div></div></section>

  <section class="g2 sec">
    <div class="card reveal"><div class="card-title"><h3>📊 Rating distribution</h3><span class="eyebrow">per-attendee average</span></div><div class="chart-box"><canvas id="cHist"></canvas></div></div>
    <div class="card reveal"><div class="card-title"><h3>🎚️ Favourite rating styles</h3></div><div class="chart-box"><canvas id="cModes"></canvas></div></div>
  </section>

  <section class="card sec reveal chapters hidden" id="chaptersCard"><div class="card-title"><h3>📍 How each section landed</h3></div><div id="chapters" class="scroll" style="overflow-x:auto"></div></section>

  <section class="g2 sec">
    <div class="card reveal"><div class="card-title"><h3>🧲 Engagement funnel</h3><span class="eyebrow">${R.funnel.joined} attendees</span></div><div class="funnel" id="funnel"></div></div>
    <div class="card reveal"><div class="card-title"><h3>🎆 Reactions</h3><span class="eyebrow">${K.reactions} total</span></div><div class="chart-box"><canvas id="cReacts"></canvas></div></div>
  </section>

  <section class="g-2-1 sec">
    <div class="card reveal"><div class="card-title"><h3>💬 Conversation activity</h3><span class="eyebrow">messages &amp; reactions over time</span></div><div class="chart-box"><canvas id="cActivity"></canvas></div></div>
    <div class="card reveal"><div class="card-title"><h3>🙂 Chat sentiment</h3></div><div class="chart-box"><canvas id="cSent"></canvas></div></div>
  </section>

  <section class="card sec reveal"><div class="card-title"><h3>☁️ What people talked about</h3><span class="eyebrow">chat · questions · feedback</span></div><div class="cloud" id="cloud"></div></section>

  <section class="g3 sec">
    <div class="card reveal"><div class="card-title"><h3>⭐ Overall rating</h3><span class="eyebrow">${R.feedback.count} reviews</span></div><div class="chart-box short"><canvas id="cStars"></canvas></div></div>
    <div class="card reveal"><div class="card-title"><h3>📣 Net Promoter Score</h3></div><div class="nps-big" id="npsBig" style="color:${R.feedback.nps == null ? 'var(--dim)' : R.feedback.nps >= 30 ? 'var(--good)' : R.feedback.nps >= 0 ? 'var(--warn)' : 'var(--bad)'}">${R.feedback.nps == null ? '—' : (R.feedback.nps > 0 ? '+' : '') + R.feedback.nps}</div><div class="chart-box short" style="height:170px"><canvas id="cNps"></canvas></div></div>
    <div class="card reveal"><div class="card-title"><h3>🧭 Detail ratings</h3></div><div class="chart-box short"><canvas id="cAspects"></canvas></div></div>
  </section>

  <section class="g2 sec">
    <div class="card reveal"><div class="card-title"><h3>🏅 Top contributors</h3></div><div class="leader" id="leader"></div></div>
    <div class="card reveal"><div class="card-title"><h3>💌 What attendees said</h3></div><div class="comments scroll" id="comments"></div></div>
  </section>

  <section class="g2 sec">
    <div class="card reveal"><div class="card-title"><h3>🙋 Questions</h3><span class="eyebrow">${R.questions.length} asked</span></div><div class="grid scroll" id="questions" style="gap:8px;max-height:420px"></div></div>
    <div class="card reveal"><div class="card-title"><h3>🗳️ Poll results</h3></div><div class="grid" id="polls" style="gap:14px"></div></div>
  </section>
  <p class="center dim" style="margin-top:40px;font-size:.8rem">Generated ${new Date(R.generatedAt).toLocaleString()} by CrowdPulse</p>`;

  CP.reveal();

  // ---------- hero grade ----------
  requestAnimationFrame(() => setTimeout(() => {
    $('#grade').classList.add('in');
    $('#grade .arc').setAttribute('stroke-dasharray', `${K.overall ?? 0} 100`);
    CP.countUp($('#ovNum'), K.overall ?? 0, { dur: 1800, dec: 0 });
    if ((K.overall ?? 0) >= 80) setTimeout(() => CP.confetti(), 1500);
  }, 200));

  // ---------- KPIs ----------
  const KP = [
    ['Attendees', K.participants, `peak ${K.peakOnline} online`, '#2ee6d6'],
    ['Avg mood', K.overall, `median ${nf(K.median)} · σ ${nf(K.stdev)}`, CP.moodColor(K.overall ?? 50)],
    ['Final mood', K.finalScore, 'last rating per person', CP.moodColor(K.finalScore ?? 50)],
    ['Ratings', K.ratingsCount, `${pct(R.funnel.rated, R.funnel.joined)}% of attendees rated`, '#7c5cff'],
    ['Reactions', K.reactions, R.reactionBreakdown[0] ? `mostly ${R.reactionBreakdown[0].emoji}` : '—', '#ff5ca8'],
    ['Messages', K.messages, `${R.sentimentSplit.positive} positive`, '#3ec5ff'],
    ['Questions', K.questions, R.mostUpvoted ? `top: ${R.mostUpvoted.votes} votes` : '—', '#ffb547'],
    ['Engagement', K.engagementRate, '% actively took part', '#b6f35c'],
  ];
  $('#kpis').innerHTML = KP.map(([k, v, s, c]) => `<div class="kpi" style="--kc:${c}"><div class="k">${k}</div><div class="v" data-to="${v ?? ''}">—</div><div class="s">${esc(s)}</div></div>`).join('');
  const kio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; kio.disconnect();
    $$('#kpis .v').forEach(el => el.dataset.to !== '' && CP.countUp(el, Number(el.dataset.to), { dec: Number(el.dataset.to) % 1 ? 1 : 0, suffix: el.parentElement.querySelector('.k').textContent === 'Engagement' ? '%' : '' }));
  }));
  kio.observe($('#kpis'));

  // ---------- insights (typed in one by one) ----------
  const ins = $('#insights');
  if (!R.insights.length) ins.innerHTML = `<div class="empty">Insights appear once the session has some activity.</div>`;
  R.insights.forEach((t, i) => {
    const el = CP.h(`<div class="insight" style="opacity:0;transform:translateX(-10px);transition:all .5s ${0.3 + i * 0.18}s"><span class="n">${i + 1}</span><div>${esc(t)}</div></div>`);
    ins.appendChild(el); requestAnimationFrame(() => setTimeout(() => { el.style.opacity = 1; el.style.transform = 'none'; }, 30));
  });

  // ---------- lazy chart creation (animate when scrolled into view) ----------
  const lazy = (id, cfg) => {
    const c = document.getElementById(id); if (!c) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); new Chart(c, typeof cfg === 'function' ? cfg(c) : cfg); } }, { threshold: .2 });
    io.observe(c);
  };

  // timeline
  lazy('cTimeline', c => {
    const ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, c.clientHeight || 340);
    g.addColorStop(0, 'rgba(124,92,255,.45)'); g.addColorStop(1, 'rgba(124,92,255,0)');
    return {
      type: 'line',
      data: {
        datasets: [
          { label: 'Mood', data: R.timeline.map(p => ({ x: p.t, y: p.avg })), yAxisID: 'y', tension: .4, borderWidth: 3, pointRadius: 0, fill: true, backgroundColor: g, spanGaps: true,
            segment: { borderColor: s => CP.moodColor((s.p0.parsed.y + s.p1.parsed.y) / 2) } },
          { label: 'Online', data: R.timeline.map(p => ({ x: p.t, y: p.online })), type: 'bar', yAxisID: 'y2', backgroundColor: 'rgba(46,230,214,.15)', borderRadius: 3, barPercentage: 1, categoryPercentage: 1 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'linear', ticks: { callback: v => mins(v), maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 0, max: 100, ticks: { stepSize: 25 } },
          y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } },
        },
        plugins: { markers: { list: R.markers }, tooltip: { callbacks: { title: i => mins(i[0].parsed.x) } } },
      },
      plugins: [markerPlugin],
    };
  });
  if (!has) $('#cTimeline').parentElement.innerHTML = `<div class="empty"><span class="big">📈</span>No ratings were recorded while the session was live.</div>`;

  // ---------- passive signals (crowd figures only; hidden when the session has none) ----------
  if (P) {
    const S = P.sources, A = P.attention, L = P.laughter, AP = P.applause;
    $('#psSources').innerHTML = [
      [S.tab, '🗂️ Tab focus', `${P.contributors.tab} devices`],
      [S.camera, '📷 Attendee cameras', `${P.camera.optIns} opted in`],
      [S.room, '🎥 Room camera & mic', 'presenter device'],
    ].map(([on, l, s]) => `<span class="pill ${on ? '' : 'off'}" title="${on ? 'On' : 'Off'} for this session">${l}${on ? ` · <span class="dim">${esc(s)}</span>` : ''}</span>`).join('');

    const PK = [
      ['Attention', A?.avg, '', A ? `peak ${A.peak} · low ${A.low}` : `needs ${P.minCrowd}+ people`, TEAL],
      ['Tab focus', P.focus?.avg, '%', P.awayPct != null ? (P.awayPct ? `40%+ of room away ${P.awayPct}% of the time` : 'room never 40%+ away') : (S.tab ? `needs ${P.minCrowd}+ people` : 'tab signal off'), '#3ec5ff'],
      ['Camera opt-ins', S.camera ? P.camera.optIns : null, '', S.camera ? (P.camera.share != null ? `${P.camera.share}% of attendees` : '') : 'attendee cameras off', '#c86bff'],
      ['Laughter peaks', S.room ? L.count : null, '', S.room ? (L.count ? `loudest ${L.peak} · ${AP.count} applause` : `${AP.count} applause`) : 'room mic off', '#ff5ca8'],
    ];
    $('#psKpis').innerHTML = PK.map(([k, v, suf, s, c]) => `<div class="kpi" style="--kc:${c}"><div class="k">${k}</div><div class="v" data-to="${v ?? ''}" data-suf="${suf}">—</div><div class="s">${esc(s)}</div></div>`).join('');
    new IntersectionObserver((es, o) => {
      if (!es[0].isIntersecting) return; o.disconnect();
      $$('#psKpis .v').forEach(el => el.dataset.to !== '' && CP.countUp(el, Number(el.dataset.to), { dec: Number(el.dataset.to) % 1 ? 1 : 0, suffix: el.dataset.suf }));
    }).observe($('#psKpis'));

    // side panel: correlation, expressions, room camera, how time away was spread
    const side = [];
    const C = P.correlation;
    side.push(`<div class="ps-stat"><div class="eyebrow">Ratings ↔ attention</div>${C
      ? `<div class="big" style="color:${Math.abs(C.r) >= 0.45 ? 'var(--good)' : Math.abs(C.r) >= 0.2 ? 'var(--warn)' : 'var(--muted)'}">r = ${C.r > 0 ? '+' : ''}${C.r}</div><div style="font-size:.88rem">${esc(C.label)}.</div><div class="dim" style="font-size:.75rem;margin-top:4px">${C.points} five-second readings</div>`
      : '<div class="dim" style="font-size:.88rem;margin-top:6px">Not enough overlapping rating and attention readings.</div>'}</div>`);
    if (S.camera) side.push(`<div class="ps-stat"><div class="eyebrow">Faces (opted-in cameras)</div>${P.positive != null || P.fatigue != null
      ? `<div class="row" style="gap:22px;margin-top:4px"><div><div class="big" style="color:var(--good)">${nf(P.positive)}</div><div class="dim" style="font-size:.75rem">🙂 positive</div></div><div><div class="big" style="color:var(--warn)">${nf(P.fatigue)}</div><div class="dim" style="font-size:.75rem">😪 fatigue</div></div>${P.camera.attention != null ? `<div><div class="big" style="color:${TEAL}">${P.camera.attention}</div><div class="dim" style="font-size:.75rem">👀 attention</div></div>` : ''}</div>`
      : `<div class="dim" style="font-size:.88rem;margin-top:6px">Fewer than ${P.minCrowd} people shared their camera at once, so no figures are shown.</div>`}</div>`);
    if (S.room && P.roomAttention != null) side.push(`<div class="ps-stat"><div class="eyebrow">Room camera</div><div class="big" style="color:${TEAL}">${P.roomAttention}</div><div class="dim" style="font-size:.75rem">avg share of faces looking forward</div></div>`);
    if (P.awayDistribution) {
      const tot = P.awayDistribution.reduce((a, b) => a + b.people, 0);
      side.push(`<div class="ps-stat"><div class="eyebrow" style="margin-bottom:8px">Time with the tab out of view</div><div class="funnel" id="psAway">${P.awayDistribution.map(b => `<div class="fr"><span>${b.label}</span><div class="bar"><div data-w="${pct(b.people, tot)}" style="background:linear-gradient(90deg,#3ec5ff,${TEAL})"></div></div><b style="text-align:right">${b.people}</b></div>`).join('')}</div><div class="dim" style="font-size:.75rem;margin-top:6px">people per bucket · ${tot} devices</div></div>`);
    }
    $('#psSide').innerHTML = side.join('');
    if ($('#psAway')) new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); $$('#psAway .bar div').forEach((d, i) => setTimeout(() => (d.style.width = d.dataset.w + '%'), i * 120)); } }).observe($('#psAway'));

    // combined chart: rating (mood colours), attention (dashed teal), tab focus (faint), laughter/applause (small bars)
    const T = P.timeline;
    const hasAtt = T.some(p => p.att != null);
    if (!has && !hasAtt) $('#cPassive').parentElement.innerHTML = '<div class="empty"><span class="big">🎯</span>No crowd-level readings were recorded.</div>';
    else lazy('cPassive', {
      type: 'line',
      data: {
        datasets: [
          { label: 'Rating', data: R.timeline.map(p => ({ x: p.t, y: p.avg })), yAxisID: 'y', tension: .4, borderWidth: 3, pointRadius: 0, spanGaps: true, borderColor: '#7c5cff', backgroundColor: '#7c5cff',
            segment: { borderColor: s => CP.moodColor((s.p0.parsed.y + s.p1.parsed.y) / 2) } },
          { label: 'Attention', data: T.map(p => ({ x: p.t, y: p.att })), yAxisID: 'y', tension: .4, borderWidth: 2.5, borderDash: [7, 5], pointRadius: 0, borderColor: TEAL, backgroundColor: TEAL, spanGaps: false },
          ...(T.some(p => p.focus != null) ? [{ label: 'Tab focus', data: T.map(p => ({ x: p.t, y: p.focus })), yAxisID: 'y', tension: .4, borderWidth: 1.5, pointRadius: 0, borderColor: 'rgba(243,241,255,.28)', backgroundColor: 'rgba(243,241,255,.28)' }] : []),
          ...(T.some(p => p.laugh != null) ? [{ label: 'Laughter', type: 'bar', data: T.map(p => ({ x: p.t, y: p.laugh })), yAxisID: 'y2', backgroundColor: 'rgba(255,92,168,.6)', borderRadius: 2, maxBarThickness: 5 }] : []),
          ...(T.some(p => p.clap != null) ? [{ label: 'Applause', type: 'bar', data: T.map(p => ({ x: p.t, y: p.clap })), yAxisID: 'y2', backgroundColor: 'rgba(255,181,71,.55)', borderRadius: 2, maxBarThickness: 5 }] : []),
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'linear', ticks: { callback: v => mins(v), maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 0, max: 100, ticks: { stepSize: 25 } },
          y2: { position: 'right', min: 0, max: 300, grid: { display: false }, ticks: { stepSize: 50, callback: v => (v <= 100 ? v : '') } },
        },
        plugins: {
          markers: { list: R.markers },
          legend: { labels: { boxWidth: 8, padding: 12 } },
          tooltip: { callbacks: { title: i => mins(i[0].parsed.x), label: c => `${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y}${c.dataset.label === 'Tab focus' ? '%' : ''}` } },
        },
      },
      plugins: [markerPlugin],
    });

    // said vs. shown
    const N = P.norms || {};
    const reactsOf = m => Object.entries(m.reactions || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => `${e}×${n}`).join(' ');
    const quotes = m => (m.messages || []).map(x => `<q>${esc(x.text)} <span class="dim">— ${esc(x.name)}</span></q>`).join('');
    const gh = $('#psGaps');
    if (!P.saidVsShown.length) gh.innerHTML = `<div class="empty" style="grid-column:1/-1">${C ? 'Ratings and attention told the same story: no stretch where they clearly pulled apart.' : 'Said-vs-shown gaps need a few minutes of ratings alongside attention readings from 5+ people.'}</div>`;
    P.saidVsShown.forEach(g => {
      const polite = g.kind === 'polite'; const reacts = reactsOf(g);
      gh.appendChild(CP.h(`<div class="moment ${g.kind}"><div class="mh"><span style="font-size:1.5rem">${polite ? '🙃' : '🧐'}</span><div><div class="eyebrow">${esc(g.label)} · ${mins(g.start)}–${mins(g.end)}</div>${g.chapter ? `<div style="font-size:.82rem">during “${esc(g.chapter)}”</div>` : ''}</div></div>
        <div class="vs"><div><div class="k">Rating</div><span class="mv" style="color:${CP.moodColor(g.rating)}">${g.rating}</span></div><div><div class="k">Attention</div><span class="mv" style="color:${TEAL}">${g.attention}</span></div></div>
        <div class="dim" style="font-size:.78rem;margin-bottom:6px">${polite ? 'Rated above the session norm while attention ran below it' : 'Attention above the session norm while ratings ran below it'}${N.rating != null ? ` (norm: rating ${N.rating}, attention ${N.attention})` : ''}.</div>
        ${reacts ? `<div style="font-size:.9rem">${reacts}</div>` : ''}${quotes(g)}</div>`));
    });

    // laughs & applause (applause within a few seconds of a laugh shares its card)
    if (!S.room && !L.moments.length && !AP.moments.length) $('#psAudioWrap').remove();
    else {
      const au = $('#psAudio');
      const claps = [...AP.moments];
      const cards = L.moments.map(l => { const i = claps.findIndex(c => Math.abs(c.t - l.t) < 6000); return { ...l, clap: i >= 0 ? claps.splice(i, 1)[0].value : null }; })
        .concat(claps).sort((a, b) => a.t - b.t);
      if (!cards.length) au.innerHTML = '<div class="empty" style="grid-column:1/-1">No clear laughter or applause was picked up.</div>';
      cards.forEach(m => {
        const laugh = m.kind === 'laugh'; const reacts = reactsOf(m);
        au.appendChild(CP.h(`<div class="moment ${m.kind}"><div class="mh"><span style="font-size:1.5rem">${laugh ? '😂' : '👏'}</span><div><div class="eyebrow">${laugh ? (m.clap != null ? 'Laughter + applause' : 'Laughter') : 'Applause'} at ${mins(m.t)}</div>${m.marker ? `<div style="font-size:.82rem">during “${esc(m.marker)}”</div>` : ''}</div><span class="spacer"></span><span class="mv" style="color:${laugh ? '#ff5ca8' : '#ffb547'}" title="loudness 0–100">${m.value}</span></div>
          ${reacts ? `<div style="font-size:.9rem">${reacts}</div>` : ''}${quotes(m)}</div>`));
      });
    }
  }

  // zones
  const zoneLabels = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];
  $('#zones').innerHTML = R.zonePct.map((z, i) => `<div style="background:${CP.moodColor(i * 25)}" title="${zoneLabels[i]}: ${z}%">${z >= 6 ? z + '%' : ''}</div>`).join('');
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); $$('#zones div').forEach((d, i) => (d.style.flex = R.zonePct[i])); } }).observe($('#zones'));
  if (!R.zonePct.some(Boolean)) $('#zones').innerHTML = '<div style="flex:1;background:rgba(255,255,255,.06);color:var(--dim)">No data yet</div>';

  // moments
  const mh = $('#moments');
  if (!R.moments.length) mh.innerHTML = `<div class="empty" style="grid-column:1/-1">Key moments are detected once the session has run for a minute or so.</div>`;
  R.moments.forEach(m => {
    const reacts = Object.entries(m.reactions).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => `${e}×${n}`).join(' ');
    mh.appendChild(CP.h(`<div class="moment ${m.kind}"><div class="mh"><span style="font-size:1.5rem">${m.kind === 'peak' ? '🚀' : '🕳️'}</span><div><div class="eyebrow">${m.kind === 'peak' ? 'Peak' : 'Dip'} at ${mins(m.t)}</div>${m.marker ? `<div style="font-size:.82rem">during “${esc(m.marker)}”</div>` : ''}</div><span class="spacer"></span><span class="mv" style="color:${CP.moodColor(m.avg)}">${m.avg}</span></div>
      ${reacts ? `<div style="font-size:.9rem">${reacts}</div>` : ''}${m.messages.map(x => `<q>${esc(x.text)} <span class="dim">— ${esc(x.name)}</span></q>`).join('')}</div>`));
  });

  // histogram
  lazy('cHist', {
    type: 'bar',
    data: { labels: R.histogram.map((_, i) => `${i * 10}–${i * 10 + 10}`), datasets: [{ label: 'Attendees', data: R.histogram, backgroundColor: R.histogram.map((_, i) => CP.moodColor(i * 10 + 5, .85)), borderRadius: 8 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  // modes
  const MODE_LABEL = Object.fromEntries(['slider:🎚️ Slider', 'smiley:😊 Smileys', 'stars:⭐ Stars', 'dial:🎛️ Dial', 'weather:🌤️ Weather', 'thermo:🌡️ Thermo', 'thumbs:👍 Thumbs', 'emoji:🔮 Vibes', 'tilt:📱 Tilt'].map(s => s.split(':')));
  const modes = Object.entries(R.modePeople);
  lazy('cModes', {
    type: 'doughnut',
    data: { labels: modes.map(([m]) => MODE_LABEL[m] || m), datasets: [{ data: modes.map(([, n]) => n), backgroundColor: PAL, borderColor: '#07051a', borderWidth: 3, hoverOffset: 14 }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' } } },
  });

  // chapters
  if (R.chapters.length) {
    $('#chaptersCard').classList.remove('hidden');
    const attCol = !!P && R.chapters.some(c => c.attention != null);
    $('#chapters').innerHTML = `<table><thead><tr><th>Section</th><th>Started</th><th>Length</th><th>Mood</th><th></th>${attCol ? '<th>Attention</th>' : ''}<th>Reactions</th><th>Messages</th></tr></thead><tbody>
      ${R.chapters.map(c => `<tr><td><b>${esc(c.label)}</b></td><td>${mins(c.t)}</td><td>${mins(c.durationMs)}</td><td style="color:${CP.moodColor(c.avg ?? 50)};font-weight:700">${nf(c.avg)}</td>
      <td><div class="mini-bar"><div style="width:${c.avg ?? 0}%;background:${CP.moodColor(c.avg ?? 50)}"></div></div></td>${attCol ? `<td style="color:${TEAL};font-weight:700" title="attention index">${nf(c.attention)}</td>` : ''}<td>${c.reactions}</td><td>${c.messages}</td></tr>`).join('')}</tbody></table>`;
  }

  // funnel
  const F = R.funnel; const FL = [['👥 Joined', F.joined], ['🎚️ Rated', F.rated], ['🎆 Reacted', F.reacted], ['💬 Chatted', F.chatted], ['🗳️ Voted in poll', F.polled], ['🙋 Asked', F.asked], ['💌 Reviewed', F.reviewed]];
  $('#funnel').innerHTML = FL.map(([l, n]) => `<div class="fr"><span>${l}</span><div class="bar"><div data-w="${pct(n, F.joined)}"></div></div><b style="text-align:right">${n}</b></div>`).join('');
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); $$('#funnel .bar div').forEach((d, i) => setTimeout(() => (d.style.width = d.dataset.w + '%'), i * 120)); } }).observe($('#funnel'));

  // reactions
  if (R.reactionBreakdown.length) {
    lazy('cReacts', {
      type: 'polarArea',
      data: { labels: R.reactionBreakdown.map(r => `${r.emoji} ${r.label}`), datasets: [{ data: R.reactionBreakdown.map(r => r.count), backgroundColor: PAL.map(c => c + 'bb'), borderColor: '#07051a', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, scales: { r: { ticks: { display: false }, grid: { color: 'rgba(255,255,255,.08)' } } }, plugins: { legend: { position: 'right' } } },
    });
  } else $('#cReacts').parentElement.innerHTML = '<div class="empty"><span class="big">🎆</span>No reactions recorded.</div>';

  // activity
  lazy('cActivity', {
    type: 'bar',
    data: {
      labels: R.chatTimeline.map(b => mins(b.t)),
      datasets: [
        { label: 'Messages', data: R.chatTimeline.map(b => b.count), backgroundColor: '#3ec5ffcc', borderRadius: 5, stack: 'a' },
        { label: 'Reactions', data: R.reactTimeline.map(b => b.count), backgroundColor: '#ff5ca8aa', borderRadius: 5, stack: 'b' },
        { label: 'Sentiment', type: 'line', data: R.chatTimeline.map(b => (b.count ? +(b.sentiment / b.count).toFixed(2) : null)), yAxisID: 's', borderColor: '#ffb547', tension: .4, pointRadius: 0, borderWidth: 2, spanGaps: true },
      ],
    },
    options: { maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } }, s: { position: 'right', min: -3, max: 3, grid: { display: false } } } },
  });
  lazy('cSent', {
    type: 'doughnut',
    data: { labels: ['😊 Positive', '😐 Neutral', '😕 Negative'], datasets: [{ data: [R.sentimentSplit.positive, R.sentimentSplit.neutral, R.sentimentSplit.negative], backgroundColor: ['#2ee6a6', '#7c74b8', '#ff5c7a'], borderColor: '#07051a', borderWidth: 3 }] },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } },
  });

  // word cloud
  const cloud = $('#cloud');
  if (!R.wordCloud.length) cloud.innerHTML = '<div class="empty">Not enough chatter for a word cloud yet.</div>';
  else {
    const max = R.wordCloud[0].count, min = R.wordCloud[R.wordCloud.length - 1].count;
    const shuffled = [...R.wordCloud].sort(() => Math.random() - .5);
    cloud.innerHTML = shuffled.map((w, i) => {
      const s = 0.85 + ((w.count - min) / Math.max(1, max - min)) * 2.4;
      const col = w.sentiment > 0 ? '#2ee6a6' : w.sentiment < 0 ? '#ff7a8f' : PAL[i % PAL.length];
      return `<span style="font-size:${s}rem;color:${col};transition-delay:${i * 25}ms;transform:scale(.6) rotate(${Math.random() < .15 ? -8 : 0}deg)" title="${w.count} mentions">${esc(w.word)}</span>`;
    }).join('');
    new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); cloud.classList.add('in'); } }).observe(cloud);
  }

  // feedback
  const FB = R.feedback;
  if (FB.count) {
    lazy('cStars', {
      type: 'bar', data: { labels: ['1★', '2★', '3★', '4★', '5★'], datasets: [{ data: FB.starDist, backgroundColor: ['#ff4d6d', '#ff8c42', '#ffcd4d', '#4ce696', '#2ed6ff'], borderRadius: 8 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
    });
    lazy('cNps', {
      type: 'doughnut', data: { labels: ['Promoters (9–10)', 'Passives (7–8)', 'Detractors (0–6)'], datasets: [{ data: [FB.promoters, FB.passives, FB.detractors], backgroundColor: ['#2ee6a6', '#ffcd4d', '#ff5c7a'], borderColor: '#07051a', borderWidth: 3 }] },
      options: { maintainAspectRatio: false, rotation: -90, circumference: 180, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } } } },
    });
    const asp = Object.entries(FB.aspects);
    if (asp.length) lazy('cAspects', {
      type: 'radar', data: { labels: asp.map(([k]) => k[0].toUpperCase() + k.slice(1)), datasets: [{ label: 'Avg (1–5)', data: asp.map(([, v]) => v), backgroundColor: 'rgba(124,92,255,.3)', borderColor: '#ff5ca8', pointBackgroundColor: '#fff', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, scales: { r: { min: 0, max: 5, ticks: { display: false, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.1)' }, angleLines: { color: 'rgba(255,255,255,.1)' }, pointLabels: { font: { size: 12, weight: 600 } } } }, plugins: { legend: { display: false } } },
    });
  } else {
    ['cStars', 'cNps', 'cAspects'].forEach(id => ($('#' + id).parentElement.innerHTML = '<div class="empty"><span class="big">💌</span>Feedback appears after the session ends.</div>'));
  }

  // leaderboard
  const medals = ['🥇', '🥈', '🥉'];
  $('#leader').innerHTML = R.topContributors.length ? R.topContributors.map((p, i) => `<div class="lr" style="--c:${esc(p.color)}"><span class="rank">${medals[i] || i + 1}</span><span class="av">${esc(p.avatar)}</span>
    <div><b>${esc(p.name)}</b><div class="dim" style="font-size:.75rem">💬 ${p.messages} · 🎆 ${p.reactions} · 🙋 ${p.questions}</div></div><b class="gradient-text">${p.points} pts</b></div>`).join('') : '<div class="empty">No activity yet.</div>';

  // comments
  $('#comments').innerHTML = FB.comments.length ? FB.comments.map(c => `<div class="comment" style="--c:${c.sentiment > 0 ? '#2ee6a6' : c.sentiment < 0 ? '#ff5c7a' : '#7c5cff'}"><div style="font-size:.8rem">${'⭐'.repeat(c.stars || 0)} ${c.word ? `<span class="pill" style="margin-left:6px">${esc(c.word)}</span>` : ''}</div><div style="margin-top:6px">${esc(c.text)}</div></div>`).join('')
    : (FB.words.length ? `<div class="cloud in">${FB.words.map(w => `<span style="font-size:1.1rem">${esc(w)}</span>`).join('')}</div>` : '<div class="empty"><span class="big">💌</span>No written comments yet.</div>');

  // questions
  $('#questions').innerHTML = R.questions.length ? R.questions.map(q => `<div class="q ${q.answered ? '' : ''}"><div class="vote" style="cursor:default">▲<span class="n">${q.votes}</span></div><div class="qtext">${esc(q.text)}<div class="meta">${esc(q.name)} ${q.answered ? '· ✅ answered' : '· ⏳ unanswered'}</div></div></div>`).join('') : '<div class="empty"><span class="big">🙋</span>No questions were asked.</div>';

  // polls
  $('#polls').innerHTML = R.polls.length ? R.polls.map(p => {
    const t = Math.max(1, p.total); const max = Math.max(...p.options.map(o => o.votes));
    return `<div><h3>${esc(p.question)}</h3><div class="dim" style="font-size:.8rem">${p.total} votes</div>${p.options.map(o => `<div class="poll-opt ${o.votes === max && max ? 'mine' : ''}" style="cursor:default"><div class="fill" style="width:${(o.votes / t) * 100}%"></div><span>${esc(o.text)}</span><span>${Math.round((o.votes / t) * 100)}%</span></div>`).join('')}</div>`;
  }).join('') : '<div class="empty"><span class="big">🗳️</span>No polls were run.</div>';
})();
