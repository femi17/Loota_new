set lock_timeout = '8s';
-- Showdowns: stealing a key (owner, 14 Nov 2026: "if you have a key now. It should in the leaderboard… there as to be a
-- relic, that shows people your location. and when they are close to you. It will be like a showdown… the thief
-- challenges you, you have a category… you pick one, then the puzzle is shown, if you get it right you win, if you lose
-- maybe the thief steals your key(s)"; agreed: one key, no ransom ("the intention is the key… the thief won't want the
-- money"), a Tracker relic, the target warned, fight or run, the same puzzle for both, protections).
--   The Tracker (a rare relic): for 10 minutes, the hunt's key holders: which way and how far (exact within 300 m).
--   Within 50 m of a key holder, a hunter may challenge them (50 coins at stake). The target has 20 s to pick one of
--   three puzzle kinds, or run: 30 s to get 300 m away (escaped: no showdown). No answer, or caught running: a kind is
--   picked for them. Both get the same puzzle (Key Trial puzzles, made by the game's server from one seed); the first
--   right answer wins, two tries each; neither in time: the target keeps the key.
--   The thief wins: the target loses their latest key (back to win it again; their answer to its riddle kept), the
--   thief gains one (their next key, its trial skipped). The thief loses: their 50 coins go to the target, and they're
--   thrown 2 km away.
--   Never someone offline, in a trial, on a trip, arrested, chased, in hospital or cloaked; a key won in the last 10
--   minutes is safe, and a target is shielded 30 minutes after a showdown; the same thief and target once a hunt; a
--   thief at most 5 challenges a day.

alter table public.player_boosts add column if not exists tracker_until timestamptz;

create table if not exists public.showdowns (
  id bigint generated always as identity primary key,
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  thief uuid not null references auth.users (id) on delete cascade,
  target uuid not null references auth.users (id) on delete cascade,
  key_n integer not null, -- the target's key at stake
  stake integer not null default 50,
  status text not null default 'challenged' check (status in ('challenged', 'running', 'fight', 'stolen', 'defended', 'escaped', 'cancelled')),
  offered text[] not null,
  kind text,
  seed bigint not null default floor(random() * 2000000000)::bigint,
  puzzle jsonb,
  solution jsonb,
  created_at timestamptz not null default now(),
  run_until timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  winner uuid,
  thief_tries integer not null default 0,
  target_tries integer not null default 0,
  thief_progress real not null default 0,
  target_progress real not null default 0,
  thrown jsonb
);
create index if not exists showdowns_thief on public.showdowns (thief, created_at desc);
create index if not exists showdowns_target on public.showdowns (target, created_at desc);
create index if not exists showdowns_hunt on public.showdowns (hunt_id, created_at desc);
create unique index if not exists showdowns_one_live_thief on public.showdowns (thief) where status in ('challenged', 'running', 'fight');
create unique index if not exists showdowns_one_live_target on public.showdowns (target) where status in ('challenged', 'running', 'fight');
alter table public.showdowns enable row level security; -- (no direct access: the functions below)

create or replace function public.showdown_stake() returns integer language sql immutable set search_path to '' as $$ select 50 $$;

-- The hunt a player is in now (live, not finished)
create or replace function public.live_hunt_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select p.hunt_id from public.hunt_players p join public.hunts h on h.id = p.hunt_id
   where p.user_id = p_user and p.finished_at is null and now() between h.starts_at and h.ends_at
   order by p.joined_at desc limit 1
$$;

-- Why a hunter can't be challenged now (null: they can)
create or replace function public.showdown_blocked(p_hunt uuid, p_target uuid, p_thief uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  hp public.hunt_players%rowtype;
  pos public.player_positions%rowtype;
begin
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = p_target;
  if hp.user_id is null or hp.finished_at is not null then
    return 'not_in_hunt';
  end if;
  if public.keys_in(p_hunt, hp.keys_held) < 1 then
    return 'no_key';
  end if;
  select * into pos from public.player_positions where user_id = p_target;
  if pos.user_id is null or pos.updated_at < now() - interval '90 seconds' then
    return 'offline';
  end if;
  if hp.last_key_at > now() - interval '10 minutes' then
    return 'fresh_key';
  end if;
  if exists (select 1 from public.showdowns s where s.target = p_target and s.ended_at > now() - interval '30 minutes' and s.status in ('stolen', 'defended')) then
    return 'shielded';
  end if;
  if exists (select 1 from public.showdowns s where s.hunt_id = p_hunt and s.thief = p_thief and s.target = p_target and s.status <> 'cancelled') then
    return 'done';
  end if;
  if exists (select 1 from public.showdowns s where (s.thief = p_target or s.target = p_target) and s.status in ('challenged', 'running', 'fight')) then
    return 'busy';
  end if;
  if exists (select 1 from public.trial_attempts t where t.user_id = p_target and t.status = 'active')
     or exists (select 1 from public.transit_trips t where t.user_id = p_target and t.ended_at is null and t.departs_at <= now() and t.arrives_at > now())
     or (public.jailed(p_target)).id is not null
     or public.chased(p_target)
     or exists (select 1 from public.hospital_visits v where v.user_id = p_target and v.discharged_at > now())
     or public.wonder_cloaked(p_target, p_hunt) then
    return 'busy';
  end if;
  return null;
end;
$$;

-- The Tracker: the hunt's key holders, which way and how far (exact within 300 m)
create or replace function public.tracker_scan()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  hunt uuid;
  me public.player_positions%rowtype;
  until timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select tracker_until into until from public.player_boosts where user_id = uid;
  if until is null or until <= now() then
    return jsonb_build_object('active', false);
  end if;
  hunt := public.live_hunt_of(uid);
  select * into me from public.player_positions where user_id = uid;
  if hunt is null or me.user_id is null then
    return jsonb_build_object('active', true, 'until', until, 'holders', '[]'::jsonb, 'noHunt', hunt is null);
  end if;
  return jsonb_build_object('active', true, 'until', until, 'holders', coalesce((
    select jsonb_agg(x order by (x ->> 'metres')::double precision) from (
      select jsonb_build_object('id', p.user_id, 'name', pr.username, 'keys', public.keys_in(hunt, p.keys_held),
               'metres', round(dd.d), 'bearing', round(degrees(atan2((pp.lng - me.lng) * cos(radians(me.lat)), pp.lat - me.lat))::numeric),
               'band', public.distance_band(dd.d),
               'lng', case when dd.d <= 300 then pp.lng end, 'lat', case when dd.d <= 300 then pp.lat end) x
        from public.hunt_players p
        join public.profiles pr on pr.id = p.user_id
        join public.player_positions pp on pp.user_id = p.user_id
        cross join lateral (select public.distance_m(me.lng, me.lat, pp.lng, pp.lat) d) dd
       where p.hunt_id = hunt and p.user_id <> uid and p.finished_at is null
         and public.keys_in(hunt, p.keys_held) >= 1
         and pp.updated_at > now() - interval '3 minutes'
         and not public.wonder_cloaked(p.user_id, hunt)
       limit 30) y), '[]'::jsonb));
end;
$$;

-- Key holders within 50 m that this hunter could challenge (and why not, for those they can't)
create or replace function public.showdown_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  hunt uuid;
  me public.player_positions%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  hunt := public.live_hunt_of(uid);
  select * into me from public.player_positions where user_id = uid;
  if hunt is null or me.user_id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.user_id, 'name', pr.username, 'keys', public.keys_in(hunt, p.keys_held),
             'metres', round(public.distance_m(me.lng, me.lat, pp.lng, pp.lat)), 'blocked', public.showdown_blocked(hunt, p.user_id, uid),
             'safeUntil', case when p.last_key_at > now() - interval '10 minutes' then p.last_key_at + interval '10 minutes' end))
      from public.hunt_players p
      join public.profiles pr on pr.id = p.user_id
      join public.player_positions pp on pp.user_id = p.user_id
     where p.hunt_id = hunt and p.user_id <> uid and p.finished_at is null
       and public.keys_in(hunt, p.keys_held) >= 1
       and pp.lat between me.lat - 0.001 and me.lat + 0.001
       and public.distance_m(me.lng, me.lat, pp.lng, pp.lat) <= 50), '[]'::jsonb);
