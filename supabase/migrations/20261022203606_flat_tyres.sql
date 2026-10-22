-- Flat tyres for motorbikes and cars (owner, 22 Oct 2026: "Yes, fix with a jack"). Now and then (about one in 100 km)
-- a tyre goes flat on the road: the vehicle stops at the roadside where it happened (stranded_at, like an empty tank)
-- and the player is on foot beside it. Change it yourself with a jack (gear, bought once, like a helmet) or have a
-- roadside mechanic do it (40 coins); a short wait either way, then back on it. Until then it can't be ridden; a
-- jerry can still fills its tank but doesn't put you back on it.

alter table public.player_vehicles
  add column if not exists jack boolean not null default false,
  add column if not exists flat_fix_how text check (flat_fix_how in ('jack', 'mechanic')),
  add column if not exists flat_fix_ready_at timestamptz;

create or replace function public.puncture_per_km() returns double precision language sql immutable set search_path = '' as $$ select 0.01::double precision $$;
create or replace function public.flat_fix_price() returns integer language sql immutable set search_path = '' as $$ select 40 $$;
create or replace function public.flat_fix_seconds(p_how text) returns integer language sql immutable set search_path = '' as $$
  select case p_how when 'jack' then 30 else 25 end
$$;

create or replace function public.addon_price(p_addon text, p_kind text)
returns integer language sql immutable set search_path = '' as $$
  select case p_addon
    when 'light' then 40
    when 'helmet' then 80
    when 'rider_licence' then 150
    when 'driver_licence' then 300
    when 'registration' then case p_kind when 'car' then 400 else 200 end
    when 'insurance' then 250
    when 'jack' then 120
  end;
$$;

