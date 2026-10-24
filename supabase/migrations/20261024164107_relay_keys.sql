-- Relay keys (owner, 24 Oct 2026: "Yes, set per key"): a stop whose chest holds no key, only a clue to the next stop,
-- where the key really is. A relay is a stop of its own (hunt_keys.relay), so finding it, its trial, its throw-outs
-- and the detector all work as for any key; only counting and naming change: "keys" are the stops that aren't relays,
-- and a relay stop belongs to the key after it (stop_key). Nobody can tell a relay chest until it opens.

alter table public.hunt_keys add column if not exists relay boolean not null default false;

-- Which key a stop is (or leads to): 1 + the keys (not relays) before it.
create or replace function public.stop_key(p_hunt uuid, p_n integer) returns integer
language sql stable security definer set search_path = '' as $$
  select 1 + count(*)::integer from public.hunt_keys where hunt_id = p_hunt and n < p_n and not relay
$$;
-- How many keys (not relays) are among the first p_stops stops.
create or replace function public.keys_in(p_hunt uuid, p_stops integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.hunt_keys where hunt_id = p_hunt and n <= p_stops and not relay
$$;
-- How many keys (not relays) a hunt has.
create or replace function public.real_keys(p_hunt uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.hunt_keys where hunt_id = p_hunt and not relay
$$;

-- A trial passed: at a relay, the clue and on to the next stop (no key, no bonuses); at a key, the key.
create or replace function public.award_trial(t public.trial_attempts, h public.hunts)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.hunt_keys%rowtype;
  stops int;
  held int;
  finished_place int;
  next_riddle text;
  bonuses jsonb;
begin
  select * into k from public.hunt_keys where hunt_id = t.hunt_id and n = t.key_n;
  update public.trial_attempts set status = 'passed', ended_at = now() where id = t.id returning * into t;
  select count(*) into stops from public.hunt_keys where hunt_id = t.hunt_id;
  update public.hunt_players
     set keys_held = keys_held + 1, last_key_at = now(), approach_key = null
   where hunt_id = t.hunt_id and user_id = t.user_id
   returning keys_held into held;

  if k.relay then
    select riddle into next_riddle from public.hunt_keys where hunt_id = t.hunt_id and n = held + 1;
    return jsonb_build_object('ok', true, 'result', 'relay', 'key', public.stop_key(t.hunt_id, t.key_n),
      'keysHeld', public.keys_in(t.hunt_id, held), 'keys', public.real_keys(t.hunt_id), 'riddle', next_riddle);
  end if;

  bonuses := public.key_bonuses(t, h);
  if held >= stops then
    -- Lock the hunt's finishers so two players can't take the same place.
    perform 1 from public.hunts where id = t.hunt_id for update;
    select count(*) + 1 into finished_place from public.hunt_players where hunt_id = t.hunt_id and finished_at is not null;
    update public.hunt_players set finished_at = now(), place = finished_place where hunt_id = t.hunt_id and user_id = t.user_id;
    return jsonb_build_object('ok', true, 'result', 'finished', 'keysHeld', public.keys_in(t.hunt_id, held), 'keys', public.real_keys(t.hunt_id),
      'place', finished_place, 'winner', finished_place <= h.winners, 'bonuses', bonuses);
  end if;

  select riddle into next_riddle from public.hunt_keys where hunt_id = t.hunt_id and n = held + 1;
  return jsonb_build_object('ok', true, 'result', 'key', 'keysHeld', public.keys_in(t.hunt_id, held), 'keys', public.real_keys(t.hunt_id),
    'riddle', next_riddle, 'bonuses', bonuses);
end;
$$;
revoke execute on function public.award_trial(public.trial_attempts, public.hunts) from public, anon, authenticated;

create or replace function public.hunt_state(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  t public.trial_attempts%rowtype;
  phase text;
  thrown jsonb;
begin
  select * into h from public.hunts where id = p_hunt and published;
  if not found then
    return null;
  end if;
  thrown := public.settle_trial(p_hunt, uid);
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  phase := public.hunt_phase(h);

  if hp.user_id is not null and phase = 'live' and hp.finished_at is null then
    select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
    select * into t from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active';
  end if;

  return jsonb_build_object(
    'id', h.id, 'title', h.title, 'prize', h.prize, 'winners', h.winners,
    'startsAt', h.starts_at, 'endsAt', h.ends_at, 'phase', phase,
    'keys', public.real_keys(p_hunt), 'joined', hp.user_id is not null,
    'keysHeld', public.keys_in(p_hunt, coalesce(hp.keys_held, 0)), 'finishedAt', hp.finished_at, 'place', hp.place,
    'winnersFound', (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.finished_at is not null),
    'riddle', k.riddle, 'category', k.category,
    -- On a relay's trail: the stop before this one was a relay chest (the key is at this one, or further on).
    'trail', coalesce(k.n is not null and exists (select 1 from public.hunt_keys r where r.hunt_id = p_hunt and r.n = k.n - 1 and r.relay), false),
    'clue', case when k.n is not null and hp.approach_key = k.n then coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.') end,
    'trial', case when t.id is not null then public.trial_view(t, h.seconds_per_question) end,
    'thrown', thrown);
end;
$$;

create or replace function public.list_hunts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.title, 'prize', h.prize, 'description', h.description,
      'winners', h.winners, 'startsAt', h.starts_at, 'endsAt', h.ends_at,
      'phase', public.hunt_phase(h),
      'keys', public.real_keys(h.id),
      'players', (select count(*) from public.hunt_players p where p.hunt_id = h.id),
      'joined', exists (select 1 from public.hunt_players p where p.hunt_id = h.id and p.user_id = auth.uid()))
    order by h.starts_at), '[]'::jsonb)
  from public.hunts h
  where h.published and h.ends_at > now() - interval '7 days';