end;
$$;

-- Challenge a key holder within 50 m
create or replace function public.showdown_challenge(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  hunt uuid;
  me public.player_positions%rowtype;
  them public.player_positions%rowtype;
  hp public.hunt_players%rowtype;
  why text;
  have bigint;
  latest integer;
  kinds text[];
  s public.showdowns%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  hunt := public.live_hunt_of(uid);
  if hunt is null then
    return jsonb_build_object('ok', false, 'reason', 'no_hunt');
  end if;
  if p_target = uid then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if exists (select 1 from public.showdowns where (thief = uid or target = uid) and status in ('challenged', 'running', 'fight')) then
    return jsonb_build_object('ok', false, 'reason', 'busy_me');
  end if;
  if (select count(*) from public.showdowns where thief = uid and created_at > now() - interval '1 day' and status <> 'cancelled') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  if exists (select 1 from public.trial_attempts t where t.user_id = uid and t.status = 'active') or (public.jailed(uid)).id is not null or public.chased(uid) then
    return jsonb_build_object('ok', false, 'reason', 'busy_me');
  end if;
  why := public.showdown_blocked(hunt, p_target, uid);
  if why is not null then
    return jsonb_build_object('ok', false, 'reason', why);
  end if;
  select * into me from public.player_positions where user_id = uid;
  select * into them from public.player_positions where user_id = p_target;
  if me.user_id is null or public.distance_m(me.lng, me.lat, them.lng, them.lat) > 50 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  select pr.coins into have from public.profiles pr where pr.id = uid;
  if coalesce(have, 0) < public.showdown_stake() then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'stake', public.showdown_stake());
  end if;
  -- The target's latest real key: what's at stake
  select * into hp from public.hunt_players where hunt_id = hunt and user_id = p_target;
  select max(k.n) into latest from public.hunt_keys k where k.hunt_id = hunt and k.n <= hp.keys_held and not coalesce(k.relay, false);
  if latest is null then
    return jsonb_build_object('ok', false, 'reason', 'no_key');
  end if;
  -- Three quick puzzle kinds for the target to choose from
  select array_agg(x.k) into kinds from (select k from unnest(array['flags', 'brands', 'grammar', 'algebra', 'countries', 'vowels']) k order by random() limit 3) x;
  perform public.apply_coin_change(uid, -public.showdown_stake(), 'spend', 'Showdown stake', null);
  insert into public.showdowns (hunt_id, thief, target, key_n, stake, offered)
  values (hunt, uid, p_target, latest, public.showdown_stake(), kinds)
  returning * into s;
  perform public.road_news(uid, 'showdown',
    '⚔️ ' || (select username from public.profiles where id = uid) || ' challenged ' || (select username from public.profiles where id = p_target) || ' to a showdown for a key!');
  return jsonb_build_object('ok', true, 'showdown', public.showdown_view(s, uid));
