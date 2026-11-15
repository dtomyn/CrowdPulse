// Ask CrowdPulse explainer: the director. The set holds seven copies of the real Ask CrowdPulse page (ask/public),
// each in an iframe on the film clock. Nothing in the film calls Claude: answers are the recorded takes in
// film/ask/takes (real runs, replayed at the speed they happened) and the prepared examples, all passed through
// the tool's real checks by film/ask/server.mjs. The director swaps each page's request for a replay of one of
// those, drives the page with a cursor, and moves a camera over the set. The scene list is near the bottom.
// Rendered by film/render_ask.py.
(function () {
  const W = 1600, H = 900, BAR = 34;
  const $ = s => document.querySelector(s);
  const clock = window.__clock;
  const errors = [];
  const D = (window.Director = {});
  let DATA = null;

  // ---------- tweens ----------
  const ease = { io: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), out: t => 1 - Math.pow(1 - t, 4), in: t => t * t * t, lin: t => t };
  let elapsed = 0;
  const tweens = new Map();
  function tween(key, from, to, dur, fn, e = 'io') {
    tweens.set(key, { from, to, start: elapsed, dur: Math.max(1, dur), fn, e });
    if (dur <= 1) fn(to);
  }
  function runTweens() {
    for (const [k, t] of tweens) {
      const f = Math.min(1, (elapsed - t.start) / t.dur), e = ease[t.e](f);
      t.fn(typeof t.from === 'number' ? t.from + (t.to - t.from) * e : Object.fromEntries(Object.keys(t.to).map(key => [key, t.from[key] + (t.to[key] - t.from[key]) * e])));
      if (f >= 1 && tweens.get(k) === t) tweens.delete(k);
    }
  }
  const fail = e => { errors.push(String(e && e.stack || e)); console.error(e); };
  const later = (ms, fn) => setTimeout(() => { try { fn(); } catch (e) { fail(e); } }, ms);
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // fades an overlay in or out, with a small rise
  function fade(sel, on, dur = 500, rise = 24) {
    const el = typeof sel === 'string' ? $(sel) : sel, from = +el.style.opacity || 0;
    tween('fade-' + (el.id || sel), from, on ? 1 : 0, dur, v => { el.style.opacity = v; el.style.translate = `0 ${(1 - v) * rise}px`; }, on ? 'out' : 'io');
  }

  // ---------- the app windows ----------
  const world = $('#world');
  const WINS = Array.from({ length: 7 }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'win ' + (i ? 'solo' : 'hero');
    el.innerHTML = `<div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="url">localhost:3100</span></div><iframe name="ask${i}"></iframe>`;
    world.appendChild(el);
    return { i, el, frame: el.querySelector('iframe'), w: i ? 1200 : 1600, h: (i ? 744 : 1000) + BAR, st: { x: 0, y: 0, s: 1, o: 0, rx: 0, ry: 0 }, goal: null, next: null, gate: 0 };
  });
  const paintWin = w => {
    const t = w.st;
    w.el.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.s}) translate(${w.w / 2}px,${w.h / 2}px) rotateX(${t.rx}deg) rotateY(${t.ry}deg) translate(${-w.w / 2}px,${-w.h / 2}px)`;
    w.el.style.opacity = t.o; w.el.style.visibility = t.o < .01 ? 'hidden' : 'visible';
  };
  function place(i, to, dur = 1000, e = 'io') {
    const w = WINS[i], g = { ...(w.goal || w.st), ...to };
    w.goal = g;
    tween('win' + i, { ...w.st }, g, dur, v => { w.st = v; paintWin(w); }, e);
  }
  const HERO = { x: 128, y: 14, s: .84, o: 1, rx: 0, ry: 0 };
  const wdoc = i => WINS[i].frame.contentDocument, wwin = i => WINS[i].frame.contentWindow;
  function q(i, sel) { const e = wdoc(i)?.querySelector(sel); if (!e) fail(`not found in window ${i}: ${sel}`); return e; }
  // where an element of a (flat) window is on the set
  function rectOf(i, sel) {
    const e = typeof sel === 'string' ? q(i, sel) : sel; if (!e) return { x: W / 2, y: H / 2, w: 10, h: 10 };
    const r = e.getBoundingClientRect(), g = WINS[i].goal || WINS[i].st;
    return { x: g.x + r.left * g.s, y: g.y + (BAR + r.top) * g.s, w: r.width * g.s, h: r.height * g.s };
  }

  // Film-only layout for the page: fit one screen, and two states the film switches between
  // (mapOnly: just the map, the rest faded out; solo: the map fills the window).
  const FILM_CSS = `
    body { padding: 14px 24px 0 !important; overflow: hidden; }
    header { display: flex; align-items: baseline; gap: 14px; } header h1 { font-size: 1.3rem !important; }
    .sub { margin: 0 0 8px !important; font-size: 13px; }
    #examples { margin: 8px 0 10px !important; }
    main { grid-template-columns: minmax(0, 1fr) 400px !important; }
    #stage { height: 610px !important; width: auto !important; margin: 0 auto; }
    aside { max-height: 790px; overflow: hidden; }
    header, #ask, #examples, aside, #caption, .controls { transition: opacity .9s; }
    .stage-wrap { transition: background .9s, border-color .9s; }
    body.mapOnly header, body.mapOnly #ask, body.mapOnly #examples, body.mapOnly aside, body.mapOnly #caption, body.mapOnly .controls { opacity: 0; }
    body.mapOnly .stage-wrap { background: transparent; border-color: transparent; }
    body.solo header, body.solo #ask, body.solo #examples, body.solo aside, body.solo #caption, body.solo .controls { display: none !important; }
    body.solo { padding: 6px !important; } body.solo main { display: block; } body.solo #stage { height: calc(100vh - 22px) !important; } body.solo .stage-wrap { padding: 2px; border: 0; }
    .film-tag { opacity: 0; transition: opacity .45s; } .film-tag.in { opacity: 1; }
    .film-tag rect { fill: #0c0a1e; stroke: #2ee6d6; stroke-width: 1.5; } .film-tag text { fill: #9ff5ec; font: 600 15px Consolas, monospace; }
    .film-miss line { stroke: #ff4d6a; stroke-width: 4; stroke-dasharray: 12 9; } .film-miss circle { fill: #ff4d6a; } .film-miss text { fill: #fff; font: 700 22px sans-serif; }
    .film-miss { animation: missblink .5s steps(2) 3; } @keyframes missblink { 50% { opacity: .25; } }
  `;
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(i, tag, attrs, text) { const e = wdoc(i).createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; }

  // Replaces the page's request to /api/ask with a replay of a take, streamed on the film clock.
  function install(w) {
    const win = w.frame.contentWindow, real = win.fetch.bind(win);
    win.fetch = (url, opts = {}) => {
      if (!String(url).includes('/api/ask')) return real(url, opts);
      const job = w.next; w.next = null;
      if (!job) { fail('unexpected request in window ' + w.i); return real(url, opts); }
      const enc = new win.TextEncoder(), evs = job.take.events; let ctrl;
      const body = new win.ReadableStream({ start(c) { ctrl = c; } });
      const pump = k => {
        if (k >= evs.length) { try { ctrl.close(); } catch { /* the page moved on */ } return; }
        const ev = evs[k], gap = job.instant ? 0 : Math.max(0, ev.t - (k ? evs[k - 1].t : 0));
        later(gap, function send() {
          if (ev.raw?.planted && w.gate <= 0) return later(100, send); // planted steps wait for their cue
          if (ev.raw?.planted) w.gate--;
          const { raw, t, ...out } = ev;
          if (job.source && (out.type === 'answer' || out.type === 'done')) out.source = job.source;
          if (job.instant && out.type === 'done') out.ms = 0;
          try { ctrl.enqueue(enc.encode(JSON.stringify(out) + '\n')); } catch { return; }
          pump(k + 1);
        });
      };
      pump(0);
      return Promise.resolve(new win.Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  }

  // ---------- driving the page ----------
  const A = {
    ask(i, take, opts = {}) { const d = wdoc(i); WINS[i].next = { take, ...opts }; d.querySelector('#q').value = take.question; d.querySelector('#audience').value = take.audience; d.querySelector('#ask').requestSubmit(); },
    speed(i, v) { q(i, '#speed').value = v; },
    pause(i) { const b = q(i, '#play'); if (b.textContent !== '▶') b.click(); },
    jump(i, k) { const li = wdoc(i).querySelectorAll('#steps li'); (li[Math.min(k, li.length - 1)])?.click(); },
    replay(i) { q(i, '#replay').click(); },
    // between scenes: stop the player and light the whole map again
    calm(i) { A.pause(i); const s = q(i, '#stage'); s.classList.remove('playing'); s.querySelectorAll('.active, .hit').forEach(x => x.classList.remove('active', 'hit')); s.lastElementChild.replaceChildren(); },
    mode(i, cls, on) { wdoc(i).body.classList.toggle(cls, on); },
  };

  // ---------- camera ----------
  const cam = { x: 800, y: 450, s: 1 };
  const follow = { on: false, s: 1.9 };
  const paintCam = () => { $('#cam').style.transform = `translate(${800 - cam.x * cam.s}px,${450 - cam.y * cam.s}px) scale(${cam.s})`; };
  function camTo(x, y, s, dur = 1200) {
    follow.on = false; const hw = 800 / s, hh = 450 / s; // never show past the edge of the set
    tween('cam', { ...cam }, { x: Math.max(hw, Math.min(W - hw, x)), y: Math.max(hh, Math.min(H - hh, y)), s }, dur, v => Object.assign(cam, v));
  }
  // the hero window's caption along the bottom of the frame, with room above it for the code panel
  const camCaption = (dur = 1400) => { const r = rectOf(0, '#caption'); camTo(r.x - 14 + 800 / 1.5, r.y + r.h - 290, 1.5, dur); };
  const camHome = (dur = 1200) => camTo(800, 450, 1, dur);
  function camEl(i, sel, s, dur = 1200, dx = 0, dy = 0) { const r = rectOf(i, sel); camTo(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy, s, dur); }
  // ride along: keep the travelling packet (or the lit components) in the middle of the frame
  function runFollow(ms) {
    if (!follow.on) return;
    const d = wdoc(0), pk = d.querySelector('#stage .packet circle');
    const els = pk ? [pk] : [...d.querySelectorAll('#stage .node.active .box')];
    if (!els.length) return;
    let x = 0, y = 0;
    for (const e of els) { const r = rectOf(0, e); x += r.x + r.w / 2; y += r.y + r.h / 2; }
    x /= els.length; y /= els.length;
    const k = 1 - Math.exp(-ms / 300), hw = 800 / follow.s, hh = 450 / follow.s;
    cam.s += (follow.s - cam.s) * k;
    cam.x += (Math.max(hw, Math.min(W - hw, x)) - cam.x) * k;
    cam.y += (Math.max(hh, Math.min(H - hh, y + 40)) - cam.y) * k;
  }
  const ride = (s = 1.9) => { tweens.delete('cam'); follow.on = true; follow.s = s; };

  // ---------- cursor ----------
  const cur = { x: 1300, y: H + 60, o: 0 };
  function paintCursor() { const c = $('#cursor'); c.style.transform = `translate(${cur.x - 6}px,${cur.y - 4}px)`; c.style.opacity = cur.o; }
  function cursorTo(x, y, dur = 650) { tween('cur', { x: cur.x, y: cur.y }, { x, y }, dur, v => { cur.x = v.x; cur.y = v.y; }, 'io'); }
  const showCursor = (on = true) => tween('curo', cur.o, on ? 1 : 0, 300, v => (cur.o = v), 'lin');
  function ripple() {
    const r = document.createElement('div'); r.className = 'ripple';
    r.style.left = cur.x + 'px'; r.style.top = cur.y + 'px'; $('#ov').appendChild(r); later(700, () => r.remove()); sfx('click');
  }
  // moves to an element of the hero window and clicks it (pass act: false to only point at it)
  function click(sel, { move = 650, ox = .5, oy = .5, then, act = true } = {}) {
    if (cur.o < .5) showCursor(true);
    const r = rectOf(0, sel);
    cursorTo(r.x + r.w * ox, r.y + r.h * oy, move);
    later(move + 60, () => { ripple(); const e = q(0, sel); if (act && e) { e.focus?.(); e.click(); } then?.(); });
  }
  function type(sel, text, cps = 22) {
    const e = q(0, sel), w = wwin(0); if (!e) return;
    e.focus(); e.value = '';
    [...text].forEach((ch, i) => later((i * 1000) / cps, () => { e.value += ch; e.dispatchEvent(new w.Event('input', { bubbles: true })); if (i % 2 === 0) sfx('key', .5); }));
  }

  // ---------- overlays ----------
  function chapter(n, kicker, text, hold = 3200) {
    const c = $('#chapter'); c.querySelector('.num').textContent = String(n).padStart(2, '0'); c.querySelector('.k').textContent = kicker; c.querySelector('.t').textContent = text;
    tween('chap', 0, 1, 700, v => { c.style.opacity = v; c.style.transform = `translateX(${(1 - v) * -60}px)`; c.querySelector('.rule').style.transform = `scaleX(${v})`; }, 'out');
    later(hold, () => tween('chap', 1, 0, 600, v => { c.style.opacity = v; c.style.transform = `translateX(${(1 - v) * -30}px)`; }, 'in'));
    sfx('whoosh');
  }
  function title(html, on = true, dur = 900) {
    const t = $('#title');
    if (on) { t.innerHTML = html; t.classList.remove('in'); void t.offsetWidth; later(30, () => t.classList.add('in')); }
    tween('title', +t.style.opacity || 0, on ? 1 : 0, dur, v => (t.style.opacity = v), on ? 'out' : 'io');
  }
  function flash() { tween('flash', .45, 0, 700, v => ($('#flash').style.opacity = v), 'out'); }
  const brandSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>';
  function typeBig(kicker, text, cps = 26) {
    const el = $('#bigq'); el.innerHTML = `<span class="k">${esc(kicker)}</span><span class="tx"></span><span class="caret"></span>`;
    const tx = el.querySelector('.tx');
    [...text].forEach((ch, i) => later((i * 1000) / cps, () => { tx.textContent += ch; if (i % 2 === 0) sfx('key', .45); }));
  }

  // the bottom card that repeats the hero window's current step, large enough to read while the camera is on the map
  let cardOn = false;
  function stepCard(on) { cardOn = on; fade('#stepCard', on, 450); }
  function readCaption(i) {
    const c = wdoc(i).querySelector('#caption'); if (!c) return null;
    const t = c.querySelector('.text'); if (!t) return null;
    const a = c.querySelector('.cite a'), code = c.querySelector('.cite code'), un = c.querySelector('.unverified');
    return { n: c.querySelector('.n')?.textContent || '', text: t.textContent, where: a ? a.textContent : '', code: code ? code.textContent : '', un: un ? un.textContent : '' };
  }
  function paintCards() {
    if (cardOn) {
      const c = readCaption(0);
      if (c) { const el = $('#stepCard'); el.querySelector('.n').textContent = c.n; el.querySelector('.t').textContent = c.text; el.querySelector('.c').innerHTML = c.un ? esc(c.un) : `<b>✓ ${esc(c.where)}</b>${esc(c.code)}`; }
    }
    if (trioOn) [1, 2, 3].forEach((wi, k) => {
      const c = readCaption(wi), el = $('#cap' + k); if (!c) return;
      el.innerHTML = `<div class="n">${esc(c.n)}</div><div class="t">${esc(c.text)}</div><div class="c">${esc(c.where)}</div>`;
    });
  }
  let trioOn = false;

  // ---------- the code panel ----------
  const SRC = {};
  async function loadSrc(file) { if (!SRC[file]) SRC[file] = (await fetch('/src/' + file).then(r => { if (!r.ok) throw new Error('cannot read ' + file); return r.text(); })).replace(/\r/g, '').split('\n'); }
  const KW = 'const|let|var|function|return|if|else|for|while|await|async|new|try|catch|throw|import|export|from|create|select|insert|update|delete|into|values|where|and|or|not|null|begin|end|declare|returns|language|perform|then|when|case|set|as|is|in|true|false|grant|execute|on|to';
  const hlRe = sql => new RegExp(`(${sql ? '--[^\\n]*' : '\\/\\/[^\\n]*'})|('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(${KW})\\b|([A-Za-z_$][\\w$]*)(?=\\()`, 'g');
  function hl(file, line) {
    const re = hlRe(file.endsWith('.sql')); let out = '', last = 0;
    for (let m; (m = re.exec(line));) {
      out += esc(line.slice(last, m.index)) + `<span class="${m[1] ? 'cm' : m[2] ? 'st' : m[3] ? 'nu' : m[4] ? 'kw' : 'fn'}">${esc(m[0])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(line.slice(last));
  }
  const LH = 26;
  const L = {
    // shows `file` scrolling to `line`; verdict 'found' lights the line, 'none' runs the whole file and finds nothing
    show(file, line, { verdict = 'found', dur = 2200, label = 'Looking up the quote', x = 868, y = 170, stamp } = {}) {
      const el = $('#lens'), lines = SRC[file]; if (!lines) return fail('source not loaded: ' + file);
      el.classList.remove('found', 'none');
      el.querySelector('.path').textContent = file.replace('supabase/migrations/20261113000000_', 'supabase/migrations/…'); el.querySelector('.what').textContent = label;
      const box = el.querySelector('.lines');
      box.innerHTML = lines.map((t, i) => `<div class="l"><span class="no">${i + 1}</span>${hl(file, t)}</div>`).join('');
      el.querySelector('.stamp').textContent = stamp || (verdict === 'found' ? `✓ Found at line ${line}` : 'No such line in this file');
      el.style.left = x + 'px'; el.style.top = y + 'px';
      fade(el, true, 500, 30);
      const from = verdict === 'none' ? 1 : Math.max(1, line - 80), to = verdict === 'none' ? lines.length : line;
      tween('lens', from, to, dur, v => (box.style.transform = `translateY(${182 - (v - 1) * LH}px)`), verdict === 'none' ? 'lin' : 'io');
      later(dur + 60, () => { el.classList.add(verdict); if (verdict === 'found') { box.children[line - 1]?.classList.add('hit'); sfx('chime', .7); } else sfx('pop'); });
    },
    hide() { fade('#lens', false, 400, 30); },
  };

  // one raw line from the model, shown before the checks give their verdict
  const label = id => DATA.map.nodes.find(n => n.id === id)?.label || id;
  function wcard(raw, x, y) {
    const el = $('#wcard'); el.classList.remove('bad', 'warn');
    el.querySelector('.k').textContent = 'A planted step, as the model would send it';
    el.querySelector('.route').innerHTML = raw.at ? `<span>${esc(label(raw.at))}</span>` : `<span>${esc(label(raw.from))}</span>→<span>${esc(label(raw.to))}</span>`;
    el.querySelector('.cap').textContent = raw.caption;
    el.querySelector('.q').innerHTML = `<b>quote:</b> ${esc(raw.cite.quote)}<br><b>file:</b> ${esc(raw.cite.file.split('/').pop())}`;
    el.querySelector('.verdict').textContent = '';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    fade(el, true, 450); sfx('pop');
  }
  function verdict(cls, text) { const el = $('#wcard'); el.querySelector('.verdict').textContent = text; el.classList.add(cls); sfx(cls === 'bad' ? 'click' : 'pop', 1.4); }

  // ---------- page loading (the clock waits while pages load) ----------
  const blockers = [];
  function load(i) {
    const w = WINS[i], f = w.frame;
    let loaded = false; f.onload = () => (loaded = true);
    f.src = '/';
    blockers.push(() => {
      const d = f.contentDocument;
      if (!loaded || !d || d.readyState !== 'complete' || !f.contentWindow.__film) return false;
      if (d.querySelectorAll('#stage .node').length < DATA.counts.nodes || !d.querySelector('#examples button')) return false;
      if (!d.getElementById('film-css')) { const s = d.createElement('style'); s.id = 'film-css'; s.textContent = FILM_CSS; d.head.appendChild(s); }
      if (i) d.body.classList.add('solo');
      install(w);
      return true;
    });
  }
  const frameWins = () => [window, ...WINS.map(w => w.frame.contentWindow).filter(w => { try { return w && w.__film; } catch { return false; } })];

  // ---------- sound cues and storyboard frames ----------
  const cues = [];
  const sfx = (name, gain = 1) => cues.push({ t: Math.round(elapsed), name, gain });
  let pendingBoard = null, currentScene = null;
  const boardsMeta = [];
  const board = (titleText, why) => { pendingBoard = { title: titleText, why, at: Math.round(elapsed), scene: currentScene }; boardsMeta.push(pendingBoard); };

  // ============================================================
  // Scene list. Each beat is one narration line; actions are [ms from the start of the line, fn].
  // ============================================================
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
    'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];
  const word = n => WORDS[n] || String(n);
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const TRIO_X = [32, 548, 1064], GRID = [0, 1, 2, 3, 4, 5].map(k => ({ x: 36 + (k % 3) * 515, y: k < 3 ? 104 : 478, s: .415 }));
  const AUD = [['developer', 'Developer', 'function names'], ['architect', 'Architect', 'boundaries and trade-offs'], ['product', 'Product owner', 'plain language']];

  function makeScenes() {
    const T = DATA.takes, DEV = T.developer, C = DATA.counts, Q = DEV.question;
    const firstS = Math.round(DEV.firstStepMs / 1000), devSteps = DEV.events.filter(e => e.type === 'step');
    const proofStep = devSteps[1], lastOk = devSteps[0];
    const bad = DATA.planted.events.filter(e => e.raw?.planted);
    const dropped = bad.find(e => e.type === 'dropped'), unver = bad.find(e => e.type === 'step');
    if (!dropped || !unver || unver.verified) fail('the planted steps did not get the verdicts the film describes');
    const node = id => DATA.map.nodes.find(n => n.id === id);

    return [
      {
        id: 'open', title: 'Cold open', feature: 'A question about the code, and the idea: ask it, and watch the answer', camera: 'The map lies tilted in the dark with an answer running across it, then swings up to face the viewer', sound: 'Music swells in; key taps as the question types; whoosh on the title',
        beats: [
          { id: 'ask-open-1', min: 8600, say: 'Some questions about a codebase take an afternoon to answer. How does a rating get from a phone, to the big screen?', do: [
            [0, () => { WINS.forEach((_, i) => load(i)); }],
            [1, () => { A.mode(0, 'solo', true); A.speed(0, '1.8'); A.ask(0, DATA.examples[1], { instant: true }); place(0, { x: 112, y: 120, s: .86, o: 0, rx: 60 }, 1); place(0, { o: .6, y: 170 }, 2600, 'out'); }],
            [3300, () => { fade('#bigq', true, 400, 0); typeBig('A question about the code', Q); }],
            [6400, () => board('The question', 'A real question about the codebase types itself over the tilted map')],
          ] },
          { id: 'ask-open-2', min: 8200, say: 'What if you could just ask? And then watch the answer happen.', do: [
            [300, () => { fade('#bigq', false, 900, -40); place(0, { ...HERO, o: 1 }, 2600); sfx('whoosh'); }],
            [2400, () => board('The map swings up', 'The tilted map turns to face the viewer, an answer still running across it')],
            [3600, () => { title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">Ask CrowdPulse</h1><p class="line l3">Answers you can watch</p></div>`, true, 700); sfx('whoosh'); }],
            [4600, () => { board('Title card', 'Logo and the film’s subject'); load(0); }], // a fresh page behind the title
            [7300, () => title('', false, 800)],
          ] },
        ],
      },
      {
        id: 'ask', title: 'Asking a question', feature: 'Typing a question, choosing who is asking, and the answer streaming in while the animation already plays', camera: 'Full window for the typing; pushes in on the answer; then rides along with the packet across the map', sound: 'Key taps, a click on Ask, soft pops as steps land',
        beats: [
          { id: 'ask-first-1', min: 11800, say: 'This is Ask CrowdPulse. It runs on your own machine, right next to the code. Type a question, say who’s asking, and press Ask.', do: [
            [0, () => { place(0, HERO, 1); chapter(1, 'Part one', 'Ask, and watch'); }],
            [3600, () => click('#q', { then: () => type('#q', Q) })],
            [7000, () => { const r = rectOf(0, '#audience'); click('#audience', { act: false, then: () => { const m = $('#menu'); m.style.left = r.x + 'px'; m.style.top = r.y + r.h + 4 + 'px'; fade(m, true, 200, 8); } }); }],
            [7500, () => board('Typing the question', 'The real page: a question, and a choice of who is asking')],
            [8300, () => { const r = rectOf(0, '#audience'); cursorTo(r.x + 60, r.y + r.h + 24, 350); later(420, () => { ripple(); fade('#menu', false, 200, 8); }); }],
            [10200, () => { WINS[0].next = { take: DEV }; click('#go', { move: 600, then: () => { $('#chip').textContent = 'A recorded run, replayed at its real speed'; fade('#chip', true, 500, -10); } }); }],
          ] },
          { id: 'ask-first-2', min: 13500, say: 'Claude Code reads the repository. A few seconds later, a short answer appears, and then the steps start to arrive. The animation begins before the answer has finished.', do: [
            [300, () => { showCursor(false); camEl(0, 'aside', 1.55, 1400, -60, -120); }],
            [3600, () => board('The answer arrives', 'A short text answer first, a few seconds after asking')],
            [5200, () => camHome(1500)],
            [8600, () => board('Steps arrive while it plays', 'The map is already animating step one while later steps are still streaming in')],
          ] },
          { id: 'ask-first-3', min: 10000, say: 'Each step is one claim. Something travels between two parts of the app, and the caption says what it is.', do: [
            [0, () => { fade('#chip', false, 400, -10); A.speed(0, '1.8'); A.replay(0); ride(1.9); stepCard(true); }],
            [5600, () => board('Riding along with the answer', 'The camera follows the packet from part to part; the step’s caption and its line of code sit underneath')],
          ] },
          { id: 'ask-first-4', min: 9500, say: 'Phone, to connection, to database. Then back out, on a broadcast, to every screen.', do: [
            [4200, () => board('Across to the database', 'Still riding: the answer crosses from the browser into Supabase')],
          ] },
        ],
      },
      {
        id: 'proof', title: 'Why you can trust it', feature: 'Every step quotes a real line that is looked up first; a step between unconnected parts is dropped; an invented quote is flagged', camera: 'Pushes in on a step’s citation while the real file scrolls to the quoted line; pulls back for the two planted mistakes', sound: 'Chime when a quote is found; a dull pop when it is not',
        beats: [
          { id: 'ask-proof-1', min: 11800, say: 'Here’s why you can trust it. Every step quotes a line of the real code, and that quote is looked up in the file before the step is shown.', do: [
            [0, () => { chapter(2, 'Part two', 'Why you can trust it'); stepCard(false); A.speed(0, '1'); A.jump(0, 1); camCaption(1500); }],
            [3800, () => L.show(proofStep.cite.file, proofStep.cite.line, { x: 880, y: 150, dur: 2600 })],
            [7200, () => board('The quote, found in the real file', `The step cites ${proofStep.cite.file.split('/').pop()}; the file scrolls to line ${proofStep.cite.line} and the line lights up`)],
          ] },
          { id: 'ask-proof-2', min: 7800, say: 'To show what happens when the model gets it wrong, we planted two mistakes in this answer.', do: [
            [0, () => { L.hide(); camHome(1300); }],
            [1200, () => { $('#banner').textContent = '⚠ Demonstration: this answer has two planted mistakes'; fade('#banner', true, 500, -10); WINS[0].gate = 0; A.ask(0, DATA.planted); }],
            [5200, () => board('An answer with two planted mistakes', 'The same answer is replayed with two bad steps added on purpose')],
          ] },
          { id: 'ask-proof-3', min: 9200, say: 'This step jumps between two parts that aren’t connected on the map. It never reaches the screen.', do: [
            [200, () => { A.pause(0); wcard(dropped.raw, 480, 500); }],
            [1900, () => { const a = node(dropped.raw.from), b = node(dropped.raw.to), g = svgEl(0, 'g', { class: 'film-miss' }), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              g.append(svgEl(0, 'line', { x1: a.x + 95, y1: a.y, x2: b.x - 95, y2: b.y }), svgEl(0, 'circle', { cx: mx, cy: my, r: 20 }), svgEl(0, 'text', { x: mx, y: my + 8, 'text-anchor': 'middle' }, '✕'));
              q(0, '#stage').appendChild(g); sfx('pop'); }],
            [3600, () => { verdict('bad', '✕ Dropped: ' + dropped.reason); WINS[0].gate = 1; flash(); }],
            [5000, () => board('Not on the map: dropped', 'The checker’s real verdict: these two parts are not connected, so the step never reaches the page')],
            [7600, () => { fade('#wcard', false, 400); wdoc(0).querySelector('.film-miss')?.remove(); }],
          ] },
          { id: 'ask-proof-4', min: 9200, say: 'And this one quotes a line that isn’t in the file. It’s shown, but flagged as unverified.', do: [
            [200, () => wcard(unver.raw, 60, 470)],
            [1500, () => L.show(unver.raw.cite.file, 0, { verdict: 'none', x: 868, y: 150, dur: 2400, label: 'Searching the whole file' })],
            [4100, () => { verdict('warn', '⚠ Shown, but marked unverified'); WINS[0].gate = 1; }],
            [5400, () => board('Quote not found: unverified', 'The whole file is searched, the invented line is not there, and the step is flagged')],
            [6400, () => { L.hide(); fade('#wcard', false, 400); const li = [...wdoc(0).querySelectorAll('#steps li')].find(x => x.querySelector('.unverified')); if (li) { li.click(); camEl(0, li, 1.7, 1200); } else fail('no unverified step on the page'); }],
          ] },
          { id: 'ask-proof-5', min: 10800, say: 'A verified step proves the line exists. Whether the caption reads it correctly is still your call, so the line is always one click away.', do: [
            [0, () => { fade('#banner', false, 400, -10); camHome(1200); A.jump(0, 0); }],
            [1500, () => camCaption()],
            [5200, () => { const a = q(0, '#caption .cite a'); if (!a) return; const p = { x: 800 + (rectOf(0, a).x + 40 - cam.x) * cam.s, y: 450 + (rectOf(0, a).y + 8 - cam.y) * cam.s };
              showCursor(true); cursorTo(p.x, p.y, 700); later(780, () => { ripple(); L.show(lastOk.cite.file, lastOk.cite.line, { x: 880, y: 150, dur: 1300, label: 'Opens in your editor', stamp: `Line ${lastOk.cite.line}` }); }); }],
            [8200, () => board('One click to the line', 'Clicking a citation opens the file at that line')],
            [9800, () => showCursor(false)],
          ] },
        ],
      },
      {
        id: 'how', title: 'How it works', feature: 'The fixed map and its anchors; what Claude is given and what it sends back; how quickly the first step arrived', camera: 'The map alone, tilted, as its anchors appear; then the map beside what goes in and what comes out', sound: 'Soft pops as anchors and lines appear',
        beats: [
          { id: 'ask-how-1', min: 11200, say: `Under the hood, the map is fixed. ${cap(word(C.nodes))} parts of the app and the connections between them, each one anchored to a line of code.`, do: [
            [0, () => { chapter(3, 'Part three', 'How it works'); L.hide(); camHome(1000); A.calm(0); place(0, { o: 0 }, 300); later(320, () => { A.mode(0, 'solo', true); place(0, { x: 112, y: 6, s: .86, rx: 0 }, 1); place(0, { o: 1 }, 600); }); }],
            [2600, () => DATA.map.nodes.forEach((n, k) => later(k * 210, () => {
              const g = svgEl(0, 'g', { class: 'film-tag', transform: `translate(${n.x} ${n.y - 34})` }), t = `${n.cite.file.split('/').pop().replace('20261113000000_', '')}:${n.cite.line}`, w = t.length * 8.6 + 16;
              g.append(svgEl(0, 'rect', { x: -w / 2, y: -14, width: w, height: 25, rx: 6 }), svgEl(0, 'text', { x: 0, y: 4, 'text-anchor': 'middle' }, t));
              q(0, '#stage').appendChild(g); void g.getBBox(); g.classList.add('in'); if (k % 3 === 0) sfx('key', .5); }))],
            [3000, () => { $('#counts').innerHTML = `<div><b>${C.nodes}</b>parts of the app</div><div><b>${C.edges}</b>connections</div><div><b>${C.anchors}</b>anchors to real lines</div>`; fade('#counts', true, 600); }],
            [3400, () => place(0, { rx: 20, y: -30 }, 5200)],
            [7600, () => board('The fixed map and its anchors', 'Every part of the map shows the file and line it is anchored to')],
          ] },
          { id: 'ask-how-2', min: 11500, say: 'Claude doesn’t draw anything. It gets the map and an outline of the code, and replies with a list of steps, one per line.', do: [
            [0, () => { fade('#counts', false, 400); wdoc(0).querySelectorAll('.film-tag').forEach(t => t.remove()); place(0, { x: 728, y: 96, s: .52, rx: 0 }, 1300);
              $('#pinSize').textContent = `${Math.round(DATA.prompt.chars / 1000)}k characters`;
              $('#pinFacts').innerHTML = `<div><b>${C.nodes} + ${C.edges}</b>the map: parts and connections</div><div><b>${DATA.prompt.outlineLines}</b>outline lines from ${C.files} files</div>`;
              $('#pinPre').textContent = DATA.prompt.outline.join('\n'); }],
            [1200, () => { fade('#pin', true, 600); tween('pinScroll', 0, 1500, 26000, v => ($('#pinPre').style.transform = `translateY(${-v}px)`), 'lin'); }],
            [4200, () => board('What Claude is given', 'The map, and an outline of the code with line numbers')],
            [5600, () => { fade('#pout', true, 600); $('#poutRows').innerHTML = ''; A.speed(0, '1.8'); A.ask(0, DEV, { instant: true, source: 'cache' });
              DEV.events.filter(e => e.type === 'step').slice(0, 6).forEach((ev, k) => later(200 + k * 2900, () => {
                const r = document.createElement('div'); r.className = 'row new'; r.textContent = JSON.stringify({ type: 'step', ...ev.raw });
                $('#poutRows').appendChild(r); void r.offsetWidth; r.classList.add('in'); later(900, () => r.classList.remove('new')); sfx('pop', .6); })); }],
            [9200, () => board('What Claude sends back', 'One line of JSON per step; each line becomes a movement on the map')],
          ] },
          { id: 'ask-how-3', min: 10800, say: `Because the map is already on screen, the answer can start playing as soon as the first line lands. Here, that took about ${word(firstS)} seconds.`, do: [
            [5200, () => { $('#stats').innerHTML = `<div><b id="st1">0.0<i>s</i></b>to the first step</div><div><b id="st2">0.0<i>s</i></b>for the whole answer</div><div><b>${DEV.events.filter(e => e.type === 'step').length}<i>of ${DEV.events.filter(e => e.type === 'step').length}</i></b>steps verified · recorded run</div>`;
              fade('#stats', true, 600);
              tween('st1', 0, DEV.firstStepMs / 1000, 1400, v => ($('#st1').firstChild.textContent = v.toFixed(1)), 'out');
              tween('st2', 0, DEV.doneMs / 1000, 2000, v => ($('#st2').firstChild.textContent = v.toFixed(1)), 'out'); }],
            [8200, () => board('How quickly it arrived', 'The recorded timings of the run shown earlier in the film')],
          ] },
        ],
      },
      {
        id: 'audience', title: 'One question, three audiences', feature: 'The same question answered for a developer, an architect and a product owner, playing side by side', camera: 'Three windows in a row, each with its current caption underneath', sound: 'Whoosh as the three windows arrive',
        beats: [
          { id: 'ask-aud-1', min: 8200, say: 'The same question can be asked three ways. A developer gets function names.', do: [
            [0, () => { chapter(4, 'Part four', 'One question, three audiences', 2600); ['#pin', '#pout', '#stats'].forEach(s => fade(s, false, 500)); place(0, { o: 0, y: 160, s: .46 }, 800); A.pause(0);
              $('#audq').innerHTML = `“${esc(Q)}”`; fade('#audq', true, 700, -10); sfx('whoosh');
              AUD.forEach(([key, name, gets], k) => { const wi = k + 1; place(wi, { x: TRIO_X[k], y: 420, s: .42, o: 0, rx: 0 }, 1); later(350 + k * 260, () => place(wi, { y: 150, o: 1 }, 1000, 'out'));
                $('#aud' + k).innerHTML = `<small>${esc(gets)}</small>${esc(name)}`; $('#aud' + k).style.left = TRIO_X[k] + 'px'; $('#cap' + k).style.left = TRIO_X[k] + 'px';
                A.ask(wi, T[key], { instant: true, source: 'cache' }); later(120, () => { A.pause(wi); A.jump(wi, 0); }); }); }],
            [1500, () => { trioOn = true; [0, 1, 2].forEach(k => { fade('#aud' + k, true, 600, -10); fade('#cap' + k, true, 600); }); }],
            [1600, () => [1, 2, 3, 4, 5].forEach(s => later(s * 4300, () => [1, 2, 3].forEach(wi => A.jump(wi, s))))],
            [3600, () => { WINS[1].el.classList.add('lit'); $('#cap0').classList.add('lit'); }],
            [5200, () => board('Three audiences, side by side', 'Three recorded answers to the same question, stepped through together')],
          ] },
          { id: 'ask-aud-2', min: 8800, say: 'An architect gets boundaries and trade-offs. A product owner gets plain language.', do: [
            [200, () => { WINS[1].el.classList.remove('lit'); $('#cap0').classList.remove('lit'); WINS[2].el.classList.add('lit'); $('#cap1').classList.add('lit'); }],
            [4200, () => { WINS[2].el.classList.remove('lit'); $('#cap1').classList.remove('lit'); WINS[3].el.classList.add('lit'); $('#cap2').classList.add('lit'); }],
            [6000, () => board('Plain language for a product owner', 'The same step, described without function names')],
          ] },
          { id: 'ask-aud-3', min: 6000, say: 'Same map, same code, three different stories.', do: [
            [200, () => [1, 2, 3].forEach((wi, k) => { WINS[wi].el.classList.add('lit'); $('#cap' + k).classList.add('lit'); })],
          ] },
        ],
      },
      {
        id: 'tests', title: 'Answers that can’t go stale', feature: 'The six prepared examples playing at once, and the real test run that checks every quoted line', camera: 'A wall of six maps; a terminal runs the tests over it', sound: 'Soft ticks as tests pass; chime on the summary',
        beats: [
          { id: 'ask-test-1', min: 10800, say: 'The prepared examples double as tests. Every one has to play on the map, and every quoted line has to exist in the code today.', do: [
            [0, () => { chapter(5, 'Part five', 'Answers that can’t go stale', 2600); trioOn = false; fade('#audq', false, 400, -10); [0, 1, 2].forEach(k => { fade('#aud' + k, false, 400, -10); fade('#cap' + k, false, 400); $('#cap' + k).classList.remove('lit'); });
              $('#wallTitle').innerHTML = `${cap(word(DATA.examples.length))} examples. <span>${cap(word(DATA.examples.length))} tests.</span>`; fade('#wallTitle', true, 800, -14); sfx('whoosh');
              DATA.examples.slice(0, 6).forEach((ex, k) => { const wi = k + 1, g = GRID[k]; WINS[wi].el.classList.remove('lit');
                if (k < 3) place(wi, { ...g, o: 1 }, 1100); else { place(wi, { ...g, y: g.y + 260, o: 0, rx: 0 }, 1); later(300 + (k - 3) * 200, () => place(wi, { y: g.y, o: 1 }, 1000, 'out')); }
                later(500 + k * 350, () => { A.speed(wi, '1.8'); A.ask(wi, ex, { instant: true }); });
                const m = $('#ml' + k); m.textContent = ex.question; m.style.left = g.x + 'px'; m.style.top = g.y + 329 + 8 + 'px'; later(900 + k * 150, () => fade(m, true, 500, 6)); }); }],
            [6800, () => board('Six examples, six tests', 'All six prepared answers playing at once, each one a test')],
          ] },
          { id: 'ask-test-2', min: 11000, say: 'Change a line that an answer depends on, and the test run fails and names the quote. The explanations can’t quietly go stale.', do: [
            [0, () => { const pre = $('#termPre'), tests = DATA.tests; pre.innerHTML = '<span class="pr">$</span> '; fade('#term', true, 500, 30);
              [...'npm run test:ask'].forEach((ch, i) => later(500 + i * 55, () => { pre.insertAdjacentText('beforeend', ch); if (i % 2 === 0) sfx('key', .5); }));
              const per = Math.min(110, 4600 / tests.lines.length);
              tests.lines.forEach((l, i) => later(1700 + i * per, () => { const sub = /^\s+/.test(l), hot = /01-rating/.test(l);
                pre.insertAdjacentHTML('beforeend', '\n' + (sub ? `  <span class="ok">✔</span> <span class="${hot ? 'hot' : ''}">${esc(l.replace(/^\s*[✔✖]\s*/, ''))}</span>` : `<span class="su">${esc(l)}</span>`)); if (i % 4 === 0) sfx('key', .35); }));
              later(1900 + tests.lines.length * per, () => { pre.insertAdjacentHTML('beforeend', `\n\n<span class="sum">tests ${tests.tests} · pass ${tests.pass} · fail ${tests.fail}</span>`); sfx('chime'); }); }],
            [8200, () => board('The real test run', 'The output of npm run test:ask from this render, with every example checked against today’s code')],
          ] },
        ],
      },
      {
        id: 'outro', title: 'Outro', feature: 'The three things the tool does, then how to start it', camera: 'The wall of maps tips back into the distance behind three lines of text; end card', sound: 'Music resolves; whoosh on the end card',
        beats: [
          { id: 'ask-outro-1', min: 8600, say: 'Ask CrowdPulse. Ask a question. Watch the answer. Check the line.', do: [
            [0, () => { fade('#words', true, 1, 0); fade('#term', false, 500, 30); fade('#wallTitle', false, 400, -14); [0, 1, 2, 3, 4, 5].forEach(k => { fade('#ml' + k, false, 300, 6); place(k + 1, { rx: 52, o: .32, y: GRID[k].y + (k < 3 ? 150 : 60) }, 2200); }); }],
            [1700, () => { $('#words').children[0].classList.add('in'); sfx('pop', .7); }],
            [3300, () => { $('#words').children[1].classList.add('in'); sfx('pop', .7); }],
            [4900, () => { $('#words').children[2].classList.add('in'); sfx('pop', .7); }],
            [6200, () => board('Ask, watch, check', 'The three things the tool does, over the wall of maps')],
          ] },
          { id: 'ask-outro-2', min: 9000, say: 'To try it, run npm run ask, and open localhost, port thirty-one hundred.', do: [
            [600, () => { fade('#words', false, 600, -20); title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">Ask CrowdPulse</h1><p class="line l3">Answers you can watch, checked against the code.</p><div class="cmd line l4"><b>$</b> npm run ask &nbsp;→&nbsp; localhost:3100</div></div>`, true, 1200); sfx('whoosh'); }],
            [4200, () => board('End card', 'Logo and how to start it')],
          ] },
        ],
        tail: 1800,
      },
    ];
  }

  // ============================================================
  // Engine (same contract as the other films: prepare, script, start, step, timeline)
  // ============================================================
  let SCENES = [], actions = [], ai = 0, total = 0, voiced = [], chapters = [], started = false;
  D.script = () => SCENES.flatMap(sc => sc.beats.map(b => ({ id: b.id, text: b.say })));
  D.prepare = async () => {
    DATA = await fetch('/studio/data.json').then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); });
    const files = new Set();
    for (const t of [...Object.values(DATA.takes), DATA.planted]) for (const e of t.events) { if (e.cite) files.add(e.cite.file); if (e.raw?.cite?.file && e.raw.planted) files.add(e.raw.cite.file); }
    await Promise.all([...files].map(loadSrc));
    await document.fonts.ready;
    SCENES = makeScenes();
    return { code: 'ask', title: DATA.takes.developer.question };
  };
  D.start = lengths => {
    let t = 0; actions = []; voiced = []; chapters = [];
    for (const sc of SCENES) {
      chapters.push({ id: sc.id, title: sc.title, at: t, feature: sc.feature, camera: sc.camera, sound: sc.sound });
      for (const b of sc.beats) {
        const lead = b.lead ?? 250, len = lengths[b.id] || 0;
        const dur = Math.max(b.min || 0, lead + len + (b.gap ?? 650));
        voiced.push({ id: b.id, text: b.say, at: t + lead, end: t + lead + len, scene: sc.id });
        actions.push({ at: t, fn: () => { currentScene = sc.id; } });
        for (const [off, fn] of b.do) actions.push({ at: t + off, fn, beat: b.id });
        t += dur;
      }
      t += sc.tail || 0;
    }
    total = t;
    actions = actions.map((a, i) => ({ ...a, i })).sort((a, b) => a.at - b.at || a.i - b.i);
    started = true;
    return { total, lines: voiced.length };
  };
  const blocked = () => {
    for (let i = blockers.length - 1; i >= 0; i--) { try { if (blockers[i]()) blockers.splice(i, 1); } catch (e) { fail(e); blockers.splice(i, 1); } }
    return blockers.length > 0;
  };
  let waitedSince = null;
  D.step = ms => {
    if (!started) return 'done';
    if (blocked()) {
      frameWins().forEach(w => w.__film.advance(0));
      waitedSince ??= window.__film.real.now();
      if (window.__film.real.now() - waitedSince > 30000) { fail('timed out waiting at ' + Math.round(elapsed) + 'ms in ' + currentScene); blockers.length = 0; }
      return 'wait';
    }
    waitedSince = null;
    while (ai < actions.length && actions[ai].at <= elapsed) {
      const a = actions[ai++];
      try { a.fn(); } catch (e) { fail(`${a.beat || ''}: ${e.stack || e}`); }
      if (blocked()) return 'wait';
    }
    clock.now += ms; elapsed += ms;
    frameWins().forEach(w => w.__film.advance(ms));
    runTweens(); runFollow(ms);
    const st = $('#stage'); if (st.scrollTop || st.scrollLeft) { st.scrollTop = 0; st.scrollLeft = 0; }
    paintCam(); paintCursor(); paintCards();
    return elapsed >= total ? 'done' : 'run';
  };
  D.takeBoard = () => { const b = pendingBoard; pendingBoard = null; return b; };
  D.timeline = () => ({ total, chapters, voiced, cues, boards: boardsMeta, question: DATA?.takes.developer.question, recordedAt: DATA?.takes.developer.recordedAt });
  D.errors = () => errors;
  D.clock = () => elapsed;
  D.scene = () => currentScene;
  WINS.forEach(paintWin); paintCam();
})();
