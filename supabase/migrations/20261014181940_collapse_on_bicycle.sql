-- Collapsing on a bicycle (owner's call, 14 Oct 2026): the ambulance still comes; a rented
-- bicycle is wrecked in the fall and stolen while the rider is in hospital, so they pay
-- for it (its price, or as much as they have); their own bicycle is damaged where it fell
-- and won't ride until a mechanic or vulcanizer has repaired it (a call-out: 30 coins for
-- a bicycle, 80 for a motorbike or car).

create function public.call_out_price(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 30 else 80 end;
$$;

create or replace function public.call_ambulance(p_hospital text, p_lng double precision, p_lat double precision, p_approach jsonb, p_route jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  spot public.places%rowtype;
  points integer;
  approach_m double precision;
  route_m double precision;
  picked timestamptz;
  arrives timestamptz;
  coins bigint;
  bill integer;
  h public.hospital_visits%rowtype;
  rented text;
  bike_price integer := 0;
  damaged text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hospital_visits where user_id = uid and left_at is null;
  if h.user_id is not null then
    return jsonb_build_object('ok', true, 'visit', public.visit_json(h));
  end if;
  select * into pos from public.player_positions where user_id = uid for update;
  if pos.fainted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_fainted');
  end if;

  -- A real hospital near the given spot and within 15 km, reached by the given ways.
  if p_route is not null then
    select * into spot from public.places
     where kind = 'hospital' and lat between p_lat - 0.002 and p_lat + 0.002 and lng between p_lng - 0.002 and p_lng + 0.002
       and public.distance_m(p_lng, p_lat, lng, lat) <= 60
     limit 1;
    points := case when jsonb_typeof(p_route) = 'array' then jsonb_array_length(p_route) else 0 end;
    if spot.id is null or public.distance_m(pos.lng, pos.lat, spot.lng, spot.lat) > 15000 or points < 2 or points > 5000
       or public.distance_m(pos.lng, pos.lat, (p_route -> 0 ->> 0)::double precision, (p_route -> 0 ->> 1)::double precision) > 150
       or public.distance_m(spot.lng, spot.lat, (p_route -> (points - 1) ->> 0)::double precision, (p_route -> (points - 1) ->> 1)::double precision) > 400 then
      return jsonb_build_object('ok', false, 'reason', 'route');
    end if;
    route_m := greatest(public.path_length_m(p_route), public.distance_m(pos.lng, pos.lat, spot.lng, spot.lat));
    points := case when jsonb_typeof(p_approach) = 'array' then jsonb_array_length(p_approach) else 0 end;
    approach_m := case when points >= 2 then public.path_length_m(p_approach) else 1500 end;
    -- The ambulance races at 60 km/h × the time scale: there in at least 10 s.
    picked := now() + make_interval(secs => greatest(10, approach_m / (60 / 3.6 * 12)));
    arrives := picked + make_interval(secs => 4 + route_m / (60 / 3.6 * 12));
  else
    picked := now() + interval '15 seconds';
    arrives := picked;
  end if;

  select profiles.coins into coins from public.profiles where id = uid;
  bill := least(50, coins)::integer;
  if bill > 0 then
    perform public.apply_coin_change(uid, -bill, 'spend', 'Hospital bill', null);
  end if;
  -- Off whatever they were riding. A rented bicycle is wrecked in the fall and stolen while
  -- they're away: the rental ends and they pay for the bike (as much as they have).
  -- Their own bicycle is damaged where it fell, and won't ride until it's repaired.
  select kind into rented from public.vehicle_rentals where user_id = uid and ended_at is null;
  perform public.settle_rental(uid);
  if rented is not null and pos.mode = rented then
    select least(public.vehicle_price(rented), profiles.coins)::integer into bike_price from public.profiles where id = uid;
    if bike_price > 0 then
      perform public.apply_coin_change(uid, -bike_price, 'spend', 'Paid for the rented ' || rented || ' (damaged in a fall, then stolen)', null);
    end if;
  end if;
  update public.player_vehicles
     set in_use = false, lng = pos.lng, lat = pos.lat,
         broken_at = case when kind = 'bicycle' then now() else broken_at end,
         repair_ready_at = case when kind = 'bicycle' then null else repair_ready_at end
   where user_id = uid and in_use
   returning kind into damaged;
  update public.player_positions set mode = 'walk' where user_id = uid;

  insert into public.hospital_visits (user_id, hospital, lng, lat, approach, route, bill, called_at, picked_at, arrives_at, discharged_at, left_at)
  values (uid, coalesce(spot.name, 'Paramedics'), coalesce(spot.lng, pos.lng), coalesce(spot.lat, pos.lat),
          case when p_route is not null then p_approach end, p_route, bill, now(), picked, arrives,
          arrives + case when p_route is not null then interval '45 seconds' else interval '30 seconds' end, null)
  on conflict (user_id) do update set
    hospital = excluded.hospital, lng = excluded.lng, lat = excluded.lat, approach = excluded.approach, route = excluded.route,
    bill = excluded.bill, called_at = excluded.called_at, picked_at = excluded.picked_at, arrives_at = excluded.arrives_at,
    discharged_at = excluded.discharged_at, left_at = null
  returning * into h;
  return jsonb_build_object('ok', true, 'visit', public.visit_json(h),
    'rentedLost', case when rented is not null and pos.mode = rented then jsonb_build_object('kind', rented, 'paid', bike_price) end,
    'damaged', damaged);
end;
$$;

-- (call_mechanic from 20261014164057_travel_restraints, priced by vehicle.)
create or replace function public.call_mechanic()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  pos public.player_positions%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and broken_at is not null and repair_ready_at is null
     and public.distance_m(pos.lng, pos.lat, lng, lat) <= 30
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

-- (start_vehicle from 20261014171326_vehicle_pickups_and_taxis: a repaired bicycle gets its tyres back.)
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
