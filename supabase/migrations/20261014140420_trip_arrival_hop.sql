-- After stepping off a bus, train or plane, the game moves the player onto the
-- nearest road; allow that hop (up to 500 m from the stop, within a minute).
-- (save_position from 20261014132852_public_transport, plus the hop.)
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
  -- a few hundred metres from the stop (an airport terminal, a station on the track).
  if exists (select 1 from public.transit_trips t
              where t.user_id = uid and t.outcome = 'arrived' and t.ended_at > now() - interval '60 seconds'
                and public.distance_m(t.to_lng, t.to_lat, p_lng, p_lat) <= 500) then
    allowed_m := greatest(allowed_m, 500);
  end if;

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
