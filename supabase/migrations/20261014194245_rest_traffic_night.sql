-- Rest where you are, traffic, and night and day (design doc 15, 14 Oct 2026).
--
-- 1. Resting by the road: when no chill spot is close, a tired player can sit
--    down where they are. Energy comes back at half the chill-spot rate.
-- 2. Night and day follow the sun where the player is (sun_altitude). After
--    dark, taxis charge a night fare and city buses come less often.
-- 3. Traffic: on weekdays the roads are busy in the morning and evening rush
--    hours (traffic_level, by local time). Taxis and city buses take longer.
--    The game also draws jams on main roads and slows cars and motorbikes in
--    them; that part is the client's (slower is always allowed by save_position).
-- The same rules are in src/game/clock.ts; keep the two in step.

alter table public.player_positions add column if not exists rest_rate double precision;

create or replace function public.roadside_regen() returns double precision language sql immutable set search_path = '' as $$ select 1::double precision $$;
create or replace function public.night_taxi_fare() returns double precision language sql immutable set search_path = '' as $$ select 1.3::double precision $$;
create or replace function public.night_bus_wait() returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- Local clock: Nigeria is on West Africa Time (UTC+1); elsewhere, by longitude.
create or replace function public.utc_offset_h(p_lng double precision, p_lat double precision) returns integer
language sql immutable set search_path = '' as $$
  select case when p_lng between 2.6 and 14.7 and p_lat between 4 and 14 then 1 else round(p_lng / 15)::integer end;
$$;

create or replace function public.local_time(p_lng double precision, p_lat double precision, p_at timestamptz default now()) returns timestamp
language sql stable set search_path = '' as $$
  select (p_at at time zone 'UTC') + make_interval(hours => public.utc_offset_h(p_lng, p_lat));
$$;

-- The sun's height above the horizon in degrees (a simple formula, good to a degree or so).
create or replace function public.sun_altitude(p_lng double precision, p_lat double precision, p_at timestamptz default now()) returns double precision
language sql stable set search_path = '' as $$
  with t as (
    select extract(doy from (p_at at time zone 'UTC'))::double precision as n,
           extract(epoch from ((p_at at time zone 'UTC') - date_trunc('day', p_at at time zone 'UTC')))::double precision / 3600 as h
  ), s as (
    select -23.44 * cos(2 * pi() / 365 * (n + 10)) as decl, (h + p_lng / 15 - 12) * 15 as ha from t
  )
  select degrees(asin(sin(radians(p_lat)) * sin(radians(decl)) + cos(radians(p_lat)) * cos(radians(decl)) * cos(radians(ha)))) from s;
$$;

create or replace function public.is_night(p_lng double precision, p_lat double precision, p_at timestamptz default now()) returns boolean
language sql stable set search_path = '' as $$ select public.sun_altitude(p_lng, p_lat, p_at) < -4 $$;

-- How busy the roads are, 0 (empty) to 1 (the evening rush), by local time and day.
create or replace function public.traffic_level(p_lng double precision, p_lat double precision, p_at timestamptz default now()) returns double precision
language sql stable set search_path = '' as $$
  with l as (
    select extract(dow from public.local_time(p_lng, p_lat, p_at)) as d,
           extract(hour from public.local_time(p_lng, p_lat, p_at)) + extract(minute from public.local_time(p_lng, p_lat, p_at)) / 60 as h
  )
  select (case
    when d = 0 then case when h >= 10 and h < 20 then 0.15 else 0 end
    when d = 6 then case when h >= 9 and h < 20 then 0.35 when h >= 20 and h < 22 then 0.1 else 0 end
    when h >= 6.5 and h < 10 then 0.8
    when h >= 16 and h < 20.5 then 1
    when h >= 10 and h < 16 then 0.3
    when h >= 20.5 and h < 22 then 0.2
    else 0
  end)::double precision from l;
$$;

-- Taxis and city buses: up to 1.8 times as long at the evening rush.
create or replace function public.traffic_factor(p_lng double precision, p_lat double precision, p_at timestamptz default now()) returns double precision
language sql stable set search_path = '' as $$ select 1 + 0.8 * public.traffic_level(p_lng, p_lat, p_at) $$;

-- Rest at a chill spot (fast; start_rest), or right where you are (rest_here; less fast).
create or replace function public.start_rest()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  spot public.places%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  spot := public.place_at(array['rest', 'eat'], uid, 80);
  if spot.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  update public.player_positions set resting_since = coalesce(resting_since, now()), rest_rate = public.rest_regen()
   where user_id = uid and fainted_at is null;
  return jsonb_build_object('ok', true, 'place', spot.name);
end;
$$;

create or replace function public.rest_here()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  update public.player_positions set resting_since = coalesce(resting_since, now()), rest_rate = public.roadside_regen()
   where user_id = uid and fainted_at is null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.rest_here() from public, anon;
