-- Where each player is on the map, saved while they travel. The server only
-- accepts moves that are possible at the travel mode's top speed, so nobody
-- can teleport.

create table public.player_positions (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  lng        double precision not null check (lng between -180 and 180),
  lat        double precision not null check (lat between -90 and 90),
  mode       text not null default 'walk' check (mode in ('walk', 'bicycle')),
  updated_at timestamptz not null default now()
);

alter table public.player_positions enable row level security;

create policy "Players read their own position"
  on public.player_positions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.player_positions from anon, authenticated;

-- Top on-screen speed in m/s: real speed x game speed 12 x sprint 1.6,
-- matching src/game/movement.ts (maxSpeed).
create function public.max_travel_speed(p_mode text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (case p_mode when 'bicycle' then 16.0 else 5.0 end) / 3.6 * 12 * 1.6;
$$;

create function public.save_position(p_lng double precision, p_lat double precision, p_mode text)
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

  moved_m := 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat - from_lat) / 2), 2)
    + cos(radians(from_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - from_lng) / 2), 2)
  ));
  -- 30% margin plus 30 m for timing jitter; the faster of the old and new mode.
  allowed_m := greatest(public.max_travel_speed(from_mode), public.max_travel_speed(p_mode))
               * extract(epoch from now() - since) * 1.3 + 30;

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

revoke execute on function public.save_position(double precision, double precision, text) from public, anon;
grant execute on function public.save_position(double precision, double precision, text) to authenticated;
