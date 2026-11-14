// Host dashboard
const { $, $$, esc } = CP;
CP.backdrop();
$('#brand').outerHTML = CP.brand;

// ---------- sign-in ----------
// Hosts sign in by email (a magic link back to this page). Only addresses on the host list (public.hosts) can create
// sessions; anyone signed in can still open sessions they were given a co-host link for.
let isHost = false;
async function paintAuth() {
  let st = { email: null, isHost: false };
  try { st = await CP.rpc('cp_host_status'); } catch (e) { CP.toast('📡 ' + e.message, 6000); }
  isHost = !!st.isHost;
  $('#create').classList.toggle('hidden', !isHost);
  $('.layout').style.gridTemplateColumns = isHost ? '' : '1fr';
  $('#signin').classList.toggle('hidden', isHost);
  $('#who').innerHTML = st.email ? `${esc(st.email)} · <button class="btn sm ghost" id="signout" type="button">Sign out</button>` : '';
  $('#signout')?.addEventListener('click', async () => { await CP.sb.auth.signOut(); location.replace(CP.page('admin.html')); });
  if (st.email && !isHost) $('#signinNote').innerHTML = `Signed in as <b>${esc(st.email)}</b>, which isn't on the host list. Ask whoever runs this site to add it.`;
}
$('#signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = String(new FormData(e.target).get('email') || '').trim();
  const btn = e.target.querySelector('button'); btn.disabled = true;
  const { error } = await CP.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: CP.page('admin.html') } });
  btn.disabled = false;
  $('#signinNote').textContent = error ? '⚠️ ' + signinErrorText(error) : `📬 Check ${email} for a sign-in link, and open it in this browser.`;
});
// Supabase's raw rate-limit messages aren't much help to a host, so say what to do instead.
function signinErrorText(error) {
  const wait = /after (\d+) seconds?/i.exec(error.message || '');
  if (wait) return `A link was just sent to this address. Wait ${wait[1]} seconds before asking for another.`;
  if (error.code === 'over_email_send_rate_limit' || error.status === 429 || /rate limit/i.test(error.message || ''))
    return 'Too many sign-in emails were sent recently. Try again in a little while, or use a link you were already sent.';
  return error.message;
}

// default date: next half hour
const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
$('[name=startsAt]').value = local;
$('[name=presenter]').value = CP.store.get('cp.presenter', '');

// attendee cameras need https on phones: show how to switch it on
const joinBase = CP.joinUrl('X');
function paintHttpsHint() {
  const slot = $('#httpsHint'); slot.innerHTML = '';
  const hint = $('[name=passiveCamera]').checked && CP.httpsHint(joinBase);
  if (hint) slot.appendChild(hint);
}
$('[name=passiveCamera]').addEventListener('change', paintHttpsHint);

// location mode
let locMode = 'virtual';
$$('#locMode button').forEach(b => b.onclick = () => {
  locMode = b.dataset.v; $$('#locMode button').forEach(x => x.classList.toggle('on', x === b));
  $('#locPhysical').classList.toggle('hidden', locMode === 'virtual');
  $('#locVirtual').classList.toggle('hidden', locMode === 'in-person');
});

// accent swatches
const ACCENTS = ['#7c5cff', '#ff5ca8', '#2ee6d6', '#ffb547', '#3ec5ff', '#ff7a45', '#b6f35c', '#c86bff'];
let accent = ACCENTS[0];
$('#swatches').innerHTML = ACCENTS.map((c, i) => `<button type="button" style="--c:${c}" class="${i ? '' : 'on'}" data-c="${c}" aria-label="Accent ${c}"></button>`).join('');
$$('#swatches button').forEach(b => b.onclick = () => { accent = b.dataset.c; $$('#swatches button').forEach(x => x.classList.toggle('on', x === b)); document.documentElement.style.setProperty('--accent', accent); });

$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  CP.store.set('cp.presenter', f.get('presenter'));
  const body = {
    title: f.get('title'), description: f.get('description'), presenter: f.get('presenter'),
    startsAt: new Date(f.get('startsAt')).toISOString(), durationMin: Number(f.get('durationMin')), accent,
    location: { mode: locMode, venue: f.get('venue'), address: f.get('address'), url: f.get('url') },
    settings: Object.fromEntries(['chat', 'qa', 'reactions', 'showCrowdMood', 'publicReport', 'listed', 'passiveTab', 'passiveCamera', 'passiveRoom'].map(k => [k, f.get(k) === 'on'])),
  };
  try {
    const ev = withLinks(await CP.rpc('cp_create_event', { _b: body }));
    remember(ev); e.target.reset(); paintHttpsHint(); $('[name=startsAt]').value = local; $('[name=presenter]').value = body.presenter;
    success(ev); load();
  } catch (err) { CP.toast('⚠️ ' + err.message); }
});

const withLinks = ev => ({ ...ev, joinUrl: CP.joinUrl(ev.code) });
const remember = ev => { const keys = CP.store.get('cp.keys', {}); keys[ev.code] = ev.adminKey; CP.store.set('cp.keys', keys); };

