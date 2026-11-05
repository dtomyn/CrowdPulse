// Builds film/fixture/db.json: a 30-minute session, simulated second by second through the app's own
// passive-signal code (lib/passive.js), so the explainer's report scene shows a complete, reproducible report.
//   node film/fixture.js
// The story: a warm intro, a deep dive people rate lower but follow closely ("engaged but critical"),
// a live demo with laughter and applause, a results section people rate well while drifting away
// ("polite but distracted"), then Q&A and a strong close.
const fs = require('fs');
const path = require('path');
const passive = require('../lib/passive');
const { buildReport } = require('../lib/analytics');

let seed = 20261104;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rand = (a, b) => a + rnd() * (b - a);
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = v => Math.max(0, Math.min(100, v));
let idn = 0;
const uid = () => 'fx' + (++idn).toString(36).padStart(5, '0');

const CODE = 'DSN26F';
const STARTS = Date.parse('2026-11-04T21:00:00.000Z');
const T0 = STARTS + 60000;
const LEN = 30 * 60;
const MIN = 60;

const CHAPTERS = [[20, '👋 Intro'], [4 * MIN, '🧠 Deep dive'], [10 * MIN, '💻 Live demo'], [17 * MIN, '📊 Results'], [23 * MIN, '🙋 Q&A'], [28 * MIN, '🎯 Wrap-up']];
// [second, mood target, attention target]
const MOOD = [[0, 58, 74], [180, 68, 80], [240, 64, 82], [380, 50, 86], [520, 52, 84], [600, 66, 82], [760, 80, 84], [900, 84, 86], [1000, 82, 84],
  [1020, 74, 70], [1100, 73, 44], [1300, 72, 40], [1380, 70, 50], [1400, 74, 78], [1600, 78, 82], [1700, 80, 84], [1800, 82, 82]];
const LAUGHS = [740, 832, 905, 968];
const CLAPS = [1012, 1790];
const lerp = (k, s) => {
  for (let i = 1; i < MOOD.length; i++) if (s <= MOOD[i][0]) {
    const [a, ...va] = MOOD[i - 1], [b, ...vb] = MOOD[i]; const f = (s - a) / (b - a); return va[k] + (vb[k] - va[k]) * f;
  }
  return MOOD[MOOD.length - 1][k + 1];
};
const moodAt = s => lerp(0, s), attAt = s => lerp(1, s);

const NAMES = ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Kai', 'Isla', 'Omar', 'Priya', 'Leo', 'Yuki', 'Sven', 'Amara', 'Diego', 'Nora', 'Ezra', 'Lena',
  'Ravi', 'Chloe', 'Mateo', 'Freya', 'Jonas', 'Aisha', 'Theo', 'Ines', 'Hugo', 'Maya', 'Felix', 'Sara', 'Arjun', 'Elsa', 'Kofi', 'Luna', 'Max',
  'Rosa', 'Ivan', 'Nia', 'Oscar', 'Tara', 'Ben', 'Wren', 'Hana'];
const AVATARS = ['🦊', '🐼', '🐙', '🦄', '🐯', '🐸', '🦉', '🐨', '🐧', '🦁', '🐳', '🦖', '🐝', '🦋', '🐢', '🦩'];
const COLORS = ['#ff6b9d', '#7c5cff', '#2ee6a6', '#ffb547', '#3ec5ff', '#ff7a45', '#c86bff', '#5ef0ff'];
const MODES = ['slider', 'slider', 'slider', 'smiley', 'stars', 'dial', 'weather', 'thermo', 'emoji', 'thumbs'];
const LINES = {
  high: ['This is fantastic 🔥', 'Love this section!', 'Wow, mind blown 🤯', 'Super clear explanation', 'Best talk today', 'So useful, thanks!',
    'Great demo!!', 'This is gold 💯', 'Amazing visuals', 'Taking so many notes', '👏👏👏', 'Brilliant point'],
  mid: ['Interesting', 'Makes sense', 'Good point', 'Following along', 'Nice', 'Hmm, curious about this', 'Solid so far', 'Agree with that'],
  low: ['A bit dense here', 'Could you slow down?', 'Not sure I agree', 'Hard to follow the token naming', 'Is this worth the migration cost?'],
};
const SCRIPTED = [[30, 'Excited for this one!'], [395, 'Tough love for our old design system 😅'], [450, 'Hard to follow the token naming'],
  [745, 'That live bug 😂😂'], [835, 'The component swap is so slick'], [906, '😂 the dark mode toggle'], [1013, 'Bravo! 👏👏👏'],
  [1130, 'Sorry, catching up on email'], [1190, 'Will the slides be shared?'], [1260, 'Same, multitasking a bit'], [1415, 'Great question!'],
  [1795, 'Thank you, this was excellent!']];
const QUESTIONS = [[420, 'How do you version tokens across platforms?', 26], [560, 'What did the migration cost you?', 14], [1150, 'Will the slides be shared?', 19],
  [1440, 'How do you get designers and engineers to agree on names?', 22], [1500, 'Can we see the repo?', 9], [1560, 'What would you do differently next time?', 11]];
