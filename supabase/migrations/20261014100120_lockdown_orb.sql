-- The Lockdown Orb (design doc 7.1–7.2): one in the world. Its holder raises a
-- 1 km dome over their current key area for 20 minutes. Hunters inside when it
-- rises (and the holder) carry on; everyone outside is stopped at the edge.
-- Hunters at the edge can break it early by attacking together (a siege). Not
-- on the final key; one dome per hunt at a time; once used, the Orb hides
-- again somewhere new.
--
-- The dome's centre is offset from the key spot (by up to 450 m), so the dome
-- doesn't give the key's exact location away.

alter table public.world_items drop constraint world_items_relic_check;
alter table public.world_items add constraint world_items_relic_check
  check (relic in ('rain_charm', 'shield', 'radar', 'fast_pass', 'second_wind', 'jerry_can', 'lockdown_orb'));
alter table public.player_relics drop constraint player_relics_relic_check;
alter table public.player_relics add constraint player_relics_relic_check
  check (relic in ('rain_charm', 'shield', 'radar', 'fast_pass', 'second_wind', 'jerry_can', 'lockdown_orb'));

create table public.hunt_domes (
  id        uuid primary key default gen_random_uuid(),
  hunt_id   uuid not null references public.hunts (id) on delete cascade,
  key_n     int not null,
  lng       double precision not null,
  lat       double precision not null,
  radius_m  int not null default 1000,
  starts_at timestamptz not null default now(),
  ends_at   timestamptz not null,
  broken_at timestamptz,
  raised_by uuid references public.profiles (id) on delete set null,
  needed    int not null -- attackers needed together (within 30 s) to break it
);
create index hunt_domes_active on public.hunt_domes (ends_at) where broken_at is null;

-- Who was inside (or raised it) when the dome went up: they may move freely.
create table public.dome_insiders (
  dome_id uuid not null references public.hunt_domes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (dome_id, user_id)
);

-- Each attacker's latest hit.
create table public.dome_hits (
  dome_id uuid not null references public.hunt_domes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (dome_id, user_id)
);

alter table public.hunt_domes enable row level security;
alter table public.dome_insiders enable row level security;
alter table public.dome_hits enable row level security;
revoke all on public.hunt_domes, public.dome_insiders, public.dome_hits from anon, authenticated;

-- An active dome over this point that keeps this player out (null if none).
create function public.dome_blocking(p_uid uuid, p_lng double precision, p_lat double precision)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.hunt_domes d
   where d.broken_at is null and d.ends_at > now()
     and public.distance_m(p_lng, p_lat, d.lng, d.lat) <= d.radius_m
     and not exists (select 1 from public.dome_insiders i where i.dome_id = d.id and i.user_id = p_uid)
   limit 1;
$$;

-- Put the Orb somewhere new, if nobody holds it and it isn't lying in the world:
-- on a coin spot (coins are always on roads) 1–4 km from a key of a live or
-- upcoming hunt, or around Lagos when there's none.
create function public.place_orb()
returns void language plpgsql security definer set search_path = '' as $$
declare
  near_lng double precision := 3.38;
  near_lat double precision := 6.52;
  spot record;
