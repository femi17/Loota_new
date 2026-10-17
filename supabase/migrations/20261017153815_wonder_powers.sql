-- The Djinn's Wonders come alive (design doc 7.7): each one used from the bag,
-- announced to every player, and (most) only during a live hunt the holder is in.
--
--   Cataclysm Orb     every hunter in the hunt (the holder too) loses every key and goes home
--   Djinn's Coin      (by itself) saves its holder from a Cataclysm, Oblivion or Return, a
--                     failed Key Trial's throw, or the chamber's whirlwind, once; revealed then
--   Orb of Oblivion   every other hunter loses every key
--   Orb of Return     every hunter (the holder too) goes home; keys stay
--   Eye of the Djinn  10 minutes: see every hunter, and the area of the key each is chasing
--   Hourglass of Ages every other hunter is frozen for 3 minutes (the server refuses their moves)
--   Master Key        at the next key's spot: the key, without its trial
--   Phantom Cloak     for the rest of the hunt: off the map and the broadcast; only the
--                     Cataclysm can touch the holder
--   Carpet of Kings   one instant flight anywhere in the world (any time)
--   Thief's Hand      the latest key of every hunter within 1 km; the holder keeps one
--   Djinn's Bargain   swap places with the hunter in the lead
--   Sandstorm Crown   30 minutes: everyone within 400 km but the holder moves at half speed
--   Mirror of Many    for the rest of the hunt: three copies of the holder on the map
--   Seer's Seal       at a Wager's map: every decoy burns (any time a Wager is on)
--
-- "Home" is where the player set their home. Finished hunters are never touched.

create table public.wonder_events (
  id       bigint generated always as identity primary key,
  wonder   text not null,
  user_id  uuid references public.profiles (id) on delete set null,
  username text,
  hunt_id  uuid references public.hunts (id) on delete set null,
  at       timestamptz not null default now(),
  message  text not null,
  affected uuid[] not null default '{}',   -- players it moved, froze or robbed
  saved    uuid[] not null default '{}',   -- players a Djinn's Coin saved
  ends_at  timestamptz,                    -- lasting effects (Eye, Hourglass, Cloak, Mirror, Sandstorm)
  lng      double precision,
  lat      double precision,
  radius_m double precision
);
create index wonder_events_recent on public.wonder_events (at desc);
alter table public.wonder_events enable row level security;

