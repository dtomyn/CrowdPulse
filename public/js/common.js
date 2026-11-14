// Shared client helpers: animated backdrop, toasts, mood colours, gauge, live pulse chart, confetti, floaters.
(function () {
  const CP = (window.CP = {});

  CP.$ = (s, r = document) => r.querySelector(s);
  CP.$$ = (s, r = document) => [...r.querySelectorAll(s)];
  CP.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CP.h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  CP.codeFromPath = () => (new URLSearchParams(location.search).get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  CP.fmtClock = ms => {
    const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  };
  CP.fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  CP.fmtDate = t => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  CP.copy = async (text, msg = 'Copied!') => { try { await navigator.clipboard.writeText(text); CP.toast('📋 ' + msg); } catch { CP.toast(text); } };
  CP.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ---------- mood scale ----------
  const STOPS = [[0, [255, 77, 109]], [25, [255, 140, 66]], [50, [255, 205, 77]], [75, [76, 230, 150]], [100, [46, 214, 255]]];
  CP.moodRGB = v => {
    v = Math.max(0, Math.min(100, v ?? 50));
    for (let i = 1; i < STOPS.length; i++) {
      if (v <= STOPS[i][0]) {
        const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i]; const f = (v - a) / (b - a);
        return ca.map((c, j) => Math.round(c + (cb[j] - c) * f));
      }
    }
    return STOPS[4][1];
  };
  CP.moodColor = (v, a = 1) => { const [r, g, b] = CP.moodRGB(v); return `rgba(${r},${g},${b},${a})`; };
  const MOODS = [[0, '😫', 'Rough'], [20, '😕', 'Meh'], [40, '😐', 'Okay'], [60, '🙂', 'Good'], [75, '😄', 'Great'], [88, '🤩', 'Amazing']];
  CP.mood = v => { if (v == null) return { emoji: '🫥', label: 'Waiting…' }; const m = [...MOODS].reverse().find(x => v >= x[0]); return { emoji: m[1], label: m[2] }; };

  // ---------- identity ----------
  const AVATARS = ['🦊', '🐼', '🐙', '🦄', '🐯', '🐸', '🦉', '🐨', '🐧', '🦁', '🐳', '🦖', '🐝', '🦋', '🐢', '🦩', '🐲', '👽', '🤖', '🎃', '🌵', '🍄', '🚀', '⚡'];
  const COLORS = ['#ff6b9d', '#7c5cff', '#2ee6a6', '#ffb547', '#3ec5ff', '#ff7a45', '#c86bff', '#5ef0ff', '#b6f35c'];
  const ADJ = ['Curious', 'Cosmic', 'Brave', 'Witty', 'Sunny', 'Swift', 'Clever', 'Mellow', 'Bold', 'Zesty', 'Quiet', 'Lucky'];
  const NOUN = ['Otter', 'Comet', 'Falcon', 'Panda', 'Pixel', 'Nova', 'Maple', 'Koala', 'Echo', 'Lynx', 'Mango', 'Orbit'];
  CP.AVATARS = AVATARS; CP.COLORS = COLORS;
  CP.profile = () => {
    let p = CP.store.get('cp.profile');
    if (!p) {
      const pick = a => a[Math.floor(Math.random() * a.length)];
      // the id is this browser's credential for the session, so it comes from the crypto RNG
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      p = { pid: 'p_' + rnd, name: pick(ADJ) + ' ' + pick(NOUN), avatar: pick(AVATARS), color: pick(COLORS) };
      CP.store.set('cp.profile', p);
    }
    return p;
  };
  CP.saveProfile = p => CP.store.set('cp.profile', p);

  // ---------- toast ----------
  CP.toast = (msg, ms = 2600) => {
    let host = document.getElementById('toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  };

  // ---------- animated backdrop: drifting aurora blobs + twinkling stars, tinted by mood ----------
  CP.backdrop = (opts = {}) => {
    const c = document.createElement('canvas'); c.id = 'backdrop'; document.body.prepend(c);
    const g = document.createElement('div'); g.className = 'grain'; document.body.prepend(g);
    const ctx = c.getContext('2d');
    let W, H, dpr = Math.min(2, window.devicePixelRatio || 1);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blobs = [
      { x: .2, y: .25, r: .45, c: [124, 92, 255], sx: .00011, sy: .00013 },
      { x: .8, y: .3, r: .4, c: [255, 92, 168], sx: .00009, sy: .00012 },
      { x: .55, y: .85, r: .5, c: [46, 230, 214], sx: .00012, sy: .00008 },
      { x: .1, y: .9, r: .35, c: [255, 181, 71], sx: .0001, sy: .00011 },
    ];
    const stars = Array.from({ length: opts.stars ?? 90 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, s: Math.random() * .002 + .0005 }));
    let tint = null, tintTarget = null;
    const resize = () => { W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px'; };
    resize(); addEventListener('resize', resize);
    const draw = t => {
      ctx.fillStyle = '#07051a'; ctx.fillRect(0, 0, W, H);
      if (tintTarget) tint = tint ? tint.map((v, i) => v + (tintTarget[i] - v) * 0.02) : tintTarget;
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const x = (b.x + Math.sin(t * b.sx + i) * .12) * W, y = (b.y + Math.cos(t * b.sy + i * 2) * .1) * H, r = b.r * Math.max(W, H);
        const col = i === 0 && tint ? tint : b.c;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${opts.intensity ?? .28})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      });
      ctx.globalCompositeOperation = 'source-over';
      stars.forEach(s => {
        const a = .25 + .55 * (0.5 + 0.5 * Math.sin(t * s.s * 3 + s.p));
        ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(s.x * W, ((s.y - t * s.s * .02) % 1 + 1) % 1 * H, s.r * dpr, 0, 6.28); ctx.fill();
      });
      if (!reduce) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    return { setMood(v) { if (v != null) tintTarget = CP.moodRGB(v); } };
  };

  // ---------- floating emoji ----------
  let layer;
  CP.floatEmoji = (e, opts = {}) => {
    if (!layer) { layer = document.createElement('div'); layer.className = 'float-layer'; document.body.appendChild(layer); }
    if (layer.childElementCount > 70) return;
    const f = document.createElement('div'); f.className = 'floater'; f.textContent = e;
    const x = opts.x ?? (10 + Math.random() * 80);
    f.style.left = x + '%';
    f.style.fontSize = (opts.size || (1.6 + Math.random() * 1.6)) + 'rem';
    f.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    f.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
    f.style.setProperty('--dur', (2.6 + Math.random() * 1.8) + 's');
    layer.appendChild(f); f.addEventListener('animationend', () => f.remove());
  };

  // ---------- confetti ----------
  CP.confetti = (n = 160) => {
    const c = document.createElement('canvas'); Object.assign(c.style, { position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 300 });
    document.body.appendChild(c); const ctx = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const cols = ['#7c5cff', '#ff5ca8', '#2ee6d6', '#ffb547', '#b6f35c', '#ffffff'];
    const ps = Array.from({ length: n }, (_, i) => ({
      x: c.width * (i % 2 ? .2 : .8), y: c.height * .7, vx: (Math.random() - .5) * 18 + (i % 2 ? 6 : -6), vy: -Math.random() * 22 - 8,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 10, a: Math.random() * 6, va: (Math.random() - .5) * .4, c: cols[i % cols.length],
    }));
    let frames = 0;
    (function step() {
      ctx.clearRect(0, 0, c.width, c.height);
      ps.forEach(p => {
        p.vy += .45; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(p.a * 2)); ctx.restore();
      });
      if (frames++ < 240) requestAnimationFrame(step); else c.remove();
    })();
  };

  // ---------- count-up numbers ----------
  CP.countUp = (el, to, { dur = 1200, dec = 0, prefix = '', suffix = '' } = {}) => {
    if (to == null || Number.isNaN(to)) { el.textContent = '—'; return; }
    const from = Number(el.dataset.v || 0); el.dataset.v = to; const t0 = performance.now();
    const step = t => {
      const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 4);
      el.textContent = prefix + (from + (to - from) * e).toFixed(dec) + suffix;
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---------- semicircle gauge with spring needle ----------
  CP.gauge = (host, { big = false } = {}) => {
    host.classList.add('gauge');
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    const ticks = Array.from({ length: 41 }, (_, i) => {
      const a = Math.PI + (i / 40) * Math.PI, r1 = 128, r2 = i % 5 ? 122 : 114;
      return `<line x1="${150 + r1 * Math.cos(a)}" y1="${150 + r1 * Math.sin(a)}" x2="${150 + r2 * Math.cos(a)}" y2="${150 + r2 * Math.sin(a)}" stroke="rgba(255,255,255,${i % 5 ? .18 : .45})" stroke-width="${i % 5 ? 1 : 2}"/>`;
    }).join('');
    host.innerHTML = `
      <svg viewBox="0 0 300 170">
        <defs>
          <linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".25" stop-color="#ff8c42"/><stop offset=".5" stop-color="#ffcd4d"/><stop offset=".75" stop-color="#4ce696"/><stop offset="1" stop-color="#2ed6ff"/></linearGradient>
          <filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
        </defs>
        <path d="M 40 150 A 110 110 0 0 1 260 150" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="22" stroke-linecap="round"/>
        <path class="g-glow" d="M 40 150 A 110 110 0 0 1 260 150" fill="none" stroke="url(#${id})" stroke-width="22" stroke-linecap="round" filter="url(#${id}b)" opacity=".55" pathLength="100" stroke-dasharray="0 100"/>
        <path class="g-arc" d="M 40 150 A 110 110 0 0 1 260 150" fill="none" stroke="url(#${id})" stroke-width="22" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>
        ${ticks}
        <circle class="g-halo" r="20" fill="white" opacity=".18"/><circle class="g-tip" r="9" fill="#fff" stroke="#07051a" stroke-width="3"/>
      </svg>
      <div class="readout"><span class="face">🫥</span><div class="num">—</div><div class="lbl">Waiting for ratings</div></div>`;
    const arc = host.querySelector('.g-arc'), glow = host.querySelector('.g-glow'), tip = host.querySelector('.g-tip'), halo = host.querySelector('.g-halo');
    const num = host.querySelector('.num'), lbl = host.querySelector('.lbl'), face = host.querySelector('.face');
    let cur = 0, target = 0, vel = 0, has = false;
    const loop = () => {
      vel += (target - cur) * 0.06; vel *= 0.82; cur += vel; // spring physics
      const d = Math.max(0, Math.min(100, cur));
      arc.setAttribute('stroke-dasharray', `${d} 100`); glow.setAttribute('stroke-dasharray', `${d} 100`);
      const a = Math.PI + (d / 100) * Math.PI, tx = 150 + 110 * Math.cos(a), ty = 150 + 110 * Math.sin(a);
      tip.setAttribute('cx', tx); tip.setAttribute('cy', ty); halo.setAttribute('cx', tx); halo.setAttribute('cy', ty); halo.setAttribute('r', 16 + Math.abs(vel) * 2 + Math.sin(performance.now() / 300) * 3);
      if (has) { num.textContent = Math.round(d); num.style.color = CP.moodColor(d); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return {
      set(v, sub) {
        if (v == null) { has = false; num.textContent = '—'; lbl.textContent = sub || 'Waiting for ratings'; face.textContent = '🫥'; return; }
        has = true; target = v; const m = CP.mood(v);
        if (face.textContent !== m.emoji) { face.textContent = m.emoji; face.style.transform = 'scale(1.4)'; setTimeout(() => (face.style.transform = ''), 250); }
        lbl.textContent = sub || m.label;
      },
    };
  };

  // ---------- streaming pulse chart (canvas) ----------
  // Smooth catmull-rom line coloured by mood, with glow + gradient fill + optional markers.
  // Points may carry `att` (passive attention index); when present a dashed teal attention line and a legend are drawn.
  CP.pulseChart = (canvas, { windowMs = 10 * 60 * 1000, showOnline = true } = {}) => {
    const ctx = canvas.getContext('2d');
    let pts = [], markers = [], hover = null, dpr = Math.min(2, devicePixelRatio || 1), start = null;
    const resize = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; };
    new ResizeObserver(resize).observe(canvas); resize();
    canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); hover = (e.clientX - r.left) * dpr; });
    canvas.addEventListener('mouseleave', () => (hover = null));
    let anim = 0;
    const draw = () => {
      const W = canvas.width, H = canvas.height, padL = 34 * dpr, padB = 22 * dpr, padT = 12 * dpr;
      ctx.clearRect(0, 0, W, H);
      const now = Date.now(); const t1 = Math.max(now, pts.length ? pts[pts.length - 1].t : now);
      const all = !windowMs; const first = start ?? (pts[0]?.t ?? now - 60000);
      const t0 = all ? Math.min(first, t1 - 30000) : Math.min(t1 - 30000, Math.max(t1 - windowMs, first));
      const X = t => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - 8 * dpr);
      const Y = v => padT + (1 - v / 100) * (H - padT - padB);
      // grid
      ctx.font = `${10 * dpr}px Inter, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.textAlign = 'right';
      [0, 25, 50, 75, 100].forEach(v => {
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(W, Y(v)); ctx.stroke();
        ctx.fillText(v, padL - 8 * dpr, Y(v) + 3 * dpr);
      });
      const vis = pts.filter(p => p.t >= t0 - 10000);
      // online bars
      if (showOnline && vis.length) {
        const maxO = Math.max(1, ...vis.map(p => p.online || 0));
        vis.forEach(p => { ctx.fillStyle = 'rgba(124,92,255,.14)'; const h = ((p.online || 0) / maxO) * (H - padT - padB) * .35; ctx.fillRect(X(p.t) - 1.5 * dpr, H - padB - h, 3 * dpr, h); });
      }
      // markers
      markers.filter(m => m.t >= t0).forEach(m => {
        const x = X(m.t); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.textAlign = 'left'; ctx.fillText('📍 ' + m.label, x + 4 * dpr, padT + 10 * dpr);
      });
      const line = vis.filter(p => p.avg != null);
      const attLine = vis.filter(p => p.att != null);
      // smooth catmull-rom path through [x, y] points
      const curve = P => {
        const path = new Path2D(); path.moveTo(...P[0]);
        for (let i = 0; i < P.length - 1; i++) {
          const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
          path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
        }
        return path;
      };
      if (line.length > 1) {
        const P = line.map(p => [X(p.t), Y(p.avg)]);
        const path = curve(P);
        const grad = ctx.createLinearGradient(0, Y(100), 0, Y(0));
        [100, 75, 50, 25, 0].forEach((v, i) => grad.addColorStop(i / 4, CP.moodColor(v)));
        const fill = new Path2D(path); fill.lineTo(P[P.length - 1][0], H - padB); fill.lineTo(P[0][0], H - padB); fill.closePath();
        const fg = ctx.createLinearGradient(0, padT, 0, H - padB); fg.addColorStop(0, 'rgba(124,92,255,.35)'); fg.addColorStop(1, 'rgba(124,92,255,0)');
        ctx.fillStyle = fg; ctx.fill(fill);
        ctx.save(); ctx.shadowColor = 'rgba(255,92,168,.7)'; ctx.shadowBlur = 16 * dpr; ctx.strokeStyle = grad; ctx.lineWidth = 3 * dpr; ctx.lineJoin = 'round'; ctx.stroke(path); ctx.restore();
      }
      // attention index: dashed teal line with a soft glow (only when passive data exists)
      if (attLine.length > 1) {
        const A = attLine.map(p => [X(p.t), Y(p.att)]);
        const apath = curve(A);
        ctx.save(); ctx.setLineDash([7 * dpr, 5 * dpr]); ctx.lineDashOffset = -anim * 6 * dpr; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(46,230,214,.75)'; ctx.shadowBlur = 10 * dpr; ctx.strokeStyle = 'rgba(46,230,214,.92)'; ctx.lineWidth = 2.2 * dpr; ctx.stroke(apath);
        ctx.restore();
        const la = A[A.length - 1];
        ctx.fillStyle = 'rgba(46,230,214,.25)'; ctx.beginPath(); ctx.arc(la[0], la[1], 7 * dpr, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#2ee6d6'; ctx.beginPath(); ctx.arc(la[0], la[1], 3.5 * dpr, 0, 6.28); ctx.fill();
        // legend
        ctx.save(); ctx.font = `600 ${10 * dpr}px Inter, sans-serif`; ctx.textAlign = 'left';
        const lw = 18 * dpr, gap = 6 * dpr, tMood = ctx.measureText('Mood').width, tAtt = ctx.measureText('Attention').width;
        const total = lw + gap + tMood + 14 * dpr + lw + gap + tAtt; let lx = W - 10 * dpr - total; const ly = padT + 2 * dpr;
        ctx.fillStyle = 'rgba(14,10,43,.6)'; ctx.fillRect(lx - 8 * dpr, ly - 8 * dpr, total + 16 * dpr, 16 * dpr);
        ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = '#ff5ca8'; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + lw, ly); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('Mood', lx + lw + gap, ly + 3.5 * dpr); lx += lw + gap + tMood + 14 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = '#2ee6d6'; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + lw, ly); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText('Attention', lx + lw + gap, ly + 3.5 * dpr);
        ctx.restore();
      }
      if (line.length > 1) {
        const P = [X(line[line.length - 1].t), Y(line[line.length - 1].avg)];
        // live head dot
        anim += 0.06; const pr = (6 + Math.sin(anim) * 3) * dpr;
        ctx.fillStyle = CP.moodColor(line[line.length - 1].avg, .3); ctx.beginPath(); ctx.arc(P[0], P[1], pr * 2, 0, 6.28); ctx.fill();
        ctx.fillStyle = CP.moodColor(line[line.length - 1].avg); ctx.beginPath(); ctx.arc(P[0], P[1], 5 * dpr, 0, 6.28); ctx.fill();
      } else if (attLine.length > 1) anim += 0.06;
      const hoverSet = line.length > 1 ? line : attLine.length > 1 ? attLine : null;
      if (hoverSet) {
        // hover crosshair
        if (hover != null) {
          const near = hoverSet.reduce((a, p) => (Math.abs(X(p.t) - hover) < Math.abs(X(a.t) - hover) ? p : a), hoverSet[0]);
          const x = X(near.t);
          ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
          if (near.avg != null) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, Y(near.avg), 4 * dpr, 0, 6.28); ctx.fill(); }
          if (near.att != null) { ctx.fillStyle = '#2ee6d6'; ctx.beginPath(); ctx.arc(x, Y(near.att), 4 * dpr, 0, 6.28); ctx.fill(); }
          const parts = [];
          if (near.avg != null) parts.push(`${Math.round(near.avg)} ${CP.mood(near.avg).emoji}`);
          if (near.att != null) parts.push(`👁️ ${Math.round(near.att)} attention`);
          parts.push(`${near.online ?? '?'} online`, start ? CP.fmtClock(near.t - start) : CP.fmtTime(near.t));
          const label = parts.join('  ·  ');
          ctx.font = `600 ${11 * dpr}px Inter, sans-serif`; const tw = ctx.measureText(label).width + 16 * dpr;
          const bx = Math.min(W - tw - 4, Math.max(padL, x - tw / 2)), by = attLine.length > 1 ? padT + 16 * dpr : padT;
          ctx.fillStyle = 'rgba(14,10,43,.92)'; ctx.fillRect(bx, by, tw, 22 * dpr); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 8 * dpr, by + 15 * dpr);
        }
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.textAlign = 'center'; ctx.font = `${13 * dpr}px Inter, sans-serif`;
        ctx.fillText('The pulse line appears once ratings start flowing ✨', W / 2, H / 2);
      }
      // x-axis labels
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.textAlign = 'center'; ctx.font = `${10 * dpr}px Inter, sans-serif`;
      for (let i = 0; i <= 4; i++) { const t = t0 + (i / 4) * (t1 - t0); ctx.fillText(start ? CP.fmtClock(t - start) : CP.fmtTime(t), X(t), H - 6 * dpr); }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    return {
      set(list) { pts = list.slice(); }, push(p) { pts.push(p); if (pts.length > 4000) pts.shift(); },
      live(p) { // smooth "now" point between 5s samples
        if (!pts.length || p.t - pts[pts.length - 1].t > 5000) return;
        const last = pts[pts.length - 1]; if (last.ephemeral) Object.assign(last, p); else pts.push({ ...p, ephemeral: true });
      },
      commit(p) { if (pts.length && pts[pts.length - 1].ephemeral) pts.pop(); pts.push(p); },
      markers(m) { markers = m.slice(); }, addMarker(m) { markers.push(m); }, setStart(t) { start = t; }, setWindow(w) { windowMs = w; },
    };
  };

  // ---------- 5-bucket mood distribution bars ----------
  CP.distBars = host => {
    const faces = ['😫', '😕', '😐', '🙂', '🤩'];
    host.innerHTML = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end;height:100%">${faces.map((f, i) => `
      <div style="display:grid;grid-template-rows:auto 1fr auto;height:100%;gap:6px;text-align:center">
        <div class="db-n muted" style="font-size:.8rem;font-weight:700">0</div>
        <div style="display:flex;align-items:flex-end;justify-content:center"><div class="db-bar" style="width:100%;max-width:56px;height:4%;border-radius:10px 10px 4px 4px;background:linear-gradient(to top, ${CP.moodColor(i * 25, .35)}, ${CP.moodColor(i * 25)});transition:height .8s cubic-bezier(.2,1.2,.4,1);box-shadow:0 0 22px -4px ${CP.moodColor(i * 25)}"></div></div>
        <div style="font-size:1.4rem">${f}</div>
      </div>`).join('')}</div>`;
    const bars = CP.$$('.db-bar', host), ns = CP.$$('.db-n', host);
    return { set(d) { const tot = Math.max(1, d.reduce((a, b) => a + b, 0)); d.forEach((v, i) => { bars[i].style.height = Math.max(4, (v / tot) * 100) + '%'; ns[i].textContent = v; }); } };
  };

  // ---------- render helpers ----------
  CP.renderMsg = (m, myPid, adminTools = false) => {
    const cls = m.role === 'system' ? 'system' : m.role === 'presenter' ? 'presenter' : m.pid === myPid ? 'mine' : '';
    const el = CP.h(`<div class="msg ${cls}" data-id="${m.id}" style="--c:${CP.esc(m.color)}">
      <div class="av">${CP.esc(m.avatar)}</div>
      <div style="min-width:0">
        <div class="who">${CP.esc(m.name)} ${m.role === 'presenter' ? '<span class="badge">HOST</span>' : ''}<time>${CP.fmtTime(m.t)}</time>
        ${adminTools && m.role !== 'system' ? `<span class="tools"><button data-act="pin" title="Pin">📌</button><button data-act="del" title="Delete">🗑️</button></span>` : ''}</div>
        <div class="bubble">${linkify(CP.esc(m.text))}</div>
      </div></div>`);
    return el;
  };
  function linkify(s) { return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }

  // Shown to the host when attendee cameras are on but the join link is plain http (phones block the camera there).
  // Returns an element, or null when the link is already https (always the case on the published site).
  CP.httpsHint = joinUrl => {
    if (!/^http:/i.test(joinUrl || '')) return null;
    return CP.h(`<div class="https-hint"><span>📷</span><div><b>Phones can only use their cameras on an https link</b>, and this join link is plain http.
      Run the session from the published https site (for example on GitHub Pages) so attendees can share attention with their camera.</div></div>`);
  };

  CP.locationText = loc => {
    if (!loc) return '';
    const parts = [];
    if (loc.mode !== 'virtual' && (loc.venue || loc.address)) parts.push('📍 ' + [loc.venue, loc.address].filter(Boolean).map(CP.esc).join(', '));
    const safeUrl = /^https?:\/\//i.test(loc.url || '') ? loc.url : '';
    if (loc.mode !== 'in-person') parts.push(safeUrl ? `💻 <a href="${CP.esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Join online</a>` : '💻 Virtual');
    return parts.join(' &nbsp;·&nbsp; ');
  };

  CP.brand = `<a class="brand" href="./"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg></span>CrowdPulse</a>`;

  // reveal-on-scroll
  CP.reveal = () => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    CP.$$('.reveal').forEach(el => io.observe(el));
  };
})();
