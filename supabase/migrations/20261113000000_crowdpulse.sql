-- CrowdPulse on Supabase: tables, security, and the server-side logic that used to live in server.js.
--
-- Security model
--   * Every visitor has a Supabase session: attendees sign in anonymously, hosts sign in by email (magic link).
--   * Tables are closed to the API roles (RLS on, no policies, no grants). Browsers can only call the functions
--     granted at the bottom of this file. Each one checks who is calling (auth.uid()) and validates its input,
--     the same checks server.js made.
--   * Only emails listed in public.hosts can create sessions. Add yours with:
--       insert into public.hosts (email) values ('you@example.com');
--   * Whoever creates a session administers it. Anyone holding its admin key (the control-room link) can claim
--     admin rights too, so a co-host or a second laptop can run it.
--   * Live updates go out as Realtime broadcasts on private channels: "ev:CODE" (everyone in the session) and
--     "adm:CODE" (its admins). Only these functions send on them; browsers can only listen.
--   * Raw per-person data (ratings, passive signals) never leaves the database except through the report Edge
--     Function, which only returns crowd-level figures, as the old server did.

-- ---------------------------------------------------------------------------------------------------------
-- Nothing in this schema is exposed unless granted explicitly at the end.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------- tables ----------
create table public.hosts (
  email text primary key check (email = lower(email))
);

create table public.events (
  code text primary key,
  owner uuid not null,
  admin_key text not null,
  title text not null,
  description text not null default '',
  presenter text not null default '',
  starts_at timestamptz not null,
  duration_min int not null default 60,
  location jsonb not null default '{}',
  accent text not null default '#7c5cff',
  settings jsonb not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  created_at bigint not null,
  started_at bigint,
  ended_at bigint,
  last_pulse jsonb,
  last_tick bigint not null default 0,
  last_history bigint not null default 0,
  simulating boolean not null default false
);
create index on public.events (owner);

create table public.event_admins (
  code text not null references public.events on delete cascade,
  uid uuid not null,
  primary key (code, uid)
);
create index on public.event_admins (uid);

-- pid: auth.uid() for people, 'presenter' for the host, 'bot_CODE_N' for simulated attendees.
-- pub: what everyone else sees instead of pid.
create table public.participants (
  code text not null references public.events on delete cascade,
  pid text not null,
  pub text not null,
  name text not null,
  avatar text not null,
  color text not null,
  joined_at bigint not null,
  last_seen bigint not null,
  bot boolean not null default false,
  rating smallint, rating_t bigint, rating_mode text, rating_row bigint,     -- latest rating (for the live pulse)
  pv_t bigint, pv_vis real, pv_act int, pv_att smallint, pv_pos smallint, pv_fat smallint, pv_stored bigint, -- latest passive reading
  passive_camera boolean not null default false,
  primary key (code, pid)
);
create index on public.participants (code, last_seen);

create table public.ratings (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  pid text not null, v smallint not null, mode text not null, t bigint not null
);
create index on public.ratings (code, t);

create table public.reactions (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  pid text not null, e text not null, t bigint not null
);
create index on public.reactions (code, t);

create table public.messages (
  id text primary key,
  code text not null references public.events on delete cascade,
  pid text not null, pub text not null, name text not null, avatar text not null, color text not null,
  text text not null, t bigint not null, role text not null,
  deleted boolean not null default false, pinned boolean not null default false
);
create index on public.messages (code, t);

create table public.questions (
  id text primary key,
  code text not null references public.events on delete cascade,
  pid text not null, pub text not null, name text not null, avatar text not null,
  text text not null, t bigint not null,
  answered boolean not null default false, hidden boolean not null default false
);
create index on public.questions (code);

create table public.question_votes (
  qid text not null references public.questions on delete cascade,
  pid text not null, pub text not null,
  primary key (qid, pid)
);

create table public.polls (
  id text primary key,
  code text not null references public.events on delete cascade,
  question text not null, options jsonb not null, open boolean not null default true, t bigint not null
);
create index on public.polls (code);

create table public.poll_votes (
  poll_id text not null references public.polls on delete cascade,
  pid text not null, idx int not null,
  primary key (poll_id, pid)
);

create table public.feedback (
  code text not null references public.events on delete cascade,
  pid text not null,
  stars smallint, nps smallint, word text not null default '', comment text not null default '',
  aspects jsonb not null default '{}', t bigint not null,
  primary key (code, pid)
);

create table public.pulse_history (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  t bigint not null, p jsonb not null
);
create index on public.pulse_history (code, t);

create table public.markers (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  label text not null, t bigint not null
);
create index on public.markers (code);

create table public.announcements (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  text text not null, t bigint not null
);
create index on public.announcements (code);

create table public.passive_samples (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  pid text not null, t bigint not null,
  vis real, act int, att smallint, pos smallint, fat smallint
);
create index on public.passive_samples (code, t);

create table public.room_signals (
  id bigint generated always as identity primary key,
  code text not null references public.events on delete cascade,
  t bigint not null, seen bigint not null,
  faces int, looking int, attention int, laughter int, applause int, level int
);
create index on public.room_signals (code, t);

create table public.throttles (
  code text not null references public.events on delete cascade,
  pid text not null, kind text not null, last bigint not null,
  primary key (code, pid, kind)
);

-- RLS on with no policies: the API roles can't read or write any table directly.
do $$
declare t text;
begin
  foreach t in array array['hosts','events','event_admins','participants','ratings','reactions','messages','questions',
    'question_votes','polls','poll_votes','feedback','pulse_history','markers','announcements','passive_samples','room_signals','throttles']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- small helpers ----------
create function public.cp_now() returns bigint language sql volatile set search_path = '' as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

create function public.cp_id() returns text language sql volatile set search_path = '' as $$
  select left(replace(gen_random_uuid()::text, '-', ''), 12)
$$;

-- only JSON strings and numbers count as text; objects/arrays become ''
create function public.cp_str(j jsonb) returns text language sql immutable set search_path = '' as $$
  select case jsonb_typeof(j) when 'string' then j #>> '{}' when 'number' then j::text else '' end
$$;

create function public.cp_num(j jsonb) returns double precision language sql immutable set search_path = '' as $$
  select case jsonb_typeof(j)
    when 'number' then (j::text)::double precision
    when 'string' then case when (j #>> '{}') ~ '^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$' then (j #>> '{}')::double precision end
  end
$$;

create function public.cp_clamp(x double precision, lo double precision, hi double precision) returns double precision
language sql immutable set search_path = '' as $$
  select case when x is null or x = 'NaN'::double precision then null else greatest(lo, least(hi, x)) end
$$;

-- control characters become spaces, then trim and cut to n characters
create function public.cp_clean(s text, n int) returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(s, ''), '[\x01-\x1f\x7f]', ' ', 'g')), n)
$$;

