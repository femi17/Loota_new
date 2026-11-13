-- A real police chase (owner, 13 Nov 2026: "Make the police give a real chase but how does user escape. we need to think
-- this through"; chose: a wanted level, GTA-style; escape by hiding out of sight; the fine grows with the run; shown big on
-- the broadcast). The game runs the police (they drive the roads to where they last saw the hunter, on the game's clock;
-- ★★ after 30 s seen: a second car from ahead; ★★★ after 60 s: a roadblock); the server keeps the chase (police_chases:
-- when, the level, the police's track and what happened, for the broadcast), settles it by its own clock, and holds the
-- hunter to it (no bus, train, plane or taxi while chased).
set lock_timeout = '8s';

create table public.police_chases (
  event_id bigint primary key references public.road_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  hunt_id uuid,
  chaser text not null check (chaser in ('officer', 'patrol')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text check (outcome in ('caught', 'escaped', 'called_off')),
  level integer not null default 1 check (level between 1 and 3),
  track jsonb not null default '[]'::jsonb, -- [server ms, car 0|1, lng, lat, heading]: the police, the last 400 points
  notes jsonb not null default '[]'::jsonb  -- [server ms, what, detail]: seen / unseen / level / hide / roadblock / end
);
create index police_chases_user on public.police_chases (user_id, started_at desc);
alter table public.police_chases enable row level security;

-- A chase under way (started within 6 minutes, not ended).
create or replace function public.chased(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.police_chases where user_id = p_user and ended_at is null and started_at > now() - interval '6 minutes')
$$;

-- Riding on through a checkpoint: the chase, kept.
do $$
declare
  f text := pg_get_functiondef('public.road_event_answer(bigint, integer)'::regprocedure);
  a text := '    chase := case coalesce(pos.mode, ''walk'')
      when ''walk'' then jsonb_build_object(''chaser'', ''officer'', ''kmh'', 7, ''gapM'', 25, ''loseM'', 150, ''seconds'', 40)
      when ''bicycle'' then jsonb_build_object(''chaser'', ''patrol'', ''kmh'', 24, ''gapM'', 50, ''loseM'', 300, ''seconds'', 40)
      else jsonb_build_object(''chaser'', ''patrol'', ''kmh'', 40, ''gapM'', 60, ''loseM'', 400, ''seconds'', 40)
    end;';
begin
  if position(a in f) = 0 then
    raise exception 'road_event_answer: not found';
  end if;
  execute replace(f, a, '    -- A real chase (13 Nov 2026): the game runs the police on its own clock; seconds = the most it lasts
    chase := case coalesce(pos.mode, ''walk'')
      when ''walk'' then jsonb_build_object(''chaser'', ''officer'', ''gapM'', 40, ''seconds'', 240)
      else jsonb_build_object(''chaser'', ''patrol'', ''gapM'', 120, ''seconds'', 240)
    end;
    insert into public.police_chases (event_id, user_id, hunt_id, chaser) values (e.id, uid, e.hunt_id, chase ->> ''chaser'')
    on conflict (event_id) do nothing;');
end $$;

-- What the game saw: the police's track and what happened (a second a batch); the level only goes up, and only as fast as
-- the server's clock allows (★★ from 30 s, ★★★ from 60 s).
create or replace function public.chase_put(p_event bigint, p_track jsonb, p_notes jsonb, p_level integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  c public.police_chases%rowtype;
  secs double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if (p_track is not null and (jsonb_typeof(p_track) <> 'array' or jsonb_array_length(p_track) > 120))
     or (p_notes is not null and (jsonb_typeof(p_notes) <> 'array' or jsonb_array_length(p_notes) > 30 or length(p_notes::text) > 4000)) then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  select * into c from public.police_chases where event_id = p_event and user_id = uid and ended_at is null for update;
  if c.event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  secs := extract(epoch from now() - c.started_at);
  update public.police_chases
     set track = (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from (
                    select x, i from jsonb_array_elements(c.track || coalesce(p_track, '[]'::jsonb)) with ordinality t(x, i)
                    order by i desc limit 400) y),
         notes = case when jsonb_array_length(c.notes) > 150 then c.notes else c.notes || coalesce(p_notes, '[]'::jsonb) end,
         level = greatest(c.level, least(coalesce(p_level, 1), case when secs >= 60 then 3 when secs >= 30 then 2 else 1 end))
   where event_id = p_event;
  return jsonb_build_object('ok', true);
end;
$$;

-- How it ended: caught (the fine and the wait by the wanted level: 50/100/200 coins, 60/120/180 s; more for missing
-- papers), escaped, or called off (4 minutes). The level is the server's (as chase_put kept it, and its clock).
create or replace function public.police_chase_end(p_event bigint, p_caught boolean, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  c public.police_chases%rowtype;
  fine integer := 0;
  balance bigint;
  lvl integer;
  how text := case when p_caught then 'caught' when p_outcome = 'called_off' then 'called_off' else 'escaped' end;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into c from public.police_chases where event_id = p_event and user_id = uid and ended_at is null for update;
  select * into e from public.road_events where id = p_event and user_id = uid and kind = 'checkpoint' and outcome = 'chased' for update;
  if c.event_id is null or e.id is null or c.started_at < now() - interval '6 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  lvl := c.level;
  if p_caught then
    select least((case lvl when 3 then 200 when 2 then 100 else 50 end * greatest(1, cardinality(e.missing)))::integer, coins)::integer
      into fine from public.profiles where id = uid;
    if fine > 0 then
      balance := public.apply_coin_change(uid, -fine, 'spend', 'Caught after a police chase (' || repeat('★', lvl) || ')', 'chase:' || e.id);
    end if;
    update public.road_events set outcome = 'fined' where id = e.id;
  else
    update public.road_events set outcome = 'declined' where id = e.id;
  end if;
  update public.police_chases set ended_at = now(), outcome = how,
         notes = notes || jsonb_build_array(jsonb_build_array(floor(extract(epoch from now()) * 1000), 'end', how))
   where event_id = p_event;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'caught', p_caught, 'outcome', how, 'level', lvl, 'fine', fine, 'balance', balance,
    'holdS', case when p_caught then 60 * lvl else 0 end);
end;
$$;

-- Chased: no bus, train, plane or taxi (no escaping on public transport).
do $$
declare
  fn text;
  f text;
  a text := '  -- Arrested (the idling law): the police have them; no travelling
  if (public.jailed(uid)).id is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''arrested'');
  end if;
';
begin
  foreach fn in array array['public.start_trip(bigint, bigint, jsonb, boolean)', 'public.request_pickup(text, double precision, double precision, text, jsonb, jsonb, text, double precision, double precision)', 'public.board_taxi()'] loop
    f := pg_get_functiondef(fn::regprocedure);
    if position(a in f) = 0 then
      raise exception '% : not found', fn;
    end if;
    execute replace(f, a, a || '  -- Chased by the police: no getting away on a bus, train, plane or taxi
  if public.chased(uid) then
    return jsonb_build_object(''ok'', false, ''reason'', ''chased'');
  end if;
');
  end loop;
end $$;

-- The broadcast: the hunt's chases (started within 10 minutes, ended within the last minute or not yet).
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a text := '''now'', now(),'; -- (an earlier patch left it unindented)
  b text := '            -- A Lamp prize won during the hunt';
begin
  if position(a in f) = 0 or position(b in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  f := replace(f, a, '    ''chases'', coalesce((
      select jsonb_agg(jsonb_build_object(''userId'', c.user_id, ''event'', c.event_id, ''chaser'', c.chaser, ''startedAt'', c.started_at,
          ''endedAt'', c.ended_at, ''outcome'', c.outcome, ''level'', c.level, ''track'', c.track, ''notes'', c.notes))
        from public.police_chases c
        join public.hunt_players p on p.user_id = c.user_id and p.hunt_id = h.id
       where c.started_at > now() - interval ''10 minutes'' and coalesce(c.ended_at, ''infinity'') > now() - interval ''1 minute''
         and not public.wonder_cloaked(c.user_id, h.id)), ''[]''::jsonb),
    ' || a);
  f := replace(f, b, '            -- Police chases: rode through a checkpoint, and how it ended
            select c.started_at, ''chase'', pr.username, c.user_id, ''🚨 '' || pr.username || '' rode through a police checkpoint: the police are after them!''
              from public.police_chases c
              join public.hunt_players p on p.user_id = c.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = c.user_id
             where c.started_at between h.starts_at and h.ends_at
            union all
            select c.ended_at, ''chase_end'', pr.username, c.user_id,
                   case c.outcome when ''caught'' then ''🚔 '' || pr.username || '' was caught by the police ('' || repeat(''★'', c.level) || '')''
                                  when ''called_off'' then ''🏁 The police called off the chase: '' || pr.username || '' got away''
                                  else ''🏁 '' || pr.username || '' lost the police ('' || repeat(''★'', c.level) || '')'' end
              from public.police_chases c
              join public.hunt_players p on p.user_id = c.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = c.user_id
             where c.ended_at is not null and c.ended_at between h.starts_at and h.ends_at
            union all
' || b);
  execute f;
end $$;

revoke execute on function public.chase_put(bigint, jsonb, jsonb, integer), public.police_chase_end(bigint, boolean, text) from public, anon;
grant execute on function public.chase_put(bigint, jsonb, jsonb, integer), public.police_chase_end(bigint, boolean, text) to authenticated, service_role;
revoke execute on function public.chased(uuid) from public, anon, authenticated;
grant execute on function public.chased(uuid) to service_role;