begin
  if exists (select 1 from public.world_items where relic = 'lockdown_orb' and taken_by is null and expires_at > now())
     or exists (select 1 from public.player_relics where relic = 'lockdown_orb' and charges > 0 and expires_at > now()) then
    return;
  end if;
  select k.spot_lng, k.spot_lat into near_lng, near_lat
    from public.hunt_keys k join public.hunts h on h.id = k.hunt_id
   where public.hunt_phase(h) in ('live', 'upcoming')
   order by random() limit 1;
  near_lng := coalesce(near_lng, 3.38);
  near_lat := coalesce(near_lat, 6.52);
  select i.cell, i.lng, i.lat into spot
    from public.world_items i
   where i.kind = 'coins' and i.taken_by is null and i.expires_at > now()
     and i.lng between near_lng - 0.04 and near_lng + 0.04 and i.lat between near_lat - 0.04 and near_lat + 0.04
     and public.distance_m(near_lng, near_lat, i.lng, i.lat) between 1000 and 4000
   order by random() limit 1;
  if spot.cell is null then
    select i.cell, i.lng, i.lat into spot
      from public.world_items i
     where i.kind = 'coins' and i.taken_by is null and i.expires_at > now()
       and i.lng between near_lng - 0.1 and near_lng + 0.1 and i.lat between near_lat - 0.1 and near_lat + 0.1
     order by random() limit 1;
  end if;
  if spot.cell is null then
    return; -- nowhere stocked yet; tried again later
  end if;
  insert into public.world_items (cell, kind, relic, hidden, lng, lat, expires_at)
  values (spot.cell, 'relic', 'lockdown_orb', false, spot.lng, spot.lat, now() + interval '3 days');
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving a position: as before, and a dome keeps outsiders out.
-- ---------------------------------------------------------------------------
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

  select lng, lat, mode, updated_at into from_lng, from_lat, from_mode, since
    from public.player_positions where user_id = uid for update;
  if not found then
    select home_lng, home_lat, 'walk', coalesce(home_set_at, now()) into from_lng, from_lat, from_mode, since
      from public.profiles where id = uid;
    if from_lng is null then
      raise exception 'Set your home first';
    end if;
    max_seconds := 600;
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

  if moved_m > allowed_m then
    return jsonb_build_object('ok', false, 'reason', 'speed', 'lng', from_lng, 'lat', from_lat);
  end if;

  -- A Lockdown dome: hunters who were outside when it rose can't go in.
  if public.dome_blocking(uid, p_lng, p_lat) is not null and public.dome_blocking(uid, from_lng, from_lat) is null then
    return jsonb_build_object('ok', false, 'reason', 'dome', 'lng', from_lng, 'lat', from_lat);
  end if;

  insert into public.player_positions (user_id, lng, lat, mode, updated_at)
  values (uid, p_lng, p_lat, p_mode, now())
  on conflict (user_id) do update
    set lng = excluded.lng, lat = excluded.lat, mode = excluded.mode, updated_at = excluded.updated_at;

  -- Owned vehicles go where the player goes, and motor vehicles use fuel.
  update public.player_vehicles
     set lng = p_lng, lat = p_lat,
         fuel = greatest(0, fuel - moved_m / 1000 * public.fuel_per_km(kind))
   where user_id = uid and in_use
   returning fuel into fuel_left;

  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'fuel', fuel_left);
end;
$$;

-- ---------------------------------------------------------------------------
-- Raising a dome (from use_relic, for the Lockdown Orb).
-- ---------------------------------------------------------------------------
create function public.raise_dome(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  total int;
  hunters int;
  bearing double precision := random() * 2 * pi();
  offset_m double precision := random() * 450;
  c_lng double precision;
  c_lat double precision;
  dome public.hunt_domes%rowtype;
begin
  select p.* into hp from public.hunt_players p join public.hunts h on h.id = p.hunt_id
   where p.user_id = p_uid and p.finished_at is null and public.hunt_phase(h) = 'live'
   order by p.joined_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_hunt');
  end if;
  select count(*) into total from public.hunt_keys where hunt_id = hp.hunt_id;
  if hp.keys_held + 1 >= total then
    return jsonb_build_object('ok', false, 'reason', 'final_key');
  end if;
  perform 1 from public.hunts where id = hp.hunt_id for update; -- one dome per hunt: decide one at a time
  if exists (select 1 from public.hunt_domes where hunt_id = hp.hunt_id and broken_at is null and ends_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'dome_up');
  end if;
  select * into k from public.hunt_keys where hunt_id = hp.hunt_id and n = hp.keys_held + 1;
  c_lat := k.spot_lat + offset_m * cos(bearing) / 110574;
  c_lng := k.spot_lng + offset_m * sin(bearing) / (111320 * cos(radians(k.spot_lat)));
  select count(*) into hunters from public.hunt_players where hunt_id = hp.hunt_id and finished_at is null;
  insert into public.hunt_domes (hunt_id, key_n, lng, lat, ends_at, raised_by, needed)
  values (hp.hunt_id, k.n, c_lng, c_lat, now() + interval '20 minutes', p_uid, least(10, greatest(2, ceil(hunters / 10.0)::int)))
  returning * into dome;
  -- Inside now: the holder, and every hunter whose last saved position is under the dome.
  insert into public.dome_insiders (dome_id, user_id)
  select dome.id, pp.user_id from public.player_positions pp
   where public.distance_m(pp.lng, pp.lat, dome.lng, dome.lat) <= dome.radius_m
  union select dome.id, p_uid
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'dome', dome.id, 'until', dome.ends_at, 'key', k.n);
end;
$$;

