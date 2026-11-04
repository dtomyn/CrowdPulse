// Injected into every frame of the film's browser before any page script (Playwright init script).
// Gives each window virtual time (Date, performance.now, timers, requestAnimationFrame, CSS animations)
// driven by the director, a seeded Math.random, and routes socket.io to the director's in-page server.
(() => {
  let topWin;
  try { topWin = window.top; void topWin.location.href; } catch { return; }
  const isTop = window === topWin;
  if (isTop && !location.pathname.startsWith('/studio')) return;
  if (!isTop && !topWin.__clock) return;

  const realDate = Date;
  const clock = isTop ? (window.__clock = { now: realDate.UTC(2026, 10, 4, 20, 57, 30), origin: 0 }) : topWin.__clock;
  if (isTop) clock.origin = clock.now;

  // ---- Date / performance ----
  class FilmDate extends realDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  window.Date = FilmDate;
  const realPerf = performance.now.bind(performance);
  const perfNow = () => clock.now - clock.origin + 1000;
  try { Object.defineProperty(performance, 'now', { value: perfNow, configurable: true }); } catch { /* ignore */ }

  // ---- seeded random (stable per page) ----
  let seed = 0;
  for (const c of location.pathname + (window.name || '')) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  seed ||= 7;
  Math.random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---- timers & animation frames ----
  const real = { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window), now: realPerf };
  const timers = new Map(), rafs = new Map();
  let seq = 1;
  window.setTimeout = (fn, ms = 0, ...args) => { const id = seq++; timers.set(id, { at: clock.now + Math.max(0, +ms || 0), fn, args }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = seq++; const every = Math.max(4, +ms || 0); timers.set(id, { at: clock.now + every, fn, args, every }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = cb => { const id = seq++; rafs.set(id, cb); return id; };
  window.cancelAnimationFrame = id => rafs.delete(id);

  const call = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : 0; } catch (e) { console.error(e); } };

  function advance(ms) {
    // timers due by now, earliest first (bounded so a runaway interval can't hang the frame)
    for (let guard = 0; guard < 500; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= clock.now && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      if (t.every) t.at += t.every; else timers.delete(id);
      call(t.fn, t.args);
    }
    // animation frames
    const list = [...rafs.values()]; rafs.clear();
    const ts = perfNow();
    list.forEach(cb => call(cb, [ts]));
    // CSS animations and transitions run on the film clock
    try {
      for (const a of document.getAnimations()) {
        if (!a.__film) { a.__film = 1; a.pause(); a.currentTime = 0; continue; }
        if (a.playState === 'finished') continue;
        const end = a.effect?.getComputedTiming().endTime;
        const next = (a.currentTime || 0) + ms;
        if (Number.isFinite(end) && next >= end) { a.currentTime = end; a.play(); a.finish(); }
        else a.currentTime = next;
      }
    } catch { /* ignore */ }
  }
  window.__film = { advance, real, isTop, token: Math.random().toString(36).slice(2) + realDate.now() };

  // ---- deterministic, instant scrolling ----
  const strip = o => (o && typeof o === 'object' ? { ...o, behavior: 'instant' } : o);
  const sTo = Element.prototype.scrollTo, sIV = Element.prototype.scrollIntoView, wTo = window.scrollTo.bind(window);
  Element.prototype.scrollTo = function (...a) { return sTo.apply(this, a.length === 1 ? [strip(a[0])] : a); };
  Element.prototype.scrollIntoView = function (o) { return sIV.call(this, typeof o === 'object' ? strip(o) : o); };
  window.scrollTo = (...a) => wTo(...(a.length === 1 ? [strip(a[0])] : a));
  const style = document.createElement('style');
  style.textContent = 'html { scroll-behavior: auto !important; } ::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; caret-color: transparent; }';
  const addStyle = () => { if (style.isConnected) return true; const root = document.head || document.documentElement; if (root) { root.appendChild(style); return true; } return false; };
  if (!addStyle()) document.addEventListener('DOMContentLoaded', addStyle, { once: true });
  document.addEventListener('readystatechange', addStyle);

  // synthetic pointer events can't be captured; don't let that abort the widget code
  const cap = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) { try { cap.call(this, id); } catch { /* ignore */ } };
  window.confirm = () => true;
  window.alert = () => {};
  try { navigator.vibrate = () => true; } catch { /* ignore */ }

  if (isTop) return;

  // ---- socket.io goes to the director's in-page server ----
  const fakeIo = () => topWin.__server.connect(window);
  Object.defineProperty(window, 'io', { get: () => fakeIo, set: () => {}, configurable: false });

  // ---- a few API calls are answered by the director ----
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    const answer = topWin.__studio?.fetch(String(url), opts);
    if (answer !== undefined) return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    return realFetch(url, opts);
  };
})();
