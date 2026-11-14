// Supabase connection: sign-in, database calls, page links, QR codes, and a socket.io-style live connection.
//
// Pages talk to CrowdPulse through CP.connect(), which keeps the shape of the old socket.io client:
//   socket.emit(name, payload, ack)  ->  a database function (supabase/migrations), ack gets its result
//   socket.on(name, fn)              <-  a Realtime broadcast on the session's private channel
// Every visitor gets a Supabase session first: anonymous for attendees, email sign-in for hosts.
(function () {
  const C = window.CP_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) throw new Error('CrowdPulse: js/config.js has no Supabase project');
  // Only the host dashboard (<html data-auth="callback">) is a sign-in landing page. Elsewhere "?code=" is a session
  // code, which Supabase must not mistake for a sign-in callback.
  const sb = supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, flowType: 'implicit', detectSessionInUrl: document.documentElement.dataset.auth === 'callback' },
  });
  CP.sb = sb;

  // ---------- session ----------
  let ready = null;
  CP.ready = () => (ready ||= (async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) { ready = null; throw new Error('Could not connect: ' + error.message); }
    }
    await sb.realtime.setAuth();
  })());

  // Calls a database function. Resolves to its result; a result of { error } is passed back, not thrown.
  CP.call = async (fn, args = {}) => {
    await CP.ready();
    const { data, error } = await sb.rpc(fn, args);
    if (error) return { error: error.message || 'Something went wrong' };
    return data;
  };
  // Same, but throws on any error (for code that uses try/catch).
  CP.rpc = async (fn, args) => {
    const r = await CP.call(fn, args);
    if (r && r.error) throw new Error(r.error);
    return r;
  };

  // ---------- links ----------
  // All pages sit side by side, so links are relative and work under any path (e.g. user.github.io/CrowdPulse/).
  CP.page = (name, params = {}, hash = '') => {
    const u = new URL(name, location.href);
    u.search = ''; u.hash = hash;
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.href;
  };
  CP.joinUrl = code => CP.page('event.html', { code });
  CP.adminUrl = (code, key) => CP.page('control.html', { code }, key ? 'key=' + key : '');
  // what to tell people to type: the site's address without https:// (e.g. "user.github.io/CrowdPulse")
  CP.siteLabel = () => (location.host + location.pathname.replace(/\/[^/]*$/, '')).replace(/\/$/, '');

  // ---------- QR codes (made in the browser) ----------
  CP.qr = (text, { dark = '#0b0820', light = '#ffffff' } = {}) => {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 1, s = n + 2 * m;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">${light === 'none' ? '' : `<rect width="${s}" height="${s}" fill="${light}"/>`}<path d="${d}" fill="${dark}"/></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  CP.qrFor = code => CP.qr(CP.joinUrl(code));

  // ---------- report (Edge Function) ----------
  CP.report = async (code, format = '') => {
    await CP.ready();
    const { data } = await sb.auth.getSession();
    return fetch(`${C.supabaseUrl}/functions/v1/report?code=${encodeURIComponent(code)}${format ? '&format=' + format : ''}`, {
      headers: { Authorization: 'Bearer ' + data.session?.access_token, apikey: C.supabaseKey }, cache: 'no-store',
    });
  };
  CP.downloadCsv = async code => {
    try {
      const r = await CP.report(code, 'csv');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob()); a.download = `crowdpulse-${code}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { CP.toast('⚠️ ' + e.message); }
  };

  // ---------- live connection ----------
  // ticker: 'always' (control room, stage) keeps the live pulse going; 'fallback' (attendees) only steps in
  // when no pulse has arrived for a while, e.g. when the presenter's screens are closed.
  const SNAPSHOT = { join: 'cp_join', watch: 'cp_watch', 'admin-join': 'cp_admin_join' };
  CP.connect = ({ code, ticker = 'none' }) => {
    const handlers = {};
    let queue = [];            // broadcasts that arrive before the page has its first snapshot
    let connected = false, joined = false, status = null, lastPulse = 0, adm = null, timers = [];

    const fire = (name, v) => (handlers[name] || []).slice().forEach(fn => { try { fn(v); } catch (e) { console.error(e); } });
    const deliver = (name, v) => {
      if (name === 'event' && v) status = v.status;
      if (name === 'pulse' && v) {
        lastPulse = Date.now();
        // reactions ride along with the pulse; spread them over the next couple of seconds
        const rs = Array.isArray(v.reacts) ? v.reacts : []; delete v.reacts;
        rs.forEach((r, i) => setTimeout(() => (queue ? queue.push(['reaction', r]) : fire('reaction', r)), i * Math.min(150, 1800 / rs.length)));
      }
      if (queue) queue.push([name, v]); else fire(name, v);
    };
    const flush = () => { const q = queue; queue = null; (q || []).forEach(([n, v]) => fire(n, v)); };
    const listen = (topic, onStatus) => sb.channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, m => deliver(m.event, m.payload?.v))
      .subscribe(onStatus);

    CP.ready().then(() => {
      listen('ev:' + code, (st, err) => {
        if (st === 'SUBSCRIBED') { connected = true; fire('connect'); }
        else if (st === 'CHANNEL_ERROR' && !connected && /permission|unauthori/i.test(err?.message || '')) {
          fire('connect'); // no such session: the page's join call reports it
        } else if (connected && (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED')) {
          connected = false; fire('disconnect');
        }
      });
    }).catch(e => { CP.toast('📡 ' + e.message, 6000); fire('connect'); });

    function started(kind, res) {
      if (res?.event) status = res.event.status;
      if (joined) return; joined = true;
      if (kind === 'join') timers.push(setInterval(() => CP.call('cp_act', { _c: code, _action: 'heartbeat' }), 20000));
      if (kind === 'admin-join' && !adm) adm = listen('adm:' + code, () => {});
      const tick = () => CP.call('cp_tick', { _c: code });
      if (ticker === 'always') { tick(); timers.push(setInterval(tick, 2000)); }
      if (ticker === 'fallback') {
        let wait = 6000 + Math.random() * 4000;
        timers.push(setInterval(() => {
          if ((status === 'live' || status === 'scheduled') && Date.now() - lastPulse > wait) { lastPulse = Date.now(); wait = 6000 + Math.random() * 4000; tick(); }
        }, 2000));
      }
    }

    const socket = {
      get connected() { return connected; },
      on(name, fn) { (handlers[name] ||= []).push(fn); return socket; },
      async emit(name, p, ack) {
        if (typeof p === 'function') { ack = p; p = undefined; }
        let res;
        if (name === 'join') res = await CP.call('cp_join', { _c: code, _p: p || {} });
        else if (name === 'watch') res = await CP.call('cp_watch', { _c: code });
        else if (name === 'admin-join') res = await CP.call('cp_admin_join', { _c: code, _key: p?.key || null });
        else if (name.startsWith('admin:')) res = await CP.call('cp_admin', { _c: code, _action: name.slice(6), _p: p ?? {} });
        else res = await CP.call('cp_act', { _c: code, _action: name, _p: p === undefined ? null : p });
        res ??= { ok: true };
        if (SNAPSHOT[name] && !res.error) started(name, res);
        try { ack?.(res); } finally { if (SNAPSHOT[name]) flush(); }
        return res;
      },
      close() { timers.forEach(clearInterval); sb.removeAllChannels(); },
    };
    return socket;
  };
})();