grant execute on function public.rest_here() to authenticated;

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

create or replace function public.start_trip(p_from bigint, p_to bigint, p_path jsonb, p_fast_pass boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.transit_stops%rowtype;
  t public.transit_stops%rowtype;
  pos public.player_positions%rowtype;
  straight double precision;
  metres double precision;
  points integer;
  fare integer;
  pass uuid;
  balance bigint;
  trip public.transit_trips%rowtype;
  wait integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'on_trip');
  end if;
  select * into f from public.transit_stops where id = p_from;
  select * into t from public.transit_stops where id = p_to;
  if f.id is null or t.id is null or f.kind <> t.kind or f.id = t.id then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;
  if f.kind = 'train' and t.line_id is distinct from f.line_id then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;
  straight := public.distance_m(f.lng, f.lat, t.lng, t.lat);
  -- Buses: within 40 km from any stop; further (up to 1,500 km) only between motor parks.
  if f.kind = 'bus' and (straight < 150 or (straight > public.bus_range_m() and not (f.park and t.park and straight <= 1500000))) then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;

  if public.current_mode(uid) <> 'walk' then
    return jsonb_build_object('ok', false, 'reason', 'vehicle');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, f.lng, f.lat) > public.transit_reach_m(f.kind) then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if public.dome_blocking(uid, t.lng, t.lat) is not null then
    return jsonb_build_object('ok', false, 'reason', 'dome');
  end if;

  -- The path must run from this stop to that one.
  points := case when jsonb_typeof(p_path) = 'array' then jsonb_array_length(p_path) else 0 end;
  if points < 2 or points > 5000
     or public.distance_m(f.lng, f.lat, (p_path -> 0 ->> 0)::double precision, (p_path -> 0 ->> 1)::double precision) > 400
     or public.distance_m(t.lng, t.lat, (p_path -> (points - 1) ->> 0)::double precision, (p_path -> (points - 1) ->> 1)::double precision) > 400 then
    return jsonb_build_object('ok', false, 'reason', 'path');
  end if;
  metres := case f.kind
    when 'bus' then greatest(public.path_length_m(p_path), straight)
    when 'train' then abs(t.along_m - f.along_m)
    else straight
  end;

  fare := public.transit_fare(f.kind, metres);
  begin
    balance := public.apply_coin_change(uid, -fare, 'spend',
      initcap(f.kind) || ' fare: ' || f.name || ' to ' || t.name, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'fare', fare);
  end;

  if p_fast_pass then
    select id into pass from public.player_relics
     where user_id = uid and relic = 'fast_pass' and charges > 0 and expires_at > now()
     order by expires_at limit 1 for update;
    if pass is null then
      raise exception 'No Fast Pass to use'; -- undoes the fare too
    end if;
    update public.player_relics set charges = charges - 1 where id = pass;
  end if;

  -- At night city buses come less often; in town, traffic slows buses at rush hour.
  wait := public.transit_wait_s(f.kind, p_fast_pass) * case when f.kind = 'bus' and public.is_night(f.lng, f.lat) then public.night_bus_wait() else 1 end;
  insert into public.transit_trips (user_id, mode, line_id, from_name, to_name, to_lng, to_lat, path, path_m, fare, fast_pass, departs_at, arrives_at)
  values (uid, f.kind, f.line_id, f.name, t.name, t.lng, t.lat, p_path, metres, fare, p_fast_pass,
          now() + make_interval(secs => wait),
          now() + make_interval(secs => wait + metres / public.transit_speed_for(f.kind, metres)
                                     * case when f.kind = 'bus' and metres <= public.bus_range_m() then public.traffic_factor(f.lng, f.lat) else 1 end))
  returning * into trip;

  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;

