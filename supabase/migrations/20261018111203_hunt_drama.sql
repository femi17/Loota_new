-- The hunt, part 5 (owner, 18 Oct 2026: keep going: moments, rewards, a reason to stay when behind).
--   First to a key: +100 coins, and every hunter hears of it.
--   A showdown: two hunters in the same key's trial within 90 s of each other; the first to finish wins +50.
--   Golden minutes: 10 minutes in every hour of a hunt (from 30 minutes in): the detector reaches twice as far, and
--     every key earned pays +50.
--   Catch-up tips: a hunter behind the leader and 15 minutes on the same key gets one tip per key (which way the key's
--     area lies, roughly how far), with the race news.
--   The recap: the player's hunt in one card (place, each key's time, medals, bonus coins).

create table public.hunt_bonuses (
  id      bigint generated always as identity primary key,
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind    text not null check (kind in ('first', 'golden', 'showdown')),
  key_n   integer not null,
  coins   integer not null,
  rival   text,                      -- a showdown: who they beat
  at      timestamptz not null default now(),
  unique (hunt_id, user_id, kind, key_n)
);
alter table public.hunt_bonuses enable row level security;

create table public.hunt_catchups (
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  key_n   integer not null,
  at      timestamptz not null default now(),
  primary key (hunt_id, user_id, key_n)
);
alter table public.hunt_catchups enable row level security;

-- Golden minutes: until when, if they're on now (10 minutes in every hour of the hunt, from 30 minutes in).
create or replace function public.golden_until(h public.hunts) returns timestamptz
language sql stable set search_path = '' as $$
  select case when m >= 30 and (m - 30)::numeric % 60 < 10
              then h.starts_at + make_interval(mins => (floor((m - 30) / 60) * 60 + 40)::integer) end
    from (select extract(epoch from now() - h.starts_at) / 60 as m) x;
$$;

-- When the next golden minutes begin (or null once the hunt is over).
create or replace function public.golden_next(h public.hunts) returns timestamptz
language sql stable set search_path = '' as $$
  select case when next_at < h.ends_at then next_at end
    from (select h.starts_at + make_interval(mins => (30 + greatest(0, ceil((extract(epoch from now() - h.starts_at) / 60 - 30) / 60)) * 60)::integer) as next_at) x;
$$;

-- Which way a spot lies from another, as a compass word.
create or replace function public.compass_word(from_lng double precision, from_lat double precision, to_lng double precision, to_lat double precision)
returns text language sql immutable set search_path = '' as $$
  select (array['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'])
           [1 + (floor((degrees(atan2((to_lng - from_lng) * cos(radians(from_lat)), to_lat - from_lat)) + 360 + 22.5) / 45)::integer % 8)];
$$;

