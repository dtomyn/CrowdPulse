// Post-session analytics: turns the raw event log into a rich report.
const { MIN_CROWD } = require('./passive');

const POS = new Set(('love loved great awesome amazing excellent good nice cool wow brilliant fantastic helpful clear ' +
  'insightful interesting fun funny yes agree perfect best smart inspiring useful thanks thank beautiful epic ' +
  'impressive solid sweet neat happy excited enjoy enjoying enjoyed like liked wonderful incredible genius fire ' +
  'clever engaging informative superb stellar').split(' '));
const NEG = new Set(('bad boring slow confusing confused hate hated awful terrible worst meh lost hard unclear ' +
  'tired sleepy no disagree wrong broken annoying long dull sad poor weak noisy quiet cant can\'t lag lagging ' +
  'problem issue fail failed ugh hmm bored repetitive rushed fast').split(' '));
const STOP = new Set(('the a an and or but if of to in on at for with is it this that was are be been i you he she we ' +
  'they me my our your so just very really can do does did not no yes what how why when where who will would ' +
  'could should have has had there here then than too also its it\'s im i\'m about from as by up out all any ' +
  'more some get got like one ok okay oh lol').split(' '));

const EMOJI_LABEL = { '👏': 'Applause', '🔥': 'Fire', '😂': 'Laughs', '🤯': 'Mind blown', '❤️': 'Love', '🤔': 'Hmm', '🎉': 'Party', '😴': 'Sleepy' };

function words(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).map(w => w.replace(/^-+|-+$/g, '')).filter(Boolean);
}

function sentimentOf(text) {
  let s = 0;
  for (const w of words(text)) {
    if (POS.has(w)) s += 1;
    if (NEG.has(w)) s -= 1;
  }
  if (/[!]{2,}/.test(text)) s += s >= 0 ? 0.5 : -0.5;
  if (/(😍|🤩|🔥|❤️|👏|🎉|😂|💯|🙌)/u.test(text)) s += 1;
  if (/(😴|😕|😒|👎|😩|🙄)/u.test(text)) s -= 1;
  return Math.max(-3, Math.min(3, s));
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((acc, x) => acc + (x - m) ** 2, 0) / (a.length - 1));
}
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function grade(score) {
  if (score == null) return { letter: '—', label: 'No ratings yet' };
  const table = [[93, 'A+', 'Standing ovation'], [87, 'A', 'Crowd favourite'], [80, 'A-', 'Excellent'], [75, 'B+', 'Really good'],
    [70, 'B', 'Good'], [65, 'B-', 'Solid'], [58, 'C+', 'Decent'], [50, 'C', 'Mixed'], [40, 'D', 'Tough room'], [0, 'E', 'Rough ride']];
  const row = table.find(r => score >= r[0]);
  return { letter: row[1], label: row[2] };
}