create or replace function public.request_pickup(
  p_kind text, p_lng double precision, p_lat double precision, p_name text,
  p_driver_path jsonb default null, p_trip_path jsonb default null,
  p_to_name text default null, p_to_lng double precision default null, p_to_lat double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  points integer;
  driven double precision;
  trip_m double precision;
  fare integer;
  coins bigint;
  ready timestamptz := now();
  p public.vehicle_pickups%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('bicycle', 'motorbike', 'taxi') then
    raise exception 'Unknown vehicle';
  end if;
  if public.current_mode(uid) <> 'walk' then
    return jsonb_build_object('ok', false, 'reason', 'vehicle');
  end if;
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'on_trip');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, p_lng, p_lat) > public.pickup_reach_m() then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;

  if p_kind = 'taxi' then
    -- The driver's way: ends at the pickup, 200 m to 8 km long.
    points := case when jsonb_typeof(p_driver_path) = 'array' then jsonb_array_length(p_driver_path) else 0 end;
    if points < 2 or points > 3000
       or public.distance_m(p_lng, p_lat, (p_driver_path -> (points - 1) ->> 0)::double precision, (p_driver_path -> (points - 1) ->> 1)::double precision) > 60 then
      return jsonb_build_object('ok', false, 'reason', 'path');
    end if;
    driven := public.path_length_m(p_driver_path);
    if driven < 200 or driven > 8000 then
      return jsonb_build_object('ok', false, 'reason', 'path');
    end if;
    -- The trip: from the pickup to the destination, within 40 km, charged by its length (never less than the straight line).
    points := case when jsonb_typeof(p_trip_path) = 'array' then jsonb_array_length(p_trip_path) else 0 end;
    if p_to_lng is null or p_to_lat is null or points < 2 or points > 5000
       or public.distance_m(p_lng, p_lat, (p_trip_path -> 0 ->> 0)::double precision, (p_trip_path -> 0 ->> 1)::double precision) > 60
       or public.distance_m(p_to_lng, p_to_lat, (p_trip_path -> (points - 1) ->> 0)::double precision, (p_trip_path -> (points - 1) ->> 1)::double precision) > 60 then
      return jsonb_build_object('ok', false, 'reason', 'path');
    end if;
    if public.distance_m(p_lng, p_lat, p_to_lng, p_to_lat) > public.bus_range_m() then
      return jsonb_build_object('ok', false, 'reason', 'route');
    end if;
    trip_m := greatest(public.path_length_m(p_trip_path), public.distance_m(p_lng, p_lat, p_to_lng, p_to_lat));
    -- A night fare after dark; the driver takes longer to come in traffic.
    fare := ceil(public.transit_fare('taxi', trip_m) * case when public.is_night(p_lng, p_lat) then public.night_taxi_fare() else 1 end);
    select profiles.coins into coins from public.profiles where id = uid;
    if coins < fare then
      return jsonb_build_object('ok', false, 'reason', 'coins', 'fare', fare);
    end if;
    ready := now() + make_interval(secs => greatest(15, driven / public.driver_speed() * public.traffic_factor(p_lng, p_lat)));
  end if;

  insert into public.vehicle_pickups (user_id, kind, name, lng, lat, driver_path, trip_path, trip_m, to_name, to_lng, to_lat, fare, requested_at, ready_at, expires_at)
  values (uid, p_kind, left(coalesce(nullif(trim(p_name), ''), 'Pickup point'), 80), p_lng, p_lat,
          case when p_kind = 'taxi' then p_driver_path end, case when p_kind = 'taxi' then p_trip_path end, trip_m,
          case when p_kind = 'taxi' then left(coalesce(nullif(trim(p_to_name), ''), 'your stop'), 80) end,
          case when p_kind = 'taxi' then p_to_lng end, case when p_kind = 'taxi' then p_to_lat end, fare,
          now(), ready, ready + interval '15 minutes')
  on conflict (user_id) do update set
    kind = excluded.kind, name = excluded.name, lng = excluded.lng, lat = excluded.lat,
    driver_path = excluded.driver_path, trip_path = excluded.trip_path, trip_m = excluded.trip_m,
    to_name = excluded.to_name, to_lng = excluded.to_lng, to_lat = excluded.to_lat, fare = excluded.fare,
    requested_at = excluded.requested_at, ready_at = excluded.ready_at, expires_at = excluded.expires_at, ended_at = null
  returning * into p;
  return jsonb_build_object('ok', true, 'pickup', public.pickup_json(p));
end;
$$;

create or replace function public.board_taxi()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pick public.vehicle_pickups%rowtype;
  pos public.player_positions%rowtype;
  balance bigint;
  trip public.transit_trips%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pick from public.vehicle_pickups where user_id = uid and kind = 'taxi' and ended_at is null and expires_at > now() for update;
  if pick.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'pickup');
  end if;
  if now() < pick.ready_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_ready', 'pickup', public.pickup_json(pick));
  end if;
  if public.current_mode(uid) <> 'walk' then
    return jsonb_build_object('ok', false, 'reason', 'vehicle');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, pick.lng, pick.lat) > public.pickup_at_m() then
    return jsonb_build_object('ok', false, 'reason', 'far_pickup', 'lng', pick.lng, 'lat', pick.lat);
  end if;
  if public.dome_blocking(uid, pick.to_lng, pick.to_lat) is not null then
    return jsonb_build_object('ok', false, 'reason', 'dome');
  end if;
  begin
    balance := public.apply_coin_change(uid, -pick.fare, 'spend', 'Taxi fare: ' || pick.name || ' to ' || pick.to_name, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'fare', pick.fare);
  end;
  insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at)
  values (uid, 'taxi', pick.name, pick.to_name, pick.to_lng, pick.to_lat, pick.trip_path, pick.trip_m, pick.fare,
          now(), now() + make_interval(secs => pick.trip_m / public.transit_speed('taxi') * public.traffic_factor(pick.lng, pick.lat)))
  returning * into trip;
  update public.vehicle_pickups set ended_at = now() where user_id = uid;
  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;
