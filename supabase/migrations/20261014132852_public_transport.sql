-- Public transport (design doc 5.5): buses, trains and planes carry the
-- player. Get to a stop, station or airport on your own, pay the fare, wait
-- (or check in and board), ride, and step off at the other end. The server
-- decides when you arrive; until then save_position refuses to move you.
--
-- Stops, lines and airports come from OpenStreetMap (scripts/build-transit.mts,
-- loaded by scripts/upload-transit.mts). Speeds use the game's time scale of
-- 12 (src/game/movement.ts), so they're in on-screen metres per second.

create table public.transit_lines (
  id       text primary key,
  name     text not null,
  colour   text not null,
  path     jsonb not null, -- [[lng, lat], ...] along the track
  length_m double precision not null
);

create table public.transit_stops (
  id      bigint generated always as identity primary key,
  kind    text not null check (kind in ('bus', 'train', 'plane')),
  name    text not null,
  lng     double precision not null,
  lat     double precision not null,
  line_id text references public.transit_lines (id) on delete cascade, -- trains: the line (one row per line at shared stations)
  along_m double precision,                                          -- trains: metres along the line
  code    text,                                                      -- planes: the airport code
  park    boolean not null default false                             -- buses: a motor park
);
create index transit_stops_kind_place on public.transit_stops (kind, lat, lng);

create table public.transit_trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  mode       text not null check (mode in ('bus', 'train', 'plane')),
  line_id    text,
  from_name  text not null,
  to_name    text not null,
  to_lng     double precision not null,
  to_lat     double precision not null,
  path       jsonb not null, -- the way the vehicle goes, for drawing the ride
  path_m     double precision not null,
  fare       integer not null,
  fast_pass  boolean not null default false,
  booked_at  timestamptz not null default now(),
  departs_at timestamptz not null,
  arrives_at timestamptz not null,
  ended_at   timestamptz,
  outcome    text check (outcome in ('arrived', 'cancelled'))
);
create unique index transit_trips_one_active on public.transit_trips (user_id) where ended_at is null;

alter table public.transit_lines enable row level security;
alter table public.transit_stops enable row level security;
alter table public.transit_trips enable row level security;
create policy "Anyone signed in reads the lines" on public.transit_lines for select to authenticated using (true);
create policy "Anyone signed in reads the stops" on public.transit_stops for select to authenticated using (true);
create policy "Players read their own trips" on public.transit_trips for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.transit_lines, public.transit_stops, public.transit_trips from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rules (match src/game/transit.ts).
-- ---------------------------------------------------------------------------