function success(ev) {
  CP.confetti();
  const m = CP.h(`<div class="modal-back"><div class="modal card glow center">
    <div class="eyebrow">Session created</div><h2 style="margin:6px 0 4px">${esc(ev.title)}</h2>
    <div class="muted" style="font-size:.9rem">${CP.fmtDate(ev.startsAt)}</div>
    <div class="success-qr"><img src="${CP.qrFor(ev.code)}" alt="QR code"></div>
    <div class="big-code">${[...ev.code].map((c, i) => `<span style="animation-delay:${.4 + i * .08}s">${c}</span>`).join('')}</div>
    <div class="muted mono" style="font-size:.85rem;margin:8px 0 18px;overflow-wrap:anywhere">${esc(ev.joinUrl)}</div>
    <div class="row wrap-row" style="justify-content:center">
      <button class="btn sm" data-copy>🔗 Copy link</button>
      <a class="btn sm" href="${CP.page('stage.html', { code: ev.code })}" target="_blank">📺 Stage view</a>
      <a class="btn sm primary" href="${CP.adminUrl(ev.code)}">🎛️ Open control room</a>
    </div>
    <button class="btn ghost sm" data-close style="margin-top:14px">Close</button></div></div>`);
  document.body.appendChild(m);
  m.querySelector('[data-copy]').onclick = () => CP.copy(ev.joinUrl, 'Join link copied');
  m.querySelector('[data-close]').onclick = () => m.remove();
  m.onclick = e => { if (e.target === m) m.remove(); };
}

function qrZoom(ev) {
  const m = CP.h(`<div class="modal-back"><div class="modal card center"><div class="success-qr" style="width:min(80vw,420px);height:min(80vw,420px)"><img src="${CP.qrFor(ev.code)}"></div><div class="big-code">${ev.code}</div><div class="muted mono">${esc(ev.joinUrl)}</div></div></div>`);
  m.onclick = () => m.remove(); document.body.appendChild(m);
}

let events = [], filt = 'all';
$$('#filter button').forEach(b => b.onclick = () => { filt = b.dataset.v; $$('#filter button').forEach(x => x.classList.toggle('on', x === b)); render(); });

async function load() {
  try { events = (await CP.rpc('cp_list_events')).map(withLinks); events.forEach(remember); render(); } catch (e) { CP.toast('⚠️ ' + e.message); }
}
function render() {
  const list = events.filter(e => filt === 'all' || e.status === filt);
  const host = $('#events');
  if (!list.length) { host.innerHTML = `<div class="card empty"><span class="big">🎤</span>${isHost ? 'No sessions here yet — create your first one!' : 'Sign in to create sessions. Sessions you open from a co-host link show up here too.'}</div>`; return; }
  host.innerHTML = '';
  list.forEach((ev, i) => {
    const card = CP.h(`<article class="card ev-card" style="--ac:${ev.accent};animation-delay:${i * 60}ms">
      <span class="accent-bar"></span>
      <div class="qr" title="Show QR"><img src="${CP.qrFor(ev.code)}" alt="QR" loading="lazy"></div>
      <div style="min-width:0">
        <div class="row wrap-row" style="gap:8px"><span class="pill ${ev.status}">${ev.status.toUpperCase()}</span><span class="code-chip" title="Copy join link">${ev.code}</span>${ev.simulating ? '<span class="pill">🤖 DEMO</span>' : ''}</div>
        <h3 style="margin-top:8px">${esc(ev.title)}</h3>
        <div class="ev-meta"><span>🗓️ ${CP.fmtDate(ev.startsAt)}</span><span>⏱️ ${ev.durationMin} min</span><span>${CP.locationText(ev.location)}</span></div>
        <div class="ev-stats"><span><b>${ev.stats.participants}</b> joined</span><span><b>${ev.stats.online}</b> online</span><span><b>${ev.stats.ratings}</b> ratings</span><span><b>${ev.stats.messages}</b> msgs</span>${ev.stats.avg != null ? `<span>mood <b style="color:${CP.moodColor(ev.stats.avg)}">${Math.round(ev.stats.avg)}</b></span>` : ''}</div>
        <div class="row wrap-row" style="gap:8px">
          <a class="btn sm primary" href="${CP.adminUrl(ev.code)}">🎛️ Control room</a>
          <a class="btn sm" href="${CP.page('stage.html', { code: ev.code })}" target="_blank">📺 Stage</a>
          <a class="btn sm" href="${CP.page('report.html', { code: ev.code })}">📊 Report</a>
          <button class="btn sm ghost" data-cohost title="Copy a link that lets someone else run this session">🔑 Co-host link</button>
          <button class="btn sm ghost" data-dup title="Duplicate">⧉</button>
          <button class="btn sm ghost danger" data-del title="Delete">🗑️</button>
        </div>
      </div></article>`);
    card.querySelector('.qr').onclick = () => qrZoom(ev);
    card.querySelector('.code-chip').onclick = () => CP.copy(ev.joinUrl, 'Join link copied');
    card.querySelector('[data-cohost]').onclick = () => CP.copy(CP.adminUrl(ev.code, ev.adminKey), 'Co-host link copied. Anyone with it can run this session');
    card.querySelector('[data-dup]').onclick = async () => { try { remember(await CP.rpc('cp_duplicate_event', { _c: ev.code })); CP.toast('⧉ Duplicated'); load(); } catch (e) { CP.toast('⚠️ ' + e.message); } };
    card.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Delete "${ev.title}" and all its data? This cannot be undone.`)) return;
      try { await CP.rpc('cp_delete_event', { _c: ev.code }); CP.toast('🗑️ Deleted'); load(); } catch (e) { CP.toast('⚠️ ' + e.message); }
    };
    host.appendChild(card);
  });
}
paintAuth().then(load); setInterval(load, 10000);
