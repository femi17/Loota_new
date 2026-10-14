-- A player's first save (no position row yet) read energy as null, which counted
-- as 0: every new player fainted on their first move. They start with full energy.
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

  select lng, lat, mode, updated_at, energy, fainted_at, resting_since
    into from_lng, from_lat, from_mode, since, energy_was, fainted, resting
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
  -- the time not spent moving gives it back (fast while resting at a chill spot).
  secs := least(extract(epoch from now() - since), 3600);
  -- Time not accounted for by moving, even at the slowest fair pace (tired, in the rain: 45% of normal).
  idle_s := greatest(0, secs - moved_m / (public.base_speed(p_mode) * 0.45));
  sprinting := moved_m / greatest(secs, 0.5) > public.base_speed(p_mode) * 1.15;
  energy_now := least(100, greatest(0,
    energy_was - moved_m * public.energy_per_m(p_mode) * (case when sprinting then 2.5 else 1 end)
               + idle_s * (case when resting is not null then public.rest_regen() else public.idle_regen() end)));

  insert into public.player_positions (user_id, lng, lat, mode, updated_at, energy, fainted_at, resting_since)
  values (uid, p_lng, p_lat, p_mode, now(), energy_now,
          case when energy_now <= 0 and p_mode in ('walk', 'bicycle') then now() end, null)
  on conflict (user_id) do update
    set lng = excluded.lng, lat = excluded.lat, mode = excluded.mode, updated_at = excluded.updated_at,
        energy = excluded.energy, fainted_at = excluded.fainted_at,
        resting_since = case when moved_m < 5 then public.player_positions.resting_since end;

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