create function public.cp_filter(s text) returns text language plpgsql immutable set search_path = '' as $$
declare w text;
begin
  foreach w in array array['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'bastard'] loop
    s := regexp_replace(s, '\m(' || left(w, 1) || ')' || substr(w, 2) || '\M', '\1' || repeat('*', length(w) - 1), 'gi');
  end loop;
  return s;
end $$;

create function public.cp_clean_url(u text) returns text language plpgsql immutable set search_path = '' as $$
declare s text := public.cp_clean(u, 300);
begin
  if s = '' then return ''; end if;
  if s !~* '^[a-z][a-z0-9+.-]*:' then s := 'https://' || s; end if;  -- "zoom.us/j/1" -> https://zoom.us/j/1
  if s ~* '^https?://[^\s/?#]+' then return s; end if;
  return '';
end $$;

create function public.cp_clean_location(l jsonb, prev jsonb default '{}') returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(l) is distinct from 'object' then l := '{}'; end if;
  prev := coalesce(prev, '{}');
  return jsonb_build_object(
    'mode', case when l ->> 'mode' in ('in-person', 'virtual', 'hybrid') then l ->> 'mode' else coalesce(prev ->> 'mode', 'virtual') end,
    'venue', case when l ? 'venue' then public.cp_clean(public.cp_str(l -> 'venue'), 120) else coalesce(prev ->> 'venue', '') end,
    'address', case when l ? 'address' then public.cp_clean(public.cp_str(l -> 'address'), 200) else coalesce(prev ->> 'address', '') end,
    'url', case when l ? 'url' then public.cp_clean_url(public.cp_str(l -> 'url')) else coalesce(prev ->> 'url', '') end);
end $$;

create function public.cp_merge_settings(cur jsonb, p jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; o jsonb := coalesce(cur, '{}');
begin
  if jsonb_typeof(p) = 'object' then
    foreach k in array array['chat', 'qa', 'reactions', 'publicReport', 'showCrowdMood', 'listed', 'passiveTab', 'passiveCamera', 'passiveRoom'] loop
      if p ? k then o := o || jsonb_build_object(k, p -> k = 'true'::jsonb); end if;
    end loop;
  end if;
  return o;
end $$;

create function public.cp_setting(s jsonb, k text, dflt boolean) returns boolean language sql immutable set search_path = '' as $$
  select case jsonb_typeof(s -> k) when 'boolean' then (s ->> k)::boolean else dflt end
$$;

create function public.cp_reactions() returns jsonb language sql immutable set search_path = '' as $$
  select '["👏","🔥","😂","🤯","❤️","🤔","🎉","😴"]'::jsonb
$$;

create function public.cp_new_code() returns text language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; b bytea;  -- no 0/O/1/I confusion
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    for i in 0..5 loop c := c || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.events where code = c);
  end loop;
  return c;
end $$;

-- broadcast on a session channel. Payloads are always wrapped as {v: ...}.
create function public.cp_send(_topic text, _event text, _v jsonb) returns void language plpgsql set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('v', _v), _event, _topic, true);
end $$;

-- ---------- views of the data sent to browsers ----------
create function public.cp_event_json(e public.events) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('code', e.code, 'title', e.title, 'description', e.description, 'presenter', e.presenter,
    'startsAt', to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'durationMin', e.duration_min,
    'location', e.location, 'accent', e.accent, 'status', e.status, 'startedAt', e.started_at, 'endedAt', e.ended_at,
    'createdAt', e.created_at, 'settings', e.settings)
$$;

create function public.cp_msg_json(m public.messages) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'pid', m.pub, 'name', m.name, 'avatar', m.avatar, 'color', m.color, 'text', m.text,
    't', m.t, 'role', m.role, 'pinned', m.pinned)
$$;

create function public.cp_questions_view(_c text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'answered')::boolean, (x ->> 'votes')::int desc, (x ->> 't')::bigint), '[]')
  from (
    select jsonb_build_object('id', q.id, 'name', q.name, 'avatar', q.avatar, 'text', q.text, 't', q.t,
      'votes', (select count(*) from public.question_votes v where v.qid = q.id),
      'voters', (select coalesce(jsonb_agg(v.pub), '[]') from public.question_votes v where v.qid = q.id),
      'answered', q.answered) x
    from public.questions q where q.code = _c and not q.hidden
  ) s
$$;

create function public.cp_polls_view(_c text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'question', p.question,
    'options', (select jsonb_agg(jsonb_build_object('text', o.txt,
        'votes', (select count(*) from public.poll_votes v where v.poll_id = p.id and v.idx = o.i - 1)) order by o.i)
      from jsonb_array_elements_text(p.options) with ordinality o(txt, i)),
    'open', p.open, 'total', (select count(*) from public.poll_votes v where v.poll_id = p.id), 't', p.t) order by p.t), '[]')
  from public.polls p where p.code = _c
$$;

create function public.cp_summary(_c text) returns jsonb language plpgsql stable set search_path = '' as $$
declare e public.events; n bigint := public.cp_now();
begin
  select * into e from public.events where code = _c;
  if not found then return null; end if;
  return public.cp_event_json(e) || jsonb_build_object('adminKey', e.admin_key, 'simulating', e.simulating, 'stats', jsonb_build_object(
    'participants', (select count(*) from public.participants where code = _c and pid <> 'presenter'),
    'online', (select count(*) from public.participants where code = _c and pid <> 'presenter' and last_seen > n - 45000),
    'ratings', (select count(*) from public.ratings where code = _c),
    'messages', (select count(*) from public.messages where code = _c),
    'reactions', (select count(*) from public.reactions where code = _c),
    'avg', e.last_pulse -> 'avg',
    'attention', e.last_pulse -> 'passive' -> 'index',
    'cameraOptIns', (select count(*) from public.participants where code = _c and passive_camera)));
end $$;

create function public.cp_snapshot(_c text, _pid text) returns jsonb language plpgsql stable set search_path = '' as $$
declare e public.events; part public.participants;
begin
  select * into e from public.events where code = _c;
  select * into part from public.participants where code = _c and pid = _pid;
  return jsonb_build_object(
    'event', public.cp_event_json(e),
    'messages', (select coalesce(jsonb_agg(public.cp_msg_json(m) order by m.t), '[]')
                 from (select * from public.messages where code = _c and not deleted order by t desc limit 150) m),
    'questions', public.cp_questions_view(_c),
    'polls', public.cp_polls_view(_c),
    'myVotes', (select coalesce(jsonb_object_agg(v.poll_id, v.idx), '{}')
                from public.poll_votes v join public.polls p on p.id = v.poll_id where p.code = _c and v.pid = _pid),
    'pulse', e.last_pulse,
    'history', (select coalesce(jsonb_agg(h.p order by h.t), '[]')
                from (select * from public.pulse_history where code = _c order by t desc limit 720) h),
    'markers', (select coalesce(jsonb_agg(jsonb_build_object('label', m.label, 't', m.t) order by m.t), '[]') from public.markers m where m.code = _c),
    'announcement', (select jsonb_build_object('text', a.text, 't', a.t) from public.announcements a where a.code = _c order by a.t desc limit 1),
    'myRating', part.rating,
    'myFeedback', (select jsonb_build_object('stars', f.stars, 'nps', f.nps, 'word', f.word, 'comment', f.comment, 'aspects', f.aspects, 't', f.t)
                   from public.feedback f where f.code = _c and f.pid = _pid),
    'reactions', public.cp_reactions());