-- The live hunt a player is in (not finished), if any.
create or replace function public.live_hunt_of(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.hunt_players hp join public.hunts h on h.id = hp.hunt_id
   where hp.user_id = p_user and hp.finished_at is null and public.hunt_phase(h) = 'live'
   order by h.starts_at desc limit 1;
$$;

-- Under a Phantom Cloak in this hunt?
create or replace function public.wonder_cloaked(p_user uuid, p_hunt uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wonder_events e
                  where e.wonder = 'phantom_cloak' and e.user_id = p_user and e.hunt_id = p_hunt and e.ends_at > now());
$$;

-- A Djinn's Coin saves its holder (once): true, and the coin is spent.
create or replace function public.coin_saves(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  coin uuid;
begin
  select id into coin from public.player_wonders
   where user_id = p_user and wonder = 'djinn_coin' and used_at is null and expires_at > now()
   order by won_at limit 1 for update;
  if coin is null then
    return false;
  end if;
  update public.player_wonders set used_at = now() where id = coin;
  return true;
end;
$$;

-- Send a player home (where they set it), with the vehicle they're on.
create or replace function public.send_home(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home record;
begin
  select home_lng, home_lat into home from public.profiles where id = p_user;
  if home.home_lng is null then
    return;
  end if;
  update public.player_positions set lng = home.home_lng, lat = home.home_lat, updated_at = now(), resting_since = null where user_id = p_user;
  update public.player_vehicles set lng = home.home_lng, lat = home.home_lat where user_id = p_user and in_use;
end;
$$;

-- Lose every key in a hunt (and any trial under way).
create or replace function public.lose_keys(p_user uuid, p_hunt uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.hunt_players set keys_held = 0, approach_key = null, last_key_at = null where hunt_id = p_hunt and user_id = p_user;
  update public.trial_attempts set status = 'failed', ended_at = now() where hunt_id = p_hunt and user_id = p_user and status = 'active';
end;
$$;

-- One more key for a player (the Master Key, the Thief's Hand); finishing if it was the last.
create or replace function public.gain_key(p_user uuid, p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  total int;
  held int;
  finished_place int;
begin
  select count(*) into total from public.hunt_keys where hunt_id = p_hunt;
  update public.hunt_players set keys_held = least(total, keys_held + 1), last_key_at = now(), approach_key = null
   where hunt_id = p_hunt and user_id = p_user returning keys_held into held;
  update public.trial_attempts set status = 'failed', ended_at = now() where hunt_id = p_hunt and user_id = p_user and status = 'active';
  if held >= total then
    perform 1 from public.hunts where id = p_hunt for update;
    select count(*) + 1 into finished_place from public.hunt_players where hunt_id = p_hunt and finished_at is not null;
    update public.hunt_players set finished_at = now(), place = finished_place where hunt_id = p_hunt and user_id = p_user and finished_at is null;
    return jsonb_build_object('keysHeld', held, 'keys', total, 'finished', true, 'place', finished_place);
  end if;
  return jsonb_build_object('keysHeld', held, 'keys', total, 'finished', false);
end;
$$;

-- Use a Wonder from the bag. p_lng/p_lat: where the Carpet of Kings should fly to.
create or replace function public.use_wonder(p_wonder uuid, p_lng double precision default null, p_lat double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me text;
  wd public.player_wonders%rowtype;
  hunt uuid;
  pos public.player_positions%rowtype;
  p record;
  hit uuid[] := '{}';
  spared uuid[] := '{}';
  msg text;
  lasts timestamptz;
  extra jsonb := '{}'::jsonb;
  k public.hunt_keys%rowtype;
  held int;
  leader record;
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
  hunt_end timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into wd from public.player_wonders where id = p_wonder and user_id = uid and used_at is null and expires_at > now() for update;
  if wd.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  select username into me from public.profiles where id = uid;
  select * into pos from public.player_positions where user_id = uid;

  if wd.wonder = 'djinn_coin' then
    return jsonb_build_object('ok', false, 'reason', 'passive');
  end if;

  -- ---- Any time: the Carpet of Kings, the Seer's Seal
  if wd.wonder = 'carpet_of_kings' then
    if p_lng is null or p_lat is null or p_lng not between -180 and 180 or p_lat not between -85 and 85 then
      return jsonb_build_object('ok', false, 'reason', 'where');
    end if;
    if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'trip');
    end if;
    update public.player_positions set lng = p_lng, lat = p_lat, mode = 'walk', updated_at = now(), resting_since = null where user_id = uid;
    update public.player_vehicles set in_use = false where user_id = uid and in_use;
    -- As if flown there: save_position allows the hop from the landing spot to its nearest road.
    insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at, ended_at, outcome)
    values (uid, 'plane', 'The Carpet of Kings', 'the carpet''s landing', p_lng, p_lat,
            jsonb_build_array(jsonb_build_array(coalesce(pos.lng, p_lng), coalesce(pos.lat, p_lat)), jsonb_build_array(p_lng, p_lat)),
            public.distance_m(coalesce(pos.lng, p_lng), coalesce(pos.lat, p_lat), p_lng, p_lat), 0, now(), now(), now(), 'arrived');
    msg := me || ' flew off on the Carpet of Kings!';
    extra := jsonb_build_object('lng', p_lng, 'lat', p_lat);
  elsif wd.wonder = 'seers_seal' then
    select * into w from public.djinn_wagers where starts_at <= now() and ends_at > now() and winner is null order by starts_at desc limit 1;
    select * into e from public.djinn_entries where wager_id = w.id and user_id = uid for update;
    if w.id is null or e.gate_score is null or e.gate_score < 1 or e.chosen_site is not null then
      return jsonb_build_object('ok', false, 'reason', 'no_map'); -- only on the Djinn's map, before a seal is broken
    end if;
    update public.djinn_entries set burned = array(select x from unnest(w.site_ids) x where x <> w.real_site)
     where wager_id = w.id and user_id = uid;
    msg := me || ' broke the Seer''s Seal: the Djinn''s lies burn before their eyes!';
  else
    -- ---- The rest: in a live hunt
    hunt := public.live_hunt_of(uid);
    if hunt is null then
      return jsonb_build_object('ok', false, 'reason', 'no_hunt');
    end if;
    select ends_at into hunt_end from public.hunts where id = hunt;

    if wd.wonder = 'cataclysm_orb' then
      for p in select hp.user_id from public.hunt_players hp where hp.hunt_id = hunt and hp.finished_at is null loop
        if public.coin_saves(p.user_id) then
          spared := spared || p.user_id;
        else
          perform public.lose_keys(p.user_id, hunt);
          perform public.send_home(p.user_id);
          hit := hit || p.user_id;
        end if;
      end loop;
      msg := me || ' unleashed the Cataclysm Orb! Every hunter has lost every key and been thrown back home.';
    elsif wd.wonder = 'orb_of_oblivion' then
      for p in select hp.user_id from public.hunt_players hp
                where hp.hunt_id = hunt and hp.finished_at is null and hp.user_id <> uid and not public.wonder_cloaked(hp.user_id, hunt) loop
        if public.coin_saves(p.user_id) then
          spared := spared || p.user_id;
        else
          perform public.lose_keys(p.user_id, hunt);
          hit := hit || p.user_id;
        end if;
      end loop;
      msg := me || ' raised the Orb of Oblivion! Every other hunter has forgotten every key.';
    elsif wd.wonder = 'orb_of_return' then
      for p in select hp.user_id from public.hunt_players hp
                where hp.hunt_id = hunt and hp.finished_at is null and (hp.user_id = uid or not public.wonder_cloaked(hp.user_id, hunt)) loop
        if public.coin_saves(p.user_id) then
          spared := spared || p.user_id;
        else
          perform public.send_home(p.user_id);
          hit := hit || p.user_id;
        end if;
      end loop;
      msg := me || ' raised the Orb of Return! Every hunter has been pulled back home.';
    elsif wd.wonder = 'eye_of_the_djinn' then
      lasts := now() + interval '10 minutes';
      msg := me || ' opened the Eye of the Djinn: for 10 minutes they see every hunter.';
    elsif wd.wonder = 'hourglass_of_ages' then
      lasts := now() + interval '3 minutes';
      select coalesce(array_agg(hp.user_id), '{}') into hit from public.hunt_players hp
       where hp.hunt_id = hunt and hp.finished_at is null and hp.user_id <> uid and not public.wonder_cloaked(hp.user_id, hunt);
      msg := me || ' turned the Hourglass of Ages! Every other hunter is frozen for 3 minutes.';
    elsif wd.wonder = 'master_key' then
      select keys_held into held from public.hunt_players where hunt_id = hunt and user_id = uid;
      select * into k from public.hunt_keys where hunt_id = hunt and n = held + 1;
      if k.n is null or pos.user_id is null or public.distance_m(pos.lng, pos.lat, k.spot_lng, k.spot_lat) > 40 then
        return jsonb_build_object('ok', false, 'reason', 'not_at_key'); -- not used up
      end if;
      extra := public.gain_key(uid, hunt);
      msg := me || ' turned the Master Key: Key ' || k.n || ' opened without a trial!';
    elsif wd.wonder = 'phantom_cloak' then
      lasts := hunt_end;
      msg := me || ' put on the Phantom Cloak and vanished!';
    elsif wd.wonder = 'mirror_of_many' then
      lasts := hunt_end;
      msg := me || ' broke the Mirror of Many: three of them walk the map now.';
    elsif wd.wonder = 'thiefs_hand' then
      if pos.user_id is null then
        return jsonb_build_object('ok', false, 'reason', 'position');
      end if;
      for p in select hp.user_id from public.hunt_players hp join public.player_positions pp on pp.user_id = hp.user_id
                where hp.hunt_id = hunt and hp.finished_at is null and hp.user_id <> uid and hp.keys_held > 0
                  and not public.wonder_cloaked(hp.user_id, hunt)
                  and public.distance_m(pos.lng, pos.lat, pp.lng, pp.lat) <= 1000 loop
        update public.hunt_players set keys_held = keys_held - 1, approach_key = null where hunt_id = hunt and user_id = p.user_id;
        hit := hit || p.user_id;
      end loop;
      if array_length(hit, 1) is null then
        return jsonb_build_object('ok', false, 'reason', 'nobody_near'); -- not used up
      end if;
      extra := public.gain_key(uid, hunt);
      msg := me || '''s Thief''s Hand took a key from ' || array_length(hit, 1) || ' hunter' || case when array_length(hit, 1) > 1 then 's' else '' end || ' nearby!';
    elsif wd.wonder = 'djinns_bargain' then
      select hp.user_id, pp.lng, pp.lat into leader
        from public.hunt_players hp join public.player_positions pp on pp.user_id = hp.user_id
       where hp.hunt_id = hunt and hp.finished_at is null and hp.user_id <> uid and not public.wonder_cloaked(hp.user_id, hunt)
       order by hp.keys_held desc, hp.last_key_at nulls last limit 1;
      if leader.user_id is null or pos.user_id is null then
        return jsonb_build_object('ok', false, 'reason', 'no_leader'); -- not used up
      end if;
      update public.player_positions set lng = leader.lng, lat = leader.lat, updated_at = now() where user_id = uid;
      update public.player_vehicles set lng = leader.lng, lat = leader.lat where user_id = uid and in_use;
      update public.player_positions set lng = pos.lng, lat = pos.lat, updated_at = now() where user_id = leader.user_id;
      update public.player_vehicles set lng = pos.lng, lat = pos.lat where user_id = leader.user_id and in_use;
      hit := array[uid, leader.user_id];
      msg := me || ' struck the Djinn''s Bargain and swapped places with the leader!';
    elsif wd.wonder = 'sandstorm_crown' then
      if pos.user_id is null then
        return jsonb_build_object('ok', false, 'reason', 'position');
      end if;
      lasts := now() + interval '30 minutes';
      msg := me || ' put on the Sandstorm Crown: a sandstorm sweeps the land for 30 minutes!';
    else
      return jsonb_build_object('ok', false, 'reason', 'unknown');
    end if;
  end if;

  update public.player_wonders set used_at = now() where id = wd.id;
  insert into public.wonder_events (wonder, user_id, username, hunt_id, message, affected, saved, ends_at, lng, lat, radius_m)
  values (wd.wonder, uid, me, hunt, msg, hit, spared, lasts,
          case when wd.wonder = 'sandstorm_crown' then pos.lng end, case when wd.wonder = 'sandstorm_crown' then pos.lat end,
          case when wd.wonder = 'sandstorm_crown' then 400000 end);
  if array_length(spared, 1) > 0 then
    insert into public.wonder_events (wonder, user_id, username, hunt_id, message)
    select 'djinn_coin', s, pr.username, hunt, pr.username || '''s Djinn''s Coin glowed: they were spared!'
      from unnest(spared) s join public.profiles pr on pr.id = s;
  end if;
  return jsonb_build_object('ok', true, 'wonder', wd.wonder, 'message', msg, 'affected', coalesce(array_length(hit, 1), 0),
    'spared', coalesce(array_length(spared, 1), 0), 'until', lasts) || extra;
end;
$$;

-- What's happened with the Wonders since the player last looked (all players hear of every use),
-- and what's acting on them now.
create or replace function public.wonder_news(p_since bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  return jsonb_build_object(
    'now', now(),
    'latest', coalesce((select max(id) from public.wonder_events), 0),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'wonder', e.wonder, 'message', e.message, 'at', e.at,
               'mine', e.user_id = uid, 'hitMe', uid = any (e.affected), 'savedMe', uid = any (e.saved)) order by e.id)
        from public.wonder_events e
       where e.id > p_since and e.at > now() - interval '1 hour'), '[]'::jsonb),
    'position', case when pos.user_id is not null then jsonb_build_object('lng', pos.lng, 'lat', pos.lat) end,
    'frozenUntil', (select max(e.ends_at) from public.wonder_events e
                     where e.wonder = 'hourglass_of_ages' and e.ends_at > now() and uid = any (e.affected)),
    'sandstorm', (select jsonb_build_object('until', e.ends_at, 'by', e.username) from public.wonder_events e
                   where e.wonder = 'sandstorm_crown' and e.ends_at > now() and e.user_id <> uid and pos.user_id is not null
                     and public.distance_m(pos.lng, pos.lat, e.lng, e.lat) <= e.radius_m
                   order by e.ends_at desc limit 1),
    'eyeUntil', (select max(e.ends_at) from public.wonder_events e where e.wonder = 'eye_of_the_djinn' and e.user_id = uid and e.ends_at > now()),
    'cloakUntil', (select max(e.ends_at) from public.wonder_events e where e.wonder = 'phantom_cloak' and e.user_id = uid and e.ends_at > now()),
    'mirrorUntil', (select max(e.ends_at) from public.wonder_events e where e.wonder = 'mirror_of_many' and e.user_id = uid and e.ends_at > now()));
end;
$$;

-- The Eye of the Djinn (while it's open): every other hunter in the hunt, and the area of the key they're chasing.
create or replace function public.eye_view()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hunt uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select e.hunt_id into hunt from public.wonder_events e
   where e.wonder = 'eye_of_the_djinn' and e.user_id = uid and e.ends_at > now() order by e.id desc limit 1;
  if hunt is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', pr.username, 'lng', pp.lng, 'lat', pp.lat, 'keysHeld', hp.keys_held,
             'chasing', case when k.n is not null then jsonb_build_object('key', k.n, 'lng', k.area_lng, 'lat', k.area_lat, 'radiusM', k.area_radius_m) end))
      from public.hunt_players hp
      join public.profiles pr on pr.id = hp.user_id
      join public.player_positions pp on pp.user_id = hp.user_id
      left join public.hunt_keys k on k.hunt_id = hp.hunt_id and k.n = hp.keys_held + 1
     where hp.hunt_id = hunt and hp.user_id <> uid and hp.finished_at is null and not public.wonder_cloaked(hp.user_id, hunt)), '[]'::jsonb);
