// Draws the component map, then plays an answer on it one step at a time as the steps stream in.
(async function () {
  const $ = s => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = 190, H = 54;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const { map, root, commit, examples } = await (await fetch('/api/map')).json();
  $('#commit').textContent = `Code at ${commit}.`;
  const nodeById = Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const svg = $('#stage');
  svg.setAttribute('viewBox', `0 0 ${map.viewBox[0]} ${map.viewBox[1]}`);

  // ---------- draw the map ----------
  for (const g of map.groups) {
    const grp = el('g', { class: 'group' });
    grp.append(el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14 }), el('text', { x: g.x + 14, y: g.y + 22 }, g.label));
    svg.append(grp);
  }
  const edgeLayer = el('g'), nodeLayer = el('g'), topLayer = el('g');
  svg.append(edgeLayer, nodeLayer, topLayer);

  // Same column: a straight line between neighbours, a bulge to the right when another box sits in between.
  // Different columns: an S-curve from the facing sides, fanned out a little where several lines meet.
  function edgePath(a, b) {
    if (a.x === b.x) {
      const [top, bot] = a.y < b.y ? [a, b] : [b, a];
      const between = map.nodes.some(n => n.x === a.x && n.y > top.y && n.y < bot.y);
      if (!between) return a.y < b.y ? `M${a.x} ${a.y + H / 2} L${b.x} ${b.y - H / 2}` : `M${a.x} ${a.y - H / 2} L${b.x} ${b.y + H / 2}`;
      const x = a.x + W / 2, bulge = Math.abs(a.y - b.y) / 5;
      return `M${x} ${a.y} C${x + bulge} ${a.y} ${x + bulge} ${b.y} ${x} ${b.y}`;
    }
    const dir = a.x < b.x ? 1 : -1;
    const fan = (from, to) => to.y + Math.max(-20, Math.min(20, (from.y - to.y) / 12));
    const x1 = a.x + dir * W / 2, y1 = fan(b, a), x2 = b.x - dir * W / 2, y2 = fan(a, b), mid = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  }
  const edgeEl = {};
  for (const e of map.edges) {
    edgeEl[e.id] = el('path', { class: 'edge', d: edgePath(nodeById[e.from], nodeById[e.to]), 'data-id': e.id });
    edgeLayer.append(edgeEl[e.id]);
  }
  const nodeEl = {};
  for (const n of map.nodes) {
    const g = el('g', { class: `node k-${n.kind}`, transform: `translate(${n.x - W / 2} ${n.y - H / 2})`, tabindex: 0, role: 'button', 'aria-label': `${n.label}: ${n.does}` });
    g.append(el('rect', { class: 'box', width: W, height: H, rx: 9 }), el('rect', { class: 'stripe', x: 0, y: 9, width: 4, height: H - 18, rx: 2 }),
      el('text', { class: 'label', x: 16, y: 23 }, n.label), el('text', { class: 'sublabel', x: 16, y: 41 }, n.sub));
    const show = () => { pause(); clearActive(); svg.classList.add('playing'); g.classList.add('active'); caption(`<p class="n">${esc(n.label)}</p><p class="text">${esc(n.does)}</p>${citeHtml(n.cite)}`); };
    g.addEventListener('click', show);
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(); } });
    nodeEl[n.id] = g; nodeLayer.append(g);
  }

  // ---------- caption ----------
  const caption = html => { $('#caption').innerHTML = html; };
  const citeHtml = c => (c ? `<span class="cite"><a href="vscode://file/${encodeURI(root + '/' + c.file)}:${c.line}" title="Open in VS Code">${esc(c.file)}:${c.line}</a><code>${esc(c.text)}</code></span>` : '');

  // ---------- player ----------
  let steps = [], cur = -1, playing = false, timer = null, raf = 0, finished = true, token = 0, waiting = false;
  const speed = () => Number($('#speed').value) || 1;
  function clearActive() {
    cancelAnimationFrame(raf); clearTimeout(timer); timer = null; waiting = false; topLayer.replaceChildren();
    svg.querySelectorAll('.active, .hit').forEach(x => x.classList.remove('active', 'hit'));
  }
  function label(x, y, text, cls) {
    const g = el('g', { class: cls }), t = el('text', { x, y, 'text-anchor': 'middle' }, text);
    g.append(t); topLayer.append(g);
    const b = t.getBBox();
    g.prepend(el('rect', { x: b.x - 6, y: b.y - 3, width: b.width + 12, height: b.height + 6, rx: 5 }));
    return g;
  }
  function show(i) {
    if (i < 0 || i >= steps.length) return;
    clearActive(); cur = i;
    const s = steps[i], my = ++token;
    svg.classList.add('playing');
    document.querySelectorAll('#steps li').forEach((li, k) => li.classList.toggle('on', k === i));
    document.querySelector('#steps li.on')?.scrollIntoView({ block: 'nearest' });
    caption(`<p class="n" id="count"></p><p class="text">${esc(s.caption)}</p>` +
      (s.verified ? citeHtml(s.cite) : `<span class="cite unverified">Not verified against the code: ${esc(s.problem || 'no citation')}</span>`));
    count();
    const land = id => { const n = nodeEl[id]; n.classList.add('active'); n.classList.remove('hit'); void n.getBBox(); n.classList.add('hit'); };
    const after = () => { if (my === token && playing) timer = setTimeout(() => { timer = null; advance(); }, (1500 + s.caption.length * 28) / speed()); };

    if (s.at) { land(s.at); return after(); }
    const path = edgeEl[s.edge], edge = map.edges.find(e => e.id === s.edge), back = s.from === edge.to;
    path.classList.add('active'); nodeEl[s.from].classList.add('active'); nodeEl[s.to].classList.add('active');
    const len = path.getTotalLength(), at = t => path.getPointAtLength((back ? 1 - t : t) * len);
    const pk = el('g', { class: 'packet' }); pk.append(el('circle', { r: 7 })); topLayer.append(pk);
    const tag = s.payload ? label(0, -14, s.payload, 'packet') : null;
    const place = t => { const p = at(t); pk.setAttribute('transform', `translate(${p.x} ${p.y})`); tag?.setAttribute('transform', `translate(${p.x} ${p.y})`); };
    const dur = reduced ? 0 : 1100 / speed(), t0 = performance.now();
    const frame = now => {
      if (my !== token) return;
      const t = dur ? Math.min(1, (now - t0) / dur) : 1;
      place(t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      if (t < 1) raf = requestAnimationFrame(frame); else { land(s.to); after(); }
    };
    place(0); raf = requestAnimationFrame(frame);
  }
  function count() { const c = $('#count'); if (c && cur >= 0) c.textContent = `Step ${cur + 1} of ${steps.length}${finished ? '' : '…'}`; }
  function advance() {
    if (cur + 1 < steps.length) show(cur + 1);
    else if (finished) pause();
    else waiting = true; // caught up with the stream: addStep carries on when the next step arrives
  }
  function play() { playing = true; $('#play').textContent = '❚❚'; if (cur + 1 >= steps.length && finished) show(0); else if (cur < 0) show(0); else show(cur); }
  function pause() { playing = false; waiting = false; $('#play').textContent = '▶'; clearTimeout(timer); timer = null; }
  $('#play').onclick = () => (playing ? pause() : steps.length && play());
  $('#prev').onclick = () => { pause(); show(Math.max(0, cur - 1)); };
  $('#next').onclick = () => { pause(); show(Math.min(steps.length - 1, cur + 1)); };
  $('#replay').onclick = () => { if (steps.length) { cur = -1; playing = true; $('#play').textContent = '❚❚'; show(0); } };

  function addStep(s) {
    steps.push(s);
    const li = document.createElement('li'), i = steps.length - 1;
    const where = s.at ? nodeById[s.at].label : `${nodeById[s.from].label} → ${nodeById[s.to].label}`;
    li.innerHTML = `${esc(s.caption)}<span class="where">${esc(where)}${s.verified ? ` · ${esc(s.cite.file.split('/').pop())}:${s.cite.line}` : ' · <span class="unverified">unverified</span>'}</span>`;
    li.onclick = () => { pause(); show(i); };
    $('#steps').append(li); count();
    // start with the first step; later ones play when the animation has caught up and is waiting
    if (i === 0) { playing = true; $('#play').textContent = '❚❚'; show(0); }
    else if (playing && waiting) show(i);
  }

  // ---------- asking ----------
  let ctrl = null, tick = null;
  const SOURCES = { example: 'Prepared example', cache: 'Saved answer for this commit', claude: 'Answered by Claude Code' };
  async function ask(question, audience, fresh = false) {
    ctrl?.abort(); ctrl = new AbortController();
    pause(); clearActive(); svg.classList.remove('playing');
    steps = []; cur = -1; finished = false;
    $('#steps').replaceChildren(); $('#answer').textContent = ''; $('#foot').classList.add('hidden');
    $('#status').className = ''; $('#go').disabled = true;
    caption('<p class="hint">Working out the answer…</p>');
    const t0 = performance.now(); let firstStep = null;
    clearInterval(tick);
    tick = setInterval(() => { $('#status').textContent = `Reading the code… ${((performance.now() - t0) / 1000).toFixed(0)} s`; }, 250);
    const fail = msg => { $('#status').className = 'err'; $('#status').textContent = msg; caption(`<p class="hint">${esc(msg)}</p>`); };
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, audience, fresh }), signal: ctrl.signal });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      const handle = m => {
        if (m.type === 'answer') $('#answer').textContent = m.text;
        else if (m.type === 'step') { firstStep ??= performance.now() - t0; addStep(m); }
        else if (m.type === 'error') { clearInterval(tick); fail(m.message); }
        else if (m.type === 'done') {
          clearInterval(tick);
          const bits = [SOURCES[m.source] || m.source, `${(m.ms / 1000).toFixed(1)} s`];
          if (m.source === 'claude' && firstStep != null) bits.push(`first step after ${(firstStep / 1000).toFixed(1)} s`);
          if (m.unverified) bits.push(`${m.unverified} unverified step${m.unverified === 1 ? '' : 's'}`);
          $('#status').textContent = bits.join(' · ');
          if (!m.steps) caption('<p class="hint">No animation for this one: nothing on the map shows it.</p>');
          $('#foot').classList.toggle('hidden', m.source === 'claude');
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) handle(JSON.parse(line)); }
      }
    } catch (e) {
      if (e.name !== 'AbortError') fail(e.message);
    } finally {
      if (!ctrl.signal.aborted) {
        clearInterval(tick); finished = true; $('#go').disabled = false; count();
        // if the animation was waiting at the last step for more, let it finish
        if (waiting) pause();
      }
    }
  }

  $('#ask').addEventListener('submit', e => { e.preventDefault(); const q = $('#q').value.trim(); if (q) ask(q, $('#audience').value); });
  $('#fresh').onclick = () => ask($('#q').value.trim(), $('#audience').value, true);
  for (const ex of examples) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = ex.question;
    b.onclick = () => { $('#q').value = ex.question; $('#audience').value = ex.audience || 'developer'; ask(ex.question, $('#audience').value); };
    $('#examples').append(b);
  }
})();