-- Bonuses for a key just earned: first to it, golden minutes, a showdown won. Returns them (for the player's screen).
create or replace function public.key_bonuses(t public.trial_attempts, h public.hunts) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  got jsonb := '[]'::jsonb;
  beaten text;
begin
  if not exists (select 1 from public.trial_attempts a where a.hunt_id = t.hunt_id and a.key_n = t.key_n and a.status = 'passed' and a.id <> t.id) then
    insert into public.hunt_bonuses (hunt_id, user_id, kind, key_n, coins) values (t.hunt_id, t.user_id, 'first', t.key_n, 100) on conflict do nothing;
    if found then
      perform public.apply_coin_change(t.user_id, 100, 'earn', 'First to Key ' || t.key_n, 'hunt-first:' || t.hunt_id || ':' || t.key_n);
      got := got || jsonb_build_array(jsonb_build_object('kind', 'first', 'coins', 100));
    end if;
  end if;
  if public.golden_until(h) is not null then
    insert into public.hunt_bonuses (hunt_id, user_id, kind, key_n, coins) values (t.hunt_id, t.user_id, 'golden', t.key_n, 50) on conflict do nothing;
    if found then
      perform public.apply_coin_change(t.user_id, 50, 'earn', 'Golden minutes: Key ' || t.key_n, 'hunt-golden:' || t.hunt_id || ':' || t.key_n || ':' || t.user_id);
      got := got || jsonb_build_array(jsonb_build_object('kind', 'golden', 'coins', 50));
    end if;
  end if;
  -- A rival in the same key's trial within 90 s, still at it or failed: this hunter finished first.
  select pr.username into beaten
    from public.trial_attempts a join public.profiles pr on pr.id = a.user_id
   where a.hunt_id = t.hunt_id and a.key_n = t.key_n and a.user_id <> t.user_id and a.status in ('active', 'failed')
     and a.started_at between t.started_at - interval '90 seconds' and t.started_at + interval '90 seconds'
     and not exists (select 1 from public.trial_attempts b where b.hunt_id = t.hunt_id and b.key_n = t.key_n and b.user_id = a.user_id and b.status = 'passed')
   order by a.started_at limit 1;
  if beaten is not null then
    insert into public.hunt_bonuses (hunt_id, user_id, kind, key_n, coins, rival) values (t.hunt_id, t.user_id, 'showdown', t.key_n, 50, beaten) on conflict do nothing;
    if found then
      perform public.apply_coin_change(t.user_id, 50, 'earn', 'Won a showdown at Key ' || t.key_n, 'hunt-showdown:' || t.hunt_id || ':' || t.key_n || ':' || t.user_id);
      got := got || jsonb_build_array(jsonb_build_object('kind', 'showdown', 'coins', 50, 'rival', beaten));
    end if;
  end if;
  return got;
end;
$$;

-- The player's hunt in one card.
create or replace function public.hunt_recap(p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if h.id is null or hp.user_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'title', h.title, 'prize', h.prize, 'winners', h.winners, 'place', hp.place, 'keys', (select count(*) from public.hunt_keys where hunt_id = p_hunt),
    'keysHeld', hp.keys_held, 'joinedAt', hp.joined_at, 'finishedAt', hp.finished_at,
    'hunters', (select count(*) from public.hunt_players where hunt_id = p_hunt),
    'perKey', coalesce((
      select jsonb_agg(jsonb_build_object('key', x.key_n, 'at', x.ended_at,
               'minutes', round((extract(epoch from x.ended_at - coalesce(x.prev, hp.joined_at)) / 60)::numeric, 1),
               'tries', (select count(*) from public.trial_attempts a where a.hunt_id = p_hunt and a.user_id = uid and a.key_n = x.key_n))
             order by x.key_n)
        from (select a.key_n, a.ended_at, lag(a.ended_at) over (order by a.key_n) as prev
                from public.trial_attempts a where a.hunt_id = p_hunt and a.user_id = uid and a.status = 'passed') x), '[]'::jsonb),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'key', b.key_n, 'coins', b.coins, 'rival', b.rival) order by b.at)
                          from public.hunt_bonuses b where b.hunt_id = p_hunt and b.user_id = uid), '[]'::jsonb),
    'bonusCoins', coalesce((select sum(coins) from public.hunt_bonuses b where b.hunt_id = p_hunt and b.user_id = uid), 0),
    'roadEvents', (select count(*) from public.road_events e where e.hunt_id = p_hunt and e.user_id = uid and e.resolved_at is not null));
end;
$$;

