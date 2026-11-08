// Home page: join with a code
const { $, $$ } = CP;
CP.backdrop();
$('#brand').outerHTML = CP.brand;
CP.reveal();

// code boxes
const boxes = $('#boxes');
for (let i = 0; i < 6; i++) boxes.insertAdjacentHTML('beforeend', `<input maxlength="1" autocomplete="off" inputmode="text" aria-label="Code character ${i + 1}">`);
const ins = $$('input', boxes);
ins.forEach((inp, i) => {
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    inp.classList.toggle('filled', !!inp.value);
    if (inp.value && ins[i + 1]) ins[i + 1].focus();
    if (ins.every(x => x.value)) $('#join').requestSubmit();
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
  inp.addEventListener('paste', e => {
    e.preventDefault(); const t = (e.clipboardData.getData('text') || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
    [...t].forEach((c, j) => { ins[j].value = c; ins[j].classList.add('filled'); }); ins[Math.min(5, t.length)].focus();
    if (t.length === 6) $('#join').requestSubmit();
  });
});
ins[0].focus();
$('#join').addEventListener('submit', async e => {
  e.preventDefault();
  const code = ins.map(x => x.value).join('');
  if (code.length < 6) { $('#join').classList.add('shake'); setTimeout(() => $('#join').classList.remove('shake'), 500); return; }
  const r = await fetch('/api/events/' + code + '/public');
  if (!r.ok) { CP.toast('🤔 No session found with code ' + code); $('#join').classList.add('shake'); setTimeout(() => $('#join').classList.remove('shake'), 500); return; }
  location.href = '/e/' + code;
});

// hero demo animation
const g = CP.gauge($('#demoGauge'));
const chart = CP.pulseChart($('#demoChart'), { windowMs: 60000, showOnline: false });
const faces = $$('#demoFaces span');
let t = 0;
const now = Date.now();
for (let i = 60; i > 0; i--) chart.push({ t: now - i * 1000, avg: 62 + 20 * Math.sin((60 - i) / 9), online: 120 });
setInterval(() => {
  t++;
  const v = Math.max(5, Math.min(97, 62 + 20 * Math.sin((60 + t) / 9) + (Math.random() * 8 - 4)));
  g.set(v); chart.push({ t: Date.now(), avg: v, online: 120 });
  faces.forEach((f, i) => f.classList.toggle('on', i === Math.min(4, Math.floor(v / 20))));
  if (Math.random() < .35) CP.floatEmoji(['👏', '🔥', '🤯', '❤️', '😂'][Math.floor(Math.random() * 5)], { x: 55 + Math.random() * 40, size: 1.6 });
}, 1000);

// "Happening now": sessions their hosts chose to list publicly
const nowList = $('#nowList');
const ago = t => { const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'just started' : m < 60 ? `${m} min in` : `${Math.floor(m / 60)}h ${m % 60}m in`; };
async function loadNow() {
  let list;
  try { const r = await fetch('/api/live', { cache: 'no-store' }); if (!r.ok) return; list = await r.json(); } catch { return; }
  $('#nowEmpty').classList.toggle('hidden', list.length > 0);
  const live = list.filter(e => e.status === 'live').length;
  $('#nowCount').textContent = list.length ? `${live} live · ${list.length - live} coming up` : '';
  nowList.innerHTML = list.map(e => {
    const where = { 'in-person': '🏢 In person', virtual: '💻 Virtual', hybrid: '🌐 Hybrid' }[e.location?.mode] || '';
    const meta = [e.presenter && '🎤 ' + CP.esc(e.presenter), where + (e.location?.venue && e.location.mode !== 'virtual' ? ' · ' + CP.esc(e.location.venue) : '')].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const when = e.status === 'live' ? `${ago(e.startedAt || e.startsAt)} · ${e.online} in the room` : `🗓️ ${CP.fmtDate(e.startsAt)}`;
    const mood = e.mood != null ? `<span class="mood" style="color:${CP.moodColor(e.mood)}" title="Crowd mood">${CP.mood(e.mood).emoji} ${e.mood}</span>` : '';
    return `<article class="card nowcard" style="--ac:${CP.esc(e.accent)}">
      <div class="row"><span class="pill ${e.status === 'live' ? 'live' : 'scheduled'}">${e.status === 'live' ? 'LIVE' : 'SOON'}</span><span class="spacer"></span>${mood}</div>
      <h3>${CP.esc(e.title)}</h3>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      <div class="meta">${when}</div>
      <a class="btn ${e.status === 'live' ? 'primary' : ''} sm" href="/e/${encodeURIComponent(e.code)}">${e.status === 'live' ? 'Join →' : 'Wait in the lobby →'}</a>
    </article>`;
  }).join('');
}
loadNow();
setInterval(() => { if (!document.hidden) loadNow(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNow(); });