end;
$$;

-- A failed Key Trial throws the player 2 km away, unless a Djinn's Coin saves them.
create or replace function public.fail_trial(t public.trial_attempts)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.hunt_keys%rowtype;
  bearing double precision := random() * 2 * pi();
  to_lng double precision;
  to_lat double precision;
  who text;
begin
  update public.trial_attempts set status = 'failed', ended_at = now() where id = t.id;
  if public.coin_saves(t.user_id) then
    select username into who from public.profiles where id = t.user_id;
    insert into public.wonder_events (wonder, user_id, username, hunt_id, message)
    values ('djinn_coin', t.user_id, who, t.hunt_id, who || '''s Djinn''s Coin glowed: they failed a Key Trial and stood their ground!');
    select lng, lat into to_lng, to_lat from public.player_positions where user_id = t.user_id;
    return jsonb_build_object('lng', to_lng, 'lat', to_lat, 'saved', true);
  end if;
  select * into k from public.hunt_keys where hunt_id = t.hunt_id and n = t.key_n;
  to_lat := k.spot_lat + 2000 * cos(bearing) / 110574;
  to_lng := k.spot_lng + 2000 * sin(bearing) / (111320 * cos(radians(k.spot_lat)));
  update public.player_positions set lng = to_lng, lat = to_lat, updated_at = now() where user_id = t.user_id;
  update public.player_vehicles set lng = to_lng, lat = to_lat where user_id = t.user_id and in_use;
  return jsonb_build_object('lng', to_lng, 'lat', to_lat);
end;
$$;

revoke execute on function public.live_hunt_of(uuid), public.wonder_cloaked(uuid, uuid), public.coin_saves(uuid), public.send_home(uuid),
  public.lose_keys(uuid, uuid), public.gain_key(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.use_wonder(uuid, double precision, double precision), public.wonder_news(bigint), public.eye_view() from public, anon;
grant execute on function public.use_wonder(uuid, double precision, double precision), public.wonder_news(bigint), public.eye_view() to authenticated;

-- ---- Existing functions the Wonders change ----------------------------------

create or replace function public.save_position(p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  from_lng double precision;
  from_lat double precision;
  from_mode text;
  since timestamptz;
  max_seconds double precision := 10;
  allowed_m double precision;
  moved_m double precision;
  fuel_left double precision;
  energy_was double precision := 100;
  fainted timestamptz;
  resting timestamptz;
  rest_rate_was double precision;
  secs double precision;
  idle_s double precision;
  sprinting boolean;
  energy_now double precision;
  v public.player_vehicles%rowtype;
  stopped text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_mode not in ('walk', 'bicycle', 'motorbike', 'car') then
    raise exception 'Unknown travel mode';
  end if;
  if p_lng not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Invalid location';
  end if;

  select lng, lat, mode, updated_at, energy, fainted_at, resting_since, rest_rate
    into from_lng, from_lat, from_mode, since, energy_was, fainted, resting, rest_rate_was
    from public.player_positions where user_id = uid for update;
  if not found then
    select home_lng, home_lat, 'walk', coalesce(home_set_at, now()) into from_lng, from_lat, from_mode, since
      from public.profiles where id = uid;
    if from_lng is null then
      raise exception 'Set your home first';
    end if;
    max_seconds := 600;
  end if;
  -- A first save has no row to read energy from (select into leaves it null): full energy.
  energy_was := coalesce(energy_was, 100);

  -- Fainted, or in hospital: nobody moves until the ambulance has been (call_ambulance, leave_hospital).
  if exists (select 1 from public.hospital_visits where user_id = uid and left_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'hospital', 'lng', from_lng, 'lat', from_lat);
  end if;
  if fainted is not null then
    return jsonb_build_object('ok', false, 'reason', 'fainted', 'lng', from_lng, 'lat', from_lat);
  end if;

  -- On a bus, train or plane: you're where it takes you (finish_trip), not where you say.
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'trip', 'lng', from_lng, 'lat', from_lat);
  end if;

  -- A rental left running while the player was away ends where they stopped.
  if since < now() - interval '3 minutes' then
    perform public.settle_rental(uid);
  end if;

  if p_mode <> public.current_mode(uid) then
    return jsonb_build_object('ok', false, 'reason', 'vehicle', 'mode', public.current_mode(uid), 'lng', from_lng, 'lat', from_lat);
  end if;

  moved_m := public.distance_m(from_lng, from_lat, p_lng, p_lat);
  -- 30% margin plus 30 m for timing jitter; the faster of the old and new mode.
  allowed_m := greatest(public.max_travel_speed(from_mode), public.max_travel_speed(p_mode))
               * least(extract(epoch from now() - since), max_seconds) * 1.3 + 30;

  -- Just off a bus, train or plane: the game puts you on the nearest road, which can be
  -- a few hundred metres from the stop (a station on the track), or a few km from an
  -- airport abroad (placed at the middle of the airfield).
  if exists (select 1 from public.transit_trips t
              where t.user_id = uid and t.outcome = 'arrived' and t.ended_at > now() - interval '60 seconds'
                and public.distance_m(t.to_lng, t.to_lat, p_lng, p_lat) <= case when t.mode = 'plane' then 3000 else 500 end) then
    allowed_m := greatest(allowed_m, 3000);
  end if;

  -- Frozen by the Hourglass of Ages: no moving until it runs out.
  if moved_m > 10 and exists (select 1 from public.wonder_events e
                               where e.wonder = 'hourglass_of_ages' and e.ends_at > now() and uid = any (e.affected)) then
    return jsonb_build_object('ok', false, 'reason', 'frozen', 'lng', from_lng, 'lat', from_lat,
      'until', (select max(e.ends_at) from public.wonder_events e where e.wonder = 'hourglass_of_ages' and e.ends_at > now() and uid = any (e.affected)));
  end if;

  if moved_m > allowed_m then
    return jsonb_build_object('ok', false, 'reason', 'speed', 'lng', from_lng, 'lat', from_lat);
  end if;

  -- A Lockdown dome: hunters who were outside when it rose can't go in.
  if public.dome_blocking(uid, p_lng, p_lat) is not null and public.dome_blocking(uid, from_lng, from_lat) is null then
    return jsonb_build_object('ok', false, 'reason', 'dome', 'lng', from_lng, 'lat', from_lat);
  end if;

  -- Energy: walking and cycling use it by the metre (sprinting 2.5 times as much);
  -- the time not spent moving gives it back (fast while resting at a chill spot, less fast resting by the road).
  secs := least(extract(epoch from now() - since), 3600);
  -- Time not accounted for by moving, even at the slowest fair pace (tired, in the rain: 45% of normal).
  idle_s := greatest(0, secs - moved_m / (public.base_speed(p_mode) * 0.45));
  sprinting := moved_m / greatest(secs, 0.5) > public.base_speed(p_mode) * 1.15;
  energy_now := least(100, greatest(0,
    energy_was - moved_m * public.energy_per_m(p_mode) * (case when sprinting then 2.5 else 1 end)
               + idle_s * (case when resting is not null then coalesce(rest_rate_was, public.rest_regen()) else public.idle_regen() end)));

  insert into public.player_positions (user_id, lng, lat, mode, updated_at, energy, fainted_at, resting_since)
  values (uid, p_lng, p_lat, p_mode, now(), energy_now,
          case when energy_now <= 0 and p_mode in ('walk', 'bicycle') then now() end, null)
  on conflict (user_id) do update
    set lng = excluded.lng, lat = excluded.lat, mode = excluded.mode, updated_at = excluded.updated_at,
        energy = excluded.energy, fainted_at = excluded.fainted_at,
        resting_since = case when moved_m < 5 then public.player_positions.resting_since end,
        rest_rate = case when moved_m < 5 then public.player_positions.rest_rate end;

  -- Owned vehicles go where the player goes: motor vehicles use fuel and wear their engines,
  -- bicycles' tyres lose air; a worn-out engine may break down.
  update public.player_vehicles
     set lng = p_lng, lat = p_lat,
         fuel = greatest(0, fuel - moved_m / 1000 * public.fuel_per_km(kind)),
         tyre = case when kind = 'bicycle' then greatest(0, tyre - moved_m / 1000 * public.tyre_per_km()) else tyre end,
         engine = case when kind <> 'bicycle' then greatest(0, engine - moved_m / 1000 * public.engine_per_km()) else engine end,
         broken_at = case when kind <> 'bicycle' and broken_at is null and engine < 15
                           and random() < moved_m / 1000 * 0.1 then now() else broken_at end
   where user_id = uid and in_use
   returning * into v;
  fuel_left := v.fuel;
  -- An empty tank or a breakdown stops a motorbike or car where it is: the player gets off.
  if v.id is not null and v.kind <> 'bicycle' and (v.fuel <= 0 or v.broken_at is not null) then
    update public.player_vehicles set in_use = false where id = v.id;
    update public.player_positions set mode = 'walk' where user_id = uid;
    stopped := case when v.broken_at is not null then 'broken' else 'fuel' end;
  end if;

  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'fuel', fuel_left, 'tyre', v.tyre, 'engine', v.engine,
    'energy', round(energy_now::numeric, 1), 'fainted', energy_now <= 0 and p_mode in ('walk', 'bicycle'), 'stopped', stopped);
end;
$$;

create or replace function public.djinn_answer_chamber(p_chamber uuid, p_cipher text, p_path integer[], p_weights integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ch public.djinn_chambers%rowtype;
  w public.djinn_wagers%rowtype;
  marks jsonb;
  all_ok boolean;
  result text;
  drop_at record;
  site public.djinn_sites%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into ch from public.djinn_chambers where id = p_chamber and user_id = uid and outcome is null for update;
  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into w from public.djinn_wagers where id = ch.wager_id for update;
  marks := public.djinn_check_rooms(ch.rooms, p_cipher, p_path, p_weights);
  all_ok := (marks ->> 'cipher')::boolean and (marks ->> 'floor')::boolean and (marks ->> 'scales')::boolean
            and now() <= ch.deadline + interval '5 seconds';

  if all_ok and ch.site_id <> w.real_site then
    result := 'empty';
    update public.djinn_entries set vault = 'empty' where wager_id = w.id and user_id = uid;
  elsif all_ok and (w.winner is not null or w.ends_at <= now()) then
    result := 'too_late';
  elsif all_ok then
    result := 'won';
    update public.djinn_wagers set winner = uid, claimed_at = now() where id = w.id;
    update public.djinn_entries set vault = 'won' where wager_id = w.id and user_id = uid;
    insert into public.player_wonders (user_id, wonder, wager_id) values (uid, w.wonder, w.id);
    if w.extra_wonder is not null then
      insert into public.player_wonders (user_id, wonder, wager_id) values (uid, w.extra_wonder, w.id);
    end if;
  elsif public.coin_saves(uid) then
    -- A Djinn's Coin: the wind can't take them (the Coin is spent).
    result := 'coin';
    insert into public.wonder_events (wonder, user_id, username, message)
    select 'djinn_coin', uid, pr.username, pr.username || '''s Djinn''s Coin glowed: the Djinn''s whirlwind couldn''t carry them off!'
      from public.profiles pr where pr.id = uid;
  else
    -- The whirlwind: dropped at an airport 10–300 km away (a random one of the nearest few), as if flown there.
    result := 'whirlwind';
    select * into site from public.djinn_sites where id = ch.site_id;
    select s.name, s.lng, s.lat into drop_at
      from public.transit_stops s
     where s.kind = 'plane' and s.lat between site.lat - 3 and site.lat + 3 and s.lng between site.lng - 3 and site.lng + 3
       and public.distance_m(site.lng, site.lat, s.lng, s.lat) between 10000 and 300000
     order by random() limit 1;
    if drop_at.name is null then
      select s.name, s.lng, s.lat into drop_at from public.transit_stops s
       where s.kind = 'plane' and public.distance_m(site.lng, site.lat, s.lng, s.lat) >= 10000
       order by public.distance_m(site.lng, site.lat, s.lng, s.lat) limit 1;
    end if;
    update public.player_positions set lng = drop_at.lng, lat = drop_at.lat, mode = 'walk', updated_at = now(), resting_since = null
     where user_id = uid;
    -- As if they'd flown there: save_position allows the hop from the airfield to its nearest road.
    insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at, ended_at, outcome)
    values (uid, 'plane', 'The whirlwind', drop_at.name, drop_at.lng, drop_at.lat,
            jsonb_build_array(jsonb_build_array(site.lng, site.lat), jsonb_build_array(drop_at.lng, drop_at.lat)),
            public.distance_m(site.lng, site.lat, drop_at.lng, drop_at.lat), 0, now(), now(), now(), 'arrived');
    update public.djinn_entries set rings_done = '{}' where wager_id = w.id and user_id = uid; -- the traps wait again
  end if;
  -- (A Coin save is kept as a failed attempt: the chamber failed, the Coin spared them.)
  update public.djinn_chambers set outcome = case when result = 'coin' then 'whirlwind' else result end, answered_at = now() where id = ch.id;
  return jsonb_build_object('ok', true, 'outcome', result, 'rooms', marks, 'wonder', w.wonder, 'extraWonder', w.extra_wonder,
    'dropAt', case when result = 'whirlwind' then jsonb_build_object('name', drop_at.name, 'lng', drop_at.lng, 'lat', drop_at.lat) end);