$$;

create or replace function public.hunt_board(p_hunt uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_to_json(b)::jsonb order by b.rank), '[]'::jsonb) from (
    select row_number() over (order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at) as rank,
           pr.username, public.keys_in(p_hunt, p.keys_held) as "keysHeld", p.place, p.user_id = auth.uid() as me
      from public.hunt_players p
      join public.profiles pr on pr.id = p.user_id
      join public.hunts h on h.id = p.hunt_id and h.published
     where p.hunt_id = p_hunt
     order by rank
     limit 20
  ) b;
$$;

create or replace function public.hunt_recap(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    'title', h.title, 'prize', h.prize, 'winners', h.winners, 'place', hp.place, 'keys', public.real_keys(p_hunt),
    'keysHeld', public.keys_in(p_hunt, hp.keys_held), 'joinedAt', hp.joined_at, 'finishedAt', hp.finished_at,
    'hunters', (select count(*) from public.hunt_players where hunt_id = p_hunt),
    -- Each key won (not the relays on the way): its time since the key before, and the tries at its stops.
    'perKey', coalesce((
      select jsonb_agg(jsonb_build_object('key', x.key_no, 'at', x.ended_at,
               'minutes', round((extract(epoch from x.ended_at - coalesce(x.prev, hp.joined_at)) / 60)::numeric, 1),
               'tries', (select count(*) from public.trial_attempts a where a.hunt_id = p_hunt and a.user_id = uid
                          and public.stop_key(p_hunt, a.key_n) = x.key_no))
             order by x.key_no)
        from (select public.stop_key(p_hunt, a.key_n) as key_no, a.ended_at, lag(a.ended_at) over (order by a.key_n) as prev
                from public.trial_attempts a join public.hunt_keys s on s.hunt_id = a.hunt_id and s.n = a.key_n
               where a.hunt_id = p_hunt and a.user_id = uid and a.status = 'passed' and not s.relay) x), '[]'::jsonb),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'key', public.stop_key(p_hunt, b.key_n), 'coins', b.coins, 'rival', b.rival) order by b.at)
                          from public.hunt_bonuses b where b.hunt_id = p_hunt and b.user_id = uid), '[]'::jsonb),
    'bonusCoins', coalesce((select sum(coins) from public.hunt_bonuses b where b.hunt_id = p_hunt and b.user_id = uid), 0),
    'roadEvents', (select count(*) from public.road_events e where e.hunt_id = p_hunt and e.user_id = uid and e.resolved_at is not null));
end;
$$;

create or replace function public.hunt_feed(p_hunt uuid, p_since timestamp with time zone default null::timestamp with time zone)
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

  -- A tip for a hunter falling behind: behind the leader, 15 minutes on this stop, once per stop.
  if hp.user_id is not null and hp.finished_at is null and mine.user_id is not null and public.hunt_phase(h) = 'live'
     and hp.keys_held < (select max(p.keys_held) from public.hunt_players p where p.hunt_id = p_hunt)
     and greatest(coalesce(hp.last_key_at, hp.joined_at), hp.joined_at) < now() - interval '15 minutes' then
    select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
    if k.n is not null then
      insert into public.hunt_catchups (hunt_id, user_id, key_n) values (p_hunt, uid, k.n) on conflict do nothing;
      if found then
        tip := jsonb_build_object('key', public.stop_key(p_hunt, k.n), 'direction', public.compass_word(mine.lng, mine.lat, k.area_lng, k.area_lat),
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
      select jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'who', ev.who, 'mine', ev.who_id = uid,
               'key', case when ev.key_n is not null then public.stop_key(p_hunt, ev.key_n) end,
               'place', ev.place, 'text', ev.text,
               'metres', case when ev.who_id <> uid and mine.user_id is not null and pp.user_id is not null and not public.wonder_cloaked(ev.who_id, p_hunt)
                              then round(public.distance_m(mine.lng, mine.lat, pp.lng, pp.lat) / 100) * 100 end)
             order by ev.at)
        from (
          select t.ended_at as at, case when s.relay then 'relay' else 'key' end as kind, pr.username as who, t.user_id as who_id, t.key_n,
                 null::integer as place, null::text as text
            from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
            join public.hunt_keys s on s.hunt_id = t.hunt_id and s.n = t.key_n
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
    -- Hunters chasing the same stop, within 2 km, nearest first (never the cloaked).
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
    -- How many others are already in the area of the stop the player is after.
    'inMyArea', case when hp.user_id is not null and hp.finished_at is null then
      (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.user_id <> uid and p.finished_at is null
          and p.keys_held = hp.keys_held and p.approach_key = hp.keys_held + 1) else 0 end);
end;
$$;

-- Only for the functions above: calling them directly would tell which stops are relays.
revoke execute on function public.stop_key(uuid, integer), public.keys_in(uuid, integer), public.real_keys(uuid) from public, anon, authenticated;