create or replace function public.answer_trial(p_attempt uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trial_attempts%rowtype;
  h public.hunts%rowtype;
  q jsonb;
  total int;
  held int;
  finished_place int;
  next_riddle text;
  landed jsonb;
  extra integer; -- seconds a memory question is shown before it's asked
  bonuses jsonb;
begin
  select * into t from public.trial_attempts where id = p_attempt and user_id = uid and status = 'active' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;
  select * into h from public.hunts where id = t.hunt_id;
  q := t.questions -> t.current;
  extra := coalesce((q ->> 'showSeconds')::integer, 0);

  if now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2 + extra) or p_choice is distinct from (q ->> 'answer')::int then
    landed := public.fail_trial(t);
    return jsonb_build_object('ok', true, 'result', 'failed',
      'reason', case when p_choice = -1 or now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2 + extra) then 'timeout' else 'wrong' end,
      'correct', q -> 'choices' ->> (q ->> 'answer')::int,
      'lng', landed -> 'lng', 'lat', landed -> 'lat', 'saved', coalesce((landed ->> 'saved')::boolean, false));
  end if;

  if t.current + 1 < jsonb_array_length(t.questions) then
    update public.trial_attempts set current = current + 1, asked_at = now() where id = t.id returning * into t;
    return jsonb_build_object('ok', true, 'result', 'next', 'trial', public.trial_view(t, h.seconds_per_question));
  end if;

  -- Key earned (and any bonuses: first to it, golden minutes, a showdown won).
  update public.trial_attempts set status = 'passed', ended_at = now() where id = t.id returning * into t;
  bonuses := public.key_bonuses(t, h);
  select count(*) into total from public.hunt_keys where hunt_id = t.hunt_id;
  update public.hunt_players
     set keys_held = keys_held + 1, last_key_at = now(), approach_key = null
   where hunt_id = t.hunt_id and user_id = uid
   returning keys_held into held;

  if held >= total then
    -- Lock the hunt's finishers so two players can't take the same place.
    perform 1 from public.hunts where id = t.hunt_id for update;
    select count(*) + 1 into finished_place from public.hunt_players where hunt_id = t.hunt_id and finished_at is not null;
    update public.hunt_players set finished_at = now(), place = finished_place where hunt_id = t.hunt_id and user_id = uid;
    return jsonb_build_object('ok', true, 'result', 'finished', 'keysHeld', held, 'keys', total,
      'place', finished_place, 'winner', finished_place <= h.winners, 'bonuses', bonuses);
  end if;

  select riddle into next_riddle from public.hunt_keys where hunt_id = t.hunt_id and n = held + 1;
  return jsonb_build_object('ok', true, 'result', 'key', 'keysHeld', held, 'keys', total, 'riddle', next_riddle, 'bonuses', bonuses);
end;
$$;

create or replace function public.key_pulse(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  pos jsonb;
  to_spot double precision;
  to_area double precision;
  reach double precision;
  heat double precision;
  far_m double precision; -- how far the detector reaches (twice as far in golden minutes)
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', case when hp.user_id is null then 'not_joined' else 'finished' end);
  end if;
  if exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'trial');
  end if;
  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
  if k.n is null then
    return jsonb_build_object('ok', false, 'reason', 'no_key');
  end if;
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);
  far_m := case when public.golden_until(h) is not null then 2 else 1 end;
  reach := greatest(coalesce(k.area_radius_m, 1000), 1000) * far_m;
  if to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n);
  end if;
  if hp.approach_key is distinct from k.n then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
  end if;
  heat := round((greatest(0, least(1, 1 - to_spot / reach)) * 20)::numeric) / 20;
  return jsonb_build_object('ok', true, 'inArea', true, 'key', k.n, 'heat', heat, 'near', to_spot <= 60,
    'spot', case when to_spot <= 60 then jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat) end,
    'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'));
end;
$$;

