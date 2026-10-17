-- The pocket garage (owner, 17 Oct 2026): a bought bicycle, motorbike or car goes everywhere with its owner,
-- "like a gadget in your pocket" (Ready Player One). Off it, it shrinks into the pocket; it can be taken out
-- anywhere in the world. Nothing is parked any more: a petrol station fills a pocketed tank, a vulcanizer pumps
-- pocketed tyres, a mechanic services one or comes to a breakdown wherever the owner is, and a keg pours in
-- anywhere. Boarding a bus, train or plane, or a taxi, pockets the vehicle being ridden (a rental must still
-- be returned first). player_vehicles.lng/lat now just follow the owner.

-- Put away the owned vehicle being ridden (not a rental): the player is on foot.
create or replace function public.pocket_vehicle(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.vehicle_rentals where user_id = p_uid and ended_at is null) then
    return;
  end if;
  if exists (select 1 from public.player_vehicles where user_id = p_uid and in_use) then
    update public.player_vehicles set in_use = false where user_id = p_uid and in_use;
    update public.player_positions set mode = 'walk' where user_id = p_uid;
  end if;
end;
$$;
revoke execute on function public.pocket_vehicle(uuid) from public, anon, authenticated;

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
      update public.player_vehicles
         set broken_at = null, repair_ready_at = null,
             engine = case when kind = 'bicycle' then engine else greatest(engine, 40) end,
             tyre = case when kind = 'bicycle' then 100 else tyre end
       where id = v.id returning * into v;
    end if;
    if v.broken_at is not null then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', case when v.repair_ready_at is not null then 'repairing' else 'broken' end,
        'readyAt', v.repair_ready_at);
    end if;
    if v.kind <> 'bicycle' and v.fuel <= 0 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'fuel');
    end if;
    -- Out of the pocket, wherever the player is.
    update public.player_vehicles set in_use = true, lng = p_lng, lat = p_lat where id = v.id;
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

create or replace function public.refuel()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  litres integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  -- One that needs it: the motorbike or car being ridden first, else the emptiest in the pocket (filled there).
  select * into v from public.player_vehicles where user_id = uid and kind in ('motorbike', 'car')
   order by fuel < 99 desc, in_use desc, fuel limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  select least(floor(100 - v.fuel)::integer, floor(coins / 2)::integer) into litres from public.profiles where id = uid;
  if litres <= 0 then
    return jsonb_build_object('ok', false, 'reason', case when v.fuel >= 99 then 'full' else 'coins' end);
  end if;
  balance := public.apply_coin_change(uid, -2 * litres, 'spend', 'Fuel for your ' || v.kind, null);
  update public.player_vehicles set fuel = least(100, fuel + litres) where id = v.id returning fuel into v.fuel;
  return jsonb_build_object('ok', true, 'fuel', v.fuel, 'cost', 2 * litres, 'balance', balance);
end;
$$;

create or replace function public.pour_keg()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.player_kegs%rowtype;
  v public.player_vehicles%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into k from public.player_kegs where user_id = uid and uses_left > 0 for update;
  if k.user_id is null or k.fuel <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  -- Anywhere: into the motorbike or car being ridden, else the emptiest one in the pocket.
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and fuel < 100
   order by in_use desc, fuel limit 1 for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  update public.player_vehicles set fuel = least(100, fuel + k.fuel) where id = v.id returning fuel into v.fuel;
  update public.player_kegs set fuel = 0, uses_left = uses_left - 1 where user_id = uid returning uses_left into k.uses_left;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'fuel', v.fuel, 'usesLeft', k.uses_left, 'spoilt', k.uses_left = 0);
end;
$$;

create or replace function public.pump_tyres()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  cost integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel', 'tyres'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into v from public.player_vehicles where user_id = uid and kind = 'bicycle' for update; -- ridden or in the pocket
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  if v.tyre >= 95 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  cost := case when v.tyre <= 0 then 20 else 5 end;
  begin
    balance := public.apply_coin_change(uid, -cost, 'spend', case when cost = 20 then 'Fixed a flat tyre' else 'Pumped tyres' end, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'cost', cost);
  end;
  update public.player_vehicles set tyre = 100 where id = v.id;
  return jsonb_build_object('ok', true, 'cost', cost, 'balance', balance);
end;
$$;

create or replace function public.service_vehicle()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['mechanic'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  -- One that needs it: the one being ridden first, else the most worn in the pocket.
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car')
   order by (engine < 90 or broken_at is not null) desc, in_use desc, engine limit 1 for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  begin
    balance := public.apply_coin_change(uid, -60, 'spend', 'Serviced your ' || v.kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  update public.player_vehicles set engine = 100, broken_at = null, repair_ready_at = null where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'balance', balance);
end;
$$;

create or replace function public.call_mechanic()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  -- The mechanic comes to the player, wherever they are (the vehicle is in their pocket).
  select * into v from public.player_vehicles
   where user_id = uid and broken_at is not null and repair_ready_at is null
   limit 1 for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  begin
    balance := public.apply_coin_change(uid, -public.call_out_price(v.kind), 'spend', 'Mechanic call-out for your ' || v.kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  update public.player_vehicles set repair_ready_at = now() + interval '45 seconds' where id = v.id returning repair_ready_at into v.repair_ready_at;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'cost', public.call_out_price(v.kind), 'readyAt', v.repair_ready_at, 'now', now(), 'balance', balance);
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

  -- A rental must be returned first; your own vehicle goes into your pocket (below, once it's certain).
  if exists (select 1 from public.vehicle_rentals where user_id = uid and ended_at is null) then
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

  perform public.pocket_vehicle(uid);
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
  -- A rental must be returned first; your own vehicle goes into your pocket (below, once it's certain).
  if exists (select 1 from public.vehicle_rentals where user_id = uid and ended_at is null) then
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

  perform public.pocket_vehicle(uid);
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
  -- A rental must be returned first; your own vehicle goes into your pocket (below, once it's certain).
  if exists (select 1 from public.vehicle_rentals where user_id = uid and ended_at is null) then
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
  perform public.pocket_vehicle(uid);
  insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at)
  values (uid, 'taxi', pick.name, pick.to_name, pick.to_lng, pick.to_lat, pick.trip_path, pick.trip_m, pick.fare,
          now(), now() + make_interval(secs => pick.trip_m / public.transit_speed('taxi') * public.traffic_factor(pick.lng, pick.lat)))
  returning * into trip;
  update public.vehicle_pickups set ended_at = now() where user_id = uid;
  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;