-- use_relic, with the Lockdown Orb added.
create or replace function public.use_relic(p_relic uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.player_relics%rowtype;
  pos public.player_positions%rowtype;
  fuel_now double precision;
  valid_until timestamptz;
  raised jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.player_relics where id = p_relic and user_id = uid for update;
  if not found or r.charges < 1 or r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  if r.relic = 'shield' then
    return jsonb_build_object('ok', false, 'reason', 'passive');
  elsif r.relic = 'fast_pass' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  elsif r.relic = 'lockdown_orb' then
    raised := public.raise_dome(uid);
    if not (raised ->> 'ok')::boolean then
      return raised;
    end if;
    update public.player_relics set charges = charges - 1 where id = r.id;
    perform public.place_orb(); -- used: it hides again somewhere new
    return raised || jsonb_build_object('relic', 'lockdown_orb');
  elsif r.relic = 'jerry_can' then
    update public.player_vehicles set fuel = least(100, fuel + 30)
     where user_id = uid and in_use and kind <> 'bicycle'
     returning fuel into fuel_now;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
  elsif r.relic = 'radar' then
    valid_until := greatest(now(), coalesce((select radar_until from public.player_boosts where user_id = uid), now())) + interval '5 minutes';
    insert into public.player_boosts (user_id, radar_until) values (uid, valid_until)
    on conflict (user_id) do update set radar_until = excluded.radar_until;
  elsif r.relic = 'rain_charm' then
    select * into pos from public.player_positions where user_id = uid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'position');
    end if;
    valid_until := now() + interval '10 minutes';
    insert into public.world_effects (kind, lng, lat, radius_m, ends_at, created_by)
    values ('rain', pos.lng, pos.lat, 5000, valid_until, uid);
  end if;

  update public.player_relics set charges = charges - 1 where id = r.id;
  return jsonb_build_object('ok', true, 'relic', r.relic, 'energy', case when r.relic = 'second_wind' then 50 end,
    'fuel', fuel_now, 'until', valid_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- Domes near the player (within 20 km), and the siege.
-- ---------------------------------------------------------------------------
create function public.domes_near()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
begin
  perform public.place_orb(); -- keep the Orb in the world (after it expires or its square is restocked)
  select * into pos from public.player_positions where user_id = uid;
  if not found then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'lng', d.lng, 'lat', d.lat, 'radiusM', d.radius_m, 'endsAt', d.ends_at, 'needed', d.needed,
      'hunt', h.title, 'key', d.key_n,
      'inside', exists (select 1 from public.dome_insiders i where i.dome_id = d.id and i.user_id = uid),
      'mine', d.raised_by = uid,
      'attackers', (select count(*) from public.dome_hits x where x.dome_id = d.id and x.at > now() - interval '30 seconds')))
      from public.hunt_domes d join public.hunts h on h.id = d.hunt_id
     where d.broken_at is null and d.ends_at > now()
       and public.distance_m(pos.lng, pos.lat, d.lng, d.lat) <= 20000
  ), '[]'::jsonb);
end;
$$;

-- An attack on a dome by a hunter at its edge (within 200 m outside it). It
-- breaks when enough different hunters attack within 30 seconds of each other.
create function public.siege_hit(p_dome uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.hunt_domes%rowtype;
  pos public.player_positions%rowtype;
  dist double precision;
  attackers int;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into d from public.hunt_domes where id = p_dome for update;
  if not found or d.broken_at is not null or d.ends_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if exists (select 1 from public.dome_insiders i where i.dome_id = d.id and i.user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'inside');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  dist := public.distance_m(pos.lng, pos.lat, d.lng, d.lat);
  if pos.user_id is null or dist > d.radius_m + 200 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  insert into public.dome_hits (dome_id, user_id, at) values (d.id, uid, now())
  on conflict (dome_id, user_id) do update set at = excluded.at;
  select count(*) into attackers from public.dome_hits where dome_id = d.id and at > now() - interval '30 seconds';
  if attackers >= d.needed then
    update public.hunt_domes set broken_at = now() where id = d.id;
    return jsonb_build_object('ok', true, 'broken', true, 'attackers', attackers, 'needed', d.needed);
  end if;
  return jsonb_build_object('ok', true, 'broken', false, 'attackers', attackers, 'needed', d.needed);
end;
$$;

revoke execute on function public.dome_blocking(uuid, double precision, double precision), public.place_orb(),
  public.raise_dome(uuid) from public, anon, authenticated;
revoke execute on function public.domes_near(), public.siege_hit(uuid) from public, anon;
grant execute on function public.domes_near(), public.siege_hit(uuid) to authenticated;

-- Put the Orb into the world.
select public.place_orb();