-- Average speed including stops, in on-screen metres per second (km/h ÷ 3.6 × 12).
create function public.transit_speed(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'bus' then 25 when 'train' then 70 when 'plane' then 750 end / 3.6 * 12;
$$;

-- Seconds before leaving: the wait for a bus or train (7 and 10 game minutes),
-- or check-in, boarding and taxiing for a plane (60 + 20 + 10). A Fast Pass
-- skips the wait or the check-in queue.
create function public.transit_wait_s(p_mode text, p_fast_pass boolean) returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then case when p_fast_pass then 0 else 35 end
    when 'train' then case when p_fast_pass then 0 else 50 end
    when 'plane' then case when p_fast_pass then 150 else 450 end
  end;
$$;

-- Fare in coins: a flat part plus a part per kilometre.
create function public.transit_fare(p_mode text, p_metres double precision) returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then 3 + ceil(p_metres / 1000)
    when 'train' then 5 + ceil(p_metres / 2000)
    when 'plane' then 80 + ceil(p_metres / 1000 * 0.15)
  end::integer;
$$;

-- How close counts as "at" the stop: at the bus stop, in the station, at the airport.
create function public.transit_reach_m(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'bus' then 40 when 'train' then 150 when 'plane' then 600 end::double precision;
$$;

-- Buses run within a city (motor-park to motor-park trips between cities come later).
create function public.bus_range_m() returns double precision language sql immutable set search_path = '' as $$ select 40000::double precision $$;

-- ---------------------------------------------------------------------------
-- Finding stops.
-- ---------------------------------------------------------------------------

-- The stops of one kind nearest a point, with their distance.
create function public.stops_near(p_kind text, p_lng double precision, p_lat double precision, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb)
  from (
    select st.id, st.kind, st.name, st.lng, st.lat, st.line_id, st.code, st.park,
           l.name as line, round(public.distance_m(p_lng, p_lat, st.lng, st.lat))::int as metres
      from public.transit_stops st left join public.transit_lines l on l.id = st.line_id
     where st.kind = p_kind
       -- Buses: a box of about 50 km first (there are many); trains and planes are few.
       and (p_kind <> 'bus' or (st.lat between p_lat - 0.45 and p_lat + 0.45 and st.lng between p_lng - 0.45 and p_lng + 0.45))
     order by public.distance_m(p_lng, p_lat, st.lng, st.lat)
     limit greatest(1, least(p_limit, 20))
  ) s;
$$;

-- For the player's screen: the stops they're at now, and the nearest of each kind.
create function public.transit_near(p_lng double precision, p_lat double precision)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  nearest jsonb := '{}'::jsonb;
  here jsonb := '[]'::jsonb;
  kind text;
  list jsonb;
  s jsonb;
begin
  foreach kind in array array['bus', 'train', 'plane'] loop
    list := public.stops_near(kind, p_lng, p_lat, case kind when 'train' then 6 else 3 end);
    if jsonb_array_length(list) > 0 then
      nearest := nearest || jsonb_build_object(kind, list -> 0);
    end if;
    for s in select value from jsonb_array_elements(list) loop
      if (s ->> 'metres')::double precision <= public.transit_reach_m(kind) then
        here := here || jsonb_build_array(s);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('here', here, 'nearest', nearest);
end;
$$;

-- Where you can go from a station or airport: the line's other stations, or
-- every other airport, with the fare and how long it takes (wait included).
create function public.transit_destinations(p_stop bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (select * from public.transit_stops where id = p_stop)
  select coalesce(jsonb_agg(d order by d.sort), '[]'::jsonb)
  from (
    select t.id, t.name, t.code, t.lng, t.lat,
           m.metres,
           public.transit_fare(f.kind, m.metres) as fare,
           round(public.transit_wait_s(f.kind, false) + m.metres / public.transit_speed(f.kind))::int as seconds,
           case when f.kind = 'train' then t.along_m else m.metres end as sort
      from f
      join public.transit_stops t
        on t.kind = f.kind and t.id <> f.id and f.kind in ('train', 'plane')
       and (f.kind <> 'train' or t.line_id = f.line_id)
      cross join lateral (
        select case when f.kind = 'train' then abs(t.along_m - f.along_m)
                    else public.distance_m(f.lng, f.lat, t.lng, t.lat) end as metres
      ) m
  ) d;
$$;

-- A path's length in metres ([[lng, lat], ...]).
create function public.path_length_m(p_path jsonb)
returns double precision language plpgsql immutable set search_path = '' as $$
declare
  total double precision := 0;
  i integer;
begin
  for i in 1 .. jsonb_array_length(p_path) - 1 loop
    total := total + public.distance_m(
      (p_path -> (i - 1) ->> 0)::double precision, (p_path -> (i - 1) ->> 1)::double precision,
      (p_path -> i ->> 0)::double precision, (p_path -> i ->> 1)::double precision);
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Taking a trip.
-- ---------------------------------------------------------------------------

-- Pay and board at stop p_from for stop p_to. p_path is the way the vehicle
-- goes (worked out by the game: roads for a bus, the track for a train, the
-- great circle for a plane); a bus is charged and timed by it, never by less
-- than the straight line. The player must be at p_from, on foot.
create function public.start_trip(p_from bigint, p_to bigint, p_path jsonb, p_fast_pass boolean default false)
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
  if f.kind = 'bus' and (straight > public.bus_range_m() or straight < 150) then
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

  wait := public.transit_wait_s(f.kind, p_fast_pass);
  insert into public.transit_trips (user_id, mode, line_id, from_name, to_name, to_lng, to_lat, path, path_m, fare, fast_pass, departs_at, arrives_at)
  values (uid, f.kind, f.line_id, f.name, t.name, t.lng, t.lat, p_path, metres, fare, p_fast_pass,
          now() + make_interval(secs => wait),
          now() + make_interval(secs => wait + metres / public.transit_speed(f.kind)))
  returning * into trip;

  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;

-- A trip as the game needs it (with the server's clock, so phones with a wrong clock still time it right).
create function public.trip_json(p public.transit_trips)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'mode', p.mode, 'line', p.line_id, 'from', p.from_name, 'to', p.to_name,
    'toLng', p.to_lng, 'toLat', p.to_lat, 'path', p.path, 'metres', round(p.path_m), 'fare', p.fare,
    'departsAt', p.departs_at, 'arrivesAt', p.arrives_at, 'now', now());
$$;

-- The trip the player is on, if any.
create function public.my_trip()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.trip_json(p) from public.transit_trips p where p.user_id = auth.uid() and p.ended_at is null;
$$;

-- Step off at the end: the player is put at the destination stop, on foot.
create function public.finish_trip()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.transit_trips%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into p from public.transit_trips where user_id = uid and ended_at is null for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_trip');
  end if;
  if now() < p.arrives_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'trip', public.trip_json(p));
  end if;
  update public.transit_trips set ended_at = now(), outcome = 'arrived' where id = p.id;
  insert into public.player_positions (user_id, lng, lat, mode, updated_at)
  values (uid, p.to_lng, p.to_lat, 'walk', now())
  on conflict (user_id) do update set lng = excluded.lng, lat = excluded.lat, mode = 'walk', updated_at = now();
  return jsonb_build_object('ok', true, 'lng', p.to_lng, 'lat', p.to_lat, 'name', p.to_name, 'mode', p.mode);
end;
$$;

-- Change your mind before it leaves: the fare comes back (a Fast Pass used doesn't).
create function public.cancel_trip()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.transit_trips%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into p from public.transit_trips where user_id = uid and ended_at is null for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_trip');
  end if;
  if now() >= p.departs_at then
    return jsonb_build_object('ok', false, 'reason', 'left');
  end if;
  update public.transit_trips set ended_at = now(), outcome = 'cancelled' where id = p.id;
  balance := public.apply_coin_change(uid, p.fare, 'refund', 'Refund: ' || p.mode || ' to ' || p.to_name, 'trip-refund:' || p.id);
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- No walking off a moving bus: positions can't be saved during a trip.
-- (save_position from 20261014100120_lockdown_orb, plus the trip check.)
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

revoke execute on function public.trip_json(public.transit_trips), public.path_length_m(jsonb) from public, anon, authenticated;
revoke execute on function public.stops_near(text, double precision, double precision, integer), public.transit_near(double precision, double precision),
  public.transit_destinations(bigint), public.start_trip(bigint, bigint, jsonb, boolean), public.my_trip(), public.finish_trip(), public.cancel_trip()
  from public, anon;
grant execute on function public.stops_near(text, double precision, double precision, integer), public.transit_near(double precision, double precision),
  public.transit_destinations(bigint), public.start_trip(bigint, bigint, jsonb, boolean), public.my_trip(), public.finish_trip(), public.cancel_trip()
  to authenticated;
