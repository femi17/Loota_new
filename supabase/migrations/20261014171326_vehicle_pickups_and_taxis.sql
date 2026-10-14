-- Rentals don't appear out of thin air (owner's call, 14 Oct 2026).
--  * A bicycle or motorbike is handed over by a renter waiting at a spot near
--    the player (the game picks the nearest bus stop: okada and bike hire
--    gather there). The rental, and its meter, start when the player gets there.
--  * Cars are taxis: the player picks where to go, a driver comes to a pickup
--    point near them, they walk there and get in, and the driver takes them
--    (a trip like a bus ride, transit_trips mode 'taxi'), for a fare.
-- Owned vehicles are unchanged: they wait where they were parked.

create table public.vehicle_pickups (
  user_id      uuid primary key references public.profiles (id) on delete cascade, -- one at a time
  kind         text not null check (kind in ('bicycle', 'motorbike', 'taxi')),
  name         text not null,            -- where: "Coker Road bus stop"
  lng          double precision not null,
  lat          double precision not null,
  driver_path  jsonb,                    -- a taxi: the driver's way to the pickup ([[lng, lat], ...])
  trip_path    jsonb,                    -- a taxi: the way to the destination
  trip_m       double precision,
  to_name      text,
  to_lng       double precision,
  to_lat       double precision,
  fare         integer,
  requested_at timestamptz not null default now(),
  ready_at     timestamptz not null,     -- when the vehicle is there
  expires_at   timestamptz not null,
  ended_at     timestamptz               -- picked up, or cancelled (null: still on)
);

alter table public.vehicle_pickups enable row level security;
create policy "Players read their own pickup" on public.vehicle_pickups for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.vehicle_pickups from anon, authenticated;

-- Taxis ride like a car in town (45 km/h × the time scale of 12), within 40 km; fare 8 + 2 coins per km.
alter table public.transit_trips drop constraint transit_trips_mode_check;
alter table public.transit_trips add constraint transit_trips_mode_check check (mode in ('bus', 'train', 'plane', 'taxi'));

create or replace function public.transit_speed(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'bus' then 25 when 'train' then 70 when 'plane' then 750 when 'taxi' then 45 end / 3.6 * 12;
$$;

create or replace function public.transit_fare(p_mode text, p_metres double precision) returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then case when p_metres > 40000 then 20 + ceil(p_metres / 1000 * 0.4) else 3 + ceil(p_metres / 1000) end
    when 'train' then 5 + ceil(p_metres / 2000)
    when 'plane' then 80 + ceil(p_metres / 1000 * 0.15)
    when 'taxi' then 8 + ceil(p_metres / 1000 * 2)
  end::integer;
$$;

-- How far a player may be sent for a pickup, how close counts as "there", and
-- how fast a driver comes to fetch them (30 km/h in town, × 12).
create function public.pickup_reach_m() returns double precision language sql immutable set search_path = '' as $$ select 2000::double precision $$;
create function public.pickup_at_m() returns double precision language sql immutable set search_path = '' as $$ select 35::double precision $$;
create function public.driver_speed() returns double precision language sql immutable set search_path = '' as $$ select 30 / 3.6 * 12 $$;

create function public.pickup_json(p public.vehicle_pickups)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'kind', p.kind, 'name', p.name, 'lng', p.lng, 'lat', p.lat, 'driverPath', p.driver_path,
    'toName', p.to_name, 'fare', p.fare, 'tripMetres', round(p.trip_m),
    'requestedAt', p.requested_at, 'readyAt', p.ready_at, 'expiresAt', p.expires_at, 'now', now());
$$;

-- Ask for a bicycle or motorbike: the renter waits at p_lng/p_lat (the spot the
-- game picked, within 2 km of where the server last saw the player).
-- Or call a taxi (p_kind 'taxi'): p_driver_path is the driver's way to the
-- pickup at p_lng/p_lat, which sets when it arrives; p_trip_path the way from
-- the pickup to the destination, which sets the fare. Replaces any earlier request.
create function public.request_pickup(
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
    fare := public.transit_fare('taxi', trip_m);
    select profiles.coins into coins from public.profiles where id = uid;
    if coins < fare then
      return jsonb_build_object('ok', false, 'reason', 'coins', 'fare', fare);
    end if;
    ready := now() + make_interval(secs => greatest(15, driven / public.driver_speed()));
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

-- The rental or taxi on its way (or waiting), if any.
create function public.my_pickup()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.pickup_json(p) from public.vehicle_pickups p where p.user_id = auth.uid() and p.ended_at is null and p.expires_at > now();
$$;

-- Never mind: nothing is charged before getting in.
create function public.cancel_pickup()
returns void language sql security definer set search_path = '' as $$
  update public.vehicle_pickups set ended_at = now() where user_id = auth.uid() and ended_at is null;
$$;

-- Get in the taxi: at the pickup, once it's there. Pays the fare and starts the trip.
create function public.board_taxi()
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
          now(), now() + make_interval(secs => pick.trip_m / public.transit_speed('taxi')))
  returning * into trip;
  update public.vehicle_pickups set ended_at = now() where user_id = uid;
  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;

