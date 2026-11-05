// Room sensor: the presenter's laptop watches and listens to the room, on this device only.
//
// What leaves this laptop, every 2 seconds, is one small object of counts and levels:
//   { faces, looking, attention, laughter, applause, level }
// No frames, no audio, no landmarks. Face analysis runs locally with MediaPipe Face Landmarker;
// laughter and applause are rough estimates from loudness patterns (Web Audio AnalyserNode).
(function () {
  const MP_VERSION = '0.10.14';
  const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
  const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const SEND_MS = 2000, FACE_MS = 333, AUDIO_MS = 50;
  const YAW_MAX = 28, PITCH_MAX = 24; // degrees from facing the camera that still count as "looking forward"

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const ema = (prev, v, a) => (prev == null ? v : prev + (v - prev) * a);

  let landmarkerPromise = null; // the model is loaded once per page and reused across Start/Stop
  function loadLandmarker() {
    if (landmarkerPromise) return landmarkerPromise;
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(MP_BUNDLE);
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
      const opts = d => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 30, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false });
      try { return await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch { return await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; }); // allow a retry after a failure
    return landmarkerPromise;
  }

  // Head yaw/pitch in degrees from MediaPipe's 4x4 facial transformation matrix (column-major)
  function headPose(matrix) {
    const m = matrix?.data || matrix; if (!m || m.length < 16) return null;
    const r20 = m[2], r21 = m[6], r22 = m[10];
    const yaw = Math.asin(clamp(-r20, -1, 1)) * 180 / Math.PI;
    const pitch = Math.atan2(r21, r22) * 180 / Math.PI;
    return { yaw, pitch };
  }

  // ---------- microphone heuristics ----------
  // level:    RMS loudness, mapped from about -60..0 dBFS to 0..100
  // applause: sustained broadband energy with a noise-like (flat) spectrum
  // laughter: bursty energy in the voice band, modulated at roughly 3-7 Hz ("ha-ha-ha")
  function audioAnalyser(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.2;
    src.connect(an);
    const time = new Float32Array(an.fftSize), freq = new Float32Array(an.frequencyBinCount);
    const binHz = ac.sampleRate / an.fftSize;
    const bin = hz => Math.max(1, Math.min(freq.length - 1, Math.round(hz / binHz)));
    const bBroadLo = bin(300), bBroadHi = bin(8000), bVoiceLo = bin(250), bVoiceHi = bin(3000);
    const env = [], flat = [], loud = []; const HIST = 40; // 2 s at 20 Hz
    let floor = -60, level = null, laughter = null, applause = null;
    const tick = () => {
      an.getFloatTimeDomainData(time); an.getFloatFrequencyData(freq);
      let sq = 0; for (let i = 0; i < time.length; i++) sq += time[i] * time[i];
      const rms = Math.sqrt(sq / time.length), db = 20 * Math.log10(rms + 1e-9);
      // slow-rising, fast-falling noise floor so the heuristics adapt to the room's ambient sound
      floor = db < floor ? db : floor + 0.01;
      // spectral flatness over the broadband range (geometric / arithmetic mean of power)
      let logSum = 0, linSum = 0, voice = 0, total = 0;
      for (let i = bBroadLo; i <= bBroadHi; i++) { const pw = Math.pow(10, freq[i] / 10); logSum += Math.log(pw + 1e-20); linSum += pw; }
      for (let i = 1; i < freq.length; i++) { const pw = Math.pow(10, freq[i] / 10); total += pw; if (i >= bVoiceLo && i <= bVoiceHi) voice += pw; }
      const n = bBroadHi - bBroadLo + 1, sf = Math.exp(logSum / n) / ((linSum / n) + 1e-20);
      const above = db - floor; // dB above ambient
      env.push(Math.max(0, above) * (total ? voice / total : 0)); flat.push(sf); loud.push(above);
      if (env.length > HIST) { env.shift(); flat.shift(); loud.shift(); }
      level = ema(level, clamp(((db + 60) / 60) * 100), 0.3);
      if (env.length < HIST) return;
      // applause: most of the last 2 s loud (>12 dB over ambient), spectrally flat, and steady rather than bursty
      const loudFrac = loud.filter(v => v > 12).length / HIST;
      const meanFlat = flat.reduce((a, b) => a + b, 0) / HIST;
      const lm = loud.reduce((a, b) => a + b, 0) / HIST, lsd = Math.sqrt(loud.reduce((a, b) => a + (b - lm) * (b - lm), 0) / HIST);
      const steady = clamp(1 - lsd / Math.max(1, lm), 0, 1);
      const clapNow = clamp(loudFrac * clamp((meanFlat - 0.15) / 0.35, 0, 1) * (0.5 + 0.5 * steady) * 140);
      // laughter: envelope autocorrelation peak at 3-7 Hz lags (3..7 samples at 20 Hz), gated by voice-band loudness and burstiness
      const em = env.reduce((a, b) => a + b, 0) / HIST, d = env.map(v => v - em);
      const var0 = d.reduce((a, b) => a + b * b, 0) + 1e-9;
      let mod = 0; for (let lag = 3; lag <= 7; lag++) { let c = 0; for (let i = lag; i < HIST; i++) c += d[i] * d[i - lag]; mod = Math.max(mod, c / var0); }
      const bursty = clamp(Math.sqrt(var0 / HIST) / Math.max(1, em), 0, 1.5);
      const voiceLoud = clamp((em - 4) / 12, 0, 1);
      const laughNow = clamp(clamp(mod, 0, 1) * voiceLoud * bursty * (1 - 0.6 * clamp((meanFlat - 0.3) / 0.3, 0, 1)) * 220);
      applause = ema(applause, clapNow, 0.25); laughter = ema(laughter, laughNow, 0.25);
    };
    const iv = setInterval(tick, AUDIO_MS);
    return {
      read: () => ({ level: level == null ? null : Math.round(level), laughter: laughter == null ? 0 : Math.round(laughter), applause: applause == null ? 0 : Math.round(applause) }),
      resume: () => ac.state === 'suspended' && ac.resume().catch(() => {}),
      stop: () => { clearInterval(iv); try { src.disconnect(); } catch { /* ignore */ } ac.close().catch(() => {}); },
    };
  }

  CP.roomSensor = (card, { send }) => {
    const { $, esc } = CP;
    let ev = null, running = false, starting = false, visible = false, gen = 0;
    let camStream = null, micStream = null, audio = null, faceTimer = null, sendTimer = null, uiTimer = null;
    let face = { faces: null, looking: null, attention: null }, lastSent = null, lastSentAt = 0;
    const want = { cam: true, mic: true, preview: false };

    card.innerHTML = `
      <div class="card-title"><h3>🎙️ Room sensor</h3><span class="onair" id="rsAir">OFF AIR</span></div>
      <div class="consent">
        <b>Before you start, tell the room.</b>
        <ul>
          <li>Nothing is recorded or uploaded. Video and sound are analysed on this laptop only.</li>
          <li>Only counts and levels leave it: faces, how many look forward, laughter, applause and loudness.</li>
          <li>Check local rules first. Emotion recognition is restricted in EU workplaces and education (AI Act).</li>
        </ul>
      </div>
      <div class="rs-opts">
        <label class="switch"><input type="checkbox" id="rsCam" checked><span class="track"></span>📷 Camera</label>
        <label class="switch"><input type="checkbox" id="rsMic" checked><span class="track"></span>🎤 Microphone</label>
        <label class="switch"><input type="checkbox" id="rsPrev"><span class="track"></span>👀 Preview</label>
      </div>
      <button class="btn sm good" id="rsBtn" style="width:100%">▶ Start room sensor</button>
      <div id="rsMsgs"></div>
      <div class="rs-preview offscreen" id="rsPrevBox"><video id="rsVideo" muted playsinline autoplay></video><span class="lbl">🔒 Preview stays on this laptop</span></div>
      <div id="rsLive" class="hidden">
        <div class="mrow"><div class="l"><span>Faces · looking forward</span><b id="rsFacesV">—</b></div><div class="meter"><i id="rsFaces"></i></div></div>
        <div class="mrow"><div class="l"><span>Laughter <span class="dim">(estimate)</span></span><b id="rsLaughV">—</b></div><div class="meter"><i id="rsLaugh" style="--mc:linear-gradient(90deg,#7c5cff,#ff5ca8);--mg:rgba(255,92,168,.6)"></i></div></div>
        <div class="mrow"><div class="l"><span>Applause <span class="dim">(estimate)</span></span><b id="rsClapV">—</b></div><div class="meter"><i id="rsClap" style="--mc:linear-gradient(90deg,#19c98b,#2ee6d6);--mg:rgba(46,230,166,.6)"></i></div></div>
        <div class="mrow"><div class="l"><span>Sound level</span><b id="rsLevelV">—</b></div><div class="meter"><i id="rsLevel" style="--mc:linear-gradient(90deg,#2ee6d6,#ffb547);--mg:rgba(255,181,71,.5)"></i></div></div>
        <div class="ps-note" id="rsSentAt">Exactly what is sent:</div>
        <div class="rs-payload mono" id="rsPayload">—</div>
      </div>`;
    const video = $('#rsVideo', card), btn = $('#rsBtn', card);
    $('#rsCam', card).onchange = e => { want.cam = e.target.checked; };
    $('#rsMic', card).onchange = e => { want.mic = e.target.checked; };
    $('#rsPrev', card).onchange = e => { want.preview = e.target.checked; paintPreview(); };
    btn.onclick = () => (running || starting ? stop() : start());

    const msgs = $('#rsMsgs', card);
    const note = (text, cls = '') => { msgs.insertAdjacentHTML('beforeend', `<div class="rs-msg ${cls}">${text}</div>`); };
    const clearNotes = () => { msgs.innerHTML = ''; };
    const paintPreview = () => $('#rsPrevBox', card).classList.toggle('offscreen', !(want.preview && camStream));
    const isLive = () => ev?.status === 'live';

    function paintButton() {
      btn.textContent = starting ? '⏳ Starting…' : running ? '⏹ Stop room sensor' : '▶ Start room sensor';
      btn.className = 'btn sm ' + (running || starting ? 'danger' : 'good');
      ['#rsCam', '#rsMic'].forEach(s => { $(s, card).disabled = running || starting; });
      const air = $('#rsAir', card);
      air.className = 'onair' + (running ? (isLive() ? ' on' : ' wait') : '');
      air.textContent = running ? (isLive() ? 'ON AIR' : 'READY · NOT LIVE') : 'OFF AIR';
      air.title = running ? (isLive() ? 'Sending counts and levels every 2 seconds' : 'Sending starts when the session goes live') : 'Not sending anything';
      $('#rsLive', card).classList.toggle('hidden', !running);
    }

    function friendly(err, what) {
      const n = err?.name || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') return `${what} permission was denied. Allow it in the browser's site settings to use it.`;
      if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${what.toLowerCase()} found on this laptop.`;
      if (n === 'NotReadableError') return `The ${what.toLowerCase()} is busy in another app (a video call?).`;
      return `${what} could not start${err?.message ? ': ' + esc(err.message) : ''}.`;
    }

    async function start() {
      clearNotes(); const my = ++gen;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        note('Camera and microphone need a secure page. Open the control room on this laptop at <b>http://localhost</b> or through an <b>https</b> address.', 'bad');
        return;
      }
      if (!want.cam && !want.mic) { note('Switch on the camera, the microphone or both.', 'warn'); return; }
      starting = true; paintButton();
      // if Stop is pressed while a permission prompt is open, release whatever arrives afterwards
      const keep = s => { if (starting) return s; s.getTracks().forEach(t => t.stop()); return null; };
      if (want.cam) {
        try {
          camStream = keep(await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false }));
          if (camStream) { video.srcObject = camStream; await video.play().catch(() => {}); }
        } catch (e) { camStream = null; if (starting) note(friendly(e, 'Camera'), 'warn'); }
      }
      if (want.mic && starting) {
        try {
          micStream = keep(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }));
          if (micStream) { audio = audioAnalyser(micStream); audio.resume(); }
        } catch (e) { micStream = null; audio = null; if (starting) note(friendly(e, 'Microphone'), 'warn'); }
      }
      if (!starting) { teardown(); return; } // stopped while waiting for permission
      if (!camStream && !audio) { starting = false; teardown(); paintButton(); note('Nothing to run: neither the camera nor the microphone is available.', 'bad'); return; }
      starting = false; running = true; paintPreview(); paintButton();
      if (camStream) {
        note('⏳ Loading the face model (runs on this laptop)…');
        const loading = msgs.lastElementChild;
        try {
          const lm = await loadLandmarker();
          loading?.remove();
          if (my !== gen) return;
          if (running && camStream) runFaces(lm);
        } catch (e) {
          loading?.remove();
          if (my !== gen) return;
          note(`The face model could not load${e?.message ? ' (' + esc(e.message) + ')' : ''}. ${audio ? 'Carrying on with the microphone only.' : 'Check the internet connection and try again.'}`, 'warn');
          camStream.getTracks().forEach(t => t.stop()); camStream = null; video.srcObject = null; paintPreview();
          if (!audio) { stop(); return; }
        }
      }
      sendTimer = setInterval(sendNow, SEND_MS);
      uiTimer = setInterval(paintLive, 250);
      paintLive();
    }

    function runFaces(lm) {
      let lastTs = 0, smooth = null;
      faceTimer = setInterval(() => {
        if (!running || video.readyState < 2 || !video.videoWidth) return;
        let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
        let res;
        try { res = lm.detectForVideo(video, ts); } catch (e) { console.warn('Room sensor: face analysis failed', e); return; }
        const n = res?.faceLandmarks?.length || 0;
        let looking = 0;
        (res?.facialTransformationMatrixes || []).forEach(m => { const p = headPose(m); if (p && Math.abs(p.yaw) <= YAW_MAX && Math.abs(p.pitch) <= PITCH_MAX) looking++; });
        looking = Math.min(looking, n);
        smooth = n ? ema(smooth, (looking / n) * 100, 0.35) : null;
        face = { faces: n, looking, attention: smooth == null ? null : Math.round(smooth) };
      }, FACE_MS);
    }

    function reading() {
      const a = audio ? audio.read() : null;
      return {
        faces: camStream ? (face.faces ?? 0) : null,
        looking: camStream ? (face.looking ?? 0) : null,
        attention: camStream ? face.attention : null,
        laughter: a ? a.laughter : null,
        applause: a ? a.applause : null,
        level: a ? a.level : null,
      };
    }
    function sendNow() {
      if (!running || !isLive() || !ev?.settings?.passiveRoom) return;
      const r = reading(); send(r); lastSent = r; lastSentAt = Date.now();
    }
    function paintLive() {
      if (!running) return;
      const r = reading();
      const fv = r.faces == null ? 'camera off' : r.faces ? `${r.looking} of ${r.faces}` : 'no faces yet';
      $('#rsFaces', card).style.width = (r.attention ?? 0) + '%'; $('#rsFacesV', card).textContent = fv;
      [['rsLaugh', r.laughter], ['rsClap', r.applause], ['rsLevel', r.level]].forEach(([id, v]) => {
        $('#' + id, card).style.width = (v ?? 0) + '%'; $('#' + id + 'V', card).textContent = v == null ? 'mic off' : v;
      });
      $('#rsSentAt', card).textContent = !isLive() ? 'Nothing is sent until the session is live. It would send:' : lastSent ? `Exactly what was sent ${Math.max(0, Math.round((Date.now() - lastSentAt) / 1000))}s ago:` : 'Exactly what is sent:';
      $('#rsPayload', card).textContent = JSON.stringify(isLive() && lastSent ? lastSent : r);
      paintButton();
    }

    function teardown() {
      clearInterval(faceTimer); clearInterval(sendTimer); clearInterval(uiTimer); faceTimer = sendTimer = uiTimer = null;
      camStream?.getTracks().forEach(t => t.stop()); micStream?.getTracks().forEach(t => t.stop());
      audio?.stop(); camStream = micStream = audio = null; video.srcObject = null;
      face = { faces: null, looking: null, attention: null }; lastSent = null;
    }
    function stop() {
      const was = running || starting; gen++;
      running = starting = false; teardown(); paintPreview(); paintButton();
      return was;
    }

    paintButton();
    return {
      // called whenever the event changes: show only when the host allows it; stop when it ends or is switched off
      sync(e) {
        ev = e;
        const allowed = !!e?.settings?.passiveRoom && e.status !== 'ended';
        if (!allowed && (running || starting)) { stop(); if (e?.status === 'ended') CP.toast('🎙️ Room sensor stopped: the session ended'); else CP.toast('🎙️ Room sensor stopped'); }
        if (allowed !== visible) { visible = allowed; card.classList.toggle('hidden', !allowed); if (allowed) card.style.animation = 'pop .5s cubic-bezier(.2,1.4,.4,1)'; }
        paintButton();
      },
      stop,
    };
  };
})();
