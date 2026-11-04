// Post-session analytics: turns the raw event log into a rich report.

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
    return { label: m.label, t: m.t - start, durationMs: to - m.t, avg: round(mean(vals)), reactions: rc, messages: mc };
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
