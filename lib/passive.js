// Passive signals: what the room shows without anyone pressing a button.
//
// Three sources, each switched on per session by the host:
//   tab     (settings.passiveTab, on by default)     each attendee's page reports how much of the last few seconds
//                                                     the session tab was visible and focused, plus a count of interactions
//   camera  (settings.passiveCamera, opt-in)          an attendee who opts in runs face analysis on their own device;
//                                                     only three numbers leave it: attention, positive, fatigue (0-100)
//   room    (settings.passiveRoom, presenter device)  the presenter's laptop camera counts faces looking forward, and its
//                                                     microphone detects laughter and applause from loudness patterns
//
// Privacy rules enforced here, not just in the UI:
//   * no images, video or audio ever reach the server: only the numbers below are accepted
//   * crowd figures are only produced once at least MIN_CROWD people contribute, so no one can be singled out
//   * passive data is kept apart from ratings and never blended into the rating score

const MIN_CROWD = 5;
const FRESH_MS = 15000;      // a reading counts toward the live figure for this long
const SAMPLE_MS = 4000;      // at most one stored sample per person per this interval
const ROOM_FRESH_MS = 10000;
const MAX_SAMPLES = 60000;

const num = (v, lo = 0, hi = 100) => {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN; // never coerce objects from a payload
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function ensure(ev) {
  ev.passive ||= [];          // [{ pid, t, vis, act, att, pos, fat }]  att/pos/fat only for camera
  ev.passiveLatest ||= {};    // pid -> latest sample
  ev.roomSignals ||= [];      // [{ t, faces, looking, attention, laughter, applause, level }]
}

// An attendee's report. p = { vis: 0..1, act: count, cam: { att, pos, fat } | null }
function record(ev, pid, p, now = Date.now()) {
  ensure(ev);
  const s = ev.settings || {};
  const sample = { pid, t: now };
  if (s.passiveTab !== false) {
    const vis = num(p?.vis, 0, 1);
    if (vis != null) sample.vis = Math.round(vis * 100) / 100;
    const act = num(p?.act, 0, 1000);
    if (act != null) sample.act = Math.round(act);
  }
  const cam = p?.cam;
  if (s.passiveCamera && cam && typeof cam === 'object') {
    const att = num(cam.att), pos = num(cam.pos), fat = num(cam.fat);
    if (att != null) { sample.att = Math.round(att); sample.pos = pos == null ? null : Math.round(pos); sample.fat = fat == null ? null : Math.round(fat); }
  }
  if (sample.vis == null && sample.att == null) return null;
  const part = ev.participants?.[pid];
  if (part) part.passiveCamera = sample.att != null;
  ev.passiveLatest[pid] = sample;
  const last = ev.passive.length ? findLast(ev.passive, x => x.pid === pid, 200) : null;
  if (!last || now - last.t >= SAMPLE_MS) {
    ev.passive.push(sample);
    if (ev.passive.length > MAX_SAMPLES) ev.passive.splice(0, ev.passive.length - MAX_SAMPLES);
  }
  return sample;
}

function stopCamera(ev, pid) {
  ensure(ev);
  const part = ev.participants?.[pid];
  if (part) part.passiveCamera = false;
  const l = ev.passiveLatest[pid];
  if (l) { delete l.att; delete l.pos; delete l.fat; }
}

// The presenter device's room reading. r = { faces, looking, attention, laughter, applause, level }
function recordRoom(ev, r, now = Date.now()) {
  ensure(ev);
  if (!ev.settings?.passiveRoom) return null;
  const sample = {
    t: now,
    faces: Math.round(num(r?.faces, 0, 500) ?? 0),
    looking: r?.looking == null ? null : Math.round(num(r.looking, 0, 500) ?? 0),
    attention: r?.attention == null ? null : Math.round(num(r.attention) ?? 0),
    laughter: r?.laughter == null ? null : Math.round(num(r.laughter) ?? 0),
    applause: r?.applause == null ? null : Math.round(num(r.applause) ?? 0),
    level: r?.level == null ? null : Math.round(num(r.level) ?? 0),
  };
  // keep one stored sample per ~2s; a faster reading refreshes the current one (t stays its start time)
  const last = ev.roomSignals[ev.roomSignals.length - 1];
  if (last && now - last.t < 2000) Object.assign(last, sample, { t: last.t, seen: now }); else ev.roomSignals.push({ ...sample, seen: now });
  if (ev.roomSignals.length > MAX_SAMPLES) ev.roomSignals.splice(0, ev.roomSignals.length - MAX_SAMPLES);
  return sample;
}

// Live crowd figures for the pulse. Anything below the privacy threshold comes back null.
function aggregate(ev, onlineMap, now = Date.now()) {
  ensure(ev);
  const s = ev.settings || {};
  const fresh = Object.entries(ev.passiveLatest).filter(([pid, x]) => now - x.t < FRESH_MS && (!onlineMap || onlineMap.has(pid) || pid.startsWith('bot_')));
  const tab = fresh.map(([, x]) => x).filter(x => x.vis != null);
  const cam = fresh.map(([, x]) => x).filter(x => x.att != null);
  const out = { minCrowd: MIN_CROWD, nTab: tab.length, nCam: cam.length, focus: null, away: null, attention: null, positive: null, fatigue: null, room: null, index: null };
  if (s.passiveTab !== false && tab.length >= MIN_CROWD) {
    out.focus = round1(mean(tab.map(x => x.vis)) * 100);
    out.away = Math.round((tab.filter(x => x.vis < 0.5).length / tab.length) * 100);
  }
  if (s.passiveCamera && cam.length >= MIN_CROWD) {
    out.attention = round1(mean(cam.map(x => x.att)));
    out.positive = round1(mean(cam.map(x => x.pos).filter(v => v != null)));
    out.fatigue = round1(mean(cam.map(x => x.fat).filter(v => v != null)));
  }
  const r = ev.roomSignals[ev.roomSignals.length - 1];
  if (s.passiveRoom && r && now - (r.seen || r.t) < ROOM_FRESH_MS) {
    out.room = {
      faces: r.faces, laughter: r.laughter, applause: r.applause, level: r.level,
      // head counts are only shown for a crowd; audio is a room-wide reading either way
      attention: r.faces >= MIN_CROWD ? r.attention : null,
      looking: r.faces >= MIN_CROWD ? r.looking : null,
    };
  }
  // One attention index for the charts: the mean of whichever signals are available
  const parts = [out.attention, out.room?.attention, out.focus].filter(v => v != null);
  out.index = parts.length ? round1(mean(parts)) : null;
  return out;
}

// Compact version for the 5-second history the charts and report use
function historyFields(p) {
  if (!p) return {};
  return { att: p.index, focus: p.focus, cam: p.attention, pos: p.positive, fat: p.fatigue, room: p.room?.attention ?? null, laugh: p.room?.laughter ?? null, clap: p.room?.applause ?? null, nCam: p.nCam };
}

function consentCount(ev) {
  return Object.values(ev.participants || {}).filter(p => p.passiveCamera).length;
}

function findLast(arr, pred, limit) {
  for (let i = arr.length - 1, n = 0; i >= 0 && n < limit; i--, n++) if (pred(arr[i])) return arr[i];
  return null;
}

module.exports = { MIN_CROWD, record, recordRoom, stopCamera, aggregate, historyFields, consentCount, ensure };
