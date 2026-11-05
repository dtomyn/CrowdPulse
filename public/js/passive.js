// Passive signals on the attendee's own device.
//
//   Tab focus   how much of each ~5 s window this tab was visible and focused, plus a count of interactions
//               (taps, keys, scrolls). Sent while the session is live, if the host left settings.passiveTab on.
//   Camera      opt-in only, and only when the host allows it (settings.passiveCamera). Face analysis runs here
//               in the browser (MediaPipe Face Landmarker). Only three numbers ever leave the device:
//               attention, positive and fatigue (0-100). No frame, image or audio is sent or stored anywhere.
//
// Exposes CP.passive.init({ socket, code, onShowPanel }) -> controller used by event.js.
(function () {
  const CP = window.CP;
  const { $, esc, h } = CP;

  const MP_VER = '0.10.14';
  const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
  const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const MIN_CROWD = 5;
  const SEND_MS = 5000;      // one report every ~5 s
  const SAMPLE_MS = 500;     // tab visibility sampling
  const ANALYZE_MS = 150;    // ~6-7 face analyses per second, not every frame

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const ramp = (v, a, b) => (v <= a ? 1 : v >= b ? 0 : 1 - (v - a) / (b - a)); // 1 below a, 0 above b
  const ema = (prev, x, dt, tau) => (prev == null ? x : prev + (x - prev) * (1 - Math.exp(-dt / tau)));
  const DEG = 180 / Math.PI;

  // ---------- tab focus + interaction tracker ----------
  function tabTracker() {
    let on = false, timer = null, visMs = 0, totalMs = 0, act = 0, last = 0, lastScroll = 0;
    let focused = document.hasFocus();
    const visibleNow = () => document.visibilityState === 'visible' && focused;
    // time-weighted, so browser timer throttling in hidden tabs doesn't skew the fraction
    const tick = () => { const now = performance.now(); if (last) { const dt = now - last; totalMs += dt; if (visibleNow()) visMs += dt; } last = now; };
    const onAct = e => {
      if (e.type === 'wheel' || e.type === 'scroll') { const n = performance.now(); if (n - lastScroll < 300) return; lastScroll = n; }
      act++;
    };
    const onFocus = () => { tick(); focused = true; };
    const onBlur = () => { tick(); focused = false; };
    const onVis = () => tick();
    const EVTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    return {
      start() {
        if (on) return; on = true; visMs = totalMs = act = 0; last = performance.now(); focused = document.hasFocus();
        EVTS.forEach(t => document.addEventListener(t, onAct, { capture: true, passive: true }));
        window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onVis);
        timer = setInterval(tick, SAMPLE_MS);
      },
      stop() {
        if (!on) return; on = false; clearInterval(timer);
        EVTS.forEach(t => document.removeEventListener(t, onAct, { capture: true }));
        window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVis);
      },
      take() {
        tick();
        const vis = totalMs > 0 ? Math.round((visMs / totalMs) * 100) / 100 : (visibleNow() ? 1 : 0);
        const out = { vis, act: Math.min(1000, act) };
        visMs = totalMs = act = 0;
        return out;
      },
      get running() { return on; },
      visibleNow,
    };
  }

  // ---------- camera: support checks and friendly errors ----------
  const ERRORS = {
    insecure: ['🔒 The camera needs a secure link', "Browsers only allow the camera on https pages or on localhost. If you joined on a phone over plain http on the Wi-Fi, the camera can't be used on this page. Everything else still works, and you can ask the host for an https link."],
    unsupported: ['📷 Camera not available', "This browser doesn't let web pages use a camera. Everything else still works."],
    denied: ['🚫 Camera permission blocked', "That's completely fine. If you change your mind, allow the camera for this site (usually via the icon in the address bar or your browser settings) and try again."],
    nocam: ['📷 No camera found', "We couldn't find a camera on this device. Everything else still works."],
    busy: ['📷 Camera is busy', 'Another app or tab may be using it. Close that and try again.'],
    model: ['🧩 The analyzer could not load', "The on-device face analyzer couldn't be downloaded (it needs an internet connection the first time). Your camera has been switched off."],
    interrupted: ['📷 The camera stopped', 'Your device or browser switched the camera off. You can turn it back on anytime.'],
    failed: ['📷 Something went wrong', 'The camera or analyzer stopped unexpectedly, so it has been switched off. You can try again.'],
  };
  const camErr = (code, cause) => Object.assign(new Error(code), { code, cause });
  function cameraSupport() {
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
    return null;
  }
  function mapGumError(e) {
    const n = e?.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'nocam';
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
    return 'failed';
  }

  // The landmarker is loaded once per page and kept for quick restarts
  let mpPromise = null;
  function loadLandmarker() {
    if (!mpPromise) {
      mpPromise = (async () => {
        const vision = await import(MP_BUNDLE);
        const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
        const opts = delegate => ({
          baseOptions: { modelAssetPath: MP_MODEL, delegate },
          runningMode: 'VIDEO', outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true, numFaces: 1,
        });
        try { return await vision.FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
        catch (e) { console.warn('[passive] GPU delegate unavailable, using CPU', e); return await vision.FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
      })();
      mpPromise.catch(() => { mpPromise = null; }); // allow a retry later
    }
    return mpPromise;
  }

  // ---------- camera: on-device face analysis ----------
  function faceCamera({ onUpdate, onError }) {
    let stream = null, video = null, timer = null, landmarker = null, running = false, gen = 0, lastTs = 0, errs = 0, calls = 0, costAvg = null;
    let R, F; // smoothed readings, fatigue state
    const reset = () => {
      R = { att: null, pos: null, fat: null, face: false, paused: false, ready: false, samples: 0, t: 0 };
      F = { hist: [], blinks: [], longCloses: [], yawns: [], closeStart: 0, yawnStart: 0, yawnCounted: false, since: performance.now() };
    };
    reset();

    function stopTracks() {
      stream?.getTracks().forEach(t => { try { t.stop(); } catch { /* */ } });
      stream = null;
      if (video) { try { video.pause(); } catch { /* */ } video.srcObject = null; video.remove(); video = null; }
    }

    function analyse(res, now) {
      const dt = R.t ? Math.min(2, (now - R.t) / 1000) : ANALYZE_MS / 1000; R.t = now;
      const cats = res?.faceBlendshapes?.[0]?.categories;
      R.samples++;
      if (!res?.faceLandmarks?.length || !cats) {
        // nobody in view: attention drifts down, expression readings hold
        R.face = false; R.att = ema(R.att, 0, dt, 2.5);
        F.closeStart = 0; F.yawnStart = 0;
      } else {
        R.face = true;
        const b = {}; for (const c of cats) b[c.categoryName] = c.score;
        // head pose from the facial transformation matrix (4x4, column-major)
        let yaw = 0, pitch = 0;
        const m = res.facialTransformationMatrixes?.[0]?.data;
        if (m && m.length >= 16) {
          pitch = Math.atan2(m[6], m[10]) * DEG;
          yaw = Math.atan2(-m[2], Math.hypot(m[6], m[10])) * DEG;
          if (pitch > 90) pitch -= 180; else if (pitch < -90) pitch += 180;
        }
        const blink = ((b.eyeBlinkLeft || 0) + (b.eyeBlinkRight || 0)) / 2;
        const smile = ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2;
        const squint = ((b.cheekSquintLeft || 0) + (b.cheekSquintRight || 0)) / 2;
        const jaw = b.jawOpen || 0;
        // eyes turned sideways (both eyes looking the same way)
        const gazeSide = Math.max(((b.eyeLookOutLeft || 0) + (b.eyeLookInRight || 0)) / 2, ((b.eyeLookOutRight || 0) + (b.eyeLookInLeft || 0)) / 2);

        // attention: present, head roughly facing the screen, eyes open and not turned away
        const facing = ramp(Math.abs(yaw), 18, 42) * ramp(Math.abs(pitch), 20, 40);
        const attRaw = 100 * facing * ramp(gazeSide, 0.45, 0.8) * (blink < 0.55 ? 1 : 0);
        R.att = ema(R.att, attRaw, dt, 3);

        // positive: smiling
        const posRaw = 100 * clamp((smile - 0.06) / 0.5 + squint * 0.15);
        R.pos = ema(R.pos, posRaw, dt, 3);

        // fatigue: share of time the eyes are closed, long eye closures, blink rate and yawns
        const closed = blink > 0.55;
        F.hist.push({ t: now, closed });
        while (F.hist.length && now - F.hist[0].t > 30000) F.hist.shift();
        if (closed) { if (!F.closeStart) F.closeStart = now; }
        else if (F.closeStart) { const d = now - F.closeStart; F.blinks.push(now); if (d > 450) F.longCloses.push(now); F.closeStart = 0; }
        if (jaw > 0.5) {
          if (!F.yawnStart) F.yawnStart = now;
          else if (!F.yawnCounted && now - F.yawnStart > 1500) { F.yawns.push(now); F.yawnCounted = true; }
        } else { F.yawnStart = 0; F.yawnCounted = false; }
        F.blinks = F.blinks.filter(t => now - t < 60000);
        F.longCloses = F.longCloses.filter(t => now - t < 60000);
        F.yawns = F.yawns.filter(t => now - t < 120000);
        const perclos = F.hist.filter(x => x.closed).length / Math.max(1, F.hist.length);
        const minutes = Math.min(1, (now - F.since) / 60000);
        const blinkRate = minutes > 0.2 ? F.blinks.length / minutes : 0;
        const fatRaw = 100 * clamp(Math.max(0, perclos - 0.04) / 0.25 * 0.6 + F.yawns.length * 0.3 + F.longCloses.length * 0.08 + Math.max(0, blinkRate - 28) * 0.01);
        R.fat = ema(R.fat, fatRaw, dt, 5);
      }
      if (!R.ready && R.samples >= 6) R.ready = true;
      onUpdate?.(view());
    }

    const view = () => ({
      att: R.att, pos: R.pos ?? 0, fat: R.fat ?? 0, face: R.face, paused: R.paused, ready: R.ready && R.att != null,
    });

    function loop() {
      if (!running) return;
      let cost = 0;
      const hidden = document.visibilityState !== 'visible';
      if (hidden !== R.paused) { R.paused = hidden; R.t = 0; onUpdate?.(view()); }
      if (!hidden && video && video.readyState >= 2 && video.videoWidth) {
        const t0 = performance.now();
        const ts = Math.max(t0, lastTs + 1); lastTs = ts;
        try { analyse(landmarker.detectForVideo(video, ts), t0); errs = 0; }
        catch (e) { if (++errs > 15) { console.error('[passive] analysis failed', e); fail('failed'); return; } }
        cost = performance.now() - t0;
        // the first call includes one-off warm-up (shader compile), so it doesn't count toward the pace
        if (calls++ > 0) costAvg = costAvg == null ? cost : costAvg * 0.8 + cost * 0.2;
      }
      // ~6-7 analyses per second, backing off on slow devices (never slower than 1 per second)
      timer = setTimeout(loop, hidden ? 500 : Math.min(1000, Math.max(ANALYZE_MS, (costAvg || 0) * 1.5)));
    }

    function fail(code) { const was = running || stream; stop(); if (was) onError?.(code); }

    async function start() {
      const my = ++gen;
      const sup = cameraSupport(); if (sup) throw camErr(sup);
      const modelP = loadLandmarker(); modelP.catch(() => { /* handled below */ });
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } } });
      } catch (e) {
        const code = mapGumError(e);
        if (code === 'denied') throw camErr(code, e);
        console.warn('[passive] camera with preferred settings failed, retrying plainly:', e?.name, e?.message);
        try { s = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
        catch (e2) { console.warn('[passive] camera unavailable:', e2?.name, e2?.message); throw camErr(mapGumError(e2), e2); }
      }
      if (my !== gen) { s.getTracks().forEach(t => t.stop()); throw camErr('cancelled'); }
      stream = s;
      // a hidden, never-uploaded video element feeds the analyzer
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
      video.className = 'pv-feed'; video.srcObject = stream; document.body.appendChild(video);
      try { await video.play(); } catch { /* autoplay of a muted local stream should be allowed; analysis waits for frames */ }
      stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (my === gen) fail('interrupted'); }));
      try { landmarker = await modelP; }
      catch (e) { console.warn('[passive] model load failed', e); if (my === gen) stop(); throw camErr('model', e); }
      if (my !== gen) throw camErr('cancelled');
      reset(); running = true; lastTs = 0; errs = 0; calls = 0; costAvg = null; loop();
    }

    function stop() {
      gen++; running = false; clearTimeout(timer); timer = null; stopTracks(); reset();
    }

    return { start, stop, view, get stream() { return stream; }, get running() { return running; } };
  }

  // ---------- controller + UI ----------
  function init({ socket, code, onShowPanel }) {
    const memKey = 'cp.passiveCam.' + code;
    const tracker = tabTracker();
    let ev = null, sendTimer = null, slot = null, crowdHost = null, lastCrowd = null;
    const S = {
      cam: 'off',            // off | starting | on | error
      error: null, readings: null, lastSent: null, lastSentAt: 0,
      remembered: !!CP.store.get(memKey, false), preview: CP.store.get('cp.pvPreview', true),
      allowed: false, tabOn: true, live: false, room: false,
    };

    const cam = faceCamera({
      onUpdate: r => { const pausedChanged = (S.readings?.paused) !== r.paused; S.readings = r; paintLive(); if (pausedChanged) paintChip(); },
      onError: code => { S.cam = 'error'; S.error = code; S.readings = null; socket.emit('passive-off'); CP.toast(ERRORS[code]?.[0] || '📷 Camera stopped'); refresh(); },
    });

    // ----- sending -----
    function payload() {
      const p = {};
      if (S.tabOn) Object.assign(p, tracker.take());
      const r = S.readings;
      p.cam = S.cam === 'on' && S.allowed && r?.ready && !r.paused
        ? { att: Math.round(r.att), pos: Math.round(r.pos), fat: Math.round(r.fat) } : null;
      return p;
    }
    function send() {
      if (!S.live) return;
      const p = payload();
      if (!S.tabOn && !p.cam) return;
      socket.emit('passive', p);
      S.lastSent = p; S.lastSentAt = Date.now(); paintLive();
    }
    function syncSending() {
      if (S.live && S.tabOn) tracker.start(); else tracker.stop();
      const want = S.live && (S.tabOn || S.cam === 'on');
      if (want && !sendTimer) sendTimer = setInterval(send, SEND_MS);
      if (!want && sendTimer) { clearInterval(sendTimer); sendTimer = null; }
    }

    // ----- camera on/off -----
    async function startCamera() {
      if (!S.allowed || S.cam === 'on' || S.cam === 'starting') return;
      S.cam = 'starting'; S.error = null; refresh();
      try {
        await cam.start();
        if (!S.allowed) { cam.stop(); S.cam = 'off'; refresh(); return; }
        S.cam = 'on'; S.remembered = true; CP.store.set(memKey, true);
        CP.toast('📷 Sharing attention. Only 3 numbers leave your device');
      } catch (e) {
        if (e.code === 'cancelled') return;
        S.cam = 'error'; S.error = e.code || 'failed';
        if (e.code === 'denied') { S.remembered = false; CP.store.set(memKey, false); }
      }
      refresh();
    }
    function stopCamera({ reason, forget = false } = {}) {
      const was = S.cam;
      cam.stop(); S.cam = 'off'; S.readings = null;
      if (was === 'on' || was === 'starting') socket.emit('passive-off');
      if (forget) { S.remembered = false; CP.store.set(memKey, false); }
      if (reason && (was === 'on' || was === 'starting')) CP.toast(reason, 3600);
      refresh();
    }
    addEventListener('pagehide', () => { if (S.cam === 'on') socket.emit('passive-off'); });

    // ----- live settings / status -----
    function update(e) {
      ev = e; const s = e.settings || {};
      S.live = e.status === 'live';
      S.tabOn = s.passiveTab !== false;
      S.room = !!s.passiveRoom;
      S.allowed = !!s.passiveCamera && e.status !== 'ended';
      if (!S.allowed && (S.cam === 'on' || S.cam === 'starting')) {
        stopCamera({ reason: e.status === 'ended' ? '📷 The session ended, so your camera was switched off' : '📷 The host turned off attention sharing, so your camera was switched off' });
      }
      if (!S.allowed && S.cam === 'error') { S.cam = 'off'; S.error = null; }
      if (e.status === 'ended') tracker.stop();
      refresh();
    }
    function refresh() { syncSending(); paintChip(); paintSlot(); }

    // ----- top-bar chip -----
    function paintChip() {
      const host = $('#pvChip'); if (!host) return;
      if (S.cam !== 'on' && S.cam !== 'starting') { host.innerHTML = ''; return; }
      const paused = S.readings?.paused;
      const label = S.cam === 'starting' ? 'Starting…' : paused ? 'Camera paused' : 'Camera on';
      host.innerHTML = `<span class="pv-chip ${S.cam === 'starting' ? 'starting' : ''} ${paused ? 'paused' : ''}">
        <button class="pv-chip-main" title="Show what is being shared"><i class="pv-dot"></i><span aria-hidden="true">📷</span><span class="lbl">${label}</span></button>
        <button class="pv-chip-stop" title="Stop the camera" aria-label="Stop the camera">Stop</button></span>`;
      host.querySelector('.pv-chip-main').onclick = () => { onShowPanel?.(); setTimeout(() => $('#pvCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); };
      host.querySelector('.pv-chip-stop').onclick = () => stopCamera({ forget: true, reason: '📷 Camera off. Nothing more is being shared from it' });
    }

    // ----- the card in the main column -----
    function mount(col) {
      slot = h('<div class="pv-slot"></div>'); col.appendChild(slot); paintSlot();
    }
    function paintSlot() {
      if (!slot || !document.body.contains(slot)) return;
      slot.innerHTML = '';
      if (!S.allowed) return;
      const el = S.cam === 'on' ? panelCard() : offerCard();
      slot.appendChild(el);
    }

    function offerCard() {
      const err = S.cam === 'error' && S.error ? ERRORS[S.error] || ERRORS.failed : null;
      const starting = S.cam === 'starting';
      const el = h(`<section class="card pv-offer" id="pvCard">
        <div class="pv-offer-row">
          <span class="pv-ic">${starting ? '<span class="pv-spin"></span>' : '📷'}</span>
          <div class="pv-offer-t">
            <b>${starting ? 'Starting your camera…' : S.remembered ? 'Share attention again?' : 'Share attention'} ${starting ? '' : '<span class="dim">(optional)</span>'}</b>
            <small>${starting ? 'Loading the on-device analyzer. Nothing is sent yet.' : 'Analysed on your device · only 3 numbers are sent · off by default'}</small>
          </div>
          ${starting ? '<button class="btn sm ghost" data-act="cancel">Cancel</button>'
            : S.remembered ? '<button class="btn sm" data-act="info">Details</button><button class="btn sm primary" data-act="start">Turn on</button>'
            : '<button class="btn sm" data-act="info">Learn more</button>'}
        </div>
        ${err ? `<div class="pv-err"><b>${esc(err[0])}</b><span>${esc(err[1])}</span></div>` : ''}
      </section>`);
      el.querySelector('[data-act=info]')?.addEventListener('click', consentSheet);
      el.querySelector('[data-act=start]')?.addEventListener('click', startCamera);
      el.querySelector('[data-act=cancel]')?.addEventListener('click', () => stopCamera());
      return el;
    }

    function panelCard() {
      const el = h(`<section class="card pv-panel" id="pvCard">
        <div class="card-title"><h3>📷 Sharing attention</h3><span class="eyebrow">${S.live ? 'Every 5 s' : 'Starts when live'}</span></div>
        <div class="pv-body ${S.preview ? '' : 'no-video'}">
          <figure class="pv-video-wrap">
            <video class="pv-video" muted playsinline autoplay></video>
            <figcaption>🔒 Stays on your device</figcaption>
            <span class="pv-face" id="pvFace">Looking for your face…</span>
          </figure>
          <div class="pv-meters">
            ${meter('att', '👁️', 'Attention')}${meter('pos', '😊', 'Positive')}${meter('fat', '🥱', 'Fatigue')}
          </div>
        </div>
        <div class="pv-sent"><span class="dim" id="pvSentLbl">${S.live ? 'Waiting for the first report…' : 'Nothing is sent until the session goes live.'}</span><code id="pvSent"></code></div>
        <div class="row pv-actions">
          <button class="btn sm ghost" data-act="preview">${S.preview ? '🙈 Hide video' : '👀 Show video'}</button>
          <button class="btn sm ghost" data-act="info">ⓘ What's shared</button>
          <span class="spacer"></span>
          <button class="btn sm danger" data-act="stop">Stop camera</button>
        </div>
      </section>`);
      const v = el.querySelector('video');
      if (S.preview && cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
      el.querySelector('[data-act=preview]').onclick = () => { S.preview = !S.preview; CP.store.set('cp.pvPreview', S.preview); paintSlot(); };
      el.querySelector('[data-act=info]').onclick = infoSheet;
      el.querySelector('[data-act=stop]').onclick = () => stopCamera({ forget: true, reason: '📷 Camera off. Nothing more is being shared from it' });
      requestAnimationFrame(paintLive);
      return el;
    }
    const meter = (k, ic, label) => `<div class="pv-meter" data-k="${k}"><span class="pv-ml">${ic} ${label}</span><div class="pv-bar"><i></i></div><b>–</b></div>`;

    function paintLive() {
      const card = $('#pvCard.pv-panel');
      if (card) {
        const r = S.readings;
        for (const k of ['att', 'pos', 'fat']) {
          const m = card.querySelector(`.pv-meter[data-k=${k}]`); if (!m) continue;
          const v = r?.ready ? Math.round(r[k]) : null;
          m.querySelector('b').textContent = v == null ? '–' : v;
          m.querySelector('i').style.width = (v ?? 0) + '%';
        }
        const face = card.querySelector('#pvFace');
        if (face) {
          face.textContent = r?.paused ? '⏸ Paused while this tab is hidden' : !r?.ready ? 'Warming up…' : r.face ? '✓ Face found' : 'Looking for your face…';
          face.classList.toggle('ok', !!(r?.face && !r.paused));
        }
        const lbl = card.querySelector('#pvSentLbl'), code = card.querySelector('#pvSent');
        if (S.lastSent && S.live) {
          lbl.textContent = `Last sent at ${new Date(S.lastSentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}, exactly:`;
          code.textContent = JSON.stringify(S.lastSent);
        } else if (!S.live) { lbl.textContent = 'Nothing is sent until the session goes live.'; code.textContent = ''; }
      }
      const info = $('#pvInfoSent');
      if (info) info.textContent = S.lastSent && S.live ? JSON.stringify(S.lastSent) : 'Nothing sent yet';
    }

    // ----- consent sheet -----
    function consentSheet() {
      const unsupported = cameraSupport();
      const why = unsupported ? ERRORS[unsupported] : null;
      const m = h(`<div class="modal-back pv-sheet-back"><div class="modal card glow pv-sheet" role="dialog" aria-modal="true" aria-labelledby="pvConsentT">
        <div class="eyebrow">Optional · off by default</div>
        <h2 id="pvConsentT" style="margin:6px 0 6px">Share your attention, privately</h2>
        <p class="muted" style="margin:0 0 14px;font-size:.92rem">Help ${esc(ev?.presenter || 'the presenter')} see how the room is following along, without pressing anything.</p>
        ${why ? `<div class="pv-err" style="margin:0 0 14px"><b>${esc(why[0])}</b><span>${esc(why[1])}</span></div>` : ''}
        <ul class="pv-points">
          <li><span>👁️</span><div><b>What is measured</b>Whether a face is in view and roughly facing the screen with eyes open (attention), smiling (positive), and yawning or heavy eyelids (fatigue).</div></li>
          <li><span>🔒</span><div><b>Analysed on this device</b>Your camera picture is processed right here in your browser. No video, photo or sound is ever uploaded or stored.</div></li>
          <li><span>📤</span><div><b>Only three numbers are sent</b>Attention, positive and fatigue, each 0 to 100, about every 5 seconds while the session is live. You can watch them as they go.</div></li>
          <li><span>👥</span><div><b>Crowd figures only</b>Figures appear only once ${MIN_CROWD} or more people share, as a room average. Nobody is shown your numbers on their own.</div></li>
          <li><span>⏹️</span><div><b>Stop anytime</b>Use the Stop button on the camera chip at the top. It's off unless you turn it on, and it never starts by itself.</div></li>
        </ul>
        <p class="dim" style="font-size:.78rem;margin:12px 0 0">The face analyzer (a few MB) is downloaded once from a public CDN (jsDelivr and Google). Nothing about you is sent with that download.</p>
        <div class="row" style="margin-top:18px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn ghost" data-act="no">Not now</button>
          <button class="btn primary" data-act="yes" ${why ? 'disabled' : ''}>📷 Turn on camera</button>
        </div></div></div>`);
      const close = () => { m.remove(); document.removeEventListener('keydown', esc_); };
      const esc_ = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc_);
      m.addEventListener('click', e => { if (e.target === m) close(); });
      m.querySelector('[data-act=no]').onclick = close;
      m.querySelector('[data-act=yes]').onclick = () => { close(); startCamera(); };
      document.body.appendChild(m);
    }

    // ----- "What does this page share?" -----
    function infoSheet() {
      const s = ev?.settings || {};
      const camState = !s.passiveCamera ? 'Not used in this session' : S.cam === 'on' ? 'On, because you turned it on' : 'Off (you can opt in)';
      const m = h(`<div class="modal-back pv-sheet-back"><div class="modal card glow pv-sheet" role="dialog" aria-modal="true" aria-labelledby="pvInfoT">
        <div class="eyebrow">Privacy</div>
        <h2 id="pvInfoT" style="margin:6px 0 14px">What does this page share?</h2>
        <ul class="pv-points">
          <li><span>🙋</span><div><b>What you choose to send</b>Your display name and avatar, your ratings, reactions, chat messages, questions, poll votes and feedback.</div></li>
          <li><span>🪟</span><div><b>Tab focus <em class="pv-tag ${S.tabOn ? 'on' : ''}">${S.tabOn ? 'On in this session' : 'Off in this session'}</em></b>While the session is live, about every 5 seconds: how much of that time this tab was open and in front (0 to 1), and how many taps, key presses or scrolls happened (just a count, never what you typed or where). The host can turn this off.</div></li>
          <li><span>📷</span><div><b>Camera <em class="pv-tag ${S.cam === 'on' ? 'on' : ''}">${camState}</em></b>Only if you opt in: three numbers (attention, positive, fatigue). The picture is analysed on your device and never leaves it.</div></li>
          ${S.room ? `<li><span>🎤</span><div><b>Room sensing</b>The presenter's own device may count faces looking forward and listen for laughter and applause. It reports room-wide figures, not individuals.</div></li>` : ''}
          <li><span>👥</span><div><b>Crowd figures only</b>Attention figures appear only once ${MIN_CROWD}+ people contribute, as an average for the room.</div></li>
          <li><span>🚫</span><div><b>Never shared</b>Video, photos, audio, your other tabs or apps, or anything you type outside this page.</div></li>
        </ul>
        <div class="pv-sent" style="margin-top:14px"><span class="dim">Last report from this page:</span><code id="pvInfoSent">Nothing sent yet</code></div>
        <div class="row" style="margin-top:16px;justify-content:flex-end;flex-wrap:wrap">
          ${s.passiveCamera && S.cam !== 'on' && ev?.status !== 'ended' ? '<button class="btn" data-act="cam">📷 Share attention…</button>' : ''}
          <button class="btn primary" data-act="ok">Got it</button>
        </div></div></div>`);
      const close = () => { m.remove(); document.removeEventListener('keydown', esc_); };
      const esc_ = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc_);
      m.addEventListener('click', e => { if (e.target === m) close(); });
      m.querySelector('[data-act=ok]').onclick = close;
      m.querySelector('[data-act=cam]')?.addEventListener('click', () => { close(); consentSheet(); });
      document.body.appendChild(m);
      paintLive();
    }

    // ----- crowd card: room attention -----
    function crowdSlot(host) { crowdHost = host; paintCrowd(lastCrowd); }
    function paintCrowd(p) {
      lastCrowd = p ?? lastCrowd;
      const host = crowdHost; if (!host || !document.body.contains(host)) return;
      const s = ev?.settings || {};
      const any = s.passiveTab !== false || s.passiveCamera || s.passiveRoom;
      if (!any) { host.innerHTML = ''; host.classList.add('hidden'); return; }
      host.classList.remove('hidden');
      const x = lastCrowd || {};
      const min = x.minCrowd || MIN_CROWD;
      let body;
      if (x.index != null) {
        const stats = [
          `<span class="pv-stat main" style="--sc:${CP.moodColor(x.index)}"><b>👁️ ${Math.round(x.index)}</b><small>attention</small></span>`,
          x.focus != null ? `<span class="pv-stat"><b>${Math.round(x.focus)}%</b><small>tab focus</small></span>` : '',
          x.positive != null ? `<span class="pv-stat"><b>😊 ${Math.round(x.positive)}</b><small>positive</small></span>` : '',
          x.fatigue != null ? `<span class="pv-stat"><b>🥱 ${Math.round(x.fatigue)}</b><small>fatigue</small></span>` : '',
          x.room?.laughter != null && x.room.laughter >= 30 ? `<span class="pv-stat"><b>😂</b><small>laughter</small></span>` : '',
          x.room?.applause != null && x.room.applause >= 30 ? `<span class="pv-stat"><b>👏</b><small>applause</small></span>` : '',
        ].join('');
        body = `<div class="pv-stats">${stats}</div>`;
      } else {
        const n = Math.max(x.nTab || 0, x.nCam || 0);
        body = `<div class="pv-wait">👁️ Attention shows once ${min}+ people share${S.live && n ? ` <span class="dim">· ${Math.min(n, min - 1)} of ${min} so far</span>` : ''}</div>`;
      }
      host.innerHTML = `${body}<button class="pv-link" type="button">ⓘ What does this page share?</button>`;
      host.querySelector('.pv-link').onclick = infoSheet;
    }

    return {
      update, mount, crowdSlot, paintCrowd, infoSheet, consentSheet,
      startCamera, stopCamera: () => stopCamera({ forget: true }),
      get state() { return { ...S }; },
    };
  }

  CP.passive = { init, tabTracker, cameraSupport, MIN_CROWD };
})();