function buildReport(ev) {
  const start = ev.startedAt || ev.createdAt;
  const end = ev.endedAt || Date.now();
  const durationMs = Math.max(1, end - start);
  const participants = Object.values(ev.participants || {}).filter(p => p.id !== 'presenter');
  const humans = participants;
  const ratings = ev.ratings || [];
  const reactions = ev.reactions || [];
  const messages = (ev.messages || []).filter(m => !m.deleted && m.role !== 'system');
  const questions = (ev.questions || []).filter(q => !q.hidden);
  const feedback = Object.values(ev.feedback || {});
  const pulse = ev.pulseHistory || [];

  // Per-participant rating stats
  const byPid = {};
  for (const r of ratings) (byPid[r.pid] ||= []).push(r);
  const perPersonAvg = Object.values(byPid).map(rs => mean(rs.map(r => r.v)));
  const perPersonLast = Object.values(byPid).map(rs => rs[rs.length - 1].v);
  const allValues = ratings.map(r => r.v);

  // Time-weighted crowd average from pulse samples
  const pulseVals = pulse.filter(p => p.avg != null).map(p => p.avg);
  const overall = pulseVals.length ? mean(pulseVals) : mean(perPersonAvg);
  const finalScore = mean(perPersonLast);

  // Histogram of each person's average rating (10 bins)
  const hist = Array(10).fill(0);
  for (const v of perPersonAvg) hist[Math.min(9, Math.floor(v / 10))]++;

  // Mode usage
  const modeUsage = {};
  for (const r of ratings) modeUsage[r.mode || 'slider'] = (modeUsage[r.mode || 'slider'] || 0) + 1;
  const modePeople = {};
  for (const rs of Object.values(byPid)) {
    const m = rs[rs.length - 1].mode || 'slider';
    modePeople[m] = (modePeople[m] || 0) + 1;
  }

  // Bucketed timelines
  const bucketCount = Math.min(60, Math.max(8, Math.round(durationMs / 60000)));
  const bucketMs = durationMs / bucketCount;
  const mkBuckets = () => Array.from({ length: bucketCount }, (_, i) => ({ t: Math.round(i * bucketMs) }));
  const chatTimeline = mkBuckets().map(b => ({ ...b, count: 0, sentiment: 0 }));
  const reactTimeline = mkBuckets().map(b => ({ ...b, count: 0 }));
  const idx = t => Math.max(0, Math.min(bucketCount - 1, Math.floor((t - start) / bucketMs)));
  for (const m of messages) { const b = chatTimeline[idx(m.t)]; b.count++; b.sentiment += sentimentOf(m.text); }
  for (const r of reactions) reactTimeline[idx(r.t)].count++;

  // Reactions breakdown
  const reactCounts = {};
  for (const r of reactions) reactCounts[r.e] = (reactCounts[r.e] || 0) + 1;
  const reactionBreakdown = Object.entries(reactCounts).sort((a, b) => b[1] - a[1])
    .map(([e, n]) => ({ emoji: e, label: EMOJI_LABEL[e] || e, count: n }));

  // Sentiment
  const sentiments = messages.map(m => sentimentOf(m.text));
  const sentimentSplit = {
    positive: sentiments.filter(s => s > 0).length,
    neutral: sentiments.filter(s => s === 0).length,
    negative: sentiments.filter(s => s < 0).length,
  };

  // Word cloud from chat + feedback words + comments
  const freq = {};
  const addText = (txt, weight = 1) => {
    for (const w of words(txt)) if (w.length > 2 && !STOP.has(w)) freq[w] = (freq[w] || 0) + weight;
  };
  messages.forEach(m => addText(m.text));
  questions.forEach(q => addText(q.text));
  feedback.forEach(f => { addText(f.word, 3); addText(f.comment); });
  const wordCloud = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 60)
    .map(([word, count]) => ({ word, count, sentiment: POS.has(word) ? 1 : NEG.has(word) ? -1 : 0 }));

  // Key moments: peaks & dips in pulse history, with context
  const moments = [];
  if (pulse.length > 6) {
    const smooth = pulse.map((p, i) => {
      const win = pulse.slice(Math.max(0, i - 2), i + 3).filter(x => x.avg != null).map(x => x.avg);
      return { t: p.t, avg: win.length ? mean(win) : null };
    }).filter(p => p.avg != null);
    const sorted = [...smooth].sort((a, b) => b.avg - a.avg);
    const pick = (list, kind) => {
      const chosen = [];
      for (const p of list) {
        if (chosen.length >= 3) break;
        if (chosen.every(c => Math.abs(c.t - p.t) > durationMs / 10)) chosen.push(p);
      }
      return chosen.map(p => {
        const near = x => Math.abs(x.t - p.t) < 45000;
        const ctxMsgs = messages.filter(near).slice(-3).map(m => ({ name: m.name, text: m.text }));
        const ctxReacts = {};
        reactions.filter(near).forEach(r => { ctxReacts[r.e] = (ctxReacts[r.e] || 0) + 1; });
        const marker = [...(ev.markers || [])].filter(m => m.t <= p.t).pop();
        return { kind, t: p.t - start, avg: round(p.avg), marker: marker ? marker.label : null, messages: ctxMsgs, reactions: ctxReacts };
      });
    };
    moments.push(...pick(sorted, 'peak'), ...pick([...sorted].reverse(), 'dip'));
  }

  // Chapter (marker) breakdown — mood per presenter-defined section
  const markers = [...(ev.markers || [])].sort((a, b) => a.t - b.t);
  const chapters = markers.map((m, i) => {
    const to = markers[i + 1] ? markers[i + 1].t : end;
    const vals = pulse.filter(p => p.t >= m.t && p.t < to && p.avg != null).map(p => p.avg);
    const rc = reactions.filter(r => r.t >= m.t && r.t < to).length;
    const mc = messages.filter(x => x.t >= m.t && x.t < to).length;
    // attention per chapter: pulse points are already null below the 5-person threshold
    const att = pulse.filter(p => p.t >= m.t && p.t < to && p.att != null).map(p => p.att);
    return { label: m.label, t: m.t - start, durationMs: to - m.t, avg: round(mean(vals)), reactions: rc, messages: mc, attention: round(mean(att)) };
  });

  // Engagement funnel
  const raters = new Set(ratings.map(r => r.pid));
  const chatters = new Set(messages.map(m => m.pid));
  const reactors = new Set(reactions.map(r => r.pid));
  const askers = new Set(questions.map(q => q.pid));
  const pollers = new Set();
  (ev.polls || []).forEach(p => Object.keys(p.voters || {}).forEach(v => pollers.add(v)));
  const reviewers = new Set(Object.keys(ev.feedback || {}));
  const total = humans.length || 1;
  const engaged = new Set([...raters, ...chatters, ...reactors, ...askers, ...pollers]);

  // Contributors leaderboard
  const score = {};
  const bump = (pid, n) => { score[pid] = (score[pid] || 0) + n; };
  messages.forEach(m => bump(m.pid, 3));
  reactions.forEach(r => bump(r.pid, 1));
  questions.forEach(q => { bump(q.pid, 5); bump(q.pid, (q.votes || []).length); });
  Object.keys(byPid).forEach(pid => bump(pid, Math.min(10, byPid[pid].length)));
  const topContributors = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pid, pts]) => {
    const p = ev.participants[pid] || {};
    return {
      name: p.name || 'Guest', avatar: p.avatar || '🙂', color: p.color || '#888', points: pts,
      messages: messages.filter(m => m.pid === pid).length,
      reactions: reactions.filter(r => r.pid === pid).length,
      questions: questions.filter(q => q.pid === pid).length,
    };
  });

  // Feedback
  const stars = feedback.map(f => f.stars).filter(Number.isFinite);
  const nps = feedback.map(f => f.nps).filter(Number.isFinite);
  const promoters = nps.filter(n => n >= 9).length;
  const detractors = nps.filter(n => n <= 6).length;
  const npsScore = nps.length ? Math.round(((promoters - detractors) / nps.length) * 100) : null;
  const aspects = {};
  feedback.forEach(f => Object.entries(f.aspects || {}).forEach(([k, v]) => { (aspects[k] ||= []).push(v); }));
  const aspectAvg = Object.fromEntries(Object.entries(aspects).map(([k, v]) => [k, round(mean(v))]));

  // Peak concurrency & retention
  const peakOnline = pulse.reduce((m, p) => Math.max(m, p.online || 0), 0);
  const retention = pulse.map(p => ({ t: p.t - start, online: p.online || 0 }));

  // Volatility: average absolute change between pulse samples
  let volatility = 0;
  for (let i = 1; i < pulseVals.length; i++) volatility += Math.abs(pulseVals[i] - pulseVals[i - 1]);
  volatility = pulseVals.length > 1 ? volatility / (pulseVals.length - 1) : 0;

  // Mood segments: % of time crowd spent in each mood zone
  const zones = [0, 0, 0, 0, 0];
  pulseVals.forEach(v => zones[Math.min(4, Math.floor(v / 20))]++);
  const zonePct = zones.map(z => (pulseVals.length ? Math.round((z / pulseVals.length) * 100) : 0));

  // Fun superlatives
  const busiestChat = chatTimeline.reduce((a, b) => (b.count > a.count ? b : a), chatTimeline[0] || { count: 0, t: 0 });
  const topReaction = reactionBreakdown[0] || null;
  const mostUpvoted = [...questions].sort((a, b) => (b.votes || []).length - (a.votes || []).length)[0];
  const startAvg = mean(pulseVals.slice(0, Math.max(1, Math.floor(pulseVals.length / 5))));
  const endAvg = mean(pulseVals.slice(-Math.max(1, Math.floor(pulseVals.length / 5))));

  const g = grade(overall);
  const insights = [];
  if (overall != null) insights.push(`The crowd averaged ${round(overall)} / 100 across the session — "${g.label}".`);
  if (startAvg != null && endAvg != null && pulseVals.length > 5) {
    const d = endAvg - startAvg;
    if (Math.abs(d) >= 5) insights.push(`Mood ${d > 0 ? 'climbed' : 'slipped'} by ${round(Math.abs(d))} points from the opening to the close.`);
    else insights.push('Mood stayed remarkably steady from start to finish.');
  }
  if (zonePct[4] > 25) insights.push(`The room spent ${zonePct[4]}% of the session in the 🤩 "Amazing" zone.`);
  if (zonePct[0] + zonePct[1] > 30) insights.push(`About ${zonePct[0] + zonePct[1]}% of the time the room leaned negative — check the dips below.`);
  if (topReaction) insights.push(`${topReaction.emoji} ${topReaction.label} was the signature reaction (${topReaction.count}×).`);
  if (busiestChat && busiestChat.count > 2) insights.push(`Chat peaked around ${fmtClock(busiestChat.t)} with ${busiestChat.count} messages.`);
  if (chapters.length > 1) {
    const best = chapters.filter(c => c.avg != null).sort((a, b) => b.avg - a.avg)[0];
    if (best) insights.push(`Best-received section: "${best.label}" (avg ${best.avg}).`);
  }
  if (npsScore != null) insights.push(`Net Promoter Score: ${npsScore > 0 ? '+' : ''}${npsScore} from ${nps.length} responses.`);
  if (humans.length) insights.push(`${Math.round((engaged.size / total) * 100)}% of attendees actively engaged (rated, chatted, reacted or asked).`);

  const passiveReport = buildPassive(ev, { start, pulse, messages, reactions, markers, humans });
  if (passiveReport) insights.push(...passiveReport.insights);

  return {
    event: publicEvent(ev),
    generatedAt: Date.now(),
    durationMs,
    kpis: {
      participants: humans.length,
      peakOnline,
      overall: round(overall),
      finalScore: round(finalScore),
      median: round(median(perPersonAvg)),
      stdev: round(stdev(perPersonAvg)),
      volatility: round(volatility),
      ratingsCount: ratings.length,
      messages: messages.length,
      questions: questions.length,
      reactions: reactions.length,
      polls: (ev.polls || []).length,
      feedbackCount: feedback.length,
      avgStars: round(mean(stars)),
      nps: npsScore,
      engagementRate: Math.round((engaged.size / total) * 100),
      grade: g,
      high: round(pulseVals.length ? Math.max(...pulseVals) : null),
      low: round(pulseVals.length ? Math.min(...pulseVals) : null),
    },
    insights,
    timeline: pulse.map(p => ({ t: p.t - start, avg: p.avg == null ? null : round(p.avg), n: p.n, online: p.online, energy: p.energy })),
    markers: markers.map(m => ({ label: m.label, t: m.t - start })),
    histogram: hist,
    allHistogram: (() => { const h = Array(10).fill(0); allValues.forEach(v => h[Math.min(9, Math.floor(v / 10))]++); return h; })(),
    zonePct,
    modeUsage, modePeople,
    chatTimeline, reactTimeline, bucketMs,
    reactionBreakdown,
    sentimentSplit,
    wordCloud,
    moments,
    chapters,
    funnel: {
      joined: humans.length, rated: raters.size, reacted: reactors.size, chatted: chatters.size,
      asked: askers.size, polled: pollers.size, reviewed: reviewers.size,
    },
    topContributors,
    passive: passiveReport ? (({ insights: _omit, ...rest }) => rest)(passiveReport) : null,
    questions: [...questions].sort((a, b) => (b.votes || []).length - (a.votes || []).length)
      .map(q => ({ text: q.text, name: q.name, votes: (q.votes || []).length, answered: !!q.answered })),
    mostUpvoted: mostUpvoted ? { text: mostUpvoted.text, votes: (mostUpvoted.votes || []).length } : null,
    polls: (ev.polls || []).map(p => ({ question: p.question, options: p.options, total: Object.keys(p.voters || {}).length })),
    feedback: {
      count: feedback.length, avgStars: round(mean(stars)),
      starDist: [1, 2, 3, 4, 5].map(s => stars.filter(x => x === s).length),
      nps: npsScore, promoters, passives: nps.length - promoters - detractors, detractors,
      npsDist: Array.from({ length: 11 }, (_, i) => nps.filter(x => x === i).length),
      aspects: aspectAvg,
      comments: feedback.filter(f => f.comment).map(f => ({ text: f.comment, stars: f.stars, word: f.word, sentiment: sentimentOf(f.comment) })),
      words: feedback.map(f => f.word).filter(Boolean),
    },
  };
}