const WORDS = ['inspiring', 'practical', 'insightful', 'clear', 'engaging', 'eye-opening', 'useful', 'dense', 'fun', 'brilliant'];

const ev = {
  code: CODE, adminKey: 'film0f1x7ure0key0demo', title: 'The Future of Design Systems',
  description: 'A tour of tokens, theming and the tools that keep big teams consistent.', presenter: 'Alex Rivera',
  startsAt: new Date(STARTS).toISOString(), durationMin: 30,
  location: { mode: 'hybrid', venue: 'Main Hall', address: '', url: 'https://meet.example.com/design' }, accent: '#7c5cff',
  settings: { chat: true, qa: true, reactions: true, publicReport: true, showCrowdMood: true, passiveTab: true, passiveCamera: true, passiveRoom: true },
  status: 'ended', createdAt: STARTS - 3 * 86400000, startedAt: T0, endedAt: T0 + LEN * 1000,
  participants: {}, ratings: [], latest: {}, reactions: [], messages: [], questions: [], polls: [], feedback: {},
  pulseHistory: [], markers: [], announcements: [], passive: [], passiveLatest: {}, roomSignals: [],
};

const bots = NAMES.map((name, i) => ({
  pid: `p_${(i * 7919).toString(36)}${i}`, name, avatar: AVATARS[i % AVATARS.length], color: COLORS[i % COLORS.length], mode: MODES[i % MODES.length],
  bias: rand(-14, 12), jitter: rand(2, 7), attBias: rand(-10, 8), camera: rnd() < 0.45, v: null, next: rand(2, 20), away: false, nextPassive: rand(0, 10),
}));
for (const b of bots) ev.participants[b.pid] = { id: b.pid, name: b.name, avatar: b.avatar, color: b.color, joinedAt: STARTS - rand(10, 200) * 1000, lastSeen: ev.endedAt };
ev.participants.presenter = { id: 'presenter', name: 'Alex Rivera', avatar: '🎤', color: '#7c5cff', joinedAt: STARTS - 300000, presenter: true };
const onlineMap = new Map(bots.map(b => [b.pid, 1]));
const at = s => T0 + Math.round(s * 1000);
const msg = (b, text, s, role = 'guest') => ev.messages.push({ id: uid(), pid: b ? b.pid : 'system', name: b ? b.name : 'CrowdPulse', avatar: b ? b.avatar : '✨', color: b ? b.color : '#7c5cff', text, t: at(s), role });