-- start_vehicle (from 20261014164057_travel_restraints): renting only where the renter has
-- brought the bicycle or motorbike; cars are taxis, not rentals.
create or replace function public.start_vehicle(p_kind text, p_lng double precision, p_lat double precision, p_rent boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos jsonb;
  v public.player_vehicles%rowtype;
  pick public.vehicle_pickups%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('bicycle', 'motorbike', 'car') then
    raise exception 'Unknown vehicle';
  end if;

  pos := public.save_position(p_lng, p_lat, public.current_mode(uid));
  if not (pos ->> 'ok')::boolean then
    return pos || jsonb_build_object('reason', 'position');
  end if;

  select * into v from public.player_vehicles where user_id = uid and kind = p_kind;
  -- Renting: only where the renter has brought the bicycle or motorbike. Cars are taxis, not rentals.
  if p_rent or v.id is null then
    if p_kind = 'car' then
      return jsonb_build_object('ok', false, 'reason', 'taxi');
    end if;
    select * into pick from public.vehicle_pickups where user_id = uid and kind = p_kind and ended_at is null and expires_at > now();
    if pick.user_id is null then
      return jsonb_build_object('ok', false, 'reason', 'pickup');
    end if;
    if public.distance_m(p_lng, p_lat, pick.lng, pick.lat) > public.pickup_at_m() then
      return jsonb_build_object('ok', false, 'reason', 'far_pickup', 'lng', pick.lng, 'lat', pick.lat);
    end if;
  end if;

  -- Get off whatever you're on now.
  perform public.settle_rental(uid);
  update public.player_vehicles set in_use = false, lng = p_lng, lat = p_lat where user_id = uid and in_use;

  if v.id is not null and not p_rent then
    -- A mechanic called to a breakdown: fixed (well enough) once they've been.
    if v.broken_at is not null and v.repair_ready_at is not null and now() >= v.repair_ready_at then
      update public.player_vehicles set broken_at = null, repair_ready_at = null, engine = greatest(engine, 40) where id = v.id returning * into v;
    end if;
    if v.broken_at is not null then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', case when v.repair_ready_at is not null then 'repairing' else 'broken' end,
        'readyAt', v.repair_ready_at);
    end if;
    if public.distance_m(p_lng, p_lat, v.lng, v.lat) > 30 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'far', 'lng', v.lng, 'lat', v.lat);
    end if;
    if v.kind <> 'bicycle' and v.fuel <= 0 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'fuel');
    end if;
    update public.player_vehicles set in_use = true where id = v.id;
    update public.player_positions set mode = p_kind where user_id = uid;
    return jsonb_build_object('ok', true, 'source', 'owned', 'fuel', v.fuel);
  end if;

  begin
    balance := public.apply_coin_change(uid, -public.rental_rate(p_kind), 'spend', 'Rented a ' || p_kind || ' (first minute)', null);
  exception when check_violation then
    update public.player_positions set mode = 'walk' where user_id = uid;
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  insert into public.vehicle_rentals (user_id, kind) values (uid, p_kind);
  update public.player_positions set mode = p_kind where user_id = uid;
  update public.vehicle_pickups set ended_at = now() where user_id = uid and ended_at is null;
  return jsonb_build_object('ok', true, 'source', 'rented', 'rate', public.rental_rate(p_kind), 'balance', balance);
end;
$$;

revoke execute on function public.pickup_json(public.vehicle_pickups) from public, anon, authenticated;
revoke execute on function public.request_pickup(text, double precision, double precision, text, jsonb, jsonb, text, double precision, double precision),
  public.my_pickup(), public.cancel_pickup(), public.board_taxi() from public, anon;
grant execute on function public.request_pickup(text, double precision, double precision, text, jsonb, jsonb, text, double precision, double precision),
  public.my_pickup(), public.cancel_pickup(), public.board_taxi() to authenticated;