end;
$$;

-- What a showdown looks like to one of its two hunters (never the solution)
create or replace function public.showdown_view(s public.showdowns, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object('id', s.id, 'role', case when p_user = s.thief then 'thief' else 'target' end,
    'thief', jsonb_build_object('id', s.thief, 'name', (select username from public.profiles where id = s.thief)),
    'target', jsonb_build_object('id', s.target, 'name', (select username from public.profiles where id = s.target)),
    'keyN', s.key_n, 'stake', s.stake, 'status', s.status, 'offered', to_jsonb(s.offered), 'kind', s.kind,
    'createdAt', s.created_at, 'runUntil', s.run_until, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'endedAt', s.ended_at,
    'winner', s.winner, 'myTries', case when p_user = s.thief then s.thief_tries else s.target_tries end,
    'theirProgress', case when p_user = s.thief then s.target_progress else s.thief_progress end,
    'gap', (select round(public.distance_m(a.lng, a.lat, b.lng, b.lat)) from public.player_positions a, public.player_positions b
             where a.user_id = s.thief and b.user_id = s.target),
    'thrown', case when p_user = s.thief then s.thrown end,
    'now', now())
$$;

-- Into the fight: the kind (the target's choice, or picked for them), the clock from 4 s on
create or replace function public.showdown_fight(p_id bigint, p_kind text)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.showdowns
     set status = 'fight', kind = p_kind, run_until = null,
         starts_at = now() + interval '4 seconds',
         ends_at = now() + interval '4 seconds' + make_interval(secs => public.puzzle_seconds(p_kind, 1))
   where id = p_id and status in ('challenged', 'running')
$$;

-- How it ends: the key moves (or not), the stake, the thief thrown, the news
create or replace function public.showdown_end(p_id bigint, p_how text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.showdowns%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  stops integer;
  next_real integer;
  finish_place integer;
  thief_name text;
  target_name text;
  bearing double precision := random() * 2 * pi();
  pos public.player_positions%rowtype;
  to_lng double precision;
  to_lat double precision;
begin
  select * into s from public.showdowns where id = p_id for update;
  if s.id is null or s.status not in ('challenged', 'running', 'fight') then
    return;
  end if;
  select username into thief_name from public.profiles where id = s.thief;
  select username into target_name from public.profiles where id = s.target;
  if p_how = 'stolen' then
    -- The target: back before the key (to win it again), their answer to its riddle kept, so the way back is shown
    select * into k from public.hunt_keys where hunt_id = s.hunt_id and n = s.key_n;
    update public.hunt_players
       set keys_held = s.key_n - 1, approach_key = null,
           guess_n = s.key_n, guess_lng = coalesce(k.spot_lng, k.area_lng), guess_lat = coalesce(k.spot_lat, k.area_lat),
           guess_name = 'Key ' || s.key_n || ' (taken by ' || thief_name || ')', guess_at = now(),
           riddle_n = s.key_n, riddle_at = now()
     where hunt_id = s.hunt_id and user_id = s.target and keys_held >= s.key_n;
    -- The thief: their next key, its trial skipped (and the hunt finished, if it was their last)
    select * into hp from public.hunt_players where hunt_id = s.hunt_id and user_id = s.thief for update;
    select count(*) into stops from public.hunt_keys where hunt_id = s.hunt_id;
    select min(kk.n) into next_real from public.hunt_keys kk where kk.hunt_id = s.hunt_id and kk.n > hp.keys_held and not coalesce(kk.relay, false);
    if next_real is not null then
      update public.hunt_players set keys_held = next_real, last_key_at = now(), approach_key = null
       where hunt_id = s.hunt_id and user_id = s.thief;
      if next_real >= stops then
        perform 1 from public.hunts where id = s.hunt_id for update;
        select count(*) + 1 into finish_place from public.hunt_players where hunt_id = s.hunt_id and finished_at is not null;
        update public.hunt_players set finished_at = now(), place = finish_place where hunt_id = s.hunt_id and user_id = s.thief;
      end if;
    end if;
    update public.showdowns set status = 'stolen', winner = s.thief, ended_at = now() where id = s.id;
    insert into public.hunt_events (hunt_id, user_id, kind, text)
    values (s.hunt_id, s.thief, 'stolen', '🗝️ ' || thief_name || ' won the showdown and stole a key from ' || target_name || '!');
  elsif p_how = 'defended' then
    -- The stake to the target; the thief thrown about 2 km away
    perform public.apply_coin_change(s.target, s.stake, 'earn', 'Won a showdown: ' || thief_name || '''s stake', 'showdown:' || s.id);
    select * into pos from public.player_positions where user_id = s.thief;
    if pos.user_id is not null then
      select p.street_lng, p.street_lat into to_lng, to_lat from public.places p
       where p.street_lng is not null
         and p.lat between pos.lat - 0.03 and pos.lat + 0.03 and p.lng between pos.lng - 0.03 and pos.lng + 0.03
         and public.distance_m(pos.lng, pos.lat, p.street_lng, p.street_lat) between 1500 and 2500
       order by random() limit 1;
      if to_lng is null then
        to_lat := pos.lat + 2000 * cos(bearing) / 110574;
        to_lng := pos.lng + 2000 * sin(bearing) / (111320 * cos(radians(pos.lat)));
      end if;
      update public.player_positions set lng = to_lng, lat = to_lat, updated_at = now() where user_id = s.thief;
      update public.player_vehicles set lng = to_lng, lat = to_lat where user_id = s.thief and in_use;
    end if;
    update public.showdowns set status = 'defended', winner = s.target, ended_at = now(),
           thrown = case when to_lng is not null then jsonb_build_object('lng', to_lng, 'lat', to_lat) end
     where id = s.id;
    insert into public.hunt_events (hunt_id, user_id, kind, text)
    values (s.hunt_id, s.target, 'defended', '🛡️ ' || target_name || ' won the showdown and kept their key: ' || thief_name || ' was thrown 2 km away!');
  elsif p_how = 'escaped' then
    perform public.apply_coin_change(s.thief, s.stake, 'earn', 'Showdown stake back: they ran', 'showdown:' || s.id);
    update public.showdowns set status = 'escaped', ended_at = now() where id = s.id;
    insert into public.hunt_events (hunt_id, user_id, kind, text)
    values (s.hunt_id, s.target, 'escaped', '🏃 ' || target_name || ' ran from ' || thief_name || '''s showdown and got away!');
  end if;
end;
$$;

-- Where a showdown stands now: the deadlines kept (no answer in 20 s: a kind picked; running: 300 m away in 30 s, or
-- caught; the puzzle's time up: the target keeps the key)
create or replace function public.showdown_settle(p_id bigint)
returns public.showdowns
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.showdowns%rowtype;
  gap double precision;
begin
  select * into s from public.showdowns where id = p_id;
  if s.status = 'challenged' and now() > s.created_at + interval '20 seconds' then
    perform public.showdown_fight(s.id, s.offered[1 + floor(random() * array_length(s.offered, 1))::integer]);
  elsif s.status = 'running' then
    select public.distance_m(a.lng, a.lat, b.lng, b.lat) into gap from public.player_positions a, public.player_positions b
     where a.user_id = s.thief and b.user_id = s.target;
    if gap > 300 then
      perform public.showdown_end(s.id, 'escaped');
    elsif now() > s.run_until then
      perform public.showdown_fight(s.id, s.offered[1 + floor(random() * array_length(s.offered, 1))::integer]);
    end if;
  elsif s.status = 'fight' and now() > s.ends_at + interval '3 seconds' then
    perform public.showdown_end(s.id, 'defended');
  end if;
  select * into s from public.showdowns where id = p_id;
  return s;
end;
$$;

-- My showdown now (and the last one, a minute after it ended); whether a Tracker is out near me
create or replace function public.showdown_mine()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  s public.showdowns%rowtype;
  hunt uuid;
  me public.player_positions%rowtype;
  tracked boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.showdowns
   where (thief = uid or target = uid) and (status in ('challenged', 'running', 'fight') or ended_at > now() - interval '60 seconds')
   order by created_at desc limit 1;
  if s.id is not null and s.status in ('challenged', 'running', 'fight') then
    s := public.showdown_settle(s.id);
  end if;
  -- A key holder: is anyone in the hunt tracking within 5 km?
  hunt := public.live_hunt_of(uid);
  if hunt is not null and public.keys_in(hunt, (select keys_held from public.hunt_players where hunt_id = hunt and user_id = uid)) >= 1 then
    select * into me from public.player_positions where user_id = uid;
    select exists (
      select 1 from public.player_boosts b
        join public.hunt_players p on p.user_id = b.user_id and p.hunt_id = hunt
        join public.player_positions pp on pp.user_id = b.user_id
       where b.tracker_until > now() and b.user_id <> uid
         and public.distance_m(me.lng, me.lat, pp.lng, pp.lat) <= 5000) into tracked;
  end if;
  return jsonb_build_object('showdown', case when s.id is not null then public.showdown_view(s, uid) end, 'tracked', tracked);
end;
$$;

-- The target's answer: one of the kinds offered, or run
create or replace function public.showdown_reply(p_id bigint, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  s public.showdowns%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.showdowns where id = p_id and target = uid and status = 'challenged' for update;
  if s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if p_choice = 'run' then
    update public.showdowns set status = 'running', run_until = now() + interval '30 seconds' where id = s.id;
  elsif p_choice = any (s.offered) then
    perform public.showdown_fight(s.id, p_choice);
  else
    return jsonb_build_object('ok', false, 'reason', 'choice');
  end if;
  select * into s from public.showdowns where id = p_id;
  return jsonb_build_object('ok', true, 'showdown', public.showdown_view(s, uid));
end;
$$;

-- How far through the puzzle each is (for the other, and the broadcast)
create or replace function public.showdown_progress(p_id bigint, p_progress real)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.showdowns
     set thief_progress = case when thief = auth.uid() then greatest(0, least(1, coalesce(p_progress, 0))) else thief_progress end,
         target_progress = case when target = auth.uid() then greatest(0, least(1, coalesce(p_progress, 0))) else target_progress end
   where id = p_id and status = 'fight' and auth.uid() in (thief, target)
$$;

-- An answer, checked by the game's server (/api/showdown/solve): the first right one wins; two tries each
create or replace function public.showdown_answer(p_id bigint, p_user uuid, p_right boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.showdowns%rowtype;
  tries integer;
begin
  select * into s from public.showdowns where id = p_id and p_user in (thief, target) for update;
  if s.id is null or s.status <> 'fight' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if now() < s.starts_at or now() > s.ends_at + interval '3 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'time');
  end if;
  tries := case when p_user = s.thief then s.thief_tries else s.target_tries end;
  if tries >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'tries');
  end if;
  if p_right then
    perform public.showdown_end(s.id, case when p_user = s.thief then 'stolen' else 'defended' end);
    return jsonb_build_object('ok', true, 'result', 'won');
  end if;
  update public.showdowns
     set thief_tries = thief_tries + case when p_user = thief then 1 else 0 end,
         target_tries = target_tries + case when p_user = target then 1 else 0 end
   where id = s.id
   returning * into s;
  -- The thief out of tries: the target keeps the key at once
  if s.thief_tries >= 2 then
    perform public.showdown_end(s.id, 'defended');
    return jsonb_build_object('ok', true, 'result', 'wrong', 'triesLeft', 2 - case when p_user = s.thief then s.thief_tries else s.target_tries end, 'over', true);
  end if;
  return jsonb_build_object('ok', true, 'result', 'wrong', 'triesLeft', 2 - case when p_user = s.thief then s.thief_tries else s.target_tries end);
end;
$$;

-- The Tracker relic: 10 minutes
do $$
declare
  f text := pg_get_functiondef('public.use_relic(uuid)'::regprocedure);
  a text := '  elsif r.relic = ''rain_charm'' then';
begin
  if position(a in f) = 0 then
    raise exception 'use_relic: not found';
  end if;
  execute replace(f, a, '  elsif r.relic = ''tracker'' then
    -- The Tracker (showdowns, 14 Nov 2026): the hunt''s key holders for 10 minutes
    if public.live_hunt_of(uid) is null then
      return jsonb_build_object(''ok'', false, ''reason'', ''no_hunt'');
    end if;
    valid_until := greatest(now(), coalesce((select tracker_until from public.player_boosts where user_id = uid), now())) + interval ''10 minutes'';
    insert into public.player_boosts (user_id, tracker_until) values (uid, valid_until)
    on conflict (user_id) do update set tracker_until = excluded.tracker_until;
' || a);
end $$;

-- broadcast_state: the showdowns going on (and just ended)
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a text := '''now'', now(),';
begin
  if position(a in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  execute replace(f, a, '''showdowns'', coalesce((
      select jsonb_agg(jsonb_build_object(''id'', s.id, ''thief'', s.thief, ''target'', s.target,
          ''thiefName'', (select username from public.profiles where id = s.thief), ''targetName'', (select username from public.profiles where id = s.target),
          ''keyN'', s.key_n, ''status'', s.status, ''kind'', s.kind, ''createdAt'', s.created_at, ''runUntil'', s.run_until,
          ''startsAt'', s.starts_at, ''endsAt'', s.ends_at, ''endedAt'', s.ended_at, ''winner'', s.winner,
          ''thiefProgress'', s.thief_progress, ''targetProgress'', s.target_progress, ''thiefTries'', s.thief_tries, ''targetTries'', s.target_tries))
        from public.showdowns s
       where s.hunt_id = h.id and (s.status in (''challenged'', ''running'', ''fight'') or s.ended_at > now() - interval ''1 minute'')), ''[]''::jsonb),
    ' || a);
end $$;

revoke execute on function public.live_hunt_of(uuid), public.showdown_blocked(uuid, uuid, uuid), public.showdown_view(public.showdowns, uuid),
  public.showdown_fight(bigint, text), public.showdown_end(bigint, text), public.showdown_settle(bigint), public.showdown_answer(bigint, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.showdown_answer(bigint, uuid, boolean) to service_role;
revoke execute on function public.tracker_scan(), public.showdown_targets(), public.showdown_challenge(uuid), public.showdown_mine(),
  public.showdown_reply(bigint, text), public.showdown_progress(bigint, real) from public, anon;
grant execute on function public.tracker_scan(), public.showdown_targets(), public.showdown_challenge(uuid), public.showdown_mine(),
  public.showdown_reply(bigint, text), public.showdown_progress(bigint, real) to authenticated;