create or replace function public.hunt_feed(p_hunt uuid, p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  mine public.player_positions%rowtype;
  since timestamptz;
  my_rank integer;
  k public.hunt_keys%rowtype;
  tip jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null then
    return null;
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  select * into mine from public.player_positions where user_id = uid;
  -- Never more than the last 10 minutes of news.
  since := greatest(coalesce(p_since, now() - interval '2 minutes'), now() - interval '10 minutes');

  -- A tip for a hunter falling behind: behind the leader, 15 minutes on this key, once per key.
  if hp.user_id is not null and hp.finished_at is null and mine.user_id is not null and public.hunt_phase(h) = 'live'
     and hp.keys_held < (select max(p.keys_held) from public.hunt_players p where p.hunt_id = p_hunt)
     and greatest(coalesce(hp.last_key_at, hp.joined_at), hp.joined_at) < now() - interval '15 minutes' then
    select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
    if k.n is not null then
      insert into public.hunt_catchups (hunt_id, user_id, key_n) values (p_hunt, uid, k.n) on conflict do nothing;
      if found then
        tip := jsonb_build_object('key', k.n, 'direction', public.compass_word(mine.lng, mine.lat, k.area_lng, k.area_lat),
          'band', public.distance_band(public.distance_m(mine.lng, mine.lat, k.area_lng, k.area_lat)));
      end if;
    end if;
  end if;

  select r.rank into my_rank from (
    select p.user_id, row_number() over (order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at) as rank
      from public.hunt_players p where p.hunt_id = p_hunt
  ) r where r.user_id = uid;

  return jsonb_build_object(
    'now', now(),
    'phase', public.hunt_phase(h),
    'rank', my_rank,
    'hunters', (select count(*) from public.hunt_players where hunt_id = p_hunt),
    'golden', public.golden_until(h),
    'goldenNext', public.golden_next(h),
    'tip', tip,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'who', ev.who, 'mine', ev.who_id = uid, 'key', ev.key_n,
               'place', ev.place, 'text', ev.text,
               'metres', case when ev.who_id <> uid and mine.user_id is not null and pp.user_id is not null and not public.wonder_cloaked(ev.who_id, p_hunt)
                              then round(public.distance_m(mine.lng, mine.lat, pp.lng, pp.lat) / 100) * 100 end)
             order by ev.at)
        from (
          select t.ended_at as at, 'key' as kind, pr.username as who, t.user_id as who_id, t.key_n, null::integer as place, null::text as text
            from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
           where t.hunt_id = p_hunt and t.status = 'passed' and t.ended_at > since
          union all
          select t.started_at, 'trial', pr.username, t.user_id, t.key_n, null, null
            from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
           where t.hunt_id = p_hunt and t.started_at > since
          union all
          select p.finished_at, 'finished', pr.username, p.user_id, null, p.place, null
            from public.hunt_players p join public.profiles pr on pr.id = p.user_id
           where p.hunt_id = p_hunt and p.finished_at > since
          union all
          select b.at, b.kind, pr.username, b.user_id, b.key_n, null, b.rival
            from public.hunt_bonuses b join public.profiles pr on pr.id = b.user_id
           where b.hunt_id = p_hunt and b.kind in ('first', 'showdown') and b.at > since
          union all
          select p.joined_at, 'joined', pr.username, p.user_id, null, null, null
            from public.hunt_players p join public.profiles pr on pr.id = p.user_id
           where p.hunt_id = p_hunt and p.joined_at > since
        ) ev
        left join public.player_positions pp on pp.user_id = ev.who_id), '[]'::jsonb),
    -- Hunters chasing the same key, within 2 km, nearest first (never the cloaked).
    'rivals', case when hp.user_id is not null and hp.finished_at is null and mine.user_id is not null then coalesce((
      select jsonb_agg(jsonb_build_object('name', x.username, 'lng', x.lng, 'lat', x.lat, 'metres', round(x.m)) order by x.m)
        from (
          select pr.username, pp.lng, pp.lat, public.distance_m(mine.lng, mine.lat, pp.lng, pp.lat) as m
            from public.hunt_players p
            join public.profiles pr on pr.id = p.user_id
            join public.player_positions pp on pp.user_id = p.user_id
           where p.hunt_id = p_hunt and p.user_id <> uid and p.finished_at is null and p.keys_held = hp.keys_held
             and pp.updated_at > now() - interval '10 minutes'
             and pp.lat between mine.lat - 0.02 and mine.lat + 0.02 and pp.lng between mine.lng - 0.02 and mine.lng + 0.02
             and not public.wonder_cloaked(p.user_id, p_hunt)
           order by 4 limit 5
        ) x where x.m <= 2000), '[]'::jsonb) else '[]'::jsonb end,
    -- How many others are already in the area of the key the player is after.
    'inMyArea', case when hp.user_id is not null and hp.finished_at is null then
      (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.user_id <> uid and p.finished_at is null
          and p.keys_held = hp.keys_held and p.approach_key = hp.keys_held + 1) else 0 end);
end;
$$;

revoke execute on function public.golden_until(public.hunts), public.golden_next(public.hunts), public.compass_word(double precision, double precision, double precision, double precision),
  public.key_bonuses(public.trial_attempts, public.hunts) from public, anon, authenticated;
revoke execute on function public.hunt_recap(uuid) from public, anon;
grant execute on function public.hunt_recap(uuid) to authenticated;
