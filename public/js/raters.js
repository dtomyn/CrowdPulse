// Rating widgets. Every widget maps the attendee's input onto a 0–100 scale.
// API: CP.raters[mode].mount(host, initialValue, onChange) -> { set(v) }
(function () {
  const { h } = CP;
  const vibrate = () => { try { navigator.vibrate?.(8); } catch { /* ignore */ } };
  const R = (CP.raters = {});

  R.slider = {
    label: 'Slider', icon: '🎚️',
    mount(host, v, on) {
      host.innerHTML = `<div class="rt-slider">
        <div class="rt-big"><span class="rt-face">🙂</span><span class="rt-num">50</span></div>
        <div class="rt-track"><div class="rt-fill"></div><input type="range" min="0" max="100" value="50" aria-label="Rating"></div>
        <div class="rt-ends"><span>😫 Not for me</span><span>Loving it 🤩</span></div></div>`;
      const inp = host.querySelector('input'), fill = host.querySelector('.rt-fill'), face = host.querySelector('.rt-face'), num = host.querySelector('.rt-num');
      const paint = x => {
        fill.style.width = x + '%'; num.textContent = x; num.style.color = CP.moodColor(x);
        const e = CP.mood(x).emoji; if (face.textContent !== e) { face.textContent = e; face.classList.remove('pop'); void face.offsetWidth; face.classList.add('pop'); }
        host.style.setProperty('--mc', CP.moodColor(x));
      };
      let last = null;
      inp.addEventListener('input', () => { const x = +inp.value; paint(x); if (Math.floor(x / 10) !== last) { last = Math.floor(x / 10); vibrate(); } on(x); });
      const set = x => { inp.value = x ?? 50; paint(x ?? 50); };
      set(v); return { set };
    },
  };

  R.smiley = {
    label: 'Smileys', icon: '😊',
    mount(host, v, on) {
      const faces = [['😫', 'Awful'], ['😕', 'Meh'], ['😐', 'Okay'], ['🙂', 'Good'], ['🤩', 'Amazing']];
      host.innerHTML = `<div class="rt-faces">${faces.map((f, i) => `<button class="rt-facebtn" data-v="${i * 25}" style="--mc:${CP.moodColor(i * 25)}"><span>${f[0]}</span><small>${f[1]}</small></button>`).join('')}</div>`;
      const btns = [...host.querySelectorAll('button')];
      const set = x => btns.forEach(b => b.classList.toggle('on', x != null && Math.abs(+b.dataset.v - x) < 13));
      btns.forEach(b => b.onclick = () => { set(+b.dataset.v); vibrate(); on(+b.dataset.v); burst(b, b.querySelector('span').textContent); });
      set(v); return { set };
    },
  };

  R.stars = {
    label: 'Stars', icon: '⭐',
    mount(host, v, on) {
      host.innerHTML = `<div class="rt-stars">${[1, 2, 3, 4, 5].map(i => `<button data-s="${i}" aria-label="${i} stars"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg></button>`).join('')}</div><div class="rt-caption"></div>`;
      const btns = [...host.querySelectorAll('button')], cap = host.querySelector('.rt-caption');
      const words = ['', 'Not great', 'Could be better', 'Pretty good', 'Really good', 'Outstanding!'];
      const set = x => {
        const s = x == null ? 0 : Math.round(x / 25) + 1;
        btns.forEach((b, i) => { b.classList.toggle('on', i < s); b.style.transitionDelay = i * 40 + 'ms'; });
        cap.textContent = words[s] || 'Tap to rate';
      };
      btns.forEach(b => {
        b.onclick = () => { const s = +b.dataset.s, x = (s - 1) * 25; set(x); vibrate(); on(x); if (s === 5) burst(b, '✨', 8); };
        b.onmouseenter = () => btns.forEach((o, i) => o.classList.toggle('hov', i < +b.dataset.s));
        b.onmouseleave = () => btns.forEach(o => o.classList.remove('hov'));
      });
      set(v); return { set };
    },
  };

  R.dial = {
    label: 'Dial', icon: '🎛️',
    mount(host, v, on) {
      const ticks = Array.from({ length: 28 }, (_, i) => {
        const a = (-135 + (i / 27) * 270) * Math.PI / 180;
        return `<line x1="${100 + 88 * Math.sin(a)}" y1="${100 - 88 * Math.cos(a)}" x2="${100 + 80 * Math.sin(a)}" y2="${100 - 80 * Math.cos(a)}" stroke="${CP.moodColor((i / 27) * 100)}" stroke-width="3" stroke-linecap="round" class="dt" data-i="${i}"/>`;
      }).join('');
      host.innerHTML = `<div class="rt-dial"><svg viewBox="0 0 200 200">${ticks}
        <circle cx="100" cy="100" r="66" fill="url(#knobg)" stroke="rgba(255,255,255,.18)"/>
        <defs><radialGradient id="knobg" cx=".35" cy=".3"><stop offset="0" stop-color="#3a3270"/><stop offset="1" stop-color="#120d33"/></radialGradient></defs>
        <g class="knob"><circle cx="100" cy="46" r="7" fill="white"/></g></svg>
        <div class="rt-dial-read"><span class="rt-face">😐</span><b class="rt-num">50</b></div></div><div class="rt-caption">Drag the knob around</div>`;
      const svg = host.querySelector('svg'), knob = host.querySelector('.knob'), num = host.querySelector('.rt-num'), face = host.querySelector('.rt-face');
      const tks = [...host.querySelectorAll('.dt')];
      knob.style.transformOrigin = '100px 100px';
      let cur = v ?? 50, dragging = false, lastTick = -1;
      const paint = x => {
        knob.style.transform = `rotate(${-135 + x * 2.7}deg)`; num.textContent = Math.round(x); num.style.color = CP.moodColor(x); face.textContent = CP.mood(x).emoji;
        const n = Math.round((x / 100) * 27); tks.forEach((t, i) => t.style.opacity = i <= n ? 1 : .15);
        if (n !== lastTick) { lastTick = n; if (dragging) vibrate(); }
      };
      const fromEvent = e => {
        const r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let a = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI; // -180..180, 0 at top
        a = Math.max(-135, Math.min(135, a)); return Math.round(((a + 135) / 270) * 100);
      };
      svg.addEventListener('pointerdown', e => { dragging = true; svg.setPointerCapture(e.pointerId); cur = fromEvent(e); paint(cur); on(cur); });
      svg.addEventListener('pointermove', e => { if (!dragging) return; const x = fromEvent(e); if (Math.abs(x - cur) > 60) return; cur = x; paint(cur); on(cur); });
      svg.addEventListener('pointerup', () => (dragging = false));
      svg.addEventListener('wheel', e => { e.preventDefault(); cur = Math.max(0, Math.min(100, cur - Math.sign(e.deltaY) * 4)); paint(cur); on(cur); }, { passive: false });
      paint(cur); return { set: x => { cur = x ?? 50; paint(cur); } };
    },
  };

  R.weather = {
    label: 'Weather', icon: '🌤️',
    mount(host, v, on) {
      const w = [['⛈️', 'Stormy'], ['🌧️', 'Drizzly'], ['⛅', 'Cloudy'], ['🌤️', 'Bright'], ['☀️', 'Sunshine']];
      host.innerHTML = `<div class="rt-weather"><div class="rt-sky"><span class="rt-wx">⛅</span><div class="rt-wx-l">How's the weather in your head?</div></div>
        <div class="rt-wrow">${w.map((x, i) => `<button data-v="${i * 25}"><span>${x[0]}</span><small>${x[1]}</small></button>`).join('')}</div></div>`;
      const sky = host.querySelector('.rt-sky'), wx = host.querySelector('.rt-wx'), lbl = host.querySelector('.rt-wx-l');
      const btns = [...host.querySelectorAll('button')];
      const skies = ['linear-gradient(180deg,#1b1d3a,#3a2b55)', 'linear-gradient(180deg,#2b3a5a,#47587a)', 'linear-gradient(180deg,#4a6b8f,#8aa3c0)', 'linear-gradient(180deg,#3fa0e8,#a6d8ff)', 'linear-gradient(180deg,#ffb347,#ffdd77)'];
      const set = x => {
        if (x == null) return; const i = Math.round(x / 25);
        btns.forEach((b, j) => b.classList.toggle('on', j === i)); sky.style.background = skies[i]; wx.textContent = w[i][0]; lbl.textContent = w[i][1];
        wx.classList.remove('pop'); void wx.offsetWidth; wx.classList.add('pop');
        sky.classList.toggle('rain', i <= 1);
      };
      btns.forEach(b => b.onclick = () => { set(+b.dataset.v); vibrate(); on(+b.dataset.v); });
      set(v); return { set };
    },
  };

  R.thermo = {
    label: 'Thermo', icon: '🌡️',
    mount(host, v, on) {
      host.innerHTML = `<div class="rt-thermo"><div class="rt-tube"><div class="rt-merc"></div><div class="rt-bulb"></div></div>
        <div class="rt-tlabels"><span>🔥 On fire</span><span>😎 Warm</span><span>😐 Tepid</span><span>🥶 Chilly</span><span>🧊 Ice cold</span></div>
        <div class="rt-tread"><b class="rt-num">50</b><small>°hype</small></div></div><div class="rt-caption">Drag up or down</div>`;
      const tube = host.querySelector('.rt-tube'), merc = host.querySelector('.rt-merc'), bulb = host.querySelector('.rt-bulb'), num = host.querySelector('.rt-num');
      let cur = v ?? 50, drag = false, lastB = -1;
      const paint = x => {
        merc.style.height = x + '%'; const c = CP.moodColor(x); merc.style.background = `linear-gradient(to top, ${c}, ${CP.moodColor(Math.min(100, x + 20))})`; bulb.style.background = c;
        bulb.style.boxShadow = `0 0 30px ${c}`; num.textContent = Math.round(x); num.style.color = c;
        const b = Math.floor(x / 10); if (b !== lastB) { lastB = b; if (drag) vibrate(); }
      };
      const fromE = e => { const r = tube.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / (r.height - 30)) * 100))); };
      tube.addEventListener('pointerdown', e => { drag = true; tube.setPointerCapture(e.pointerId); cur = fromE(e); paint(cur); on(cur); });
      tube.addEventListener('pointermove', e => { if (drag) { cur = fromE(e); paint(cur); on(cur); } });
      tube.addEventListener('pointerup', () => (drag = false));
      paint(cur); return { set: x => { cur = x ?? 50; paint(cur); } };
    },
  };

  R.thumbs = {
    label: 'Thumbs', icon: '👍',
    mount(host, v, on) {
      host.innerHTML = `<div class="rt-thumbs"><button class="down" aria-label="Thumbs down">👎</button>
        <div class="rt-meter"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10"/><circle class="ring" cx="60" cy="60" r="50" fill="none" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="50 100" transform="rotate(-90 60 60)"/></svg><b class="rt-num">50</b></div>
        <button class="up" aria-label="Thumbs up">👍</button></div><div class="rt-caption">Tap repeatedly to nudge your rating</div>`;
      const ring = host.querySelector('.ring'), num = host.querySelector('.rt-num');
      let cur = v ?? 50;
      const paint = x => { ring.setAttribute('stroke-dasharray', `${x} 100`); ring.style.stroke = CP.moodColor(x); num.textContent = Math.round(x); num.style.color = CP.moodColor(x); };
      const nudge = (d, b) => { cur = Math.max(0, Math.min(100, cur + d)); paint(cur); vibrate(); on(cur); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); burst(b, b.textContent, 3); };
      host.querySelector('.up').onclick = e => nudge(10, e.currentTarget);
      host.querySelector('.down').onclick = e => nudge(-10, e.currentTarget);
      paint(cur); return { set: x => { cur = x ?? 50; paint(cur); } };
    },
  };

  R.emoji = {
    label: 'Vibes', icon: '🔮',
    mount(host, v, on) {
      const vibes = [['😴', 'Snoozing'], ['🤨', 'Skeptical'], ['🤔', 'Thinking'], ['😃', 'Into it'], ['🔥', 'On fire']];
      host.innerHTML = `<div class="rt-orbit"><div class="rt-core"><span>🔮</span><small>Pick a vibe</small></div>
        ${vibes.map((x, i) => { const a = (-90 + i * 72) * Math.PI / 180; return `<button data-v="${i * 25}" style="left:calc(50% + ${Math.cos(a) * 38}% - 32px);top:calc(50% + ${Math.sin(a) * 38}% - 32px);--mc:${CP.moodColor(i * 25)}" title="${x[1]}">${x[0]}</button>`; }).join('')}</div>`;
      const btns = [...host.querySelectorAll('button')], core = host.querySelector('.rt-core');
      const set = x => {
        if (x == null) return; const i = Math.round(x / 25);
        btns.forEach((b, j) => b.classList.toggle('on', j === i)); core.innerHTML = `<span>${vibes[i][0]}</span><small>${vibes[i][1]}</small>`;
        core.style.boxShadow = `0 0 60px -6px ${CP.moodColor(x)}`; core.classList.remove('pop'); void core.offsetWidth; core.classList.add('pop');
      };
      btns.forEach(b => b.onclick = () => { set(+b.dataset.v); vibrate(); on(+b.dataset.v); burst(b, b.textContent, 5); });
      set(v); return { set };
    },
  };

  // Tilt the phone left/right to rate (the 2015 app's "Use Gyroscope"). Tilting only changes the rating after the
  // attendee taps Start, and Hold freezes it, so a phone put down on the table doesn't keep re-rating.
  // Devices without motion sensors (laptops) fall back to dragging the bubble.
  const TILT_RANGE = 35; // degrees either side of level for 0 and 100
  const tiltState = { active: false, granted: false }; // survives re-mounts (the page re-renders on every event update)
  R.tilt = {
    label: 'Tilt', icon: '📱',
    mount(host, v, on) {
      host.innerHTML = `<div class="rt-tilt">
        <div class="rt-big"><span class="rt-face">🙂</span><span class="rt-num">50</span></div>
        <div class="rt-level"><div class="rt-level-mid"></div><div class="rt-bubble"></div></div>
        <div class="rt-ends"><span>⬅️ 😫 Not for me</span><span>Loving it 🤩 ➡️</span></div>
        <div class="rt-tilt-ctl"><button type="button" class="btn primary rt-tilt-go">📱 Start tilting</button></div></div>
        <div class="rt-caption">Tap Start, then tilt your phone left or right</div>`;
      const root = host.firstElementChild, bubble = host.querySelector('.rt-bubble'), level = host.querySelector('.rt-level');
      const num = host.querySelector('.rt-num'), face = host.querySelector('.rt-face'), go = host.querySelector('.rt-tilt-go'), cap = host.querySelector('.rt-caption');
      let cur = v ?? 50, smooth = null, lastB = -1, sawMotion = false, waitT = null;
      const paint = x => {
        bubble.style.left = `calc(24px + (100% - 48px) * ${x / 100})`; // keeps the whole bubble inside the tube
        num.textContent = Math.round(x); num.style.color = CP.moodColor(x);
        bubble.style.background = CP.moodColor(x); bubble.style.boxShadow = `0 0 26px ${CP.moodColor(x)}`;
        const e = CP.mood(x).emoji; if (face.textContent !== e) { face.textContent = e; face.classList.remove('pop'); void face.offsetWidth; face.classList.add('pop'); }
        const b = Math.floor(x / 10); if (b !== lastB) { lastB = b; if (tiltState.active) vibrate(); }
      };
      const commit = x => { x = Math.round(Math.max(0, Math.min(100, x))); if (x === Math.round(cur)) return; cur = x; paint(cur); on(cur); };

      // left/right tilt in the screen's frame, whichever way the phone is turned
      const sideTilt = e => {
        const a = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
        if (a === 90) return e.beta; if (a === 270 || a === -90) return -e.beta; if (a === 180) return -e.gamma;
        return e.gamma;
      };
      function onTilt(e) {
        if (!root.isConnected) return stopListening(); // widget was replaced: clean up
        if (e.gamma == null || e.beta == null) return;
        sawMotion = true;
        const deg = sideTilt(e);
        smooth = smooth == null ? deg : smooth + (deg - smooth) * 0.25; // low-pass: steadies a shaky hand
        commit(50 + (Math.max(-TILT_RANGE, Math.min(TILT_RANGE, smooth)) / TILT_RANGE) * 50);
      }
      function stopListening() { window.removeEventListener('deviceorientation', onTilt); clearTimeout(waitT); }
      const ui = () => {
        root.classList.toggle('on', tiltState.active);
        go.textContent = tiltState.active ? '✋ Hold this rating' : '📱 Start tilting';
        go.classList.toggle('primary', !tiltState.active);
        cap.textContent = tiltState.active ? 'Tilt left or right · tap Hold to keep your rating' : 'Tap Start, then tilt your phone left or right';
      };
      function noSensor(msg) {
        tiltState.active = false; stopListening(); ui();
        go.disabled = true; go.textContent = '📵 No tilt sensor'; cap.textContent = msg;
      }
      async function start() {
        if (typeof DeviceOrientationEvent === 'undefined') return noSensor('This device has no motion sensor. Drag the bubble instead.');
        if (!tiltState.granted && typeof DeviceOrientationEvent.requestPermission === 'function') { // iOS asks first
          try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return noSensor('Motion access was declined. Drag the bubble instead, or allow Motion & Orientation for this site.'); }
          catch { return noSensor("Motion access isn't available here (iPhones need an https link). Drag the bubble instead."); }
        }
        tiltState.granted = true; tiltState.active = true; smooth = null; ui();
        window.addEventListener('deviceorientation', onTilt);
        clearTimeout(waitT);
        waitT = setTimeout(() => { if (!sawMotion && root.isConnected) noSensor("No tilt readings from this device. Drag the bubble instead."); }, 1500);
      }
      go.onclick = () => { if (tiltState.active) { tiltState.active = false; stopListening(); ui(); vibrate(); } else start(); };

      // drag fallback (and a quick way to nudge while holding)
      let drag = false;
      const fromE = e => { const r = level.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; };
      level.addEventListener('pointerdown', e => { if (tiltState.active) return; drag = true; level.setPointerCapture(e.pointerId); commit(fromE(e)); });
      level.addEventListener('pointermove', e => { if (drag) commit(fromE(e)); });
      level.addEventListener('pointerup', () => (drag = false));

      paint(cur); ui();
      if (tiltState.active) start(); // resume after a re-render
      return { set: x => { cur = x ?? 50; paint(cur); } };
    },
  };

  // little particle burst out of an element
  function burst(el, emoji, n = 6) {
    const r = el.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.textContent = emoji;
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 50;
      Object.assign(s.style, { position: 'fixed', left: r.left + r.width / 2 + 'px', top: r.top + r.height / 2 + 'px', fontSize: '1.1rem', pointerEvents: 'none', zIndex: 400, transition: 'transform .7s cubic-bezier(.2,.8,.2,1), opacity .7s', transform: 'translate(-50%,-50%)' });
      document.body.appendChild(s);
      requestAnimationFrame(() => { s.style.transform = `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.6)`; s.style.opacity = 0; });
      setTimeout(() => s.remove(), 750);
    }
  }
  CP.burst = burst;
})();