msg(null, '🎬 The session is now live! Rate along as you go.', 0, 'system');
const scripted = [...SCRIPTED], qs = [...QUESTIONS];
let tick = 0;
for (let s = 0; s <= LEN; s++) {
  const now = at(s), mood = moodAt(s), att = attAt(s);
  for (const [cs, label] of CHAPTERS) if (cs === s) { ev.markers.push({ label, t: now }); msg(null, `📍 Now: ${label}`, s, 'system'); }
  for (const b of bots) {
    if (s >= b.next) {
      const goal = clamp(mood + b.bias + rand(-b.jitter, b.jitter));
      b.v = b.v == null ? goal : b.v + (goal - b.v) * 0.6;
      let v = Math.round(b.v);
      if (['smiley', 'stars', 'weather', 'emoji'].includes(b.mode)) v = Math.round(v / 25) * 25;
      ev.ratings.push({ pid: b.pid, v, t: now, mode: b.mode });
      ev.latest[b.pid] = { i: ev.ratings.length - 1, t: now };
      b.next = s + rand(15, 45);
    }
    if (s >= b.nextPassive) {
      const a = clamp(att + b.attBias);
      if (rnd() < 0.4) b.away = rnd() < Math.max(0.03, (78 - a) / 70);
      const cam = b.camera ? { att: clamp(a + rand(-6, 6) - (b.away ? 40 : 0)), pos: clamp(((b.v ?? mood) - 38) * 1.25 + rand(-8, 8)), fat: clamp((s / LEN) * 14 + (80 - a) * 0.5 + rand(-4, 6)) } : null;
      passive.record(ev, b.pid, { vis: b.away ? rand(0.05, 0.4) : rand(0.88, 1), act: Math.round(rand(0, 4)), cam }, now);
      b.nextPassive = s + rand(9, 12);
    }
    const r = rnd(), m = b.v ?? mood;
    if (r < 0.0016 * (m > 78 ? 2.2 : m > 60 ? 1 : 0.5)) ev.reactions.push({ pid: b.pid, e: m > 78 ? pick(['🔥', '👏', '🤯', '❤️', '🎉']) : m > 55 ? pick(['👏', '❤️', '🤔']) : pick(['🤔', '😴']), t: now });
    if (rnd() < 0.0011) msg(b, pick(m > 74 ? LINES.high : m > 56 ? LINES.mid : LINES.low), s);
  }
  for (const L of LAUGHS) if (s >= L && s < L + 4) for (let k = 0; k < 6; k++) ev.reactions.push({ pid: pick(bots).pid, e: '😂', t: now + k * 120 });
  for (const C of CLAPS) if (s >= C && s < C + 6) for (let k = 0; k < 5; k++) ev.reactions.push({ pid: pick(bots).pid, e: pick(['👏', '👏', '🎉']), t: now + k * 150 });
  while (scripted.length && scripted[0][0] <= s) { const [, text] = scripted.shift(); msg(pick(bots), text, s); }
  while (qs.length && qs[0][0] <= s) {
    const [, text, votes] = qs.shift(); const b = pick(bots);
    ev.questions.push({ id: uid(), pid: b.pid, name: b.name, avatar: b.avatar, text, t: now, votes: bots.slice(0, votes).map(x => x.pid), answered: s < 1500, hidden: false });
  }
  if (s === 9 * MIN) ev.polls.push({ id: uid(), question: 'How is the pace?', options: [{ text: 'Too slow 🐢', votes: 0 }, { text: 'Just right 👌', votes: 0 }, { text: 'Too fast 🐇', votes: 0 }], voters: {}, open: true, t: now });
  if (s > 9 * MIN && s < 10 * MIN) { const p = ev.polls[0]; const b = bots[(s - 541) % bots.length]; if (b && !(b.pid in p.voters)) { const x = rnd(); const i = x < 0.62 ? 1 : x < 0.88 ? 2 : 0; p.voters[b.pid] = i; p.options[i].votes++; } }
  if (s === 10 * MIN) ev.polls[0].open = false;
  if (s % 2 === 0) {
    const recent = ev.reactions.filter(x => now - x.t < 4000 && x.t <= now);
    const laughs = recent.filter(x => x.e === '😂').length, claps = recent.filter(x => x.e === '👏' || x.e === '🎉').length;
    const ra = clamp(att * 0.95 + rand(-4, 4)), faces = 30 + Math.round(rand(-2, 2));
    passive.recordRoom(ev, { faces, looking: Math.round(faces * ra / 100), attention: ra, laughter: clamp(laughs * 4 + rand(0, 6)), applause: clamp(claps * 4 + rand(0, 5)), level: clamp(32 + laughs * 2 + claps * 2 + rand(-4, 4)) }, now);
  }
  if (s % 5 === 0 && s > 0) {
    tick++;
    const vals = Object.values(ev.latest).map(l => ev.ratings[l.i].v);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const rr = ev.reactions.filter(x => now - x.t < 60000 && x.t <= now).length, mm = ev.messages.filter(x => now - x.t < 60000 && x.t <= now).length;
    const energy = Math.min(100, Math.round(((rr + mm * 2) / bots.length) * 25));
    const p = passive.aggregate(ev, onlineMap, now);
    ev.pulseHistory.push({ t: now, avg: avg == null ? null : Math.round(avg * 10) / 10, n: vals.length, online: bots.length, energy, ...passive.historyFields(p) });
    ev.lastPulse = { t: now, avg, n: vals.length, online: bots.length, passive: p };
  }
}
ev.reactions.sort((a, b) => a.t - b.t);
msg(null, '🏁 The session has ended — thanks for joining! Please leave a quick review.', LEN, 'system');
for (const b of bots) {
  const base = clamp((b.v ?? 70) + rand(-6, 8));
  ev.feedback[b.pid] = {
    stars: Math.max(1, Math.min(5, Math.round(base / 20 + rand(0, 0.8)))), nps: Math.max(0, Math.min(10, Math.round(base / 10 + rand(0.5, 2.5)))), word: pick(WORDS),
    comment: rnd() < 0.35 ? pick(base > 70 ? LINES.high : LINES.mid) : '', aspects: { content: Math.round(clamp(base + rand(-8, 8)) / 20), delivery: Math.round(clamp(base + rand(-5, 10)) / 20), visuals: Math.round(clamp(base + rand(0, 12)) / 20), pace: Math.round(clamp(base + rand(-14, 4)) / 20) },
    t: ev.endedAt + rand(5, 120) * 1000,
  };
}

const out = path.join(__dirname, 'fixture');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'db.json'), JSON.stringify({ events: { [CODE]: ev } }));
const r = buildReport(ev);
console.log('wrote', path.join(out, 'db.json'), Math.round(fs.statSync(path.join(out, 'db.json')).size / 1024), 'KB');
console.log('grade', r.kpis.grade.letter, r.kpis.overall, '| attention', r.passive?.attention?.avg, '| r', r.passive?.correlation?.r, r.passive?.correlation?.label);
console.log('gaps', (r.passive?.saidVsShown || []).map(g => `${g.kind} ${Math.round(g.start / 1000)}-${Math.round(g.end / 1000)}s ${g.chapter} r${g.rating}/a${g.attention}`).join(' | '));
console.log('laughs', r.passive?.laughter?.count, 'claps', r.passive?.applause?.count, '| chapters', r.chapters.map(c => `${c.label}:${c.avg}/${c.attention}`).join(' '));