create or replace function public.buy_addon(p_addon text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  have boolean;
  price integer;
  balance bigint;
  label text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not ((p_addon = 'light' and p_kind = 'bicycle') or (p_addon = 'helmet' and p_kind = 'motorbike')
          or (p_addon = 'registration' and p_kind in ('motorbike', 'car')) or (p_addon = 'insurance' and p_kind = 'car')
          or (p_addon = 'rider_licence' and p_kind = 'motorbike') or (p_addon = 'driver_licence' and p_kind = 'car')
          or (p_addon = 'jack' and p_kind in ('motorbike', 'car'))) then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if p_addon in ('rider_licence', 'driver_licence') then
    select case p_addon when 'rider_licence' then rider_licence else driver_licence end into have from public.profiles where id = uid;
  else
    select * into v from public.player_vehicles where user_id = uid and kind = p_kind for update;
    if v.id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
    have := case p_addon when 'light' then v.light when 'helmet' then v.helmet when 'registration' then v.registered
                         when 'jack' then v.jack else v.insured end;
  end if;
  if have then
    return jsonb_build_object('ok', false, 'reason', 'have');
  end if;
  price := public.addon_price(p_addon, p_kind);
  label := case p_addon
    when 'light' then 'A bicycle light'
    when 'helmet' then 'A helmet'
    when 'rider_licence' then 'A rider''s licence'
    when 'driver_licence' then 'A driver''s licence'
    when 'registration' then 'Registration for your ' || p_kind
    when 'jack' then 'A jack and spare tyre for your ' || p_kind
    else 'Insurance for your car' end;
  begin
    balance := public.apply_coin_change(uid, -price, 'spend', label, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', price);
  end;
  if p_addon = 'rider_licence' then
    update public.profiles set rider_licence = true where id = uid;
  elsif p_addon = 'driver_licence' then
    update public.profiles set driver_licence = true where id = uid;
  else
    update public.player_vehicles set
      light = light or p_addon = 'light',
      helmet = helmet or p_addon = 'helmet',
      registered = registered or p_addon = 'registration',
      insured = insured or p_addon = 'insurance',
      jack = jack or p_addon = 'jack'
     where id = v.id;
  end if;
  return jsonb_build_object('ok', true, 'price', price, 'balance', balance);
end;
$$;

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
  hopped boolean := false; -- set down by a plane, the whirlwind or the Carpet: the step onto a road is free
  allow_was double precision;
  speed double precision;
  budget_m double precision;
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

  select lng, lat, mode, updated_at, energy, fainted_at, resting_since, rest_rate, allow_m
    into from_lng, from_lat, from_mode, since, energy_was, fainted, resting, rest_rate_was, allow_was
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
  -- A distance allowance that builds up at 1.3 times the top speed (the faster of the old and new mode), up to
  -- max_seconds of it, and is spent by moving. Unspent allowance carries over: a save that reached the server late
  -- (a slow phone connection) leaves the next one with less server time but the leftover of its own, so riding at top
  -- speed is never refused, while going faster on average still is. Plus 30 m for jitter.
  speed := greatest(public.max_travel_speed(from_mode), public.max_travel_speed(p_mode));
  budget_m := least(speed * max_seconds * 1.3,
                    coalesce(allow_was, 0) + speed * greatest(0, extract(epoch from now() - since)) * 1.3);
  allowed_m := budget_m + 30;

  -- Just off a bus, train or plane: the game puts you on the nearest road, which can be
  -- a few hundred metres from the stop (a station on the track), or a few km from an
  -- airport abroad (placed at the middle of the airfield).
  if exists (select 1 from public.transit_trips t
              where t.user_id = uid and t.outcome = 'arrived' and t.ended_at > now() - interval '60 seconds'
                and public.distance_m(t.to_lng, t.to_lat, p_lng, p_lat) <= case when t.mode = 'plane' then 3000 else 500 end) then
    allowed_m := greatest(allowed_m, 3000);
    hopped := true;
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
    energy_was - (case when hopped then 0 else moved_m end) * public.energy_per_m(p_mode) * (case when sprinting then 2.5 else 1 end)
               + idle_s * (case when resting is not null then coalesce(rest_rate_was, public.rest_regen()) else public.idle_regen() end)));

  insert into public.player_positions (user_id, lng, lat, mode, updated_at, energy, fainted_at, resting_since, allow_m)
  values (uid, p_lng, p_lat, p_mode, now(), energy_now,
          case when energy_now <= 0 and p_mode in ('walk', 'bicycle') then now() end, null,
          greatest(0, budget_m - moved_m))
  on conflict (user_id) do update
    set lng = excluded.lng, lat = excluded.lat, mode = excluded.mode, updated_at = excluded.updated_at,
        energy = excluded.energy, fainted_at = excluded.fainted_at, allow_m = excluded.allow_m,
        resting_since = case when moved_m < 5 then public.player_positions.resting_since end,
        rest_rate = case when moved_m < 5 then public.player_positions.rest_rate end;

  -- Owned vehicles go where the player goes: motor vehicles use fuel and wear their engines, and now and then a
  -- tyre goes flat; bicycles' tyres lose air; a worn-out engine may break down.
  update public.player_vehicles
     set lng = p_lng, lat = p_lat,
         fuel = greatest(0, fuel - moved_m / 1000 * public.fuel_per_km(kind)),
         tyre = case when kind = 'bicycle' then greatest(0, tyre - moved_m / 1000 * public.tyre_per_km())
                     when tyre > 0 and random() < moved_m / 1000 * public.puncture_per_km() then 0
                     else tyre end,
         engine = case when kind <> 'bicycle' then greatest(0, engine - moved_m / 1000 * public.engine_per_km()) else engine end,
         broken_at = case when kind <> 'bicycle' and broken_at is null and engine < 15
                           and random() < moved_m / 1000 * 0.1 then now() else broken_at end
   where user_id = uid and in_use
   returning * into v;
  fuel_left := v.fuel;
  -- An empty tank, a flat or a breakdown stops a motorbike or car where it is: the player gets off. Out of fuel or
  -- with a flat, it stays parked at the roadside there (stranded) until it's seen to (pour_keg, finish_flat_fix); a
  -- breakdown goes into the pocket for a repair shop or a mechanic.
  if v.id is not null and v.kind <> 'bicycle' and (v.fuel <= 0 or v.broken_at is not null or v.tyre <= 0) then
    update public.player_vehicles
       set in_use = false, stranded_at = case when v.broken_at is null then now() end
     where id = v.id;
    update public.player_positions set mode = 'walk' where user_id = uid;
    stopped := case when v.broken_at is not null then 'broken' when v.tyre <= 0 then 'flat' else 'fuel' end;
  end if;

  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'fuel', fuel_left, 'tyre', v.tyre, 'engine', v.engine,
    'energy', round(energy_now::numeric, 1), 'fainted', energy_now <= 0 and p_mode in ('walk', 'bicycle'), 'stopped', stopped);