// ---------- Passive signals ----------
// Crowd-level figures only. Pulse history fields are already null when fewer than MIN_CROWD people contributed;
// anything computed from raw samples (ev.passive) re-checks the threshold, and no per-person value leaves this function.
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function corrLabel(r) {
  if (r == null) return null;
  const a = Math.abs(r);
  if (a < 0.2) return 'No clear link: ratings and attention moved independently';
  const strength = a >= 0.7 ? 'Strong' : a >= 0.45 ? 'Moderate' : 'Weak';
  return r > 0 ? `${strength} link: ratings and attention rose and fell together`
    : `${strength} inverse link: ratings went up as attention went down`;
}

function buildPassive(ev, { start, pulse, messages, reactions, markers, humans }) {
  const MIN = MIN_CROWD;
  const S = ev.settings || {};
  const samples = ev.passive || [];
  const roomSig = ev.roomSignals || [];
  const F = ['att', 'focus', 'cam', 'pos', 'fat', 'room', 'laugh', 'clap'];
  const hasPulse = pulse.some(p => F.some(f => p[f] != null));
  if (!samples.length && !roomSig.length && !hasPulse) return null;

  const rel = t => Math.max(0, t - start);
  const vals = f => pulse.filter(p => p[f] != null).map(p => p[f]);
  const chapterAt = t => { const m = markers.filter(x => x.t <= t).pop(); return m ? m.label : null; };
  const context = (from, to) => {
    const near = x => x.t >= from && x.t <= to;
    const ctxReacts = {};
    reactions.filter(near).forEach(r => { ctxReacts[r.e] = (ctxReacts[r.e] || 0) + 1; });
    return { messages: messages.filter(near).slice(-3).map(m => ({ name: m.name, text: m.text })), reactions: ctxReacts };
  };

  // distinct contributors (counts only)
  const tabPids = new Set(samples.filter(s => s.vis != null).map(s => s.pid));
  const camPids = new Set(samples.filter(s => s.att != null).map(s => s.pid));
  Object.values(ev.participants || {}).forEach(p => { if (p.passiveCamera && p.id !== 'presenter') camPids.add(p.id); });
  const attendees = humans.length;

  // attention index
  const attPts = pulse.filter(p => p.att != null);
  let attention = null;
  if (attPts.length) {
    const peak = attPts.reduce((a, b) => (b.att > a.att ? b : a));
    const low = attPts.reduce((a, b) => (b.att < a.att ? b : a));
    const fifth = Math.max(1, Math.floor(attPts.length / 5));
    attention = {
      avg: round(mean(attPts.map(p => p.att))),
      peak: round(peak.att), peakT: rel(peak.t), peakChapter: chapterAt(peak.t),
      low: round(low.att), lowT: rel(low.t), lowChapter: chapterAt(low.t),
      start: round(mean(attPts.slice(0, fifth).map(p => p.att))),
      end: round(mean(attPts.slice(-fifth).map(p => p.att))),
    };
  }

  // share of time when >= 40% of the room had the tab mostly away (vis < 0.5); only moments with 5+ tab readers count
  const tabSamples = samples.filter(s => s.vis != null).sort((a, b) => a.t - b.t);
  let awayPct = null;
  if (tabSamples.length && pulse.length) {
    const latest = new Map(); let j = 0, valid = 0, away = 0;
    for (const p of pulse) {
      while (j < tabSamples.length && tabSamples[j].t <= p.t) { latest.set(tabSamples[j].pid, tabSamples[j]); j++; }
      const fresh = [...latest.values()].filter(s => p.t - s.t < 15000);
      if (fresh.length < MIN) continue;
      valid++;
      if (fresh.filter(s => s.vis < 0.5).length / fresh.length >= 0.4) away++;
    }
    if (valid) awayPct = Math.round((away / valid) * 100);
  }

  // how time away was spread across the crowd (number of people per bucket); only with 5+ people
  let awayDistribution = null;
  {
    const per = {};
    for (const s of tabSamples) { const o = (per[s.pid] ||= { n: 0, away: 0 }); o.n++; if (s.vis < 0.5) o.away++; }
    const shares = Object.values(per).filter(o => o.n >= 3).map(o => o.away / o.n);
    if (shares.length >= MIN) {
      const B = [['Under 10%', 0, 0.1], ['10–25%', 0.1, 0.25], ['25–50%', 0.25, 0.5], ['Over half', 0.5, 1.01]];
      awayDistribution = B.map(([label, lo, hi]) => ({ label, people: shares.filter(x => x >= lo && x < hi).length }));
    }
  }

  // laughter / applause bursts from the room microphone (a room-wide reading, not tied to anyone)
  const audio = roomSig.length
    ? roomSig.map(r => ({ t: r.t, laugh: r.laughter, clap: r.applause }))
    : pulse.map(p => ({ t: p.t, laugh: p.laugh, clap: p.clap }));
  const bursts = (field, kind, thresh = 35) => {
    const out = []; let cur = null;
    for (const a of audio.filter(x => x[field] != null).sort((x, y) => x.t - y.t)) {
      if (a[field] < thresh) continue;
      if (cur && a.t - cur.last <= 6000) { cur.last = a.t; if (a[field] > cur.value) { cur.value = a[field]; cur.t = a.t; } } else out.push(cur = { t: a.t, last: a.t, value: a[field] });
    }
    return out.map(b => ({ kind, t: rel(b.t), value: Math.round(b.value), marker: chapterAt(b.t), ...context(b.t - 20000, b.t + 20000) }));
  };
  const laughs = bursts('laugh', 'laugh');
  const applause = bursts('clap', 'applause');
  const top = list => [...list].sort((a, b) => b.value - a.value).slice(0, 3);

  const timeline = pulse.map(p => ({ t: rel(p.t), att: p.att ?? null, focus: p.focus ?? null, cam: p.cam ?? null, pos: p.pos ?? null, fat: p.fat ?? null, room: p.room ?? null, laugh: p.laugh ?? null, clap: p.clap ?? null }));

  // rating vs attention over time
  const paired = pulse.filter(p => p.avg != null && p.att != null);
  const r = paired.length >= 8 ? pearson(paired.map(p => p.avg), paired.map(p => p.att)) : null;
  const correlation = r == null ? null : { r: round(r, 2), points: paired.length, label: corrLabel(r) };

  // "said vs. shown": stretches where ratings and attention diverge, judged against this session's own norms
  const gaps = [];
  let mA = null, mT = null;
  if (paired.length >= 8) {
    const sm = (i, f) => mean(paired.slice(Math.max(0, i - 1), i + 2).map(p => p[f]));
    const A = paired.map((_, i) => sm(i, 'avg')), T = paired.map((_, i) => sm(i, 'att'));
    mA = mean(A); mT = mean(T);
    const sA = Math.max(3, stdev(A)), sT = Math.max(3, stdev(T));
    const z = i => [(A[i] - mA) / sA, (T[i] - mT) / sT];
    const kindAt = i => {
      const [za, zt] = z(i);
      if (za - zt >= 1 && za > 0.2 && zt < -0.2) return 'polite';
      if (zt - za >= 1 && zt > 0.2 && za < -0.2) return 'critical';
      return null;
    };
    let run = null;
    const close = () => {
      if (run && run.idx.length >= 2) {
        const pts = run.idx.map(i => paired[i]);
        const from = pts[0].t, to = pts[pts.length - 1].t;
        gaps.push({
          kind: run.kind, start: rel(from), end: rel(to), durationMs: to - from,
          rating: round(mean(pts.map(p => p.avg))), attention: round(mean(pts.map(p => p.att))),
          chapter: chapterAt((from + to) / 2), score: run.score, ...context(from - 10000, to + 10000),
        });
      }
      run = null;
    };
    paired.forEach((p, i) => {
      const k = kindAt(i);
      if (run && (!k || run.kind !== k || p.t - paired[run.idx[run.idx.length - 1]].t > 16000)) close();
      if (!k) return;
      run ||= { kind: k, idx: [], score: 0 };
      const [za, zt] = z(i);
      run.idx.push(i); run.score += Math.abs(za - zt);
    });
    close();
  }
  const pickGaps = kind => gaps.filter(g => g.kind === kind).sort((a, b) => b.score - a.score).slice(0, 2);
  const strip = ({ score, ...g }) => ({ ...g, label: g.kind === 'polite' ? 'Polite but distracted' : 'Engaged but critical' });
  const saidVsShown = [...pickGaps('polite'), ...pickGaps('critical')].sort((a, b) => a.start - b.start).map(strip);

  const focusVals = vals('focus'), posVals = vals('pos'), fatVals = vals('fat'), camVals = vals('cam'), roomVals = vals('room');
  const out = {
    minCrowd: MIN,
    sources: { tab: S.passiveTab !== false && (tabPids.size > 0 || focusVals.length > 0), camera: !!S.passiveCamera, room: !!S.passiveRoom },
    contributors: { tab: tabPids.size, camera: camPids.size },
    attention,
    focus: focusVals.length ? { avg: round(mean(focusVals)), low: round(Math.min(...focusVals)) } : null,
    awayPct,
    awayDistribution,
    camera: { optIns: camPids.size, share: attendees ? Math.round((camPids.size / attendees) * 100) : null, attention: round(mean(camVals)) },
    positive: round(mean(posVals)),
    fatigue: round(mean(fatVals)),
    roomAttention: round(mean(roomVals)),
    laughter: { count: laughs.length, peak: laughs.length ? Math.max(...laughs.map(l => l.value)) : null, moments: top(laughs) },
    applause: { count: applause.length, peak: applause.length ? Math.max(...applause.map(l => l.value)) : null, moments: top(applause) },
    timeline,
    correlation,
    norms: { rating: round(mA), attention: round(mT) },
    saidVsShown,
  };

  // 1-3 insight sentences
  const ins = [];
  if (attention && attPts.length > 5) {
    const d = attention.end - attention.start;
    ins.push(Math.abs(d) >= 5
      ? `Attention ${d > 0 ? 'built' : 'faded'} over the session, from ${attention.start} to ${attention.end} on the attention index (avg ${attention.avg}).`
      : `Attention held steady around ${attention.avg} / 100 on the attention index.`);
  }
  const big = [...gaps].sort((a, b) => b.score - a.score)[0];
  if (big) {
    const where = `around ${fmtClock(big.start)}${big.chapter ? ` (“${big.chapter}”)` : ''}`;
    ins.push(big.kind === 'polite'
      ? `Polite but distracted ${where}: ratings stayed at ${big.rating} while attention dropped to ${big.attention}.`
      : `Engaged but critical ${where}: attention rose to ${big.attention} while ratings fell to ${big.rating}.`);
  } else if (correlation && Math.abs(correlation.r) >= 0.45) ins.push(`${correlation.label} (r = ${correlation.r}).`);
  const lp = top(laughs)[0];
  if (lp) ins.push(`😂 The biggest laugh came at ${fmtClock(lp.t)}${lp.marker ? ` during “${lp.marker}”` : ''}${laughs.length > 1 ? `, one of ${laughs.length} laughter peaks` : ''}.`);
  else if (awayPct != null && awayPct >= 15) ins.push(`For ${awayPct}% of the session at least 40% of the room had the session tab mostly out of view.`);
  out.insights = ins.slice(0, 3);
  return out;
}

function fmtClock(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

function publicEvent(ev) {
  return {
    code: ev.code, title: ev.title, description: ev.description, presenter: ev.presenter,
    startsAt: ev.startsAt, durationMin: ev.durationMin, location: ev.location, accent: ev.accent,
    status: ev.status, startedAt: ev.startedAt, endedAt: ev.endedAt, createdAt: ev.createdAt,
    settings: ev.settings,
  };
}

module.exports = { buildReport, publicEvent, sentimentOf, mean };
