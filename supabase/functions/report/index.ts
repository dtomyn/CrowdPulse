// Session report: GET /functions/v1/report?code=ABC123[&format=csv]
//
// The browser sends its Supabase session (Authorization header). Access is checked as that user
// (cp_report_access: the session's admins, or anyone once the host shares the report). The raw data is then
// read with the service role and turned into crowd-level figures here, so per-person passive readings never
// reach a browser, exactly as the old server worked. The CSV export is for admins only.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { buildReport } from '../_shared/analytics.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// The service-role key: the legacy variable, or the default entry of the newer secret-keys variable.
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { return ''; }
}

type Row = Record<string, any>;

function toCsv(ev: Row): string {
  const s = ev.startedAt || ev.createdAt;
  // quote every cell, and defuse text that a spreadsheet would run as a formula (=, +, -, @)
  const esc = (v: unknown) => `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : String(v ?? '')).replace(/"/g, '""')}"`;
  const sec = (t: number) => Math.round((t - s) / 1000);
  const name = (pid: string) => ev.participants[pid]?.name || pid;
  const rows: unknown[][] = [['type', 'seconds_from_start', 'participant', 'value', 'mode_or_extra']];
  ev.ratings.forEach((r: Row) => rows.push(['rating', sec(r.t), name(r.pid), r.v, r.mode]));
  ev.reactions.forEach((r: Row) => rows.push(['reaction', sec(r.t), name(r.pid), r.e, '']));
  ev.messages.forEach((m: Row) => rows.push(['chat', sec(m.t), m.name, m.text, m.pinned ? 'pinned' : '']));
  ev.questions.forEach((q: Row) => rows.push(['question', sec(q.t), q.name, q.text, `${q.votes.length} votes`]));
  ev.pulseHistory.forEach((p: Row) => rows.push(['crowd_pulse', sec(p.t), '', p.avg, `${p.online} online`]));
  // passive signals are exported as crowd-level figures only, never per person
  ev.pulseHistory.filter((p: Row) => p.att != null || p.focus != null).forEach((p: Row) => rows.push(['crowd_attention', sec(p.t), '', p.att,
    `tab_focus=${p.focus ?? ''}; camera_attention=${p.cam ?? ''}; positive=${p.pos ?? ''}; fatigue=${p.fat ?? ''}; room_attention=${p.room ?? ''}; laughter=${p.laugh ?? ''}; applause=${p.clap ?? ''}`]));
  Object.entries(ev.feedback).forEach(([pid, f]: [string, any]) => rows.push(['feedback', '', name(pid), f.stars, `nps=${f.nps}; word=${f.word}; ${f.comment || ''}`]));
  return rows.map(r => r.map(esc).join(',')).join('\n');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const csv = url.searchParams.get('format') === 'csv';
  if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Event not found' }, 404);

  const base = Deno.env.get('SUPABASE_URL')!;
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const auth = req.headers.get('Authorization') || '';
  if (!auth) return json({ error: 'Sign in first' }, 401);

  const asUser = createClient(base, apikey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: access, error: accessErr } = await asUser.rpc('cp_report_access', { _c: code });
  if (accessErr) return json({ error: 'Sign in first' }, 401);
  if (!access?.ok) return json({ error: access?.error || 'Forbidden' }, access?.error === 'Event not found' ? 404 : 403);
  if (csv && !access.admin) return json({ error: 'Only the host can export the raw data' }, 403);

  const admin = createClient(base, serviceKey(), { auth: { persistSession: false } });
  const { data: ev, error } = await admin.rpc('cp_report_data', { _c: code });
  if (error || !ev) { console.error('report data failed', error); return json({ error: 'Something went wrong' }, 500); }

  if (csv) {
    return new Response(toCsv(ev), { headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="crowdpulse-${code}.csv"` } });
  }
  return json(buildReport(ev));
});