end;
$$;

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
    -- A flat at the roadside: change it there first (start_flat_fix).
    if v.kind <> 'bicycle' and v.tyre <= 0 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'flat', 'lng', v.lng, 'lat', v.lat, 'jack', v.jack);
    end if;
    if v.stranded_at is not null then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'stranded', 'lng', v.lng, 'lat', v.lat);
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

create or replace function public.pour_keg()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.player_kegs%rowtype;
  v public.player_vehicles%rowtype;
  pos public.player_positions%rowtype;
  far public.player_vehicles%rowtype;
  added double precision;
  was_stranded boolean;
  remount boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into k from public.player_kegs where user_id = uid and uses_left > 0 for update;
  if k.user_id is null or k.fuel <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and in_use and fuel < public.keg_capacity() for update;
  if v.id is null then
    select * into v from public.player_vehicles
     where user_id = uid and kind in ('motorbike', 'car') and stranded_at is not null
       and public.distance_m(lng, lat, pos.lng, pos.lat) <= 30
     order by fuel limit 1 for update;
  end if;
  if v.id is null then
    select * into v from public.player_vehicles
     where user_id = uid and kind in ('motorbike', 'car') and not in_use and stranded_at is null
       and broken_at is null and fuel < public.keg_capacity()
     order by fuel limit 1 for update;
  end if;
  if v.id is null then
    select * into far from public.player_vehicles where user_id = uid and stranded_at is not null limit 1;
    if far.id is not null then
      return jsonb_build_object('ok', false, 'reason', 'far', 'kind', far.kind, 'lng', far.lng, 'lat', far.lat);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  was_stranded := v.stranded_at is not null;
  remount := was_stranded and v.tyre > 0; -- with a flat it stays at the roadside until the tyre is changed
  added := least(k.fuel, public.keg_capacity() - v.fuel);
  update public.player_vehicles set fuel = fuel + added where id = v.id returning fuel into v.fuel;
  update public.player_kegs set fuel = greatest(0, fuel - added), uses_left = uses_left - 1 where user_id = uid
  returning uses_left, fuel into k.uses_left, k.fuel;
  -- At a vehicle parked at the roadside: back on it.
  if remount then
    perform public.settle_rental(uid);
    update public.player_vehicles set in_use = false where user_id = uid and in_use;
    update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
    update public.player_positions set mode = v.kind where user_id = uid;
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'fuel', v.fuel, 'kegFuel', k.fuel, 'usesLeft', k.uses_left,
    'spoilt', k.uses_left = 0, 'remounted', remount, 'flat', was_stranded and not remount);
end;
$$;

