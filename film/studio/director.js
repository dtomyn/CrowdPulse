// CrowdPulse explainer: the director. Lays out the set, drives the real app pages in iframes on the film clock,
// and runs the scene list below. scripts: film/render.py
(function () {
  const W = 1600, H = 900;
  const $ = s => document.querySelector(s);
  const clock = window.__clock;
  const errors = [];
  const D = (window.Director = {});
  const studio = (window.__studio = {});
  const S = window.__server;

  // ---------- easing / tweens ----------
  const ease = { io: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), out: t => 1 - Math.pow(1 - t, 4), in: t => t * t * t, lin: t => t,
    back: t => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); } };
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
      if (f >= 1) tweens.delete(k);
    }
  }
  const later = (ms, fn) => setTimeout(() => { try { fn(); } catch (e) { fail(e); } }, ms);
  const fail = e => { errors.push(String(e && e.stack || e)); console.error(e); };

  // ---------- devices ----------
  const DEV = {
    full: { el: $('#d-full'), frame: $('#f-full'), off: [0, 0], size: [1600, 900] },
    desk: { el: $('#d-browser'), frame: $('#f-desk'), off: [0, 40], size: [1440, 940] },
    phone: { el: $('#d-phone'), frame: $('#f-phone'), off: [14, 14], size: [418, 872] },
  };
  for (const d of Object.values(DEV)) { d.st = { x: 0, y: 0, s: 1, o: 0 }; d.goal = { ...d.st }; }
  const paintDev = d => { d.el.style.transform = `translate(${d.st.x}px,${d.st.y}px) scale(${d.st.s}) rotate(${d.rot || 0}deg)`; d.el.style.opacity = d.st.o; d.el.style.visibility = d.st.o < .01 ? 'hidden' : 'visible'; };
  const LAYOUTS = {
    full: { full: { x: 0, y: 0, s: 1, o: 1 } },
    desk: { desk: { x: 181, y: 46, s: 0.86, o: 1 } },
    duo: { desk: { x: 52, y: 126, s: 0.69, o: 1 }, phone: { x: 1600 - 52 - 385, y: 49, s: 0.92, o: 1 } },
    phone: { phone: { x: 1060, y: 14, s: 1, o: 1 } },
    pip: { full: { x: 0, y: 0, s: 1, o: 1 }, phone: { x: 1600 - 248 - 44, y: 900 - 516 - 40, s: 0.592, o: 1 } },
  };
  let layoutName = null;
  function layout(name, dur = 1000) {
    const L = LAYOUTS[name]; layoutName = name;
    for (const [k, d] of Object.entries(DEV)) {
      const g = L[k] ? { ...L[k] } : { ...d.goal, o: 0, s: d.goal.s * 0.94, y: d.goal.y + 30 };
      if (d.st.o < .01 && L[k]) d.st = { ...g, o: 0, s: g.s * 0.92, y: g.y + 60 }; // enter from below
      d.goal = g;
      tween('dev-' + k, { ...d.st }, g, dur, v => { d.st = v; paintDev(d); }, 'io');
    }
    tween('side', +$('#side').style.opacity || 0, name === 'phone' ? 1 : 0, dur * 0.8, v => ($('#side').style.opacity = v));
  }

  const win = dev => DEV[dev].frame.contentWindow;
  const doc = dev => DEV[dev].frame.contentDocument;
  function el(dev, sel) {
    const e = typeof sel === 'string' ? doc(dev)?.querySelector(sel) : sel;
    if (!e) fail(`not found: ${dev} ${sel}`);
    return e;
  }
  // element rect in set coordinates, using the device's resting position
  function rectOf(dev, sel) {
    const e = el(dev, sel); if (!e) return { x: W / 2, y: H / 2, w: 10, h: 10 };
    const r = e.getBoundingClientRect(), d = DEV[dev], g = d.goal;
    return { x: g.x + (d.off[0] + r.left) * g.s, y: g.y + (d.off[1] + r.top) * g.s, w: r.width * g.s, h: r.height * g.s };
  }
  const toSet = (dev, cx, cy) => { const d = DEV[dev], g = d.goal; return { x: g.x + (d.off[0] + cx) * g.s, y: g.y + (d.off[1] + cy) * g.s }; };

  // ---------- camera ----------
  let cam = { cx: W / 2, cy: H / 2, s: 1 };
  const paintCam = () => { $('#cam').style.transform = `translate(${W / 2 - cam.cx * cam.s}px,${H / 2 - cam.cy * cam.s}px) scale(${cam.s})`; };
  function camTo(cx, cy, s, dur = 1400, e = 'io') {
    const hw = W / (2 * s), hh = H / (2 * s);
    const goal = { cx: s <= 1 ? W / 2 : Math.max(hw, Math.min(W - hw, cx)), cy: s <= 1 ? H / 2 : Math.max(hh, Math.min(H - hh, cy)), s };
    tween('cam', { ...cam }, goal, dur, v => { cam = v; paintCam(); }, e);
  }
  function focus(dev, sel, { fill = 0.62, max = 2.6, min = 1, dur = 1400, dx = 0, dy = 0, e } = {}) {
    const r = rectOf(dev, sel);
    const s = Math.max(min, Math.min(max, (W * fill) / r.w, (H * fill) / r.h));
    camTo(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy, s, dur, e);
  }
  const reset = (dur = 1200) => camTo(W / 2, H / 2, 1, dur);
  const toScreen = (x, y) => [(x - cam.cx) * cam.s + W / 2, (y - cam.cy) * cam.s + H / 2];

  // ---------- cursor ----------
  const cur = { x: W / 2, y: H + 60, o: 0 };
  function paintCursor() { const [x, y] = toScreen(cur.x, cur.y); const c = $('#cursor'); c.style.transform = `translate(${x - 6}px,${y - 4}px)`; c.style.opacity = cur.o; }
  function cursorTo(x, y, dur = 650) { tween('cur', { x: cur.x, y: cur.y }, { x, y }, dur, v => { cur.x = v.x; cur.y = v.y; }, 'io'); }
  const showCursor = (on = true) => tween('curo', cur.o, on ? 1 : 0, 300, v => (cur.o = v), 'lin');
  function ripple() {
    const [x, y] = toScreen(cur.x, cur.y); const r = document.createElement('div'); r.className = 'ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px'; $('#ov').appendChild(r); later(700, () => r.remove()); sfx('click');
  }
  function ensureVisible(dev, sel) {
    const e = el(dev, sel); if (!e) return;
    const r = e.getBoundingClientRect(), h = win(dev).innerHeight;
    if (r.top < 70 || r.bottom > h - 90) e.scrollIntoView({ block: 'center' });
  }
  // moves the cursor to an element and clicks it
  const isFixed = e => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const p = n.ownerDocument.defaultView.getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  function click(dev, sel, { move = 650, ox = 0.5, oy = 0.5, then, scrolled } = {}) {
    if (cur.o < .5) { showCursor(true); }
    const e0 = el(dev, sel); if (!e0) return;
    const r0 = e0.getBoundingClientRect(), vh = win(dev).innerHeight;
    if (!scrolled && !isFixed(e0) && (r0.top < 70 || r0.bottom > vh - 90)) { scrollDev(dev, e0, 420); later(440, () => click(dev, sel, { move, ox, oy, then, scrolled: true })); return; }
    const r = rectOf(dev, sel);
    cursorTo(r.x + r.w * ox, r.y + r.h * oy, move);
    later(move + 60, () => {
      ripple();
      const e = el(dev, sel); if (!e) return;
      e.focus?.();
      e.click();
      then?.();
    });
  }
  function type(dev, sel, text, { cps = 20, clear = true, submit } = {}) {
    const e = el(dev, sel); if (!e) return; const w = win(dev);
    e.focus();
    if (clear) { e.value = ''; e.dispatchEvent(new w.Event('input', { bubbles: true })); }
    [...text].forEach((ch, i) => later((i * 1000) / cps, () => {
      e.value += ch; e.dispatchEvent(new w.Event('input', { bubbles: true })); if (i % 2 === 0) sfx('key', 0.5);
      if (i === text.length - 1 && submit) later(250, () => { const f = el(dev, submit); f.requestSubmit ? f.requestSubmit() : f.click(); });
    }));
  }
  // drags a pointer over an element along a path function f(t) -> [clientX, clientY] in the iframe
  function drag(dev, sel, path, dur, { onInput } = {}) {
    const target = el(dev, sel); if (!target) return; const w = win(dev);
    const ev = (type, [x, y]) => target.dispatchEvent(new w.PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    const p0 = path(0), s0 = toSet(dev, ...p0);
    cursorTo(s0.x, s0.y, 500);
    later(520, () => {
      ripple(); if (!onInput) ev('pointerdown', p0);
      tween('drag', 0, 1, dur, t => {
        const p = path(t), sp = toSet(dev, ...p); cur.x = sp.x; cur.y = sp.y;
        if (onInput) onInput(t); else ev('pointermove', p);
        if (t >= 1 && !onInput) ev('pointerup', p);
      }, 'io');
    });
  }

  // ---------- overlays ----------
  function chapter(n, kicker, text, hold = 3600) {
    const c = $('#chapter'); c.querySelector('.num').textContent = String(n).padStart(2, '0'); c.querySelector('.k').textContent = kicker; c.querySelector('.t').textContent = text;
    tween('chap', 0, 1, 700, v => { c.style.opacity = v; c.style.transform = `translateX(${(1 - v) * -60}px)`; c.querySelector('.rule').style.transform = `scaleX(${v})`; }, 'out');
    later(hold, () => tween('chap', 1, 0, 600, v => { c.style.opacity = v; c.style.transform = `translateX(${(1 - v) * -30}px)`; }, 'in'));
    sfx('whoosh');
  }
  const callouts = [];
  function callout(dev, sel, text, { hold = 3200, side = 'right', gap = 40, ring = true } = {}) {
    const r = rectOf(dev, sel);
    const box = document.createElement('div'); box.className = 'callout ' + side; box.textContent = text; box.style.opacity = 0;
    const rg = ring ? Object.assign(document.createElement('div'), { className: 'ring' }) : null;
    $('#callouts').append(...[rg, box].filter(Boolean));
    const c = { r, box, rg, side, gap, o: 0 }; callouts.push(c);
    tween('co' + callouts.length, 0, 1, 500, v => (c.o = v), 'out');
    later(hold, () => tween('co' + callouts.indexOf(c), 1, 0, 400, v => { c.o = v; if (v <= 0) { box.remove(); rg?.remove(); callouts.splice(callouts.indexOf(c), 1); } }, 'lin'));
    sfx('pop', 0.5);
  }
  function paintCallouts() {
    for (const c of callouts) {
      const [x1, y1] = toScreen(c.r.x, c.r.y), [x2, y2] = toScreen(c.r.x + c.r.w, c.r.y + c.r.h);
      if (c.rg) Object.assign(c.rg.style, { left: x1 - 8 + 'px', top: y1 - 8 + 'px', width: x2 - x1 + 16 + 'px', height: y2 - y1 + 16 + 'px', opacity: c.o, transform: `scale(${0.96 + 0.04 * c.o})` });
      const bw = c.box.offsetWidth, bh = c.box.offsetHeight;
      let x, y;
      if (c.side === 'right') { x = x2 + c.gap + 30; y = (y1 + y2) / 2 - bh / 2; }
      if (c.side === 'left') { x = x1 - c.gap - 30 - bw; y = (y1 + y2) / 2 - bh / 2; }
      if (c.side === 'top') { x = (x1 + x2) / 2 - bw / 2; y = y1 - c.gap - bh; }
      if (c.side === 'bottom') { x = (x1 + x2) / 2 - bw / 2; y = y2 + c.gap; }
      x = Math.max(20, Math.min(W - bw - 20, x)); y = Math.max(20, Math.min(H - bh - 20, y));
      Object.assign(c.box.style, { opacity: c.o, transform: `translate(${x}px,${y + (1 - c.o) * 14}px)` });
    }
  }
  function title(html, on = true, dur = 900) {
    const t = $('#title');
    if (on) { t.innerHTML = html; t.classList.remove('in'); void t.offsetWidth; later(30, () => t.classList.add('in')); }
    tween('title', +t.style.opacity || 0, on ? 1 : 0, dur, v => (t.style.opacity = v), on ? 'out' : 'io');
  }
  function flash() { tween('flash', 0.55, 0, 700, v => ($('#flash').style.opacity = v), 'out'); }
  function side(kicker, heading, items, cls = '') {
    const s = $('#side'); s.className = cls; s.querySelector('.kicker').textContent = kicker; s.querySelector('h2').innerHTML = heading;
    const box = s.querySelector('.items'); box.innerHTML = items.map(([ic, tx], i) => `<div class="item" data-i="${i}"><span class="ic">${ic}</span>${tx}</div>`).join('');
    [...box.children].forEach((it, i) => later(300 + i * 140, () => it.classList.add('in')));
  }
  const sideOn = i => document.querySelectorAll('#side .item').forEach((it, j) => it.classList.toggle('on', j === i));

  // ---------- page loading (the clock waits while a page loads) ----------
  const blockers = [];
  function go(dev, url, ready, { bar } = {}) {
    const f = DEV[dev].frame;
    const started = performance.now();
    f.__ready = false;
    f.src = url;
    if (dev === 'desk') $('#url').textContent = bar || 'localhost:3000' + url.replace(/\?.*$/, '');
    let loaded = false; f.onload = () => (loaded = true);
    blockers.push(() => {
      const d = f.contentDocument;
      if (!loaded || !d || d.readyState !== 'complete' || !f.contentWindow.__film) return false;
      if (d.fonts && d.fonts.status !== 'loaded') return false;
      if ([...d.images].some(i => !i.complete)) return false;
      const ok = typeof ready === 'function' ? ready(d) : d.querySelector(ready);
      return !!ok;
    });
    void started;
  }
  const wait = fn => blockers.push(fn);
  const frameWins = () => [window, ...Object.values(DEV).map(d => d.frame.contentWindow).filter(w => { try { return w && w.__film; } catch { return false; } })];

  // ---------- sound cues and boards ----------
  const cues = [];
  const sfx = (name, gain = 1) => cues.push({ t: Math.round(elapsed), name, gain });
  let pendingBoard = null;
  const boardsMeta = [];
  const board = (titleText, why) => { pendingBoard = { title: titleText, why, at: Math.round(elapsed), scene: currentScene }; boardsMeta.push(pendingBoard); };

  // ---------- API answers for pages in the film ----------
  let created = false, real = null;
  studio.fetch = (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/events' && method === 'POST') { created = true; return studioSummary(); }
    if (url === '/api/events') return created ? [studioSummary()] : [];
    if (url === '/api/live') return liveList();
    return undefined;
  };
  // The home page's "Happening now": the film's session (listed by the host in step one) and two others in the building
  const liveList = () => {
    const e = S.ev, now = Date.now(), live = e?.status === 'live';
    const ours = e && { code: e.code, title: e.title, presenter: e.presenter, status: e.status, startsAt: e.startsAt, startedAt: e.startedAt, durationMin: e.durationMin,
      accent: e.accent, location: { mode: e.location?.mode, venue: e.location?.venue || '' }, online: S.online.size, mood: live && e.lastPulse?.avg != null ? Math.round(e.lastPulse.avg) : null };
    const others = [
      { code: 'KX4P7M', title: 'Accessibility clinic: designing for everyone', presenter: 'Priya Shah', status: 'live', startsAt: new Date(now - 23 * 60000).toISOString(), startedAt: now - 23 * 60000,
        durationMin: 60, accent: '#2ee6a6', location: { mode: 'in-person', venue: 'Room 4B' }, online: 18, mood: 74 },
      { code: 'HN8RQ2', title: 'Data storytelling 101', presenter: 'Tom Okafor', status: 'scheduled', startsAt: new Date(now + 26 * 3600000).toISOString(), startedAt: null,
        durationMin: 45, accent: '#ffb547', location: { mode: 'virtual', venue: '' }, online: 0, mood: null },
    ];
    return [ours, ...others].filter(Boolean).sort((a, b) => (a.status === b.status ? 0 : a.status === 'live' ? -1 : 1));
  };
  const studioSummary = () => ({ ...real, status: S.ev?.status || 'scheduled', stats: { participants: 0, online: 0, ratings: 0, messages: 0, reactions: 0, avg: null }, simulating: false });

  // ============================================================
  // Scene list. Each beat is one narration line; actions are [ms from the start of the line, fn].
  // ============================================================
  const PHONE_ME = { pid: 'p_jordan', name: 'Guest 4821', avatar: '🙂', color: '#7c5cff' };
  const CODE = () => real.code;
  const MODES = [['🎚️', 'Slider'], ['😊', 'Smileys'], ['⭐', 'Stars'], ['🎛️', 'Rotary dial'], ['🌤️', 'Weather'], ['🌡️', 'Thermometer'], ['👍', 'Thumbs'], ['🔮', 'Vibes'], ['📱', 'Tilt']];
  const brandSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>';
  const rateMode = (m, i) => () => { sideOn(i); click('phone', `#modes [data-m="${m}"]`, { move: 500 }); };
  const dial = (t, a0, a1) => { const r = el('phone', '.rt-dial svg').getBoundingClientRect(); const a = (a0 + (a1 - a0) * t) * Math.PI / 180, cx = r.left + r.width / 2, cy = r.top + r.height / 2; return [cx + Math.sin(a) * r.width * 0.36, cy - Math.cos(a) * r.width * 0.36]; };

  const SCENES = [
    {
      id: 'open', title: 'Cold open', feature: 'The landing page and its live demo phone', camera: 'Starts tight on the demo gauge, pulls back to reveal the page', sound: 'Music swells in; whoosh on the title',
      beats: [
        { id: 'open-1', min: 4200, say: 'This is CrowdPulse. It lets your audience rate your session while it’s happening, so you can feel the room, live.', do: [
          [0, () => { layout('full', 1); go('full', '/', '.demo-phone'); }],
          [10, () => { focus('full', '.demo-phone', { fill: 0.8, max: 2.4, dur: 1 }); title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">CrowdPulse</h1><p class="line l3">Feel the room. Live.</p></div>`, true, 1); sfx('whoosh'); }],
          [600, () => board('Title card', 'Logo and tagline over the live demo gauge')],
          [3300, () => title('', false, 1100)],
          [3700, () => focus('full', '#demoGauge', { fill: 0.7, max: 2.8, dur: 2600 })],
        ] },
        { id: 'open-2', min: 3600, say: 'Here’s how it works, from creating a session to the report at the end.', do: [
          [200, () => reset(2600)],
          [2400, () => board('The landing page', 'Pull back to the hero: join box and live demo')],
        ] },
      ],
    },
    {
      id: 'create', title: 'Create a session', feature: 'Host dashboard: the new-session form, location modes, features and the QR code it makes', camera: 'Zooms on each field as it is filled, then on the QR code and join code', sound: 'Key taps while typing, clicks, chime on the QR reveal',
      beats: [
        { id: 'create-1', say: 'Start in the host dashboard. Give your session a title, a short description, and your name.', do: [
          [0, () => { go('desk', '/admin', '#create'); layout('desk', 1100); chapter(1, 'Step one', 'Create a session'); }],
          [700, () => focus('desk', '#create', { fill: 0.92, max: 1.7 })],
          [1400, () => click('desk', '#create [name=title]', { then: () => type('desk', '#create [name=title]', real.title, { cps: 22 }) })],
          [3300, () => click('desk', '#create [name=description]', { then: () => type('desk', '#create [name=description]', real.description, { cps: 38 }) })],
          [5600, () => click('desk', '#create [name=presenter]', { then: () => type('desk', '#create [name=presenter]', real.presenter, { cps: 20 }) })],
          [6400, () => board('Filling in the session', 'Title, description and presenter typed into the form')],
        ] },
        { id: 'create-2', say: 'Pick a date and time, then say where it’s happening: in person, virtual, or hybrid, with a venue and a meeting link.', do: [
          [0, () => scrollDev('desk', '#locMode', 700)],
          [750, () => focus('desk', '#locMode', { fill: 0.5, max: 2.0, dy: 40 })],
          [1900, () => callout('desk', '[name=startsAt]', 'Date & time', { side: 'right', hold: 2400 })],
          [3600, () => click('desk', '#locMode [data-v="hybrid"]')],
          [4500, () => click('desk', '#create [name=venue]', { then: () => type('desk', '#create [name=venue]', 'Main Hall', { cps: 16 }) })],
          [5500, () => board('Hybrid location', 'Venue and meeting link both shown for a hybrid session')],
          [6000, () => click('desk', '#create [name=url]', { then: () => type('desk', '#create [name=url]', 'https://meet.example.com/design', { cps: 34 }) })],
        ] },
        { id: 'create-3', say: 'Choose an accent colour, switch on the features you want, list it on the home page if you like, and create it.', min: 5000, do: [
          [0, () => scrollDev('desk', '#swatches', 600)],
          [650, () => focus('desk', '#swatches', { fill: 0.75, max: 1.9, dy: 110 })],
          [700, () => click('desk', '#swatches button:nth-child(1)')],
          [1700, () => click('desk', '#create label.switch:nth-of-type(5) .track')],
          [2300, () => click('desk', '#create [name=listed] + .track')],
          [3600, () => click('desk', '#create button.primary', { then: () => later(80, () => scrollDev('desk', null, 1)) })],
          [4100, () => reset(900)],
        ] },
        { id: 'create-4', say: 'You instantly get a QR code and a six-character join code.', min: 4200, do: [
          [0, () => sfx('chime')],
          [400, () => focus('desk', '.modal', { fill: 0.86, max: 1.6, dur: 1100 })],
          [1500, () => focus('desk', '.success-qr', { fill: 0.6, max: 2.4, dy: 70, dur: 1300 })],
          [2300, () => board('QR code and join code', 'The success card: QR code, the code dropping in letter by letter, and the join link')],
          [3200, () => callout('desk', '.big-code', 'Join code', { side: 'right', hold: 2000 })],
        ] },
      ],
    },
    {
      id: 'invite', title: 'Invite the room', feature: 'Stage view lobby: giant QR code, join code and avatars appearing as people join', camera: 'Starts on the QR code, pulls back to the room filling up', sound: 'Soft pops as avatars arrive',
      beats: [
        { id: 'invite-1', say: 'Put the stage view up on the projector. It shows a giant QR code, and avatars pop in as people join.', min: 6400, do: [
          [0, () => { go('full', `/stage/${CODE()}`, '.big-lobby .qr'); layout('full', 900); chapter(2, 'Step two', 'Invite the room'); S.addBots(34, 7000); }],
          [300, () => focus('full', '.big-lobby .qr', { fill: 0.55, max: 1.6, dur: 1 })],
          [400, () => camTo(800, 330, 1.25, 4200)],
          [4200, () => focus('full', '.crowd-dots', { fill: 0.9, max: 1.5, dur: 1600 })],
          [5600, () => board('Stage view lobby', 'Giant QR code and join code; avatars pop in as people join')],
        ] },
      ],
    },
    {
      id: 'join', title: 'Join from any phone', feature: 'The home page Happening now list; attendee joins with the code, picks a profile, waits in the lobby countdown', camera: 'Phone on the right, story on the left; zooms on the Happening now list, the code boxes and the countdown', sound: 'Key taps, clicks',
      beats: [
        { id: 'join-0', say: 'If you listed it, your session shows up on the home page, under Happening now, so people can find it without a code.', min: 6400, do: [
          [0, () => { reset(1); showCursor(false); go('phone', '/', '#nowList .nowcard'); layout('phone', 1100); chapter(3, 'Step three', 'Join from any phone');
            side('For attendees', 'Join in <span class="gradient-text">seconds</span>', [['🌍', 'Find it under Happening now'], ['📷', 'Scan the QR code'], ['⌨️', 'Or type the 6-character code'], ['🚫', 'No app, no sign-up'], ['🎨', 'Pick a name, avatar & colour']]); later(700, () => sideOn(0)); }],
          [300, () => scrollDev('phone', '#now', 1200)],
          [1700, () => focus('phone', '#now', { fill: 0.95, max: 1.5, dur: 1300 })],
          [3100, () => callout('phone', '#nowList .nowcard:nth-child(2)', 'Your session', { side: 'left', hold: 2600 })],
          [3700, () => board('Happening now', 'Listed sessions on the home page: live first, with the crowd mood, then what’s coming up')],
          [5300, () => { reset(900); scrollDev('phone', null, 900); }],
        ] },
        { id: 'join-1', say: 'Or they just scan the QR code, or type it in. There’s no app to install, and no sign-up.', do: [
          [0, () => sideOn(1)],
          [900, () => { el('phone', '#join').scrollIntoView({ block: 'center' }); }],
          [1200, () => focus('phone', '#join', { fill: 0.95, max: 2.0, dur: 1300 })],
          [2200, () => { sideOn(2); click('phone', '#boxes input:nth-child(1)', { then: () => [...CODE()].forEach((c, i) => later(i * 170, () => { const inp = el('phone', `#boxes input:nth-child(${i + 1})`); inp.value = c; inp.dispatchEvent(new (win('phone').Event)('input', { bubbles: true })); sfx('key', 0.7); })) }); }],
          [3300, () => board('Typing the code', 'The six code boxes fill in, then the page joins automatically')],
          [4300, () => { reset(900); arrive('phone', d => d.location.pathname.startsWith('/e/') && d.querySelector('#mainCol .lobby')); }],
        ] },
        { id: 'join-2', say: 'They choose a name, an avatar and a colour, then wait in the lobby, where a countdown ticks down to the start.', do: [
          [0, () => { sideOn(4); focus('phone', '.modal', { fill: 0.92, max: 1.5 }); }],
          [500, () => click('phone', '#pfName', { then: () => type('phone', '#pfName', 'Jordan', { cps: 12 }) })],
          [1700, () => click('phone', '.avatar-grid button:nth-child(1)')],
          [2600, () => click('phone', '[data-c="#ff6b9d"]')],
          [3300, () => board('Choosing a profile', 'Name, avatar and colour on the welcome card')],
          [3700, () => click('phone', '#pfSave')],
          [4400, () => { showCursor(false); focus('phone', '.ring', { fill: 0.6, max: 1.9 }); }],
          [6000, () => board('Lobby countdown', 'A ring counts down to the start time')],
        ] },
      ],
    },
    {
      id: 'live', title: 'Go live', feature: 'Control room Go live button; every phone switches to rating', camera: 'Control room and phone side by side; zoom on the button, then on the phone', sound: 'Click, confetti burst',
      beats: [
        { id: 'live-1', say: 'When you’re ready, open the control room and press Go live.', do: [
          [0, () => { reset(1); go('desk', `/admin/${CODE()}?key=${real.adminKey}`, '#mainBtns button'); layout('duo', 1100); chapter(4, 'Step four', 'Go live'); }],
          [1200, () => focus('desk', '#mainBtns', { fill: 0.4, max: 2.2 })],
          [2400, () => click('desk', '#mainBtns button', { then: () => { sfx('pop'); flash(); S.moodTarget = 70; } })],
          [3000, () => board('Go live', 'The host presses Go live; confetti on every screen')],
        ] },
        { id: 'live-2', say: 'Every phone switches to rating mode right away.', min: 3400, do: [
          [0, () => { showCursor(false); focus('phone', '#mainCol .card', { fill: 0.85, max: 1.7 }); }],
          [2000, () => board('Phones switch to rating', 'The attendee phone flips from the lobby to the rating card')],
        ] },
      ],
    },
    {
      id: 'rate', title: 'Rate your way', feature: 'All nine rating styles, including tilting the phone, each mapped to the same 0–100 score', camera: 'Phone close-up; the list on the left lights up for each style', sound: 'Clicks and taps',
      beats: [
        { id: 'rate-1', say: 'Rating takes a second. The slider is the default: drag it, and the face changes with you.', do: [
          [0, () => { reset(1); layout('phone', 1000); chapter(5, 'Step five', 'Rate your way');
            side('For attendees', '9 ways to <span class="gradient-text">rate</span>', MODES, 'grid9'); later(1200, () => sideOn(0)); }],
          [1300, () => focus('phone', '#rater', { fill: 0.7, max: 1.7 })],
          [2200, () => { const inp = el('phone', '#rater input'); const r = inp.getBoundingClientRect(); const w = win('phone');
            drag('phone', inp, t => [r.left + r.width * (0.5 + 0.38 * Math.sin(t * Math.PI * 1.5) * (t < 0.66 ? 1 : 1)), r.top + r.height / 2], 2600,
              { onInput: t => { inp.value = Math.round(50 + 38 * Math.sin(t * Math.PI * 1.5)); inp.dispatchEvent(new w.Event('input', { bubbles: true })); } }); }],
          [3600, () => board('The slider', 'Dragging the default slider; the face and number follow')],
        ] },
        { id: 'rate-2', say: 'But everyone can pick the style they like best. Smileys.', min: 2600, do: [
          [0, () => focus('phone', '#modes', { fill: 0.9, max: 1.5, dy: 150 })],
          [900, rateMode('smiley', 1)], [2100, () => click('phone', '.rt-facebtn[data-v="75"]', { move: 450 })],
        ] },
        { id: 'rate-3', say: 'Stars.', min: 1900, do: [[0, rateMode('stars', 2)], [900, () => click('phone', '.rt-stars button[data-s="5"]', { move: 450 })]] },
        { id: 'rate-4', say: 'A rotary dial.', min: 2600, do: [
          [0, rateMode('dial', 3)],
          [800, () => drag('phone', '.rt-dial svg', t => dial(t, -60, 95), 1500)],
          [1700, () => board('Rotary dial', 'Turning the dial; the ticks light up in mood colours')],
        ] },
        { id: 'rate-5', say: 'The weather in your head.', min: 2200, do: [[0, rateMode('weather', 4)], [900, () => click('phone', '.rt-wrow button[data-v="100"]', { move: 450 })], [1700, () => board('Weather', 'Sunshine: the sky changes with the rating')]] },
        { id: 'rate-6', say: 'A thermometer of hype.', min: 2300, do: [
          [0, rateMode('thermo', 5)],
          [800, () => drag('phone', '.rt-tube', t => { const r = el('phone', '.rt-tube').getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 40 - (r.height - 60) * (0.25 + 0.65 * t)]; }, 1300)],
        ] },
        { id: 'rate-7', say: 'Thumbs, tapped to nudge it up or down.', min: 2600, do: [
          [0, rateMode('thumbs', 6)],
          [800, () => click('phone', '.rt-thumbs .up', { move: 400 })], [1250, () => click('phone', '.rt-thumbs .up', { move: 120 })], [1600, () => click('phone', '.rt-thumbs .up', { move: 120 })],
        ] },
        { id: 'rate-8', say: 'Or a ring of vibes.', min: 2200, do: [[0, rateMode('emoji', 7)], [900, () => click('phone', '.rt-orbit button[data-v="100"]', { move: 450 })], [1700, () => board('Vibes', 'The orbit of vibes, with fire selected')]] },
        { id: 'rate-tilt', say: 'Or just tilt your phone, like a spirit level, and tap Hold when it feels right.', min: 5800, do: [
          [0, rateMode('tilt', 8)],
          [700, () => { win('phone').DeviceOrientationEvent.requestPermission = async () => 'granted'; click('phone', '.rt-tilt-go', { move: 450 }); }],
          [1500, () => { showCursor(false); focus('phone', '#rater', { fill: 0.7, max: 1.7, dur: 900 });
            const w = win('phone');
            tween('tilt', 0, 1, 2800, t => {
              const deg = 30 * Math.sin(t * Math.PI * 2.5) * Math.min(1, t * 4);
              DEV.phone.rot = deg * 0.4; paintDev(DEV.phone);
              w.dispatchEvent(new w.DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 55, gamma: deg }));
            }, 'lin'); }],
          [3300, () => board('Tilt to rate', 'Tilting the phone moves the bubble; right is happier')],
          [4500, () => { el('phone', '.rt-tilt-go')?.click(); sfx('click'); tween('untilt', DEV.phone.rot || 0, 0, 700, v => { DEV.phone.rot = v; paintDev(DEV.phone); }, 'io'); }],
        ] },
        { id: 'rate-9', say: 'Whatever the style, it all becomes one score, from zero to a hundred.', do: [
          [0, () => { showCursor(false); sideOn(-1); reset(1500); }],
          [800, () => document.querySelectorAll('#side .item').forEach((it, i) => later(i * 90, () => it.classList.add('on')))],
          [2600, () => document.querySelectorAll('#side .item').forEach(it => it.classList.remove('on'))],
        ] },
      ],
    },
    {
      id: 'react', title: 'Reaction storms', feature: 'Emoji reactions from phones float across every screen, including the stage view', camera: 'Stage view full screen with the phone picture-in-picture; zoom on the reaction bar', sound: 'Taps and pops',
      beats: [
        { id: 'react-1', say: 'Tap a reaction, and it floats up on every screen, including the big one.', min: 6000, do: [
          [0, () => { go('full', `/stage/${CODE()}`, '#gauge .num'); layout('pip', 1100); chapter(6, 'Step six', 'Reaction storms'); S.react = 2.2; S.moodTarget = 80; }],
          [300, () => { el('phone', '.reactbar').scrollIntoView({ block: 'center' }); }],
          [1300, () => focus('phone', '.reactbar', { fill: 0.75, max: 2.2, dur: 1100 })],
          [2400, () => click('phone', '.reactbar [data-e="🔥"]', { move: 400 })],
          [2800, () => click('phone', '.reactbar [data-e="👏"]', { move: 200 })],
          [3200, () => { click('phone', '.reactbar [data-e="🤯"]', { move: 200 }); S.burst(['🔥', '👏', '🤯', '❤️', '🎉'], 40, 2600); }],
          [3600, () => { showCursor(false); reset(1500); }],
          [5200, () => board('Reaction storm', 'Emoji from every phone float up the stage view')],
        ] },
      ],
    },
    {
      id: 'talk', title: 'Chat, Q&A and polls', feature: 'Live chat, Q&A with upvotes, quick polls from the control room, spotlighted questions', camera: 'Phone close-ups, then control room and phone side by side', sound: 'Key taps, clicks',
      beats: [
        { id: 'talk-1', say: 'There’s a live chat, so the room can talk to each other.', do: [
          [0, () => { reset(1); layout('phone', 1000); chapter(7, 'Step seven', 'Chat, Q&A and polls'); S.react = 0.3; S.chatty = 1.5;
            side('Together', 'Talk with the <span class="gradient-text">room</span>', [['💬', 'Live chat'], ['🙋', 'Q&A with upvotes'], ['📊', 'Instant polls'], ['🔦', 'Spotlight a question']]); later(600, () => sideOn(0)); }],
          [600, () => click('phone', '#mobnav [data-tab="chat"]')],
          [1500, () => click('phone', '#chatIn', { then: () => type('phone', '#chatIn', 'The token deep dive is so good 🔥', { cps: 22, submit: '#chatForm' }) })],
          [2100, () => focus('phone', '#chatForm', { fill: 0.9, max: 1.8, dy: -170 })],
          [3700, () => board('Live chat', 'Jordan’s message joins the conversation')],
        ] },
        { id: 'talk-2', say: 'Questions go to the Q and A, where the room upvotes the best ones.', do: [
          [0, () => { sideOn(1); click('phone', '#mobnav [data-tab="qa"]'); reset(900); }],
          [900, () => click('phone', '#askIn', { then: () => type('phone', '#askIn', 'How do you version tokens across platforms?', { cps: 30, submit: '#askForm' }) })],
          [1100, () => { S.botAsk(3, 'Will the slides be shared?'); S.botAsk(9, 'What tools do you use for theming?'); }],
          [3000, () => { focus('phone', '#qa', { fill: 0.85, max: 1.5, dy: -120 }); when(() => S.question('How do you version tokens across platforms?'), () => S.upvote(S.question('How do you version tokens across platforms?').id, 23, 2400)); }],
          [3400, () => { const q = S.question('Will the slides be shared?'); if (q) S.upvote(q.id, 9, 2400); }],
          [5000, () => board('Q&A upvotes', 'Questions re-sort live as the room upvotes them')],
        ] },
        { id: 'talk-3', say: 'From the control room, you can launch a quick poll in two clicks.', do: [
          [0, () => { sideOn(2); showCursor(false); reset(1); layout('duo', 1000); }],
          [900, () => { focus('desk', '#pollQ', { fill: 0.5, max: 2.1, dy: 40 }); }],
          [1600, () => click('desk', '#pollTemplates button:nth-child(1)')],
          [2700, () => click('desk', '#launchPoll')],
          [3300, () => { click('phone', '#mobnav [data-tab="polls"]', { move: 700 }); reset(900); }],
          [4200, () => click('phone', '#polls .poll-opt[data-i="1"]', { move: 600 })],
          [5000, () => focus('phone', '#polls .card', { fill: 0.8, max: 1.5 })],
          [5600, () => board('Instant poll', 'A template poll launched from the control room, answered on the phone')],
        ] },
        { id: 'talk-4', say: 'And you can put the top question in the spotlight, on every screen.', do: [
          [0, () => { reset(900); click('desk', '#tabs [data-tab="qa"]'); }],
          [900, () => focus('desk', '#qa .q', { fill: 0.6, max: 2.2 })],
          [1700, () => click('desk', '#qa .q [data-a="spotlight"]')],
          [2400, () => { showCursor(false); reset(1000); }],
          [3400, () => board('Spotlight', 'The top question fills every screen')],
        ] },
      ],
    },
    {
      id: 'room', title: 'Read the room', feature: 'Control room telemetry: gauge, distribution, KPIs, chapter markers, mood chart and the presenter coach', camera: 'Control room full; zooms on the gauge, KPIs, the chart and the coach alert', sound: 'Clicks',
      beats: [
        { id: 'room-1', say: 'Meanwhile, the control room shows you how it’s going, every second: the crowd’s mood, how the ratings are spread, energy, and trend.', do: [
          [0, () => { go('desk', `/admin/${CODE()}?key=${real.adminKey}`, '#gauge .num'); layout('desk', 1000); chapter(8, 'For the host', 'Read the room'); S.chatty = 0.8; S.react = 0.3; showCursor(false); }],
          [900, () => focus('desk', '#gauge', { fill: 0.55, max: 2.6 })],
          [3200, () => focus('desk', '#dist', { fill: 0.55, max: 2.6 })],
          [3800, () => board('Live gauge and distribution', 'The spring-loaded gauge and the five mood buckets')],
          [5400, () => focus('desk', '.tick-row', { fill: 0.85, max: 2.2 })],
        ] },
        { id: 'room-2', say: 'Drop chapter markers as you move through your talk, so later you can see which parts landed.', do: [
          [0, () => focus('desk', '#markerChips', { fill: 0.7, max: 2.2, dy: -40 })],
          [900, () => click('desk', '#markerChips button:nth-child(4)')],
          [2300, () => { showCursor(false); el('desk', '#chart').scrollIntoView({ block: 'center' }); focus('desk', '#chart', { fill: 0.8, max: 2.0 }); }],
          [3800, () => board('Chapter markers', 'Live demo marker drawn across the mood chart')],
        ] },
        { id: 'room-3', say: 'And a built-in coach nudges you when the mood dips, or spikes.', min: 5600, do: [
          [0, () => { S.moodTarget = 44; scrollDev('desk', null, 500); reset(900); }],
          [300, () => when(() => doc('desk').querySelector('#alerts .alert[data-kind="drop"], #alerts .alert[data-kind="cool"]'), () => { win('desk').scrollTo(0, 0); focus('desk', '#alerts .alert[data-kind="drop"], #alerts .alert[data-kind="cool"]', { fill: 0.6, max: 2.2, dur: 1100 }); })],
          [3000, () => board('Presenter coach', 'A mood dip triggers a suggestion to re-engage the room')],
          [4200, () => { S.moodTarget = 82; reset(1200); }],
        ] },
      ],
    },
    {
      id: 'passive', title: 'Passive signals', feature: 'Tab focus, the opt-in attendee camera and its consent sheet, the control room Passive signals card, said vs. shown, and the distracted coach nudge', camera: 'Phone close-up on the consent sheet, then the control room card, the said-vs-shown meters, the coach alert and the dashed attention line', sound: 'Clicks',
      beats: [
        { id: 'passive-1', say: 'CrowdPulse can also read the room passively. When the host allows it, attendees can choose to share their attention.', do: [
          [0, () => { showCursor(false); reset(1); layout('phone', 1000); chapter(9, 'New', 'Passive signals'); S.react = 0.5; S.chatty = 0.8;
            side('Without a button', 'Read the room <span class="gradient-text">passively</span>', [['👀', 'Tab focus'], ['📷', 'Opt-in attendee camera'], ['🎙️', 'Room sensor on your laptop'], ['🔒', 'Numbers only · 5+ people']]); later(600, () => sideOn(1)); }],
          [500, () => click('phone', '#mobnav [data-tab="rate"]', { move: 600 })],
          [1500, () => { scrollDev('phone', '#pvCard', 700); }],
          [2300, () => focus('phone', '#pvCard', { fill: 0.9, max: 1.8, dur: 1100 })],
          [3300, () => click('phone', '#pvCard [data-act="info"]', { move: 500 })],
          [4300, () => board('Share attention, optional', 'The opt-in offer on the attendee phone')],
        ] },
        { id: 'passive-2', say: 'Their camera is analysed on their own phone. No video ever leaves it: just three numbers, for attention, positive, and fatigue.', do: [
          [0, () => { showCursor(false); reset(700); }],
          [800, () => focus('phone', '.pv-sheet', { fill: 0.92, max: 1.35, dur: 1200 })],
          [2400, () => { const box = doc('phone').querySelector('.pv-sheet'); box && tween('sheet-scroll', 0, 260, 1800, v => (box.scrollTop = v), 'io'); }],
          [3200, () => board('The consent sheet', 'On-device analysis, three numbers only, crowd figures from 5+ people, stop anytime')],
          [5800, () => { el('phone', '.pv-sheet [data-act="no"]')?.click(); reset(900); }],
        ] },
        { id: 'passive-3', say: 'In the control room, the passive signals card blends tab focus, cameras and a room sensor into one attention index, shown only once five or more people take part.', do: [
          [0, () => { sideOn(-1); layout('desk', 1000); S.distract = 1.25; }],
          [300, () => scrollDev('desk', '#passiveCard', 800)],
          [1200, () => focus('desk', '#passiveCard', { fill: 0.92, max: 1.6, dur: 1300 })],
          [3200, () => focus('desk', '.ps-grid', { fill: 0.85, max: 2.0, dur: 1200 })],
          [4400, () => board('Passive signals card', 'Attention index, tab focus, attendee cameras and the room sensor')],
          [6200, () => focus('desk', '.ps-top', { fill: 0.85, max: 2.0, dur: 1100 })],
        ] },
        { id: 'passive-4', say: 'It also compares what people say with what they show. When ratings stay high but attention slips, the coach flags it: polite, but distracted.', min: 8200, do: [
          [0, () => focus('desk', '#svText', { fill: 0.5, max: 2.4, dur: 1000 })],
          [1200, () => board('Said vs. shown', 'Ratings stay high while attention drops')],
          [1600, () => when(() => doc('desk').querySelector('#alerts .alert[data-kind="distracted"], #alerts .alert[data-kind="tabaway"]'), () => {
            win('desk').scrollTo(0, 0); focus('desk', '#alerts .alert[data-kind="distracted"], #alerts .alert[data-kind="tabaway"]', { fill: 0.6, max: 2.2, dur: 1000 });
            later(1600, () => board('Polite but distracted', 'The coach notices the gap between ratings and attention'));
          }, 6000)],
          [5200, () => { scrollDev('desk', '#chart', 700); }],
          [6000, () => focus('desk', '#chart', { fill: 0.85, max: 1.9, dur: 1100 })],
          [7600, () => { S.distract = 0; reset(900); }],
        ] },
      ],
    },
    {
      id: 'stage', title: 'On the big screen', feature: 'Stage view during the session: gauge, stats, chat ticker, chart and reactions', camera: 'Slow push-in on the gauge, then wide', sound: 'Confetti burst',
      beats: [
        { id: 'stage-1', say: 'The stage view puts it all up on the projector: the live gauge, the chat, the polls, and every single reaction.', min: 6200, do: [
          [0, () => { go('full', `/stage/${CODE()}`, '#gauge .num'); layout('full', 1000); chapter(10, 'For the room', 'On the big screen'); S.react = 2.6; }],
          [400, () => focus('full', '#gauge', { fill: 0.75, max: 1.5, dur: 1 })],
          [500, () => reset(4200)],
          [3600, () => { S.admin('admin:confetti'); sfx('pop'); }],
          [4600, () => board('Stage view, live', 'Gauge, stats, chat ticker and reactions on the projector')],
        ] },
      ],
    },
    {
      id: 'end', title: 'Wrap up', feature: 'End the session; the attendee feedback form: stars, NPS, detail ratings and one word', camera: 'Side by side, then close on the phone form', sound: 'Clicks, key taps, confetti',
      beats: [
        { id: 'end-1', say: 'When you finish, end the session. Every phone asks for a quick review: stars, how likely they are to recommend it, and one word that sums it up.', do: [
          [0, () => { layout('duo', 1000); chapter(11, 'Wrap up', 'Feedback'); S.react = 0.6; }],
          [600, () => focus('desk', '#mainBtns', { fill: 0.4, max: 2.2 })],
          [1500, () => click('desk', '#mainBtns .danger')],
          [2300, () => click('phone', '#mobnav [data-tab="rate"]', { move: 600 })],
          [3000, () => focus('phone', '#fbStars', { fill: 0.85, max: 1.5, dy: 120 })],
          [3500, () => click('phone', '#fbStars button[data-s="5"]', { move: 500 })],
          [4400, () => click('phone', '#fbNps button[data-n="9"]', { move: 500 })],
          [5400, () => click('phone', '.dots[data-a="content"] button[data-v="5"]', { move: 500 })],
          [6000, () => board('Feedback form', 'Five stars, a 9 for recommend, and detail ratings')],
          [6600, () => click('phone', '#fbWord', { then: () => type('phone', '#fbWord', 'inspiring', { cps: 14 }) })],
          [8000, () => click('phone', '#fbSend', { then: () => sfx('pop') })],
          [8800, () => { showCursor(false); reset(1000); }],
        ] },
      ],
    },
    {
      id: 'report', title: 'The report', feature: 'Post-session report: grade, KPIs, timeline, insights, key moments, engagement, word cloud, NPS and exports', camera: 'Zooms on the grade, then scrolls with push-ins on each section', sound: 'Chime on the grade',
      beats: [
        { id: 'report-1', say: 'Then comes the report. A grade, a score, and the numbers that matter.', min: 5200, do: [
          [0, () => { go('full', `/report/${CODE()}?key=${real.adminKey}`, '#kpis .kpi'); layout('full', 900); chapter(12, 'Afterwards', 'The report'); }],
          [200, () => { focus('full', '#grade', { fill: 0.5, max: 2.4, dur: 1 }); sfx('chime'); }],
          [2600, () => board('Grade reveal', 'The animated letter grade and score')],
          [2900, () => focus('full', '#kpis', { fill: 0.95, max: 1.6, dur: 1400 })],
        ] },
        { id: 'report-2', say: 'The mood timeline shows every chapter, and key moments pick out the biggest peaks and dips, with what people were saying at the time.', do: [
          [0, () => scrollFull('#cTimeline', 1300)],
          [200, () => reset(1300)],
          [1500, () => focus('full', '#cTimeline', { fill: 0.9, max: 1.7 })],
          [3200, () => board('Mood timeline', 'Mood line with chapter markers and audience size')],
          [4300, () => { scrollFull('#moments', 1200); reset(1200); }],
          [5600, () => focus('full', '.moment', { fill: 0.6, max: 2.2 })],
          [7000, () => board('Key moments', 'The biggest peak, with the reactions and chat around it')],
        ] },
        { id: 'report-passive', say: 'A passive signals section lines attention up against the ratings, and finds where they disagreed: engaged but critical in the deep dive, and polite but distracted during the results.', min: 9800, do: [
          [0, () => { reset(800); scrollFull('#passive', 1400); }],
          [1500, () => focus('full', '#psKpis', { fill: 0.9, max: 1.6, dur: 1100 })],
          [2900, () => { reset(700); scrollFull('#cPassive', 1000); }],
          [4000, () => focus('full', '#cPassive', { fill: 0.92, max: 1.7, dur: 1200 })],
          [5200, () => board('Rating vs. attention', 'Mood line, dashed attention line, tab focus, laughter and applause')],
          [6200, () => { reset(700); scrollFull('#psGaps', 1000); }],
          [7300, () => focus('full', '#psGaps', { fill: 0.95, max: 1.6, dur: 1200 })],
          [8700, () => board('Said vs. shown in the report', 'Engaged but critical, and polite but distracted, with the chapters they fell in')],
        ] },
        { id: 'report-3', say: 'Then engagement, reactions, sentiment, a word cloud, and the Net Promoter Score.', min: 9400, do: [
          [0, () => { reset(900); scrollFull('#funnel', 1300); }],
          [1400, () => focus('full', '#funnel', { fill: 0.8, max: 1.8 })],
          [2900, () => { reset(800); scrollFull('#cloud', 1300); }],
          [4300, () => focus('full', '#cloud', { fill: 0.92, max: 1.5, dur: 1200 })],
          [5600, () => board('Word cloud', 'What people talked about, coloured by sentiment')],
          [6200, () => { reset(800); scrollFull('#npsBig', 1100); }],
          [7400, () => focus('full', '#npsBig', { fill: 0.4, max: 1.9 })],
          [8800, () => board('Net Promoter Score', 'NPS with promoters, passives and detractors')],
        ] },
        { id: 'report-4', say: 'Export it as a PDF, a CSV or JSON, and share it with your audience if you like.', do: [
          [0, () => { reset(800); scrollFull(null, 1400); }],
          [1500, () => focus('full', '.toolbar', { fill: 0.5, max: 2.4 })],
          [3100, () => board('Exports', 'PDF, CSV and JSON exports in the report toolbar')],
        ] },
      ],
    },
    {
      id: 'outro', title: 'Outro', feature: 'End card: how to start it', camera: 'Wide on the landing page under the end card', sound: 'Music resolves',
      beats: [
        { id: 'outro-1', say: 'That’s CrowdPulse. Run npm start, open the host dashboard, and feel the room. Live.', min: 6500, do: [
          [0, () => { reset(1); go('full', '/', '.demo-phone'); layout('full', 1); }],
          [100, () => { title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">CrowdPulse</h1><p class="line l3">Feel the room. Live.</p><div class="cmd line l4"><b>$</b> npm start &nbsp;→&nbsp; localhost:3000/admin</div></div>`, true, 1200); sfx('whoosh'); }],
          [3000, () => board('End card', 'Logo, tagline and how to start it')],
        ] },
      ],
      tail: 1600,
    },
  ];

  // smoothly scrolls a device's page so the element sits in the middle (or to the top with no element)
  function scrollDev(dev, sel, dur = 800) {
    const w = win(dev), from = w.scrollY, vh = w.innerHeight;
    let to = 0;
    if (sel) { const e = el(dev, sel); if (e) { const r = e.getBoundingClientRect(); to = Math.max(0, Math.min(w.document.documentElement.scrollHeight - vh, from + r.top + r.height / 2 - vh / 2)); } }
    tween('scroll-' + dev, from, to, dur, v => w.scrollTo(0, v), 'io');
  }
  const scrollFull = (sel, dur) => scrollDev('full', sel, dur);
  // runs fn once cond() holds, checking on the film clock (doesn't stop time like wait())
  function when(cond, fn, timeout = 8000) {
    const t0 = elapsed;
    const check = () => { let ok = false; try { ok = cond(); } catch { /* not yet */ } if (ok) fn(); else if (elapsed - t0 > timeout) fail('when() timed out in ' + currentScene); else later(100, check); };
    check();
  }
  const arrive = (dev, ready) => blockers.push(() => { const d = doc(dev); return d && d.readyState === 'complete' && win(dev).__film && ready(d); });
  S.admin = (name, p) => { const sock = [...S.sockets].find(k => k.admin); sock?.emit(name, p, () => {}); };

  // ============================================================
  // Engine
  // ============================================================
  let actions = [], ai = 0, total = 0, voiced = [], chapters = [], currentScene = null, started = false;
  D.script = () => SCENES.flatMap(sc => sc.beats.map(b => ({ id: b.id, text: b.say })));
  D.prepare = async ({ code }) => {
    const list = await fetch('/api/events').then(r => r.json());
    real = list.find(e => e.code === code) || list[0];
    if (!real) throw new Error('no session found to film');
    // start the film two and a half minutes before the session's start time
    clock.now = clock.origin = new Date(real.startsAt).getTime() - 155000;
    S.init({ code: real.code, adminKey: real.adminKey, joinUrl: real.joinUrl, title: real.title, description: real.description, presenter: real.presenter,
      startsAt: real.startsAt, durationMin: real.durationMin, location: real.location, accent: real.accent, settings: { ...real.settings, publicReport: true } });
    localStorage.clear();
    localStorage.setItem('cp.profile', JSON.stringify(PHONE_ME));
    localStorage.setItem('cp.mode', JSON.stringify('slider'));
    return { code: real.code, title: real.title };
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
    actions.sort((a, b) => a.at - b.at);
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
      if (window.__film.real.now() - waitedSince > 20000) { fail('timed out waiting at ' + Math.round(elapsed) + 'ms in ' + currentScene); blockers.length = 0; }
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
    runTweens();
    const st = $('#stage'); if (st.scrollTop || st.scrollLeft) { st.scrollTop = 0; st.scrollLeft = 0; }
    paintCursor(); paintCallouts();
    return elapsed >= total ? 'done' : 'run';
  };
  D.takeBoard = () => { const b = pendingBoard; pendingBoard = null; return b; };
  D.timeline = () => ({ total, chapters, voiced, cues, boards: boardsMeta, code: real?.code, title: real?.title });
  D.errors = () => errors;
  D.clock = () => elapsed;
  D.scene = () => currentScene;
  for (const d of Object.values(DEV)) paintDev(d);
  paintCam();
})();
