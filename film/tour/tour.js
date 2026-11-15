// CrowdPulse code tour: the director. The left of the set is a VS Code style editor showing the real source files;
// the right is the real app, running in iframes on the film clock against film/tour/fakesupa.js. Every database call
// and broadcast the app makes is traced, and those traces move the editor's execution pointer, so the code on the
// left lights up when (and because) the app on the right runs it. The scene list is at the bottom.
// Rendered by film/render_tour.py.
(function () {
  const W = 1600, H = 900;
  const $ = s => document.querySelector(s);
  const clock = window.__clock;
  const errors = [];
  const D = (window.Director = {});
  const S = window.__server;

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
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ============================================================
  // Syntax colours (VS Code Dark+), from three small tokenizers
  // ============================================================
  const JS_CT = new Set('if else for while do return await try catch finally throw switch case break continue default import export from yield'.split(' '));
  const JS_KW = new Set('const let var function class extends this super null undefined true false void static async new delete typeof instanceof in of type'.split(' '));
  function tokJS(src) {
    const out = []; let i = 0, prev = '';
    const R = { ws: /\s+/y, cm: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y, st: /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/y,
      rx: /\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])+\/[dgimsuy]*/y, nu: /(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)\b/iy, id: /[A-Za-z_$][\w$]*/y };
    const at = r => { r.lastIndex = i; const m = r.exec(src); return m && m[0]; };
    while (i < src.length) {
      let m, c = '';
      if ((m = at(R.ws))) c = '';
      else if ((m = at(R.cm))) c = 'cm';
      else if ((m = at(R.st))) c = 'st';
      else if (src[i] === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || prev === 'return') && (m = at(R.rx))) c = 'rx';
      else if ((m = at(R.nu))) c = 'nu';
      else if ((m = at(R.id))) {
        let j = i + m.length; while (src[j] === ' ') j++;
        c = JS_CT.has(m) ? 'ct' : JS_KW.has(m) ? 'kw' : src[j] === '(' ? 'fn' : /^[A-Z][A-Z0-9_]+$/.test(m) ? 'co' : /^[A-Z]/.test(m) ? 'ty' : 'va';
      } else if (src.startsWith('=>', i)) { m = '=>'; c = 'kw'; }
      else m = src[i];
      if (c !== 'cm' && c !== '') prev = m;
      out.push([m, c]); i += m.length;
    }
    return out;
  }
  const SQL_KW = new Set(('create or replace function returns language as begin end declare if then else elsif case when return returning select into from where and not null is insert update delete set values on conflict do nothing perform ' +
    'table index primary key references default check in exists loop for grant revoke execute to alter privileges schema policy using with order by limit desc asc group join left distinct like security definer stable volatile immutable ' +
    'filter between all true false found unique cascade over ordinality exception others').split(' '));
  const SQL_TY = new Set('text jsonb bigint int boolean uuid timestamptz numeric void double precision integer'.split(' '));
  function tokSQL(src) {
    const out = []; let i = 0;
    const R = { ws: /\s+/y, cm: /--[^\n]*/y, st: /'(?:''|[^'\n])*'/y, nu: /\d+(?:\.\d+)?\b/y, id: /[A-Za-z_][\w]*/y };
    const at = r => { r.lastIndex = i; const m = r.exec(src); return m && m[0]; };
    while (i < src.length) {
      let m, c = '';
      if ((m = at(R.ws))) c = '';
      else if ((m = at(R.cm))) c = 'cm';
      else if ((m = at(R.st))) c = 'st';
      else if ((m = at(R.nu))) c = 'nu';
      else if ((m = at(R.id))) { const l = m.toLowerCase(); c = SQL_KW.has(l) ? 'kw' : SQL_TY.has(l) ? 'ty' : src[i + m.length] === '(' ? 'fn' : m.startsWith('_') ? 'va' : ''; }
      else m = src[i];
      out.push([m, c]); i += m.length;
    }
    return out;
  }
  function tokHTML(src) {
    const out = []; let last = 0;
    const re = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z!][\w-]*)([^>]*?)(\/?>)/g;
    for (let m; (m = re.exec(src));) {
      if (m.index > last) out.push([src.slice(last, m.index), '']);
      if (m[1]) out.push([m[1], 'cm']);
      else {
        out.push([m[2], 'tg'], [m[3], 'kw']);
        for (const a of m[4].matchAll(/([\w:-]+)|("[^"]*"|'[^']*')|([^\w"']+)/g)) out.push([a[0], a[1] ? 'va' : a[2] ? 'st' : '']);
        out.push([m[5], 'tg']);
      }
      last = re.lastIndex;
    }
    if (last < src.length) out.push([src.slice(last), '']);
    return out;
  }
  const LANG = { js: ['JavaScript', tokJS], ts: ['TypeScript', tokJS], sql: ['SQL', tokSQL], html: ['HTML', tokHTML] };
  const FILES = {};
  async function load(path) {
    const src = (await fetch('/src/' + path).then(r => { if (!r.ok) throw new Error('cannot read ' + path); return r.text(); })).replace(/\r/g, '');
    const ext = path.split('.').pop(), [lang, tok] = LANG[ext];
    const rows = [[]];
    for (const [text, cls] of tok(src)) text.split('\n').forEach((part, k) => { if (k) rows.push([]); if (part) rows[rows.length - 1].push(cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part)); });
    if (!rows[rows.length - 1].length) rows.pop();
    FILES[path] = { lang, ext, text: src.split('\n'), html: rows.map((r, i) => `<div class="ln"><span class="no">${i + 1}</span><span class="tx">${r.join('')}</span></div>`).join('') };
  }
  // 1-based number of the first line containing `find`
  function lineOf(file, find) {
    const i = FILES[file].text.findIndex(l => l.includes(find));
    if (i < 0) { fail(`not in ${file}: ${find}`); return 1; }
    return i + 1;
  }

  // ============================================================
  // The editor
  // ============================================================
  const HOME = 'public/js/home.js', EV = 'public/js/event.js', SUPA = 'public/js/supa.js', CTRL = 'public/js/control.js', STAGE = 'public/js/stage.js', COMMON = 'public/js/common.js',
    REPORT = 'public/js/report.js', EVHTML = 'public/event.html', SQL = 'supabase/migrations/20261113000000_crowdpulse.sql', FN = 'supabase/functions/report/index.ts',
    AN = 'supabase/functions/_shared/analytics.js';
  const SOURCES = [HOME, EV, SUPA, CTRL, STAGE, COMMON, REPORT, EVHTML, SQL, FN, AN];
  // the Explorer: [depth, name, path]; folders have a trailing slash
  const TREE = [[0, 'public/'], [1, 'css/', null, 1], [1, 'js/'], ...['admin', 'common', 'config', 'control', 'event', 'home', 'passive', 'raters', 'report', 'room', 'simulator', 'stage', 'supa'].map(n => [2, n + '.js', `public/js/${n}.js`]),
    ...['admin', 'control', 'event', 'index', 'report', 'stage'].map(n => [1, n + '.html', `public/${n}.html`]), [0, 'scripts/', null, 1], [0, 'supabase/'], [1, 'functions/'], [2, '_shared/'], [3, 'analytics.js', AN],
    [2, 'report/'], [3, 'index.ts', FN], [1, 'migrations/'], [2, '20261113000000_crowdpulse.sql', SQL], [1, 'config.toml', 'supabase/config.toml'], [0, 'package.json', 'package.json'], [0, 'README.md', 'README.md']];
  const ICON = { js: 'JS', ts: 'TS', html: '&lt;&gt;', sql: 'SQL', json: '{ }', toml: '⚙', md: 'M↓', css: '#' };
  const icon = name => { const e = name.split('.').pop(); return `<span class="fi ${e}">${ICON[e] || '·'}</span>`; };
  function buildTree() {
    $('#tree').innerHTML = TREE.map(([d, name, path, closed]) => name.endsWith('/')
      ? `<div class="row" style="padding-left:${8 + d * 11}px" data-path="${name}"><span class="ch">${closed ? '›' : '⌄'}</span>${name.slice(0, -1)}</div>`
      : `<div class="row" style="padding-left:${22 + d * 11}px" data-path="${path}">${icon(name)}${name.length > 21 ? name.slice(0, 20) + '…' : name}</div>`).join('');
  }
  const treeRow = path => document.querySelector(`#tree .row[data-path="${path}"]`);
  const LH = 19, MAIN_H = 812, CHROME = 57;
  const ed = { frac: 1, ph: 156, goalFrac: 1, goalPh: 156 };
  const scrollFor = (pane, line, at, viewH) => Math.max(0, Math.min(Math.max(0, FILES[pane.file].text.length * LH - viewH + 2 * LH), (line - 1) * LH - viewH * at));
  const panes = [0, 1].map(i => ({ i, el: $('#p' + i), lines: $(`#p${i} .lines`), file: null, line: 1, at: .3, tabs: [], h: 0 }));
  const E = {
    // shows `file` in pane p with the line containing `find` placed `at` (0..1) of the way down
    open(p, file, find, { at = .3, dur = 900 } = {}) {
      const pane = panes[p], line = lineOf(file, find);
      if (pane.file !== file) {
        E.unmark(p);
        pane.file = file; pane.lines.innerHTML = FILES[file].html; pane.line = line; pane.at = at;
        pane.tabs = [...pane.tabs.filter(f => f !== file), file].slice(-3);
        const parts = file.split('/');
        pane.el.querySelector('.tabs').innerHTML = pane.tabs.map(f => `<div class="tab ${f === file ? 'on' : ''}">${icon(f)}${f.split('/').pop().replace('20261113000000_', '')}<span class="x">✕</span></div>`).join('');
        pane.el.querySelector('.crumbs').innerHTML = parts.map((s, k) => (k === parts.length - 1 ? `<b>${s}</b>` : s)).join(' › ');
        tween('fade' + p, 0, 1, 350, v => (pane.lines.style.opacity = v), 'out');
        tweens.delete('line' + p);
      } else tween('line' + p, { line: pane.line, at: pane.at }, { line, at }, dur, v => { pane.line = v.line; pane.at = v.at; });
      pane.goal = { line, at };
      document.querySelectorAll('#tree .row.on').forEach(r => r.classList.remove('on'));
      treeRow(file)?.classList.add('on');
      $('#ttl').textContent = `${file.split('/').pop()} — CrowdPulse — Visual Studio Code`;
      $('#sbLang').textContent = FILES[file].lang; $('#sbPos').textContent = `Ln ${line}, Col 1`;
    },
    // highlights n lines from the one containing `find`, dims the rest, and pins an optional note to them
    mark(p, find, n = 1, note) {
      const pane = panes[p], a = lineOf(pane.file, find);
      E.unmark(p);
      for (let k = a; k < a + n; k++) pane.lines.children[k - 1]?.classList.add('hl');
      pane.el.classList.add('dim');
      $('#sbPos').textContent = `Ln ${a}, Col 1`;
      if (!note) return;
      const el = document.createElement('div'); el.className = 'note'; el.textContent = note; pane.lines.appendChild(el);
      // above the lines when there is room, else below them, else over the end of the first line
      const area = MAIN_H - ed.goalPh, viewH = (p ? area * (1 - ed.goalFrac) : area * ed.goalFrac) - CHROME, scroll = scrollFor(pane, pane.goal.line, pane.goal.at, viewH);
      const h = el.offsetHeight, above = (a - 1) * LH - h - 10, under = (a + n - 1) * LH + 10;
      const where = above >= scroll + 2 ? 'above' : under + h <= scroll + viewH - 2 ? 'below' : 'flat';
      el.classList.add(where); el.style.top = (where === 'above' ? above : where === 'below' ? under : (a - 1) * LH - 4) + 'px';
      later(60, () => el.classList.add('in'));
      steps.push({ file: pane.file, line: a, title: note, description: currentSay });
    },
    unmark(p) { const pane = panes[p]; pane.el.classList.remove('dim'); pane.lines.querySelectorAll('.hl').forEach(l => l.classList.remove('hl')); pane.lines.querySelectorAll('.note').forEach(n => n.remove()); },
    // the execution pointer: flashes the line containing `find`
    exec(p, find, { hold = 900 } = {}) {
      const pane = panes[p], a = lineOf(pane.file, find), l = pane.lines.children[a - 1]; if (!l) return;
      l.classList.add('exec'); l.__n = (l.__n || 0) + 1; const mine = l.__n;
      later(hold, () => { if (l.__n === mine) l.classList.remove('exec'); });
      $('#sbPos').textContent = `Ln ${a}, Col 1`; sfx('key', 0.4);
    },
    split(frac, dur = 800) { ed.goalFrac = frac; tween('split', ed.frac, frac, dur, v => (ed.frac = v)); },
    panel(ph, dur = 800) { ed.goalPh = ph; tween('panel', ed.ph, ph, dur, v => (ed.ph = v)); },
    glow(paths, ms = 1600) { paths.forEach(p => { const r = treeRow(p); if (!r) return fail('no tree row ' + p); r.classList.add('glow'); later(ms, () => r.classList.remove('glow')); }); },
  };
  function paintEd() {
    const ph = ed.ph, area = MAIN_H - ph, hs = [area * ed.frac, area * (1 - ed.frac)];
    $('#panel').style.height = ph + 'px';
    panes.forEach((pane, i) => {
      pane.h = hs[i];
      Object.assign(pane.el.style, { top: (i ? hs[0] : 0) + 'px', height: hs[i] + 'px', display: hs[i] < 70 ? 'none' : 'block' });
      if (!pane.file) return;
      pane.lines.style.transform = `translateY(${-scrollFor(pane, pane.line, pane.at, hs[i] - CHROME)}px)`;
    });
  }

  // ---------- the live trace (bottom panel) and "on the wire" ----------
  const short = v => (typeof v === 'string' ? `'${v.length > 30 ? v.slice(0, 29) + '…' : v}'` : v == null ? 'null' : typeof v !== 'object' ? String(v)
    : '{ ' + Object.entries(v).slice(0, 3).map(([k, x]) => `${k}: ${x && typeof x === 'object' ? '{…}' : short(x)}`).join(', ') + (Object.keys(v).length > 3 ? ', …' : '') + ' }');
  const PAGE = { 'index.html': 'home page', 'event.html': 'phone', 'control.html': 'control room', 'stage.html': 'big screen', 'report.html': 'report page' };
  const pageOf = win => { try { return PAGE[win.location.pathname.split('/').pop() || 'index.html'] || 'page'; } catch { return 'page'; } };
  function describe(t) {
    if (t.kind === 'http') return { who: pageOf(t.win), up: true, msg: `GET /functions/v1/report  → the report` };
    if (t.kind === 'rpc') {
      const a = t.args || {};
      if (t.fn === 'cp_tick') return t.res ? { who: pageOf(t.win), up: true, msg: 'cp_tick()' } : null;
      if (t.fn === 'cp_list_live') return null;
      if (t.fn === 'cp_act') return ['heartbeat', 'typing', 'passive', 'passive-off'].includes(a._action) ? null : { who: pageOf(t.win), up: true, msg: `cp_act('${a._action}'${a._p == null ? '' : ', ' + short(a._p)})` };
      if (t.fn === 'cp_admin') return ['room', 'sim', 'simulate'].includes(a._action) ? null : { who: pageOf(t.win), up: true, msg: `cp_admin('${a._action}')` };
      if (t.fn === 'cp_join') return { who: pageOf(t.win), up: true, msg: `cp_join(${short({ name: a._p?.name, avatar: a._p?.avatar })})  → snapshot` };
      if (t.fn === 'cp_watch' || t.fn === 'cp_admin_join') return { who: pageOf(t.win), up: true, msg: `${t.fn}()  → snapshot` };
      if (t.fn === 'cp_event_public') return { who: pageOf(t.win), up: true, msg: `cp_event_public('${a._c}')  → ${t.res ? short({ title: t.res.title }) : 'null'}` };
      return { who: pageOf(t.win), up: true, msg: `${t.fn}()` };
    }
    if (['history-point', 'admin-summary', 'typing', 'feedback-count'].includes(t.event)) return null;
    const v = t.v || {};
    const body = t.event === 'pulse' ? short({ avg: v.avg, n: v.n, online: v.online }) : t.event === 'chat' ? short({ name: v.name, text: v.text }) : t.event === 'event' ? short({ status: v.status }) : '';
    return { who: t.topic, up: false, msg: `${t.event} ${body}` };
  }
  const hooks = [];
  const hook = (pred, fn, once = false) => hooks.push({ pred, fn, once });
  const isRpc = (fn, action) => t => t.kind === 'rpc' && t.fn === fn && (!action || t.args._action === action) && (fn !== 'cp_tick' || !!t.res);
  const isCast = event => t => t.kind === 'cast' && t.event === event;
  const wire = { up: 0, down: 0 };
  let lastRow = null;
  S.trace = t => {
    for (const h of [...hooks]) { let ok = false; try { ok = h.pred(t); } catch { /* not this one */ } if (ok) { if (h.once) hooks.splice(hooks.indexOf(h), 1); try { h.fn(t); } catch (e) { fail(e); } } }
    const d = describe(t); if (!d) return;
    const key = d.who + d.msg, sec = Math.floor(elapsed / 1000);
    if (lastRow && lastRow.key === key) { lastRow.n++; lastRow.el.querySelector('.n').textContent = '×' + lastRow.n; }
    else {
      $('#rows .idle')?.remove();
      const el = document.createElement('div'); el.className = 'tr new ' + (d.up ? 'up' : 'down');
      el.innerHTML = `<span class="t">${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}</span><span class="who">${esc(d.who)}</span><span class="dir">${d.up ? '↑ call' : '↓ broadcast'}</span><span class="msg">${esc(d.msg)}</span><span class="n"></span>`;
      $('#rows').appendChild(el); later(450, () => el.classList.remove('new'));
      while ($('#rows').children.length > 18) $('#rows').firstElementChild.remove();
      lastRow = { key, n: 1, el };
    }
    // on the wire
    const dir = d.up ? 'up' : 'down'; wire[dir]++;
    $(d.up ? '#wUp' : '#wDown').textContent = wire[dir];
    packet($('#wire .lane.' + dir), d.up);
    const node = $(`#wire [data-w="${d.up ? 'db' : 'pages'}"]`); later(480, () => { node.classList.add('hit'); later(320, () => node.classList.remove('hit')); });
  };
  let pk = 0;
  function packet(lane, up, dur = 560) {
    const el = document.createElement('div'); el.className = 'pkt'; lane.appendChild(el); el.style.opacity = 1;
    const h = lane.offsetHeight;
    tween('pk' + (pk++), up ? h : -8, up ? -8 : h, dur, v => { el.style.top = v + 'px'; if (v === (up ? -8 : h)) el.remove(); }, 'io');
  }
  window.__studio = { fetch(url) { if (!url.includes('/functions/v1/report')) return undefined; S.trace({ kind: 'http', win: DEV.desk.frame.contentWindow }); return S.report; } };

  // ---------- the map ----------
  const mapEl = id => document.querySelector(`#map [data-m="${id}"]`) || fail('no map item ' + id);
  const PAGES = ['index', 'event', 'control', 'stage', 'admin', 'report'];
  const M = {
    show: (...ids) => ids.forEach(id => mapEl(id)?.classList.add('in')),
    on: (...ids) => document.querySelectorAll('#map .it').forEach(it => it.classList.toggle('on', ids.includes(it.dataset.m))),
    flow: dir => packet(mapEl(dir), dir === 'up', 900),
  };

  // ---------- devices ----------
  const DEV = {
    desk: { el: $('#d-browser'), frame: $('#f-desk'), off: [0, 40], size: [1280, 840] },
    phone: { el: $('#d-phone'), frame: $('#f-phone'), off: [14, 14], size: [418, 872] },
  };
  for (const d of Object.values(DEV)) { d.st = { x: 0, y: 0, s: 1, o: 0 }; d.goal = { ...d.st }; }
  const paintDev = d => { d.el.style.transform = `translate(${d.st.x}px,${d.st.y}px) scale(${d.st.s})`; d.el.style.opacity = d.st.o; d.el.style.visibility = d.st.o < .01 ? 'hidden' : 'visible'; };
  function deskSize(w, h) { const d = DEV.desk; d.size = [w, h + 40]; d.frame.style.width = w + 'px'; d.frame.style.height = h + 'px'; d.el.style.width = w + 'px'; }
  const RX = 1046, RW = 536;
  const LAYOUTS = {
    map: () => ({}),
    phone: () => ({ phone: { x: RX + (RW - 418 * .93) / 2, y: 44, s: .93, o: 1 } }),
    duo: () => ({ desk: { x: RX, y: 22, s: RW / DEV.desk.size[0], o: 1 }, phone: { x: RX + RW - 418 * .525, y: 404, s: .525, o: 1 } }),
    tall: () => { const s = RW / DEV.desk.size[0]; return { desk: { x: RX, y: (H - DEV.desk.size[1] * s) / 2, s, o: 1 } }; },
  };
  function layout(name, dur = 1000) {
    const L = LAYOUTS[name]();
    for (const [k, d] of Object.entries(DEV)) {
      const g = L[k] ? { ...L[k] } : { ...d.goal, o: 0, s: d.goal.s * 0.94, y: d.goal.y + 30 };
      if (d.st.o < .01 && L[k]) d.st = { ...g, o: 0, s: g.s * 0.92, y: g.y + 60 }; // enter from below
      d.goal = g;
      tween('dev-' + k, { ...d.st }, g, dur, v => { d.st = v; paintDev(d); }, 'io');
    }
    tween('map', +$('#map').style.opacity || 0, name === 'map' ? 1 : 0, dur * 0.8, v => ($('#map').style.opacity = v));
    tween('wire', +$('#wire').style.opacity || 0, name === 'duo' ? 1 : 0, dur * 0.8, v => ($('#wire').style.opacity = v));
  }
  const win = dev => DEV[dev].frame.contentWindow;
  const doc = dev => DEV[dev].frame.contentDocument;
  function el(dev, sel) {
    const e = typeof sel === 'string' ? doc(dev)?.querySelector(sel) : sel;
    if (!e) fail(`not found: ${dev} ${sel}`);
    return e;
  }
  function rectOf(dev, sel) {
    const e = el(dev, sel); if (!e) return { x: W / 2, y: H / 2, w: 10, h: 10 };
    const r = e.getBoundingClientRect(), d = DEV[dev], g = d.goal;
    return { x: g.x + (d.off[0] + r.left) * g.s, y: g.y + (d.off[1] + r.top) * g.s, w: r.width * g.s, h: r.height * g.s };
  }
  const toSet = (dev, cx, cy) => { const d = DEV[dev], g = d.goal; return { x: g.x + (d.off[0] + cx) * g.s, y: g.y + (d.off[1] + cy) * g.s }; };

  // ---------- cursor ----------
  const cur = { x: 1300, y: H + 60, o: 0 };
  function paintCursor() { const c = $('#cursor'); c.style.transform = `translate(${cur.x - 6}px,${cur.y - 4}px)`; c.style.opacity = cur.o; }
  function cursorTo(x, y, dur = 650) { tween('cur', { x: cur.x, y: cur.y }, { x, y }, dur, v => { cur.x = v.x; cur.y = v.y; }, 'io'); }
  const showCursor = (on = true) => tween('curo', cur.o, on ? 1 : 0, 300, v => (cur.o = v), 'lin');
  function ripple() {
    const r = document.createElement('div'); r.className = 'ripple';
    r.style.left = cur.x + 'px'; r.style.top = cur.y + 'px'; $('#ov').appendChild(r); later(700, () => r.remove()); sfx('click');
  }
  const isFixed = e => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const p = n.ownerDocument.defaultView.getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  function click(dev, sel, { move = 650, ox = 0.5, oy = 0.5, then, scrolled } = {}) {
    if (cur.o < .5) showCursor(true);
    const e0 = el(dev, sel); if (!e0) return;
    const r0 = e0.getBoundingClientRect(), vh = win(dev).innerHeight;
    if (!scrolled && !isFixed(e0) && (r0.top < 70 || r0.bottom > vh - 90)) { scrollDev(dev, e0, 420); later(440, () => click(dev, sel, { move, ox, oy, then, scrolled: true })); return; }
    const r = rectOf(dev, sel);
    cursorTo(r.x + r.w * ox, r.y + r.h * oy, move);
    later(move + 60, () => {
      ripple();
      const e = el(dev, sel); if (!e) return;
      e.focus?.(); e.click(); then?.();
    });
  }
  function type(dev, sel, text, { cps = 20, clear = true, submit } = {}) {
    const e = el(dev, sel); if (!e) return; const w = win(dev);
    e.focus();
    if (clear) { e.value = ''; e.dispatchEvent(new w.Event('input', { bubbles: true })); }
    [...text].forEach((ch, i, all) => later((i * 1000) / cps, () => {
      e.value += ch; e.dispatchEvent(new w.Event('input', { bubbles: true })); if (i % 2 === 0) sfx('key', 0.5);
      if (i === all.length - 1 && submit) later(250, () => { const f = el(dev, submit); f.requestSubmit ? f.requestSubmit() : f.click(); });
    }));
  }
  // drags the cursor over an element along path(t) -> [clientX, clientY] in the iframe, calling onInput(t) on the way
  function drag(dev, sel, path, dur, onInput) {
    if (!el(dev, sel)) return;
    if (cur.o < .5) showCursor(true);
    const s0 = toSet(dev, ...path(0));
    cursorTo(s0.x, s0.y, 500);
    later(520, () => { ripple(); tween('drag', 0, 1, dur, t => { const sp = toSet(dev, ...path(t)); cur.x = sp.x; cur.y = sp.y; onInput(t); }, 'io'); });
  }
  function scrollDev(dev, sel, dur = 800) {
    const w = win(dev), from = w.scrollY, vh = w.innerHeight;
    let to = 0;
    if (sel) { const e = el(dev, sel); if (e) { const r = e.getBoundingClientRect(); to = Math.max(0, Math.min(w.document.documentElement.scrollHeight - vh, from + r.top + r.height / 2 - vh / 2)); } }
    tween('scroll-' + dev, from, to, dur, v => w.scrollTo(0, v), 'io');
  }
  const slide = (from, to, dur) => { // drags the phone's rating slider
    const inp = el('phone', '#rater input'); if (!inp) return; const r = inp.getBoundingClientRect(), w = win('phone');
    drag('phone', inp, t => [r.left + r.width * (from + (to - from) * Math.sin(t * Math.PI * 1.5) ** 2) / 100, r.top + r.height / 2], dur,
      t => { inp.value = Math.round(from + (to - from) * Math.sin(t * Math.PI * 1.5) ** 2); inp.dispatchEvent(new w.Event('input', { bubbles: true })); });
  };

  // ---------- overlays ----------
  function chapter(n, kicker, text, hold = 3400) {
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
  const labels = on => tween('lbl', +$('#lblCode').style.opacity || 0, on ? 1 : 0, 500, v => { $('#lblCode').style.opacity = v; $('#lblApp').style.opacity = v; });
  function flash() { tween('flash', 0.5, 0, 700, v => ($('#flash').style.opacity = v), 'out'); }

  // ---------- page loading (the clock waits while a page loads) ----------
  const blockers = [];
  function go(dev, url, ready, bar) {
    const f = DEV[dev].frame;
    f.src = url;
    if (dev === 'desk') $('#url').textContent = bar || 'localhost:3000' + url;
    let loaded = false; f.onload = () => (loaded = true);
    blockers.push(() => {
      const d = f.contentDocument;
      if (!loaded || !d || d.readyState !== 'complete' || !f.contentWindow.__film) return false;
      if (d.fonts && d.fonts.status !== 'loaded') return false;
      if ([...d.images].some(i => !i.complete)) return false;
      return !!(typeof ready === 'function' ? ready(d) : d.querySelector(ready));
    });
  }
  const arrive = (dev, ready) => blockers.push(() => { const d = doc(dev); return d && d.readyState === 'complete' && win(dev).__film && ready(d); });
  const frameWins = () => [window, ...Object.values(DEV).map(d => d.frame.contentWindow).filter(w => { try { return w && w.__film; } catch { return false; } })];

  // ---------- sound cues, storyboard frames and CodeTour steps ----------
  const cues = [];
  const sfx = (name, gain = 1) => cues.push({ t: Math.round(elapsed), name, gain });
  let pendingBoard = null, currentScene = null, currentSay = '';
  const boardsMeta = [], steps = [];
  const board = (titleText, why) => { pendingBoard = { title: titleText, why, at: Math.round(elapsed), scene: currentScene }; boardsMeta.push(pendingBoard); };

  // ============================================================
  // Scene list. Each beat is one narration line; actions are [ms from the start of the line, fn].
  // Trace hooks (hook(isRpc(...)/isCast(...), fn)) last until the next line starts.
  // ============================================================
  let real = null;
  const CODE = () => real.code;
  const brandSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>';
  const pageFiles = ['index', 'event', 'control', 'stage', 'admin', 'report'].map(n => `public/${n}.html`);
  const pageScripts = ['home', 'event', 'control', 'stage', 'admin', 'report'].map(n => `public/js/${n}.js`);
  const gaugeReady = d => d.querySelector('#gauge')?.children.length > 0;

  const SCENES = [
    {
      id: 'open', title: 'Cold open', code: 'home.js: the loop that animates the home page demo', app: 'The home page on a phone, its demo gauge moving', sound: 'Music swells in; whoosh on the title',
      beats: [
        { id: 'code-open-1', min: 9200, say: 'This is CrowdPulse, from the inside. On the right, the app, running. On the left, the code that’s running it.', do: [
          [0, () => { layout('phone', 1); go('phone', '/index.html', '#boxes input'); E.open(0, HOME, '// hero demo animation', { at: .25 });
            title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">CrowdPulse</h1><p class="line l3">How the code works</p></div>`, true, 1); sfx('whoosh'); }],
          [600, () => board('Title card', 'Logo and the film’s subject over the set')],
          [3000, () => title('', false, 1000)],
          [3300, () => { labels(true); scrollDev('phone', '#demoGauge', 1100); }],
          [4600, () => { E.mark(0, '// hero demo animation', 14, 'This loop drives the demo gauge, once a second');
            for (let k = 0; k < 8; k++) later(600 + k * 1000, () => E.exec(0, 'g.set(v); chart.push(', { hold: 420 })); }],
          [7200, () => board('Code on the left, app on the right', 'home.js lights up each time its timer moves the gauge on the phone')],
        ] },
        { id: 'code-open-2', min: 9000, say: 'This isn’t a line by line walkthrough. It’s a map: how the code is laid out, and what runs when the app does its main jobs.', do: [
          [0, () => labels(false)],
          [600, () => { E.unmark(0); E.open(0, HOME, '// Home page: join with a code', { at: 0, dur: 1400 }); }],
          [2600, () => [['public/'], ['js/'], pageScripts, pageFiles, ['supabase/'], [AN, FN], [SQL]].forEach((g, k) => later(k * 750, () => E.glow(g, 900)))],
        ] },
      ],
    },
    {
      id: 'layout', title: 'How the code is laid out', code: 'The Explorer, event.html’s script tags, then the SQL migration', app: 'A map of the code builds up: six pages, two helpers, and Supabase', sound: 'Whoosh on the chapter card',
      beats: [
        { id: 'code-map-1', min: 11500, say: 'Start with the layout. Everything the browser loads is in the public folder: six plain HTML pages, with one script for each. No framework, and the build just copies files.', do: [
          [0, () => { layout('map', 1000); chapter(1, 'Part one', 'How the code is laid out'); E.open(0, EVHTML, '<!doctype html>', { at: 0 }); }],
          [2400, () => E.glow(['public/'], 2200)],
          [4200, () => PAGES.forEach((p, k) => later(k * 420, () => { M.show('pg-' + p); E.glow([pageFiles[k], pageScripts[k]], 1500); }))],
          [7600, () => board('Six pages, one script each', 'The Explorer and the map light up together, page by page')],
        ] },
        { id: 'code-map-2', min: 12000, say: 'Every page loads the same two helpers before its own script. common.js draws the shared pieces, like the gauge and the chart. supa.js is the connection to the back end.', do: [
          [0, () => E.open(0, EVHTML, '<script src="vendor/supabase/supabase.js">', { at: .4 })],
          [900, () => E.mark(0, '<script src="vendor/supabase/supabase.js">', 8, 'The helpers first, then the page’s own script')],
          [4200, () => { E.mark(0, '<script src="js/common.js">', 1, 'Shared drawing code'); M.show('common'); M.on('common'); E.glow([COMMON], 2600); }],
          [8300, () => { E.mark(0, '<script src="js/supa.js">', 1, 'The connection to the back end'); M.show('supa'); M.on('supa'); E.glow([SUPA], 2600); }],
          [9600, () => board('Two helpers on every page', 'event.html’s script tags: common.js and supa.js before event.js')],
        ] },
        { id: 'code-map-3', min: 12500, say: 'The back end is Supabase, and almost all of it is one SQL file: the tables, the security rules, and a function for every action. There’s no server of our own to run.', do: [
          [0, () => { M.on(); E.open(0, SQL, '-- CrowdPulse on Supabase', { at: 0 }); E.glow([SQL], 3000); }],
          [1000, () => { E.mark(0, '-- Security model', 13, 'One file: tables, rules and functions'); M.show('pg'); M.on('pg'); }],
          [5200, () => { E.open(0, SQL, '-- ---------- tables ----------', { at: .06, dur: 1100 }); E.mark(0, 'create table public.events', 21, 'The tables…'); }],
          [7600, () => { E.open(0, SQL, '-- ---------- attendee API ----------', { at: .1, dur: 1400 }); M.show('rt', 'fn'); }],
          [9000, () => E.mark(0, 'create function public.cp_join(', 12, '…and a function for every action')],
          [10200, () => board('The back end is one SQL file', 'Tables, security rules and one function per action, in a single migration')],
        ] },
      ],
    },
    {
      id: 'connect', title: 'One connection, two directions', code: 'supa.js: CP.connect, emit and the Realtime listener', app: 'The map: calls go up through database functions, broadcasts come back down', sound: 'Soft ticks as lines light up',
      beats: [
        { id: 'code-conn-1', min: 10500, say: 'One idea holds it all together, and it lives in supa.js. Every page asks for a connection, and gets back a small socket with two methods.', do: [
          [0, () => { chapter(2, 'Part two', 'One connection, two directions'); E.open(0, SUPA, '// Supabase connection: sign-in', { at: 0 }); M.on('supa'); }],
          [1500, () => E.mark(0, '//   socket.emit(name, payload, ack)', 2, 'The whole design, in two comment lines')],
          [5600, () => { E.open(0, SUPA, 'const socket = {', { at: .22 }); E.mark(0, 'const socket = {', 19, 'The socket every page gets'); }],
          [7800, () => board('The connection file', 'supa.js hands every page a socket with emit and on')],
        ] },
        { id: 'code-conn-2', min: 9000, say: 'Emit sends something up. Each name maps to a database function: join, an admin action, or anything else an attendee does.', do: [
          [0, () => { E.mark(0, 'async emit(name, p, ack) {', 13, 'emit ↑ becomes a database function call'); M.show('up'); M.on('supa', 'pg'); }],
          [700, () => [0, 1700, 3400, 5100].forEach(ms => later(ms, () => M.flow('up')))],
          [3300, () => E.exec(0, "if (name === 'join')", { hold: 1300 })],
          [4700, () => E.exec(0, "name.startsWith('admin:')", { hold: 1300 })],
          [6100, () => E.exec(0, "else res = await CP.call('cp_act'", { hold: 1800 })],
          [6500, () => board('Emit: up through a function', 'Each emit name maps to one database function')],
        ] },
        { id: 'code-conn-3', min: 8500, say: 'And on listens for what comes back down: a Realtime broadcast, on a private channel that belongs to this one session.', do: [
          [0, () => { E.open(0, SUPA, 'const listen = (topic, onStatus)', { at: .3 }); E.mark(0, 'const listen = (topic, onStatus)', 3, 'on ↓ receives a Realtime broadcast'); M.show('down'); M.on('supa', 'rt'); }],
          [700, () => [0, 1700, 3400, 5100].forEach(ms => later(ms, () => M.flow('down')))],
          [2600, () => E.exec(0, ".on('broadcast', { event: '*' }", { hold: 2200 })],
          [5200, () => board('On: down through a broadcast', 'Broadcasts arrive on the session’s private channel')],
        ] },
        { id: 'code-conn-4', min: 7500, say: 'Up through a function, down through a broadcast. Every feature in the app is a variation on that loop.', do: [
          [0, () => { E.unmark(0); M.on('supa', 'pg', 'rt'); [0, 2000, 4000].forEach(ms => { later(ms + 300, () => M.flow('up')); later(ms + 1300, () => M.flow('down')); }); }],
          [3600, () => board('The loop', 'Up through a function, down through a broadcast')],
        ] },
      ],
    },
    {
      id: 'join', title: 'Joining a session', code: 'home.js, then event.js beside the cp_join function', app: 'An attendee types the join code, picks a profile and lands in the lobby', sound: 'Key taps, clicks',
      beats: [
        { id: 'code-join-1', min: 10000, say: 'Watch it happen. An attendee types a join code on the home page. home.js asks the database whether that session exists, then opens the attendee page.', do: [
          [0, () => { layout('phone', 1000); chapter(3, 'Path one', 'Joining a session'); go('phone', '/index.html', '#boxes input'); E.open(0, HOME, "$('#join').addEventListener('submit'", { at: .25 }); }],
          [1000, () => E.mark(0, "$('#join').addEventListener('submit'", 9, 'Does this session exist?')],
          [3400, () => { hook(isRpc('cp_event_public'), () => E.exec(0, "ev = await CP.rpc('cp_event_public'", { hold: 2200 }), true);
            click('phone', '#boxes input:nth-child(1)', { then: () => [...CODE()].forEach((c, i) => later(i * 190, () => { const inp = el('phone', `#boxes input:nth-child(${i + 1})`); inp.value = c; inp.dispatchEvent(new (win('phone').Event)('input', { bubbles: true })); sfx('key', 0.7); })) }); }],
          [4500, () => board('Typing the join code', 'home.js checks the code with one database call')],
          [5800, () => arrive('phone', d => d.location.pathname.endsWith('/event.html') && d.querySelector('#mainCol .lobby'))],
          [5900, () => showCursor(false)],
        ] },
        { id: 'code-join-2', min: 11500, say: 'There, event.js connects and emits join. In the database, cp_join records the participant, and hands back a snapshot: everything the page needs to draw itself.', do: [
          [0, () => { E.split(.5); E.open(0, EV, 'function join() {', { at: .22 }); E.open(1, SQL, '-- ---------- attendee API ----------', { at: .06 }); }],
          [800, () => { E.mark(0, 'function join() {', 11, 'emit(\'join\') ↑'); E.exec(0, "socket.emit('join', { code, ...me }, res => {", { hold: 1800 }); }],
          [2300, () => click('phone', '#pfName', { then: () => type('phone', '#pfName', 'Jordan', { cps: 9 }) })],
          [4600, () => { E.mark(1, 'create function public.cp_join(', 12, 'Record the participant, return a snapshot'); E.exec(1, 'part := public.cp_upsert_participant', { hold: 1700 }); }],
          [5000, () => click('phone', '.avatar-grid button:nth-child(1)')],
          [6600, () => E.exec(1, '|| public.cp_snapshot(e.code, me);', { hold: 2200 })],
          [7400, () => board('Join: the call and its function', 'event.js emits join; cp_join answers with a snapshot')],
          [8300, () => E.exec(0, 'state = res; myRating = res.myRating;', { hold: 2200 })],
          [9000, () => click('phone', '#pfSave')],
          [10000, () => showCursor(false)],
        ] },
        { id: 'code-join-3', min: 10500, say: 'From then on, the page keeps that snapshot as its state, and render functions turn state into screen. The session hasn’t started, so it draws the lobby.', do: [
          [0, () => { E.split(1); E.open(0, EV, '// ---------- top-level render ----------', { at: .06 }); S.addBots(34, 7000); }],
          [900, () => E.mark(0, 'function renderMain() {', 5, 'State in, screen out')],
          [6600, () => E.exec(0, "if (ev.status === 'scheduled') { renderLobby(col)", { hold: 3000 })],
          [7400, () => board('Rendering the lobby from state', 'renderMain picks the lobby because the status is still scheduled')],
        ] },
      ],
    },
    {
      id: 'live', title: 'Going live', code: 'control.js, the cp_admin function, then event.js’s event listener', app: 'The host presses Go live in the control room; the phone flips to rating', sound: 'Click, pop',
      beats: [
        { id: 'code-live-1', min: 6500, say: 'Now the host. In the control room, the Go live button emits admin start.', do: [
          [0, () => { chapter(4, 'Path two', 'Going live'); deskSize(1280, 800); go('desk', `/control.html?code=${CODE()}#key=${real.adminKey}`, '#mainBtns button', `localhost:3000/control.html?code=${CODE()}`);
            layout('duo', 1100); E.open(0, CTRL, '// ---------- status / buttons ----------', { at: .1 }); }],
          [1200, () => E.mark(0, "if (ev.status === 'scheduled') add(", 1, 'The Go live button: emit(\'admin:start\')')],
          [3000, () => { const r = rectOf('desk', '#mainBtns button'); showCursor(true); cursorTo(r.x + r.w / 2, r.y + r.h / 2, 900); }],
          [4400, () => board('The Go live button', 'One line in control.js: the button emits admin:start')],
        ] },
        { id: 'code-live-2', min: 11000, say: 'In the database, cp_admin checks that the caller really is an admin of this session, flips the status to live, and broadcasts the new event to everyone.', do: [
          [0, () => E.open(0, SQL, 'create function public.cp_admin(', { at: .08 })],
          [1800, () => E.mark(0, "'Not authorised'", 1, 'First: is the caller an admin?')],
          [5600, () => E.mark(0, "when 'start' then", 6, 'Status → live, then broadcast to everyone')],
          [8000, () => board('cp_admin: check, update, broadcast', 'The database function behind the button')],
        ] },
        { id: 'code-live-3', min: 9500, say: 'On the phone, the event listener sees the status change and renders again. The lobby becomes the rating screen. Nobody refreshed anything.', do: [
          [0, () => { E.split(.46); E.open(0, SQL, "when 'start' then", { at: .3 }); E.open(1, EV, "socket.on('spotlight', q => {", { at: .1 }); E.mark(1, "socket.on('event', ev => {", 7, 'The phone hears the new event');
            hook(isRpc('cp_admin', 'start'), () => { E.exec(0, "update public.events set status = 'live'", { hold: 1500 }); later(450, () => E.exec(0, 'perform public.cp_broadcast_event(e.code);', { hold: 1700 })); }, true);
            hook(isCast('event'), () => later(700, () => { E.exec(1, "if (changed && ev.status === 'live')", { hold: 1600 }); later(500, () => E.exec(1, 'if (changed || settingsChanged) renderAll();', { hold: 2400 })); }), true); }],
          [1500, () => click('desk', '#mainBtns button', { move: 300, then: () => { sfx('pop'); flash(); S.moodTarget = 72; } })],
          [3000, () => showCursor(false)],
          [4200, () => board('Live: the broadcast reaches the phone', 'cp_admin broadcasts; event.js re-renders the phone as the rating screen')],
        ] },
      ],
    },
    {
      id: 'pulse', title: 'The live pulse', code: 'event.js’s sendRating, cp_act and cp_do_rate, then cp_tick and the pulse listeners', app: 'A slider drag on the phone; the big screen’s gauge follows every two seconds', sound: 'Soft ticks on every call and broadcast',
      beats: [
        { id: 'code-pulse-1', min: 9000, say: 'Here’s the heart of it. Dragging the slider calls send rating, which waits a quarter of a second, then emits rate.', do: [
          [0, () => { chapter(5, 'Path three', 'The live pulse'); E.split(1); layout('phone', 1000); E.open(0, EV, 'function mountRater() {', { at: .06 });
            hook(isRpc('cp_act', 'rate'), () => E.exec(0, "socket.emit('rate', { v: pending, mode }); sendT = null;", { hold: 420 })); }],
          [1000, () => E.mark(0, 'let sendT = null, pending = null;', 10, 'Wait 250 ms, then emit once')],
          [2900, () => slide(52, 90, 3600)],
          [5200, () => board('Dragging the slider', 'Each batch of slider movement becomes one emit of rate')],
          [7600, () => showCursor(false)],
        ] },
        { id: 'code-pulse-2', min: 10000, say: 'cp_act routes it to cp_do_rate, which stores the number against that participant. Notice what it doesn’t do: it doesn’t tell anyone.', do: [
          [0, () => { E.split(.4); E.open(0, SQL, 'case _action', { at: .35 }); E.open(1, SQL, 'create function public.cp_do_rate(', { at: .04 });
            hook(isRpc('cp_act', 'rate'), () => { E.exec(0, "when 'rate' then perform public.cp_do_rate", { hold: 420 }); later(200, () => E.exec(1, 'update public.participants set rating = val, rating_t = n, rating_mode = md, last_seen', { hold: 420 })); }); }],
          [900, () => E.mark(0, "when 'rate' then perform public.cp_do_rate", 1, 'cp_act: one branch per action')],
          [2000, () => slide(86, 64, 3200)],
          [3600, () => E.mark(1, 'if part.rating_row is not null', 8, 'Store it. No broadcast here.')],
          [5600, () => board('cp_act routes to cp_do_rate', 'The rating is stored; nothing is broadcast yet')],
          [6400, () => showCursor(false)],
        ] },
        { id: 'code-pulse-3', min: 14000, say: 'That’s the job of cp_tick. Every two seconds, the control room and the big screen call it. It averages the latest ratings, measures the energy, and broadcasts one small message: the pulse.', do: [
          [0, () => { deskSize(1280, 800); go('desk', `/stage.html?code=${CODE()}`, gaugeReady, `localhost:3000/stage.html?code=${CODE()}`); layout('duo', 1100); S.react = 1.6; S.chatty = 0.12;
            E.split(.3); E.open(0, SUPA, "const tick = () => CP.call('cp_tick', { _c: code });", { at: .35 }); E.open(1, SQL, '-- ---------- the live pulse ----------', { at: .03 });
            hook(isRpc('cp_tick'), () => E.exec(0, "if (ticker === 'always') { tick();", { hold: 650 }));
            hook(isCast('pulse'), () => later(250, () => E.exec(1, "perform public.cp_send('ev:' || _c, 'pulse', pulse ||", { hold: 800 }))); }],
          [1200, () => E.mark(0, "const tick = () => CP.call('cp_tick', { _c: code });", 2, 'Every 2 seconds')],
          [2600, () => E.mark(1, 'create function public.cp_tick(', 1)],
          [6200, () => { E.open(1, SQL, '-- ratings from people still here', { at: .2, dur: 1200 }); E.mark(1, '-- ratings from people still here', 10, 'Average the ratings, measure the energy'); }],
          [8200, () => board('cp_tick computes the pulse', 'supa.js calls cp_tick every two seconds; SQL does the averaging')],
          [10000, () => { E.open(1, SQL, "pulse := jsonb_build_object('t', n, 'avg'", { at: .4, dur: 1200 }); E.mark(1, "pulse := jsonb_build_object('t', n, 'avg'", 4, 'One small broadcast: the pulse'); }],
          [12400, () => board('The pulse broadcast', 'The line that sends the pulse flashes each time the big screen’s gauge is about to move')],
        ] },
        { id: 'code-pulse-4', min: 10500, say: 'Every screen is listening for it. On pulse updates the gauge, the bars and the chart, all drawn by the shared helpers in common.js.', do: [
          [0, () => { E.split(.5); E.open(0, STAGE, 'function onPulse(p) {', { at: .15 }); E.open(1, COMMON, '// ---------- semicircle gauge with spring needle ----------', { at: .1 }); S.moodTarget = 84;
            hook(isCast('pulse'), () => later(120, () => { E.exec(0, 'gauge.set(p.avg, p.avg == null', { hold: 800 }); later(300, () => E.exec(1, 'CP.gauge = (host, { big = false } = {}) => {', { hold: 800 })); })); }],
          [800, () => E.mark(0, 'function onPulse(p) {', 13, 'Every screen: on pulse, redraw')],
          [3000, () => S.burst(['🔥', '👏', '🎉', '❤️'], 26, 5000)],
          [5200, () => E.mark(1, 'CP.gauge = (host, { big = false } = {}) => {', 1, 'Shared drawing code')],
          [6400, () => board('On pulse: gauge, bars, chart', 'stage.js handles the pulse; common.js draws the gauge')],
        ] },
        { id: 'code-pulse-5', min: 7000, say: 'So a hundred people dragging sliders still means just one broadcast every two seconds.', do: [
          [0, () => { E.split(1); E.unmark(0); E.panel(336); S.moodTarget = 76; S.chatty = 0; }],
          [700, () => slide(64, 90, 4400)],
          [6000, () => showCursor(false)],
          [4200, () => board('One broadcast every two seconds', 'The live trace: calls going up, one pulse coming down')],
        ] },
      ],
    },
    {
      id: 'rest', title: 'Everything else, same route', code: 'event.js emits and listeners beside cp_act’s branches, then the grants at the end of the SQL file', app: 'Reactions and a chat message from the phone show up on the big screen', sound: 'Taps, key taps',
      beats: [
        { id: 'code-rest-1', min: 12000, say: 'Chat, questions, polls and reactions all take the same route. One line to emit, one branch in cp_act, and one listener to draw the result.', do: [
          [0, () => { chapter(6, 'Path four', 'Everything else, same route'); S.chatty = 0.5; E.panel(156); E.split(.5); E.open(0, EV, 'if (ev.settings.reactions) {', { at: .3 }); E.open(1, SQL, 'case _action', { at: .2 });
            E.mark(1, "when 'heartbeat' then null;", 8, 'One branch per action');
            hook(isRpc('cp_act', 'react'), () => { E.exec(0, "socket.emit('react', b.dataset.e)", { hold: 500 }); E.exec(1, "when 'react' then", { hold: 500 }); });
            hook(isRpc('cp_act', 'chat'), () => { E.exec(0, "socket.emit('chat', v); $('#chatIn').value = '';", { hold: 1500 }); E.exec(1, "when 'chat' then", { hold: 1500 }); });
            hook(isCast('chat'), () => later(500, () => { if (panes[0].file === EV) E.exec(0, "socket.on('chat', addMsg);", { hold: 900 }); })); }],
          [700, () => { E.mark(0, "socket.emit('react', b.dataset.e)", 1, 'One line to emit'); scrollDev('phone', '.reactbar', 700); }],
          [2300, () => click('phone', '.reactbar [data-e="🔥"]', { move: 500 })],
          [3100, () => click('phone', '.reactbar [data-e="👏"]', { move: 250 })],
          [3800, () => { click('phone', '.reactbar [data-e="🤯"]', { move: 250 }); S.burst(['🔥', '👏', '🤯', '❤️', '🎉'], 30, 3000); }],
          [4600, () => board('Reactions take the same route', 'A tap on the phone: one emit, one branch in cp_act')],
          [5200, () => { click('phone', '#mobnav [data-tab="chat"]', { move: 500 }); E.open(0, EV, "socket.on('chat-delete'", { at: .25 }); E.mark(0, "$('#chatForm').addEventListener('submit'", 4, 'Chat: emit ↑, and one listener ↓'); }],
          [6400, () => click('phone', '#chatIn', { move: 400, then: () => type('phone', '#chatIn', 'Love the live gauge 🔥', { cps: 16, submit: '#chatForm' }) })],
          [9200, () => board('Chat takes the same route', 'The message goes up through cp_act and comes back as a chat broadcast')],
          [10500, () => showCursor(false)],
        ] },
        { id: 'code-rest-2', min: 13500, say: 'And the rules live in the database, not the browser. The tables are closed. A browser can only call the functions granted at the bottom of the file, and each one checks who is calling.', do: [
          [0, () => { E.split(1); E.open(0, SQL, '-- RLS on with no policies', { at: .25 }); win('phone').document.querySelector('#mobnav [data-tab="rate"]')?.click(); }],
          [900, () => E.mark(0, '-- RLS on with no policies', 10, 'Tables: closed to browsers')],
          [5200, () => { E.open(0, SQL, '-- ---------- grants: the browser API ----------', { at: .45 }); E.mark(0, '-- ---------- grants: the browser API ----------', 10, 'The entire browser API'); }],
          [7600, () => board('Rules live in the database', 'The grants at the end of the migration are the only doors in')],
          [10000, () => { E.open(0, SQL, 'create function public.cp_join(', { at: .15 }); E.mark(0, "if me is null then return jsonb_build_object('error', 'Not signed in'); end if;", 1, 'Each function checks who is calling'); }],
        ] },
      ],
    },
    {
      id: 'report', title: 'The report', code: 'report.js and supa.js, then the report Edge Function and analytics.js', app: 'The report page loads and scrolls: grade, timeline, key moments', sound: 'Chime as the report appears',
      beats: [
        { id: 'code-report-1', min: 8000, say: 'When the session ends, there’s one more path. report.js asks an Edge Function for the report.', do: [
          [0, () => { chapter(7, 'Path five', 'The report'); S.admin('end'); deskSize(1100, 1680); go('desk', `/report.html?code=${CODE()}`, '#kpis .kpi', `localhost:3000/report.html?code=${CODE()}`); layout('tall', 1100); sfx('chime');
            E.split(.36); E.open(0, REPORT, '// Post-session report', { at: 0 }); E.open(1, SUPA, '// ---------- report (Edge Function) ----------', { at: .08 }); }],
          [1100, () => { E.mark(0, 'try { r = await CP.report(code); R = await r.json(); }', 1, 'Ask the Edge Function'); E.exec(0, 'try { r = await CP.report(code); R = await r.json(); }', { hold: 2400 }); }],
          [3000, () => { E.mark(1, 'CP.report = async (code, format', 8, 'A plain fetch, carrying the visitor’s session'); E.exec(1, 'return fetch(`${C.supabaseUrl}/functions/v1/report', { hold: 2400 }); }],
          [5200, () => board('The report page asks an Edge Function', 'report.js calls CP.report, a fetch to the report function')],
        ] },
        { id: 'code-report-2', min: 15500, say: 'The function checks that you’re allowed to see it, reads the raw data with a key the browser never gets, and runs it through analytics.js, which turns ratings and chat into a grade, key moments and insights.', do: [
          [0, () => { E.split(.56); E.open(0, FN, 'Deno.serve(async req => {', { at: .05 }); E.open(1, AN, '// Post-session analytics', { at: 0 }); }],
          [900, () => { E.open(0, FN, 'const asUser = createClient(', { at: .3 }); E.mark(0, 'const asUser = createClient(', 5, 'Is this visitor allowed to see it?'); }],
          [2500, () => scrollDev('desk', '#cTimeline', 3000)],
          [4800, () => E.mark(0, 'const admin = createClient(', 2, 'Raw data, read with the server’s own key')],
          [8200, () => { E.open(0, FN, 'return json(buildReport(ev));', { at: .55 }); E.mark(0, 'return json(buildReport(ev));', 1, 'Only the finished report goes back'); E.exec(0, 'return json(buildReport(ev));', { hold: 3000 }); }],
          [9000, () => { E.open(1, AN, 'function buildReport(ev) {', { at: .25 }); E.mark(1, 'function buildReport(ev) {', 1, 'Ratings and chat in; grade and insights out'); scrollDev('desk', '#moments', 3000); }],
          [11600, () => board('Inside the Edge Function', 'Access check, raw data read with the service key, then analytics.js')],
        ] },
        { id: 'code-report-3', min: 6000, say: 'Only crowd-level results come back, and Chart.js draws them.', do: [
          [0, () => { E.split(1); E.open(0, REPORT, '// ---------- lazy chart creation', { at: .12 }); E.mark(0, '// ---------- lazy chart creation', 1, 'Charts are drawn in the browser'); scrollDev('desk', '#cloud', 3600); }],
          [3600, () => board('Charts drawn in the browser', 'report.js builds each chart as it scrolls into view')],
        ] },
      ],
    },
    {
      id: 'outro', title: 'Outro', code: 'The Explorer, with each part of the map lit in turn', app: 'The finished map, then the end card', sound: 'Music resolves',
      beats: [
        { id: 'code-outro-1', min: 11500, say: 'So that’s the map. Six pages, with a script each. One connection file. One SQL file that holds the rules. And one function for the report.', do: [
          [0, () => { layout('map', 1000); E.unmark(0); E.open(0, SUPA, '// Supabase connection: sign-in', { at: 0 }); M.on(); }],
          [1900, () => { M.on(...PAGES.map(p => 'pg-' + p)); E.glow([...pageFiles, ...pageScripts], 2600); }],
          [4900, () => { M.on('supa'); E.glow([SUPA], 1700); }],
          [6800, () => { M.on('pg', 'rt'); E.glow([SQL], 2300); }],
          [7600, () => board('The map', 'Six pages, one connection file, one SQL file, one function')],
          [9400, () => { M.on('fn'); E.glow([FN, AN], 2000); }],
        ] },
        { id: 'code-outro-2', min: 11500, say: 'To explore it yourself, run npm run dev, open a session’s control room, and start the built-in audience simulator. Then follow one emit, and see where it lands.', do: [
          [0, () => M.on('supa', 'pg', 'rt', 'fn', 'common', ...PAGES.map(p => 'pg-' + p))],
          [900, () => { title(`<div><div class="mark line">${brandSvg}</div><h1 class="line l2">CrowdPulse</h1><p class="line l3">Follow one <code>emit</code>, and see where it lands.</p><div class="cmd line l4"><b>$</b> npm run dev &nbsp;→&nbsp; localhost:3000</div></div>`, true, 1200); sfx('whoosh'); }],
          [4200, () => board('End card', 'Logo and how to start exploring')],
        ] },
      ],
      tail: 1600,
    },
  ];

  // ============================================================
  // Engine
  // ============================================================
  let actions = [], ai = 0, total = 0, voiced = [], chapters = [], started = false;
  D.script = () => SCENES.flatMap(sc => sc.beats.map(b => ({ id: b.id, text: b.say })));
  D.prepare = async () => {
    const db = await fetch('/fixture/db.json').then(r => r.json());
    const fx = Object.values(db.events)[0];
    if (!fx) throw new Error('no session in film/fixture/db.json');
    S.report = window.__buildReport(fx); // the report scene shows the fixture's finished session
    // the live part starts two and a half minutes before the session's start time, with only tab focus as a passive signal
    clock.now = clock.origin = new Date(fx.startsAt).getTime() - 155000;
    real = { code: fx.code, adminKey: fx.adminKey, title: fx.title, description: fx.description, presenter: fx.presenter, startsAt: fx.startsAt, durationMin: fx.durationMin,
      location: fx.location, accent: fx.accent, settings: { ...fx.settings, passiveCamera: false, passiveRoom: false, listed: true, publicReport: true } };
    S.init(real); S.chatty = 0.6;
    const now = Date.now();
    S.others = [
      { code: 'KX4P7M', title: 'Accessibility clinic: designing for everyone', presenter: 'Priya Shah', status: 'live', startsAt: new Date(now - 23 * 60000).toISOString(), startedAt: now - 23 * 60000,
        durationMin: 60, accent: '#2ee6a6', location: { mode: 'in-person', venue: 'Room 4B' }, online: 18, mood: 74 },
    ];
    localStorage.clear();
    localStorage.setItem('cp.profile', JSON.stringify({ pid: 'p_jordan', name: 'Guest 4821', avatar: '🙂', color: '#7c5cff' }));
    localStorage.setItem('cp.mode', JSON.stringify('slider'));
    await Promise.all(SOURCES.map(load));
    buildTree(); paintEd();
    return { code: real.code, title: real.title };
  };
  D.start = lengths => {
    let t = 0; actions = []; voiced = []; chapters = [];
    for (const sc of SCENES) {
      chapters.push({ id: sc.id, title: sc.title, at: t, code: sc.code, app: sc.app, sound: sc.sound });
      for (const b of sc.beats) {
        const lead = b.lead ?? 250, len = lengths[b.id] || 0;
        const dur = Math.max(b.min || 0, lead + len + (b.gap ?? 650));
        voiced.push({ id: b.id, text: b.say, at: t + lead, end: t + lead + len, scene: sc.id });
        actions.push({ at: t, fn: () => { currentScene = sc.id; currentSay = b.say; hooks.length = 0; } });
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
    paintEd(); paintCursor();
    return elapsed >= total ? 'done' : 'run';
  };
  D.takeBoard = () => { const b = pendingBoard; pendingBoard = null; return b; };
  D.timeline = () => ({ total, chapters, voiced, cues, boards: boardsMeta, steps, code: real?.code, title: real?.title });
  D.errors = () => errors;
  D.clock = () => elapsed;
  D.scene = () => currentScene;
  for (const d of Object.values(DEV)) paintDev(d);
})();