create or replace function public.use_relic(p_relic uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.player_relics%rowtype;
  pos public.player_positions%rowtype;
  fuel_now double precision;
  valid_until timestamptz;
  raised jsonb;
  v public.player_vehicles%rowtype;
  remounted boolean := false;
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
    -- A full jerry can (owner, 19 Oct 2026: "I had a jerry can and was still made to buy one"): into the motorbike or
    -- car being ridden, or one standing at the roadside out of fuel within 30 m (then back on it, unless it has a
    -- flat); a tank to 65% at most.
    select * into pos from public.player_positions where user_id = uid;
    select * into v from public.player_vehicles where user_id = uid and kind in ('motorbike', 'car') and in_use for update;
    if v.id is null and pos.user_id is not null then
      select * into v from public.player_vehicles
       where user_id = uid and stranded_at is not null and public.distance_m(lng, lat, pos.lng, pos.lat) <= 30
       limit 1 for update;
    end if;
    if v.id is null then
      select * into v from public.player_vehicles where user_id = uid and stranded_at is not null limit 1;
      if v.id is not null then
        return jsonb_build_object('ok', false, 'reason', 'far', 'kind', v.kind, 'lng', v.lng, 'lat', v.lat);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
    if v.fuel >= public.keg_capacity() then
      return jsonb_build_object('ok', false, 'reason', 'full');
    end if;
    update public.player_vehicles set fuel = public.keg_capacity() where id = v.id returning fuel into fuel_now;
    if v.stranded_at is not null and v.tyre > 0 then
      perform public.settle_rental(uid);
      update public.player_vehicles set in_use = false where user_id = uid and in_use;
      update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
      update public.player_positions set mode = v.kind where user_id = uid;
      remounted := true;
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
    'fuel', fuel_now, 'until', valid_until, 'kind', v.kind, 'remounted', remounted);
end;
$$;

-- Start changing a flat by the roadside: with your jack (free) or a roadside mechanic (paid when done). Beside the
-- vehicle (30 m), a short wait (flat_fix_seconds), then finish_flat_fix.
create or replace function public.start_flat_fix(p_how text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
  secs integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_how not in ('jack', 'mechanic') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and tyre <= 0 and stranded_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_flat');
  end if;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, v.lng, v.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far', 'lng', v.lng, 'lat', v.lat);
  end if;
  if p_how = 'jack' and not v.jack then
    return jsonb_build_object('ok', false, 'reason', 'no_jack');
  end if;
  if p_how = 'mechanic' and (select coins from public.profiles where id = uid) < public.flat_fix_price() then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', public.flat_fix_price());
  end if;
  secs := public.flat_fix_seconds(p_how);
  update public.player_vehicles set flat_fix_how = p_how, flat_fix_ready_at = now() + make_interval(secs => secs) where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'how', p_how, 'seconds', secs,
    'price', case when p_how = 'mechanic' then public.flat_fix_price() else 0 end, 'readyAt', now() + make_interval(secs => secs), 'now', now());
end;
$$;

-- The tyre changed: paid for (a mechanic), full tyre, and back on the vehicle (if it has fuel; otherwise it waits at
-- the roadside for a jerry can).
create or replace function public.finish_flat_fix()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
  balance bigint;
  price integer := 0;
  remount boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and flat_fix_ready_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if now() < v.flat_fix_ready_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'readyAt', v.flat_fix_ready_at);
  end if;
  if v.flat_fix_how = 'mechanic' then
    price := public.flat_fix_price();
    begin
      balance := public.apply_coin_change(uid, -price, 'spend', 'A roadside mechanic changed your ' || v.kind || '''s tyre', null);
    exception when check_violation then
      update public.player_vehicles set flat_fix_how = null, flat_fix_ready_at = null where id = v.id;
      return jsonb_build_object('ok', false, 'reason', 'coins', 'price', price);
    end;
  end if;
  select * into pos from public.player_positions where user_id = uid;
  remount := v.fuel > 0;
  update public.player_vehicles set tyre = 100, flat_fix_how = null, flat_fix_ready_at = null where id = v.id;
  if remount then
    perform public.settle_rental(uid);
    update public.player_vehicles set in_use = false where user_id = uid and in_use;
    update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
    update public.player_positions set mode = v.kind where user_id = uid;
  end if;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'how', v.flat_fix_how, 'price', price, 'balance', balance,
    'remounted', remount, 'fuel', v.fuel);
end;
$$;

revoke execute on function public.start_flat_fix(text), public.finish_flat_fix() from public, anon;
grant execute on function public.start_flat_fix(text), public.finish_flat_fix() to authenticated;