end;
$$;

create or replace function public.broadcast_state(p_hunt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  h public.hunts%rowtype;
  total int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Owner only';
  end if;
  select * into h from public.hunts where id = p_hunt;
  if not found then
    return null;
  end if;
  select count(*) into total from public.hunt_keys where hunt_id = h.id;

  return jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'prize', h.prize, 'winners', h.winners,
      'startsAt', h.starts_at, 'endsAt', h.ends_at, 'phase', public.hunt_phase(h), 'keys', total),
    'hunters', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.user_id, 'name', pr.username, 'look', pr.avatar, 'keysHeld', p.keys_held, 'place', p.place,
          'lastKeyAt', p.last_key_at,
          'lng', case when public.wonder_cloaked(p.user_id, h.id) then null else pp.lng end,
          'lat', case when public.wonder_cloaked(p.user_id, h.id) then null else pp.lat end,
          'mode', pp.mode, 'seenAt', pp.updated_at,
          'inTrial', exists (select 1 from public.trial_attempts t where t.hunt_id = h.id and t.user_id = p.user_id and t.status = 'active'))
        order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at)
        from public.hunt_players p
        join public.profiles pr on pr.id = p.user_id
        left join public.player_positions pp on pp.user_id = p.user_id
       where p.hunt_id = h.id), '[]'::jsonb),
    'domes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'lng', d.lng, 'lat', d.lat, 'radiusM', d.radius_m, 'endsAt', d.ends_at,
          'key', d.key_n, 'raisedBy', pr.username, 'needed', d.needed,
          'attackers', (select count(*) from public.dome_hits x where x.dome_id = d.id and x.at > now() - interval '30 seconds')))
        from public.hunt_domes d left join public.profiles pr on pr.id = d.raised_by
       where d.hunt_id = h.id and d.broken_at is null and d.ends_at > now()), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(recent.e order by recent.at desc) from (
        select jsonb_build_object('at', ev.at, 'kind', ev.kind, 'who', ev.who, 'whoId', ev.who_id, 'text', ev.text) as e, ev.at
          from (
            select t.ended_at as at, 'key' as kind, pr.username as who, t.user_id as who_id,
                   pr.username || ' earned Key ' || t.key_n || '!' as text
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id and t.status = 'passed'
            union all
            select t.ended_at, 'failed', pr.username, t.user_id,
                   pr.username || ' failed the Key ' || t.key_n || ' trial and was thrown 2 km away'
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id and t.status = 'failed'
            union all
            select t.started_at, 'trial', pr.username, t.user_id,
                   pr.username || ' found Key ' || t.key_n || ' and started the Key Trial'
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id
            union all
            select p.finished_at, 'finished', pr.username, p.user_id,
                   pr.username || ' finished ' || case p.place when 1 then '1st' when 2 then '2nd' when 3 then '3rd' else p.place || 'th' end
                   || case when p.place <= h.winners then ' and WINS!' else '' end
              from public.hunt_players p join public.profiles pr on pr.id = p.user_id
             where p.hunt_id = h.id and p.finished_at is not null
            union all
            select we.at, 'wonder', we.username, we.user_id, we.message
              from public.wonder_events we
             where we.hunt_id = h.id
            union all
            select p.joined_at, 'joined', pr.username, p.user_id, pr.username || ' joined the hunt'
              from public.hunt_players p join public.profiles pr on pr.id = p.user_id
             where p.hunt_id = h.id
            union all
            select d.starts_at, 'dome', pr.username, d.raised_by,
                   coalesce(pr.username, 'Someone') || ' raised a Lockdown dome over Key ' || d.key_n || '!'
              from public.hunt_domes d left join public.profiles pr on pr.id = d.raised_by
             where d.hunt_id = h.id
            union all
            select d.broken_at, 'siege', null, null, 'Siege! The dome over Key ' || d.key_n || ' has been broken'
              from public.hunt_domes d
             where d.hunt_id = h.id and d.broken_at is not null
          ) ev
         where ev.at > now() - interval '6 hours'
         order by ev.at desc
         limit 40
      ) recent), '[]'::jsonb));
end;
$$;
