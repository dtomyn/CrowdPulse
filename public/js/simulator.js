// Demo-mode audience simulator: bot attendees whose mood follows a shared "story arc", so presenters can preview
// every live visual and the final report. It runs in the control room and sends each second's bot actions to the
// database in one batch (the 'sim' admin action), so it stops when the control room closes.
(function () {
  const NAMES = ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Kai', 'Isla', 'Omar', 'Priya', 'Leo', 'Yuki', 'Sven', 'Amara', 'Diego',
    'Nora', 'Ezra', 'Lena', 'Ravi', 'Chloe', 'Mateo', 'Freya', 'Jonas', 'Aisha', 'Theo', 'Ines', 'Hugo', 'Maya', 'Felix',
    'Sara', 'Arjun', 'Elsa', 'Kofi', 'Luna', 'Max', 'Rosa', 'Ivan', 'Nia', 'Oscar', 'Tara', 'Ben'];
  const AVATARS = ['🦊', '🐼', '🐙', '🦄', '🐯', '🐸', '🦉', '🐨', '🐧', '🦁', '🐳', '🦖', '🐝', '🦋', '🐢', '🦩'];
  const COLORS = ['#ff6b9d', '#7c5cff', '#2ee6a6', '#ffb547', '#3ec5ff', '#ff7a45', '#c86bff', '#5ef0ff'];
  const MODES = ['slider', 'slider', 'slider', 'smiley', 'stars', 'dial', 'weather', 'thermo', 'emoji', 'thumbs', 'tilt'];
  const LINES = {
    high: ['This is fantastic 🔥', 'Love this section!', 'Wow, mind blown 🤯', 'Super clear explanation', 'Best talk today', 'So useful, thanks!',
      'Great demo!!', 'This is gold 💯', 'Amazing visuals', 'Taking so many notes', '👏👏👏', 'Brilliant point'],
    mid: ['Interesting', 'Makes sense', 'Can you share the slides?', 'Good point', 'Following along', 'Nice', 'Hmm, curious about this',
      'Where can I learn more?', 'Solid so far', 'Agree with that'],
    low: ['A bit lost here', 'Slides are hard to read', 'Could you slow down?', 'Bit boring tbh', 'Audio is quiet', 'Confusing part',
      'Not sure I follow', 'Too long on this topic'],
  };
  const QUESTIONS = ['How does this scale to large teams?', 'Will the recording be shared?', 'What tools do you recommend for getting started?',
    'How would you handle legacy systems?', 'What was the biggest surprise in your research?', 'Can you go back to the previous slide?',
    'How do you measure success here?', 'Is there an open-source version?', 'What would you do differently next time?',
    'How long did this take to build?'];
  const WORDS = ['inspiring', 'insightful', 'fun', 'clear', 'practical', 'engaging', 'long', 'brilliant', 'useful', 'dense', 'energizing', 'eye-opening'];
  const ASPECTS = ['content', 'delivery', 'visuals', 'pace'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = v => Math.max(0, Math.min(100, v));
  // Shared narrative arc: warm-up, a dip, a big peak, a cooldown — cycles every ~4 minutes.
  const arc = sec => { const phase = (sec % 240) / 240; return 62 + 18 * Math.sin(phase * Math.PI * 2 - 0.6) + 9 * Math.sin(phase * Math.PI * 6) - (phase > 0.35 && phase < 0.45 ? 22 : 0); };

  // getState() -> { event, questions, polls } as the control room currently sees them
  // send(ops) -> sends one batch of bot actions
  CP.simulator = ({ getState, send }) => {
    let timer = null, bots = [], t0 = 0, busy = false;
    const voted = new Set(), reviewed = new Set();
    const recentReacts = [];

    function start(count = 24) {
      stop();
      bots = []; voted.clear(); reviewed.clear();
      const ops = [];
      for (let i = 0; i < count; i++) {
        const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
        const b = { i, name, avatar: pick(AVATARS), color: pick(COLORS), mode: pick(MODES), bias: rand(-18, 15), jitter: rand(3, 10),
          chatty: rand(0.01, 0.06), reacty: rand(0.008, 0.05), v: null, camera: Math.random() < 0.45, away: false, lastPassive: 0 };
        bots.push(b);
        ops.push({ op: 'join', i, name: b.name, avatar: b.avatar, color: b.color });
      }
      t0 = Date.now();
      send(ops);
      timer = setInterval(tick, 1000);
    }

    function stop() { clearInterval(timer); timer = null; }

    async function tick() {
      if (busy) return; // don't pile up requests on a slow connection
      const { event: ev, questions = [], polls = [] } = getState() || {};
      if (!ev) return;
      const ops = [];
      const now = Date.now(), sec = (now - t0) / 1000, target = arc(sec), live = ev.status === 'live';
      while (recentReacts.length && now - recentReacts[0].t > 4000) recentReacts.shift();
      if (live && ev.settings?.passiveRoom) {
        const avg = bots.reduce((x, b) => x + (b.v ?? 60), 0) / Math.max(1, bots.length);
        const faces = Math.round(bots.length * 0.8);
        const laughs = recentReacts.filter(r => r.e === '😂').length, claps = recentReacts.filter(r => r.e === '👏' || r.e === '🎉').length;
        const attention = clamp(avg * 0.7 + 25 + rand(-5, 5));
        ops.push({ op: 'room', i: 0, r: { faces, looking: Math.round(faces * attention / 100), attention, laughter: clamp(laughs * 22 + rand(0, 8)), applause: clamp(claps * 15 + rand(0, 6)), level: clamp(30 + laughs * 10 + claps * 8 + rand(-5, 5)) } });
      }
      const poll = polls.find(p => p.open);
      for (const b of bots) {
        const { i } = b;
        if (live && (b.v == null || Math.random() < 0.28)) {
          const goal = clamp(target + b.bias + rand(-b.jitter, b.jitter));
          b.v = b.v == null ? goal : b.v + (goal - b.v) * 0.5;
          let v = Math.round(b.v);
          if (['smiley', 'stars', 'weather', 'emoji'].includes(b.mode)) v = Math.round(v / 25) * 25; // discrete modes
          ops.push({ op: 'rate', i, v, mode: b.mode });
        }
        const mood = b.v ?? 60;
        if (live && Math.random() < b.reacty * (mood > 75 ? 1.8 : mood < 40 ? 0.6 : 1)) {
          const e = mood > 78 ? pick(['🔥', '👏', '🤯', '❤️', '🎉']) : mood > 55 ? pick(['👏', '😂', '🤔', '❤️']) : pick(['🤔', '😴', '🤔']);
          ops.push({ op: 'react', i, e }); recentReacts.push({ e, t: now });
        }
        if (ev.status !== 'ended' && Math.random() < b.chatty * 0.5) ops.push({ op: 'chat', i, text: pick(mood > 72 ? LINES.high : mood > 48 ? LINES.mid : LINES.low) });
        if (live && Math.random() < 0.0025) ops.push({ op: 'ask', i, text: pick(QUESTIONS) });
        if (live && Math.random() < 0.02) {
          const qs = questions.filter(q => !q.answered);
          if (qs.length) ops.push({ op: 'vote-q', i, qid: pick(qs).id });
        }
        if (poll && !voted.has(poll.id + ':' + i) && Math.random() < 0.15) {
          // weighted toward the first options to make results interesting
          const w = poll.options.map((_, k) => 1 / (k + 1.3) + Math.random() * 0.4);
          let r = Math.random() * w.reduce((a, c) => a + c, 0), idx = 0;
          while ((r -= w[idx]) > 0 && idx < w.length - 1) idx++;
          voted.add(poll.id + ':' + i);
          ops.push({ op: 'poll-vote', i, pollId: poll.id, idx });
        }
        // passive signals: low mood makes people drift to other tabs and look away; high mood brings smiles
        if (live && now - b.lastPassive > 4000 + Math.random() * 1500) {
          b.lastPassive = now;
          const m = b.v ?? 60;
          const awayOdds = m < 45 ? 0.45 : m < 60 ? 0.18 : 0.05;
          if (Math.random() < 0.35) b.away = Math.random() < awayOdds;
          const vis = b.away ? rand(0, 0.45) : rand(0.85, 1);
          const cam = ev.settings?.passiveCamera && b.camera ? {
            att: clamp(m * 0.75 + 22 + rand(-8, 8) - (b.away ? 35 : 0)), pos: clamp((m - 35) * 1.3 + rand(-10, 10)), fat: clamp((62 - m) * 1.1 + rand(-6, 10)),
          } : null;
          ops.push({ op: 'passive', i, p: { vis, act: Math.round(rand(0, 4)), cam } });
        }
        if (ev.status === 'ended' && !reviewed.has(i) && Math.random() < 0.2) {
          reviewed.add(i);
          const base = clamp((b.v ?? 65) + rand(-10, 10));
          const aspects = {};
          ASPECTS.forEach(a => { aspects[a] = Math.max(1, Math.min(5, Math.round(base / 20 + rand(-1, 1)))); });
          ops.push({ op: 'feedback', i, f: {
            stars: Math.max(1, Math.min(5, Math.round(base / 20 + rand(-0.4, 0.6)))), nps: Math.max(0, Math.min(10, Math.round(base / 10 + rand(0, 2.5)))),
            word: pick(WORDS), aspects, comment: Math.random() < 0.4 ? pick(base > 65 ? LINES.high : base > 45 ? LINES.mid : LINES.low) : '',
          } });
        }
      }
      busy = true;
      try { await send(ops); } finally { busy = false; }
    }

    return { start, stop, get running() { return !!timer; } };
  };
})();
