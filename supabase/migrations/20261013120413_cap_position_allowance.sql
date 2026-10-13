-- Fix: the time allowed since the last saved position used to grow without
-- limit, so a player who stood still for an hour could jump ~100 km in one
-- move. Count at most 60 seconds; a moving player saves every few seconds.
-- (Tightened further in 20261013120447_tighten_position_allowance.sql.)
create or replace function public.save_position(p_lng double precision, p_lat double precision, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  from_lng double precision;
  from_lat double precision;
  from_mode text;
  since timestamptz;
  allowed_m double precision;
  moved_m double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_mode not in ('walk', 'bicycle') then
    raise exception 'Unknown travel mode';
  end if;
  if p_lng not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Invalid location';
  end if;

  select lng, lat, mode, updated_at into from_lng, from_lat, from_mode, since
    from public.player_positions where user_id = uid for update;
  if not found then
    -- First move: measured from home.
    select home_lng, home_lat, 'walk', coalesce(home_set_at, now()) into from_lng, from_lat, from_mode, since
      from public.profiles where id = uid;
    if from_lng is null then
      raise exception 'Set your home first';
    end if;
  end if;

  moved_m := public.distance_m(from_lng, from_lat, p_lng, p_lat);
  -- 30% margin plus 30 m for timing jitter; the faster of the old and new mode;
  -- at most 60 seconds of travel since the last save.
  allowed_m := greatest(public.max_travel_speed(from_mode), public.max_travel_speed(p_mode))
               * least(extract(epoch from now() - since), 60) * 1.3 + 30;

  if moved_m > allowed_m then
    -- Too fast to be real: keep the last valid position.
    return jsonb_build_object('ok', false, 'lng', from_lng, 'lat', from_lat);
  end if;

  insert into public.player_positions (user_id, lng, lat, mode, updated_at)
  values (uid, p_lng, p_lat, p_mode, now())
  on conflict (user_id) do update
    set lng = excluded.lng, lat = excluded.lat, mode = excluded.mode, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat);
end;
$$;