end $$;

create function public.cp_broadcast_event(_c text) returns void language plpgsql set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where code = _c;
  perform public.cp_send('ev:' || _c, 'event', public.cp_event_json(e));
  perform public.cp_send('adm:' || _c, 'admin-summary', public.cp_summary(_c));
end $$;

-- ---------- access checks ----------
create function public.cp_is_admin(_c text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_admins where code = _c and uid = auth.uid())
$$;

create function public.cp_event_exists(_c text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where code = _c)
$$;

create function public.cp_is_host() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.hosts where email = lower(auth.jwt() ->> 'email'))
$$;

-- true when the action may go ahead; false when this person did the same thing less than _ms ago
create function public.cp_throttle_ok(_c text, _pid text, _kind text, _ms int) returns boolean language plpgsql set search_path = '' as $$
declare n bigint := public.cp_now(); ok boolean;
begin
  insert into public.throttles as t (code, pid, kind, last) values (_c, _pid, _kind, n)
  on conflict (code, pid, kind) do update set last = excluded.last where t.last <= excluded.last - _ms
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- ---------- core actions (shared by attendees, the presenter and the simulator) ----------
create function public.cp_upsert_participant(_c text, _pid text, _p jsonb, _bot boolean) returns public.participants
language plpgsql set search_path = '' as $$
declare part public.participants; n bigint := public.cp_now(); nm text; av text; col text;
begin
  if not exists (select 1 from public.participants where code = _c and pid = _pid)
     and (select count(*) from public.participants where code = _c) >= 5000 then
    return null;  -- full: stops a script from filling the database with fake attendees
  end if;
  nm := nullif(public.cp_clean(public.cp_str(_p -> 'name'), 32), '');
  av := nullif(public.cp_clean(public.cp_str(_p -> 'avatar'), 8), '');
  col := case when public.cp_str(_p -> 'color') ~* '^#[0-9a-f]{6}$' then public.cp_str(_p -> 'color') end;
  insert into public.participants as x (code, pid, pub, name, avatar, color, joined_at, last_seen, bot)
  values (_c, _pid, case when _pid = 'presenter' then 'presenter' else 'u_' || public.cp_id() end,
          coalesce(nm, 'Guest'), coalesce(av, '🙂'), coalesce(col, '#7c5cff'), n, n, _bot)
  on conflict (code, pid) do update set name = coalesce(nm, x.name), avatar = coalesce(av, x.avatar), color = coalesce(col, x.color), last_seen = n
  returning * into part;
  return part;
end $$;

create function public.cp_do_rate(e public.events, _pid text, _v jsonb, _mode jsonb) returns void language plpgsql set search_path = '' as $$
declare val int; md text; n bigint := public.cp_now(); part public.participants; rid bigint;
begin
  if e.status <> 'live' then return; end if;
  val := round(public.cp_clamp(public.cp_num(_v), 0, 100));
  if val is null then return; end if;
  md := coalesce(nullif(public.cp_clean(public.cp_str(_mode), 12), ''), 'slider');
  select * into part from public.participants where code = e.code and pid = _pid;
  if not found then return; end if;
  if part.rating_row is not null and n - part.rating_t < 1500 then
    -- collapse rapid-fire slider drags into one sample
    update public.ratings set v = val, t = n, mode = md where id = part.rating_row;
    update public.participants set rating = val, rating_t = n, rating_mode = md, last_seen = n where code = e.code and pid = _pid;
  else
    insert into public.ratings (code, pid, v, mode, t) values (e.code, _pid, val, md, n) returning id into rid;
    update public.participants set rating = val, rating_t = n, rating_mode = md, rating_row = rid, last_seen = n where code = e.code and pid = _pid;
  end if;
end $$;

create function public.cp_do_react(e public.events, _pid text, _e text) returns void language plpgsql set search_path = '' as $$
begin
  if e.status <> 'live' or not public.cp_setting(e.settings, 'reactions', true) then return; end if;
  if not (public.cp_reactions() ? _e) then return; end if;
  if not public.cp_throttle_ok(e.code, _pid, 'react', 250) then return; end if;
  if (select count(*) from public.reactions where code = e.code) >= 100000 then return; end if;
  insert into public.reactions (code, pid, e, t) values (e.code, _pid, _e, public.cp_now());
  -- reactions reach screens with the next pulse (see cp_tick), which keeps Realtime traffic low
end $$;

create function public.cp_system_msg(e public.events, _text text) returns void language plpgsql set search_path = '' as $$
declare m public.messages;
begin
  insert into public.messages (id, code, pid, pub, name, avatar, color, text, t, role)
  values (public.cp_id(), e.code, 'system', 'system', 'CrowdPulse', '✨', e.accent, _text, public.cp_now(), 'system')
  returning * into m;
  perform public.cp_send('ev:' || e.code, 'chat', public.cp_msg_json(m));
end $$;

create function public.cp_do_chat(e public.events, _pid text, _text text) returns void language plpgsql set search_path = '' as $$
declare txt text; part public.participants; m public.messages;
begin
  if not public.cp_setting(e.settings, 'chat', true) or e.status = 'ended' then return; end if;
  txt := public.cp_filter(public.cp_clean(_text, 280));
  if txt = '' then return; end if;
  select * into part from public.participants where code = e.code and pid = _pid;
  if not found then return; end if;
  if not public.cp_throttle_ok(e.code, _pid, 'chat', 700) then return; end if;
  insert into public.messages (id, code, pid, pub, name, avatar, color, text, t, role)
  values (public.cp_id(), e.code, _pid, part.pub, part.name, part.avatar, part.color, txt, public.cp_now(),
          case when _pid = 'presenter' then 'presenter' else 'guest' end)
  returning * into m;
  if (select count(*) from public.messages where code = e.code) > 5000 then
    delete from public.messages where id = (select id from public.messages where code = e.code order by t limit 1);
  end if;
  perform public.cp_send('ev:' || e.code, 'chat', public.cp_msg_json(m));
end $$;

create function public.cp_do_ask(e public.events, _pid text, _text text) returns void language plpgsql set search_path = '' as $$
declare txt text; part public.participants;
begin
  if not public.cp_setting(e.settings, 'qa', true) or e.status = 'ended' then return; end if;
  txt := public.cp_filter(public.cp_clean(_text, 240));
  if txt = '' then return; end if;
  select * into part from public.participants where code = e.code and pid = _pid;
  if not found then return; end if;
  if (select count(*) from public.questions where code = e.code) >= 2000 then return; end if;
  if not public.cp_throttle_ok(e.code, _pid, 'ask', 5000) then return; end if;
  insert into public.questions (id, code, pid, pub, name, avatar, text, t)
  values (public.cp_id(), e.code, _pid, part.pub, part.name, part.avatar, txt, public.cp_now());
  perform public.cp_send('ev:' || e.code, 'questions', public.cp_questions_view(e.code));
end $$;

create function public.cp_do_vote_q(e public.events, _pid text, _qid text) returns void language plpgsql set search_path = '' as $$
declare part public.participants;
begin
  if not exists (select 1 from public.questions where id = _qid and code = e.code and not hidden) then return; end if;
  select * into part from public.participants where code = e.code and pid = _pid;
  if not found then return; end if;
  if not public.cp_throttle_ok(e.code, _pid, 'vote-q', 300) then return; end if;
  delete from public.question_votes where qid = _qid and pid = _pid;
  if not found then insert into public.question_votes (qid, pid, pub) values (_qid, _pid, part.pub); end if;
  perform public.cp_send('ev:' || e.code, 'questions', public.cp_questions_view(e.code));
end $$;

create function public.cp_do_poll_vote(e public.events, _pid text, _poll text, _idx jsonb) returns void language plpgsql set search_path = '' as $$
declare p public.polls; i double precision := public.cp_num(_idx);
begin
  select * into p from public.polls where id = _poll and code = e.code;
  if not found or not p.open then return; end if;
  if jsonb_typeof(_idx) <> 'number' or i is null or i <> trunc(i) or i < 0 or i >= jsonb_array_length(p.options) then return; end if;
  insert into public.poll_votes (poll_id, pid, idx) values (_poll, _pid, i::int)
  on conflict (poll_id, pid) do update set idx = excluded.idx;
  perform public.cp_send('ev:' || e.code, 'polls', public.cp_polls_view(e.code));
end $$;

create function public.cp_do_feedback(e public.events, _pid text, f jsonb) returns void language plpgsql set search_path = '' as $$
declare asp jsonb := '{}'; k text; n_ int;
begin
  if jsonb_typeof(f) <> 'object' then return; end if;
  if not public.cp_throttle_ok(e.code, _pid, 'feedback', 1000) then return; end if;
  if jsonb_typeof(f -> 'aspects') = 'object' then
    foreach k in array array['content', 'delivery', 'visuals', 'pace'] loop
      n_ := round(public.cp_clamp(public.cp_num(f -> 'aspects' -> k), 1, 5));
      if n_ is not null then asp := asp || jsonb_build_object(k, n_); end if;
    end loop;
  end if;
  insert into public.feedback as x (code, pid, stars, nps, word, comment, aspects, t)
  values (e.code, _pid, round(public.cp_clamp(public.cp_num(f -> 'stars'), 1, 5)), round(public.cp_clamp(public.cp_num(f -> 'nps'), 0, 10)),
          public.cp_filter(public.cp_clean(public.cp_str(f -> 'word'), 24)), public.cp_filter(public.cp_clean(public.cp_str(f -> 'comment'), 1000)),
          asp, public.cp_now())
  on conflict (code, pid) do update set stars = excluded.stars, nps = excluded.nps, word = excluded.word,
    comment = excluded.comment, aspects = excluded.aspects, t = excluded.t;
  perform public.cp_send('adm:' || e.code, 'feedback-count', to_jsonb((select count(*) from public.feedback where code = e.code)));
end $$;

-- An attendee's passive reading: p = { vis: 0..1, act: count, cam: { att, pos, fat } | null }. Numbers only.
create function public.cp_do_passive(e public.events, _pid text, p jsonb) returns void language plpgsql set search_path = '' as $$
declare vis real; act int; att int; pos int; fat int; cam jsonb := p -> 'cam'; n bigint := public.cp_now(); part public.participants;
begin
  if e.status <> 'live' or jsonb_typeof(p) <> 'object' then return; end if;
  if public.cp_setting(e.settings, 'passiveTab', true) then
    vis := round((public.cp_clamp(public.cp_num(p -> 'vis'), 0, 1) * 100)::numeric) / 100;
    act := round(public.cp_clamp(public.cp_num(p -> 'act'), 0, 1000));
  end if;
  if public.cp_setting(e.settings, 'passiveCamera', false) and jsonb_typeof(cam) = 'object' then
    att := round(public.cp_clamp(public.cp_num(cam -> 'att'), 0, 100));
    if att is not null then
      pos := round(public.cp_clamp(public.cp_num(cam -> 'pos'), 0, 100));
      fat := round(public.cp_clamp(public.cp_num(cam -> 'fat'), 0, 100));
    end if;
  end if;
  if vis is null and att is null then return; end if;
  update public.participants set pv_t = n, pv_vis = vis, pv_act = act, pv_att = att, pv_pos = pos, pv_fat = fat,
    passive_camera = att is not null, last_seen = n
  where code = e.code and pid = _pid
  returning * into part;
  if not found then return; end if;
  if part.pv_stored is null or n - part.pv_stored >= 4000 then  -- at most one stored sample per person every 4s
    insert into public.passive_samples (code, pid, t, vis, act, att, pos, fat) values (e.code, _pid, n, vis, act, att, pos, fat);
    update public.participants set pv_stored = n where code = e.code and pid = _pid;
  end if;
end $$;

-- The presenter device's room reading: r = { faces, looking, attention, laughter, applause, level }
create function public.cp_do_room(e public.events, r jsonb) returns void language plpgsql set search_path = '' as $$
declare n bigint := public.cp_now(); last public.room_signals;
  f int; lk int; att int; la int; ap int; lv int;
begin
  if e.status <> 'live' or not public.cp_setting(e.settings, 'passiveRoom', false) or jsonb_typeof(r) <> 'object' then return; end if;
  f := coalesce(round(public.cp_clamp(public.cp_num(r -> 'faces'), 0, 500)), 0);
  lk := round(public.cp_clamp(public.cp_num(r -> 'looking'), 0, 500));
  att := round(public.cp_clamp(public.cp_num(r -> 'attention'), 0, 100));
  la := round(public.cp_clamp(public.cp_num(r -> 'laughter'), 0, 100));
  ap := round(public.cp_clamp(public.cp_num(r -> 'applause'), 0, 100));
  lv := round(public.cp_clamp(public.cp_num(r -> 'level'), 0, 100));
  select * into last from public.room_signals where code = e.code order by t desc limit 1;
  if found and n - last.t < 2000 then  -- one stored sample per ~2s; a faster reading refreshes the current one
    update public.room_signals set seen = n, faces = f, looking = lk, attention = att, laughter = la, applause = ap, level = lv where id = last.id;
  else
    insert into public.room_signals (code, t, seen, faces, looking, attention, laughter, applause, level) values (e.code, n, n, f, lk, att, la, ap, lv);
  end if;
end $$;

-- ---------- the live pulse ----------
-- Called every ~2s by the control room and stage screen (and by attendee pages when no pulse arrives).
-- Only one call per 1.8s does any work; the others return straight away.
create function public.cp_tick(_c text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.events; prev_tick bigint; n bigint := public.cp_now(); online int; pulse jsonb; pv jsonb; room jsonb;
  avg_ double precision; cnt int; dist jsonb; rr int; rm int; energy int; prev_avg double precision; mom double precision;
  tab_on boolean; cam_on boolean; room_on boolean; n_tab int; n_cam int; focus numeric; away int; att numeric; pos numeric; fat numeric;
  rs public.room_signals; idx numeric; reacts jsonb; point jsonb;
begin
  if auth.uid() is null then return null; end if;
  _c := upper(_c);
  select last_tick into prev_tick from public.events where code = _c;
  update public.events set last_tick = n where code = _c and status in ('scheduled', 'live') and last_tick < n - 1800 returning * into e;
  if not found then return null; end if;

  select count(*) into online from public.participants where code = _c and pid <> 'presenter' and last_seen > n - 45000;

  if e.status = 'scheduled' then  -- lobby headcount for the stage view
    if online > 0 then
      perform public.cp_send('ev:' || _c, 'pulse', jsonb_build_object('t', n, 'avg', null, 'n', 0, 'online', online,
        'dist', '[0,0,0,0,0]'::jsonb, 'energy', 0, 'rpm', 0, 'mpm', 0, 'momentum', 0, 'elapsed', 0));
    end if;
    if n - e.last_history >= 5000 then
      update public.events set last_history = n where code = _c;
      perform public.cp_send('adm:' || _c, 'admin-summary', public.cp_summary(_c));
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- ratings from people still here, or who rated in the last 3 minutes
  select avg(rating), count(*),
    jsonb_build_array(count(*) filter (where rating < 20), count(*) filter (where rating >= 20 and rating < 40),
      count(*) filter (where rating >= 40 and rating < 60), count(*) filter (where rating >= 60 and rating < 80), count(*) filter (where rating >= 80))
  into avg_, cnt, dist
  from public.participants where code = _c and rating_t is not null and (last_seen > n - 45000 or rating_t > n - 180000);

  select count(*) into rr from public.reactions where code = _c and t > n - 60000;
  select count(*) into rm from public.messages where code = _c and t > n - 60000;
  energy := least(100, round(((rr + rm * 2)::double precision / greatest(1, online)) * 25));
  select (s.p ->> 'avg')::double precision into prev_avg
  from (select p, t from public.pulse_history where code = _c order by t desc limit 6) s order by s.t asc limit 1;
  mom := case when avg_ is not null and prev_avg is not null then round(((avg_ - prev_avg) * 10)::numeric) / 10 else 0 end;

  -- passive signals: crowd figures only once 5+ people contribute (MIN_CROWD)
  tab_on := public.cp_setting(e.settings, 'passiveTab', true);
  cam_on := public.cp_setting(e.settings, 'passiveCamera', false);
  room_on := public.cp_setting(e.settings, 'passiveRoom', false);
  select count(*) filter (where pv_vis is not null), count(*) filter (where pv_att is not null),
    round((avg(pv_vis) * 100)::numeric, 1),
    round((count(*) filter (where pv_vis < 0.5))::numeric * 100 / nullif(count(*) filter (where pv_vis is not null), 0)),
    round(avg(pv_att)::numeric, 1), round(avg(pv_pos) filter (where pv_att is not null)::numeric, 1), round(avg(pv_fat) filter (where pv_att is not null)::numeric, 1)
  into n_tab, n_cam, focus, away, att, pos, fat
  from public.participants where code = _c and pv_t > n - 15000 and (last_seen > n - 45000 or bot);
  if not (tab_on and n_tab >= 5) then focus := null; away := null; end if;
  if not (cam_on and n_cam >= 5) then att := null; pos := null; fat := null; end if;
  room := null;
  if room_on then
    select * into rs from public.room_signals where code = _c order by t desc limit 1;
    if found and n - rs.seen < 10000 then
      room := jsonb_build_object('faces', rs.faces, 'laughter', rs.laughter, 'applause', rs.applause, 'level', rs.level,
        'attention', case when rs.faces >= 5 then rs.attention end, 'looking', case when rs.faces >= 5 then rs.looking end);
    end if;
  end if;
  select round(avg(x), 1) into idx from unnest(array[att, (room ->> 'attention')::numeric, focus]) x;
  pv := jsonb_build_object('minCrowd', 5, 'nTab', n_tab, 'nCam', n_cam, 'focus', focus, 'away', away, 'attention', att,
    'positive', pos, 'fatigue', fat, 'room', room, 'index', idx);

  -- reactions since the last pulse ride along with it
  select coalesce(jsonb_agg(jsonb_build_object('e', r.e, 'color', p.color) order by r.t), '[]') into reacts
  from (select * from public.reactions where code = _c and t > greatest(coalesce(prev_tick, 0), n - 4000) order by t limit 60) r
  left join public.participants p on p.code = r.code and p.pid = r.pid;

  pulse := jsonb_build_object('t', n, 'avg', round(avg_::numeric, 1), 'n', cnt, 'online', online, 'dist', dist, 'energy', energy,
    'rpm', rr, 'mpm', rm, 'momentum', mom, 'elapsed', n - e.started_at, 'passive', pv);
  update public.events set last_pulse = pulse where code = _c;
  perform public.cp_send('ev:' || _c, 'pulse', pulse || jsonb_build_object('reacts', reacts));

  if n - e.last_history >= 5000 then
    point := jsonb_build_object('t', n, 'avg', round(avg_::numeric, 1), 'n', cnt, 'online', online, 'energy', energy,
      'att', idx, 'focus', focus, 'cam', att, 'pos', pos, 'fat', fat, 'room', room -> 'attention',
      'laugh', room -> 'laughter', 'clap', room -> 'applause', 'nCam', n_cam);
    insert into public.pulse_history (code, t, p) values (_c, n, point);
    update public.events set last_history = n where code = _c;
    perform public.cp_send('ev:' || _c, 'history-point', point);
    perform public.cp_send('adm:' || _c, 'admin-summary', public.cp_summary(_c));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- attendee API ----------
create function public.cp_join(_c text, _p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.events; part public.participants; me text := auth.uid()::text;
begin
  if me is null then return jsonb_build_object('error', 'Not signed in'); end if;
  select * into e from public.events where code = upper(_c);
  if not found then return jsonb_build_object('error', 'No event with that code'); end if;
  part := public.cp_upsert_participant(e.code, me, _p, false);
  if part is null then return jsonb_build_object('error', 'This session is full'); end if;
  return jsonb_build_object('pid', me, 'pub', part.pub,
    'me', jsonb_build_object('id', part.pub, 'name', part.name, 'avatar', part.avatar, 'color', part.color))
    || public.cp_snapshot(e.code, me);
end $$;

-- stage / big-screen view (read-only)
create function public.cp_watch(_c text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.events where code = upper(_c)) then
    return jsonb_build_object('error', 'No event');
  end if;
  return public.cp_snapshot(upper(_c), null);
end $$;

create function public.cp_act(_c text, _action text, _p jsonb default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.events; me text := auth.uid()::text; n bigint := public.cp_now();
begin
  if me is null then return jsonb_build_object('error', 'Not signed in'); end if;
  select * into e from public.events where code = upper(_c);
  if not found then return jsonb_build_object('error', 'Event not found'); end if;
  update public.participants set last_seen = n where code = e.code and pid = me;
  if not found then return jsonb_build_object('error', 'Join the session first'); end if;
  case _action
    when 'heartbeat' then null;
    when 'rate' then perform public.cp_do_rate(e, me, _p -> 'v', _p -> 'mode');
    when 'react' then perform public.cp_do_react(e, me, public.cp_str(_p));
    when 'chat' then perform public.cp_do_chat(e, me, public.cp_str(_p));
    when 'ask' then perform public.cp_do_ask(e, me, public.cp_str(_p));
    when 'vote-q' then perform public.cp_do_vote_q(e, me, public.cp_str(_p));
    when 'poll-vote' then perform public.cp_do_poll_vote(e, me, public.cp_str(_p -> 'pollId'), _p -> 'idx');
    when 'feedback' then perform public.cp_do_feedback(e, me, _p);
    when 'passive' then
      if public.cp_throttle_ok(e.code, me, 'passive', 1500) then perform public.cp_do_passive(e, me, _p); end if;
    when 'passive-off' then
      update public.participants set passive_camera = false, pv_att = null, pv_pos = null, pv_fat = null where code = e.code and pid = me;
    when 'profile' then
      if jsonb_typeof(_p) = 'object' and public.cp_throttle_ok(e.code, me, 'profile', 1000) then
        perform public.cp_upsert_participant(e.code, me, _p, false);
      end if;
    when 'typing' then
      if public.cp_throttle_ok(e.code, me, 'typing', 1000) then
        perform public.cp_send('ev:' || e.code, 'typing',
          jsonb_build_object('name', (select name from public.participants where code = e.code and pid = me), 'pid', (select pub from public.participants where code = e.code and pid = me)));
      end if;
    else return jsonb_build_object('error', 'Unknown action');
  end case;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- presenter API ----------
create function public.cp_admin_join(_c text, _key text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.events; uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Not signed in'); end if;
  select * into e from public.events where code = upper(_c);
  if not found then return jsonb_build_object('error', 'Event not found'); end if;
  if not public.cp_is_admin(e.code) then
    if coalesce(_key, '') = '' or _key <> e.admin_key then return jsonb_build_object('error', 'Invalid admin key'); end if;
    insert into public.event_admins (code, uid) values (e.code, uid) on conflict do nothing;
  end if;
  insert into public.participants (code, pid, pub, name, avatar, color, joined_at, last_seen)
  values (e.code, 'presenter', 'presenter', coalesce(nullif(e.presenter, ''), 'Presenter'), '🎤', e.accent, public.cp_now(), 0)
  on conflict do nothing;
  return public.cp_snapshot(e.code, 'presenter') || jsonb_build_object('summary', public.cp_summary(e.code),
    'feedbackCount', (select count(*) from public.feedback where code = e.code));
end $$;

create function public.cp_admin(_c text, _action text, _p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.events; n bigint := public.cp_now(); txt text; opts jsonb; m public.messages; q public.questions; op jsonb; botid text;
begin
  select * into e from public.events where code = upper(_c);
  if not found then return jsonb_build_object('error', 'Event not found'); end if;
  if not public.cp_is_admin(e.code) then return jsonb_build_object('error', 'Not authorised'); end if;
  if jsonb_typeof(_p) is distinct from 'object' then _p := '{}'; end if;
  case _action
    when 'start' then
      if e.status <> 'live' then
        update public.events set status = 'live', started_at = coalesce(started_at, n), ended_at = null where code = e.code returning * into e;
        perform public.cp_system_msg(e, '🎬 The session is now live! Rate along as you go.');
        perform public.cp_broadcast_event(e.code);
      end if;
    when 'end' then
      update public.events set status = 'ended', ended_at = n where code = e.code returning * into e;
      update public.polls set open = false where code = e.code;
      perform public.cp_system_msg(e, '🏁 The session has ended — thanks for joining! Please leave a quick review.');
      perform public.cp_broadcast_event(e.code);
      perform public.cp_send('ev:' || e.code, 'polls', public.cp_polls_view(e.code));
    when 'reopen' then
      update public.events set status = 'live', ended_at = null where code = e.code;
      perform public.cp_broadcast_event(e.code);
    when 'reset' then
      delete from public.ratings where code = e.code;
      delete from public.reactions where code = e.code;
      delete from public.messages where code = e.code;
      delete from public.questions where code = e.code;
      delete from public.polls where code = e.code;
      delete from public.feedback where code = e.code;
      delete from public.pulse_history where code = e.code;
      delete from public.markers where code = e.code;
      delete from public.announcements where code = e.code;
      delete from public.passive_samples where code = e.code;
      delete from public.room_signals where code = e.code;
      delete from public.throttles where code = e.code;
      update public.participants set rating = null, rating_t = null, rating_mode = null, rating_row = null, pv_t = null, pv_vis = null,
        pv_act = null, pv_att = null, pv_pos = null, pv_fat = null, pv_stored = null, passive_camera = false where code = e.code;
      update public.events set status = 'scheduled', started_at = null, ended_at = null, last_pulse = null, last_history = 0 where code = e.code;
      perform public.cp_broadcast_event(e.code);
      perform public.cp_send('ev:' || e.code, 'reset', 'true');
    when 'settings' then
      update public.events set settings = public.cp_merge_settings(settings, _p) where code = e.code;
      perform public.cp_broadcast_event(e.code);
    when 'chat' then
      perform public.cp_do_chat(e, 'presenter', public.cp_str(_p -> 'text'));
    when 'msg-delete' then
      update public.messages set deleted = true where id = public.cp_str(_p -> 'id') and code = e.code;
      if found then perform public.cp_send('ev:' || e.code, 'chat-delete', _p -> 'id'); end if;
    when 'msg-pin' then
      update public.messages set pinned = case when id = public.cp_str(_p -> 'id') then not pinned else false end
      where code = e.code and (pinned or id = public.cp_str(_p -> 'id'));
      select * into m from public.messages where code = e.code and id = public.cp_str(_p -> 'id');
      perform public.cp_send('ev:' || e.code, 'pinned', case when m.pinned then public.cp_msg_json(m) else 'null'::jsonb end);
    when 'q' then
      select * into q from public.questions where id = public.cp_str(_p -> 'id') and code = e.code;
      if found then
        if _p ->> 'action' = 'answer' then update public.questions set answered = not answered where id = q.id; end if;
        if _p ->> 'action' = 'hide' then update public.questions set hidden = true where id = q.id; end if;
        if _p ->> 'action' = 'spotlight' then
          perform public.cp_send('ev:' || e.code, 'spotlight', jsonb_build_object('text', q.text, 'name', q.name, 'avatar', q.avatar));
        end if;
        perform public.cp_send('ev:' || e.code, 'questions', public.cp_questions_view(e.code));
      end if;
    when 'poll-create' then
      select coalesce(jsonb_agg(o), '[]') into opts from (
        select public.cp_clean(public.cp_str(x), 80) o from jsonb_array_elements(case when jsonb_typeof(_p -> 'options') = 'array' then _p -> 'options' else '[]' end) x
      ) s where o <> '';
      if jsonb_array_length(opts) > 6 then opts := (select jsonb_agg(v) from (select v from jsonb_array_elements(opts) with ordinality a(v, i) where i <= 6) s); end if;
      txt := public.cp_clean(public.cp_str(_p -> 'question'), 160);
      if txt = '' or jsonb_array_length(opts) < 2 then return jsonb_build_object('error', 'A poll needs a question and at least 2 options'); end if;
      update public.polls set open = false where code = e.code;
      insert into public.polls (id, code, question, options, t) values (public.cp_id(), e.code, txt, opts, n);
      perform public.cp_send('ev:' || e.code, 'polls', public.cp_polls_view(e.code));
    when 'poll-close' then
      update public.polls set open = false where id = public.cp_str(_p -> 'id') and code = e.code;
      perform public.cp_send('ev:' || e.code, 'polls', public.cp_polls_view(e.code));
    when 'marker' then
      txt := public.cp_clean(public.cp_str(_p -> 'label'), 60);
      if txt <> '' then
        insert into public.markers (code, label, t) values (e.code, txt, n);
        perform public.cp_send('ev:' || e.code, 'marker', jsonb_build_object('label', txt, 't', n));
        perform public.cp_system_msg(e, '📍 Now: ' || txt);
      end if;
    when 'announce' then
      txt := public.cp_clean(public.cp_str(_p -> 'text'), 200);
      if txt = '' then return jsonb_build_object('error', 'Write a message first'); end if;
      insert into public.announcements (code, text, t) values (e.code, txt, n);
      perform public.cp_send('ev:' || e.code, 'announce', jsonb_build_object('text', txt, 't', n));
    when 'confetti' then
      perform public.cp_send('ev:' || e.code, 'confetti', 'true');
    when 'room' then
      if public.cp_throttle_ok(e.code, 'presenter', 'room', 800) then perform public.cp_do_room(e, _p); end if;
    when 'simulate' then
      -- the demo audience runs in the control room (js/simulator.js); this only flags it and clears bots when it stops
      update public.events set simulating = (_p -> 'on' = 'true'::jsonb) where code = e.code;
      if not (_p -> 'on' = 'true'::jsonb) then update public.participants set last_seen = 0 where code = e.code and bot; end if;
      perform public.cp_send('adm:' || e.code, 'admin-summary', public.cp_summary(e.code));
      return jsonb_build_object('simulating', _p -> 'on' = 'true'::jsonb);
    when 'sim' then
      -- a batch of simulated-attendee actions: { ops: [{ op, i, ... }] }, bots are 'bot_CODE_i'
      update public.participants set last_seen = n where code = e.code and bot;
      for op in select x from jsonb_array_elements(case when jsonb_typeof(_p -> 'ops') = 'array' then _p -> 'ops' else '[]' end) with ordinality a(x, k) where k <= 600 loop
        if jsonb_typeof(op) <> 'object' or public.cp_num(op -> 'i') is null then continue; end if;
        botid := 'bot_' || e.code || '_' || least(149, greatest(0, public.cp_num(op -> 'i')::int));
        case op ->> 'op'
          when 'join' then perform public.cp_upsert_participant(e.code, botid, op, true);
          when 'rate' then perform public.cp_do_rate(e, botid, op -> 'v', op -> 'mode');
          when 'react' then perform public.cp_do_react(e, botid, public.cp_str(op -> 'e'));
          when 'chat' then perform public.cp_do_chat(e, botid, public.cp_str(op -> 'text'));
          when 'ask' then perform public.cp_do_ask(e, botid, public.cp_str(op -> 'text'));
          when 'vote-q' then perform public.cp_do_vote_q(e, botid, public.cp_str(op -> 'qid'));
          when 'poll-vote' then perform public.cp_do_poll_vote(e, botid, public.cp_str(op -> 'pollId'), op -> 'idx');
          when 'passive' then perform public.cp_do_passive(e, botid, op -> 'p');
          when 'feedback' then perform public.cp_do_feedback(e, botid, op -> 'f');
          when 'room' then perform public.cp_do_room(e, op -> 'r');
          else null;
        end case;
      end loop;
    else return jsonb_build_object('error', 'Unknown action');
  end case;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- host dashboard ----------
create function public.cp_host_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then null else auth.jwt() ->> 'email' end,
    'isHost', public.cp_is_host())
$$;

create function public.cp_list_events() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.cp_summary(e.code) order by e.starts_at desc), '[]')
  from public.events e join public.event_admins a on a.code = e.code and a.uid = auth.uid()
$$;

create function public.cp_create_event(_b jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c text; title text; uid uuid := auth.uid(); starts timestamptz; dur double precision;
begin
  if not public.cp_is_host() then
    return jsonb_build_object('error', 'Only approved hosts can create sessions. Sign in with an email address on the hosts list.');
  end if;
  if (select count(*) from public.events where owner = uid) >= 500 then return jsonb_build_object('error', 'Too many sessions: delete some first'); end if;
  if jsonb_typeof(_b) is distinct from 'object' then _b := '{}'; end if;
  title := public.cp_clean(public.cp_str(_b -> 'title'), 120);
  if title = '' then return jsonb_build_object('error', 'Title is required'); end if;
  begin starts := (public.cp_str(_b -> 'startsAt'))::timestamptz; exception when others then starts := null; end;
  dur := public.cp_num(_b -> 'durationMin');
  c := public.cp_new_code();
  insert into public.events (code, owner, admin_key, title, description, presenter, starts_at, duration_min, location, accent, settings, created_at)
  values (c, uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), title,
    public.cp_clean(public.cp_str(_b -> 'description'), 2000), public.cp_clean(public.cp_str(_b -> 'presenter'), 80),
    coalesce(starts, now()), greatest(5, least(1440, coalesce(round(dur), 60))), public.cp_clean_location(_b -> 'location'),
    case when public.cp_str(_b -> 'accent') ~* '^#[0-9a-f]{6}$' then public.cp_str(_b -> 'accent') else '#7c5cff' end,
    public.cp_merge_settings(jsonb_build_object('chat', true, 'qa', true, 'reactions', true, 'publicReport', false, 'showCrowdMood', true,
      'listed', false, 'passiveTab', true, 'passiveCamera', false, 'passiveRoom', false), _b -> 'settings'),
    public.cp_now());
  insert into public.event_admins (code, uid) values (c, uid);
  return public.cp_summary(c);
end $$;

create function public.cp_duplicate_event(_c text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare src public.events; c text; uid uuid := auth.uid();
begin
  select * into src from public.events where code = upper(_c);
  if not found or not public.cp_is_admin(src.code) then return jsonb_build_object('error', 'Forbidden'); end if;
  if (select count(*) from public.events where owner = uid) >= 500 then return jsonb_build_object('error', 'Too many sessions: delete some first'); end if;
  c := public.cp_new_code();
  insert into public.events (code, owner, admin_key, title, description, presenter, starts_at, duration_min, location, accent, settings, created_at)
  values (c, uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), left(src.title, 113) || ' (copy)', src.description,
    src.presenter, src.starts_at, src.duration_min, src.location, src.accent, src.settings, public.cp_now());
  insert into public.event_admins (code, uid) values (c, uid);
  return public.cp_summary(c);
end $$;

create function public.cp_delete_event(_c text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.cp_is_admin(upper(_c)) then return jsonb_build_object('error', 'Forbidden'); end if;
  perform public.cp_send('ev:' || upper(_c), 'deleted', 'true');
  delete from public.events where code = upper(_c);
  return jsonb_build_object('ok', true);
end $$;

-- Sessions the host chose to list on the home page: live ones first, then those starting in the next week.
create function public.cp_list_live() returns jsonb language sql stable security definer set search_path = '' as $$
  with n as (select public.cp_now() as now),
  l as (
    select e.*, (select count(*) from public.participants p, n where p.code = e.code and p.pid <> 'presenter' and p.last_seen > n.now - 45000) as online
    from public.events e, n
    where public.cp_setting(e.settings, 'listed', false) and (e.status = 'live' or (e.status = 'scheduled'
      and e.starts_at > to_timestamp((n.now - e.duration_min * 60000) / 1000.0) and e.starts_at < to_timestamp((n.now + 7 * 86400000) / 1000.0)))
  )
  select coalesce(jsonb_agg(x.j order by x.live desc, x.online_sort desc, x.starts_at), '[]') from (
    select l.status = 'live' as live, case when l.status = 'live' then l.online else 0 end as online_sort, l.starts_at,
      jsonb_build_object('code', l.code, 'title', l.title, 'presenter', l.presenter, 'status', l.status,
        'startsAt', to_char(l.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'startedAt', l.started_at,
        'durationMin', l.duration_min, 'accent', l.accent,
        'location', jsonb_build_object('mode', l.location ->> 'mode', 'venue', coalesce(l.location ->> 'venue', '')),
        'online', l.online,
        'mood', case when l.status = 'live' and public.cp_setting(l.settings, 'showCrowdMood', true) and (l.last_pulse ->> 'avg') is not null
                  then round((l.last_pulse ->> 'avg')::numeric) end) as j
    from l order by live desc, online_sort desc, l.starts_at limit 50
  ) x
$$;

create function public.cp_event_public(_c text) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.cp_event_json(e) from public.events e where e.code = upper(_c)
$$;

-- ---------- report ----------
-- Who may read a session's report: its admins, or anyone once the host shares it.
create function public.cp_report_access(_c text) returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when e.code is null then jsonb_build_object('ok', false, 'error', 'Event not found')
    when public.cp_is_admin(e.code) then jsonb_build_object('ok', true, 'admin', true)
    when public.cp_setting(e.settings, 'publicReport', false) then jsonb_build_object('ok', true, 'admin', false)
    else jsonb_build_object('ok', false, 'error', 'The presenter has not published this report.')
  end
  from (select 1) d left join public.events e on e.code = upper(_c)
$$;

-- Everything the report needs, shaped like the old server's event object. Only the report Edge Function
-- (service role) can call this; people are identified by their public id, never their account id.
create function public.cp_report_data(_c text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where code = upper(_c);
  if not found then return null; end if;
  return public.cp_event_json(e) || jsonb_build_object(
    'participants', (select coalesce(jsonb_object_agg(p.pub, jsonb_build_object('id', p.pub, 'name', p.name, 'avatar', p.avatar,
        'color', p.color, 'passiveCamera', p.passive_camera)), '{}') from public.participants p where p.code = e.code),
    'ratings', (select coalesce(jsonb_agg(jsonb_build_object('pid', p.pub, 'v', r.v, 't', r.t, 'mode', r.mode) order by r.t), '[]')
        from public.ratings r join public.participants p on p.code = r.code and p.pid = r.pid where r.code = e.code),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('pid', p.pub, 'e', r.e, 't', r.t) order by r.t), '[]')
        from public.reactions r join public.participants p on p.code = r.code and p.pid = r.pid where r.code = e.code),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'pid', m.pub, 'name', m.name, 'text', m.text, 't', m.t,
        'role', m.role, 'pinned', m.pinned) order by m.t), '[]') from public.messages m where m.code = e.code and not m.deleted),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'pid', q.pub, 'name', q.name, 'avatar', q.avatar, 'text', q.text,
        't', q.t, 'answered', q.answered, 'hidden', q.hidden,
        'votes', (select coalesce(jsonb_agg(v.pub), '[]') from public.question_votes v where v.qid = q.id)) order by q.t), '[]')
        from public.questions q where q.code = e.code),
    'polls', (select coalesce(jsonb_agg(jsonb_build_object('question', v ->> 'question', 'options', v -> 'options',
        'voters', (select coalesce(jsonb_object_agg(p.pub, pv.idx), '{}') from public.poll_votes pv
                   join public.participants p on p.code = e.code and p.pid = pv.pid where pv.poll_id = v ->> 'id')) order by (v ->> 't')::bigint), '[]')
        from jsonb_array_elements(public.cp_polls_view(e.code)) v),
    'feedback', (select coalesce(jsonb_object_agg(p.pub, jsonb_build_object('stars', f.stars, 'nps', f.nps, 'word', f.word,
        'comment', f.comment, 'aspects', f.aspects, 't', f.t)), '{}')
        from public.feedback f join public.participants p on p.code = f.code and p.pid = f.pid where f.code = e.code),
    'pulseHistory', (select coalesce(jsonb_agg(h.p order by h.t), '[]') from public.pulse_history h where h.code = e.code),
    'markers', (select coalesce(jsonb_agg(jsonb_build_object('label', m.label, 't', m.t) order by m.t), '[]') from public.markers m where m.code = e.code),
    'passive', (select coalesce(jsonb_agg(jsonb_build_object('pid', p.pub, 't', s.t, 'vis', s.vis, 'act', s.act, 'att', s.att,
        'pos', s.pos, 'fat', s.fat) order by s.t), '[]')
        from public.passive_samples s join public.participants p on p.code = s.code and p.pid = s.pid where s.code = e.code),
    'roomSignals', (select coalesce(jsonb_agg(jsonb_build_object('t', r.t, 'faces', r.faces, 'looking', r.looking, 'attention', r.attention,
        'laughter', r.laughter, 'applause', r.applause, 'level', r.level) order by r.t), '[]') from public.room_signals r where r.code = e.code));
end $$;

-- ---------- Realtime: who may listen on which channel ----------
create policy "crowdpulse listen" on realtime.messages for select to authenticated using (
  ((select realtime.topic()) like 'ev:%' and public.cp_event_exists(substr((select realtime.topic()), 4)))
  or ((select realtime.topic()) like 'adm:%' and public.cp_is_admin(substr((select realtime.topic()), 5)))
);

-- ---------- grants: the browser API ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.cp_join(text, jsonb), public.cp_watch(text), public.cp_act(text, text, jsonb), public.cp_tick(text),
  public.cp_admin_join(text, text), public.cp_admin(text, text, jsonb),
  public.cp_host_status(), public.cp_list_events(), public.cp_create_event(jsonb), public.cp_duplicate_event(text),
  public.cp_delete_event(text), public.cp_list_live(), public.cp_event_public(text), public.cp_report_access(text),
  -- used inside the Realtime policy above, which runs as the listening user
  public.cp_is_admin(text), public.cp_event_exists(text)
to authenticated;
grant execute on function public.cp_report_data(text) to service_role;
