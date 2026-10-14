-- Further afield (owner's request, 14 Oct 2026): flights to anywhere in the
-- world (airports from OurAirports, scripts/add-world-airports.mts), long-distance
-- buses between motor parks, and the Lagos–Kano train (data only).

-- Airports are searched by city and country too.
alter table public.transit_stops add column city text, add column country text;

-- A long-distance bus (over 40 km, motor park to motor park) runs at 60 km/h on the highway.
create function public.transit_speed_for(p_mode text, p_metres double precision) returns double precision language sql immutable set search_path = '' as $$
  select case when p_mode = 'bus' and p_metres > public.bus_range_m() then 60 / 3.6 * 12 else public.transit_speed(p_mode) end;
$$;

-- Fares (match src/game/transit.ts): a long-distance bus is 20 + 0.4 coins per km.
create or replace function public.transit_fare(p_mode text, p_metres double precision) returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then case when p_metres > 40000 then 20 + ceil(p_metres / 1000 * 0.4) else 3 + ceil(p_metres / 1000) end
    when 'train' then 5 + ceil(p_metres / 2000)
    when 'plane' then 80 + ceil(p_metres / 1000 * 0.15)
  end::integer;
$$;

-- At the airport: anywhere on its grounds (abroad, an airport's position is the middle of the airfield).
create or replace function public.transit_reach_m(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'bus' then 40 when 'train' then 150 when 'plane' then 2000 end::double precision;
$$;

-- Airports anywhere, by name, city, country or code.
create function public.search_airports(p_query text, p_from bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (select * from public.transit_stops where id = p_from and kind = 'plane'),
  found as (
    select t.id, t.name, t.code, t.lng, t.lat, t.city, t.country,
           round(public.distance_m(f.lng, f.lat, t.lng, t.lat))::int as metres
      from public.transit_stops t, f
     where t.kind = 'plane' and t.id <> f.id and length(trim(p_query)) >= 2
       and (t.name ilike '%' || trim(p_query) || '%' or t.city ilike '%' || trim(p_query) || '%'
            or t.country ilike '%' || trim(p_query) || '%' or t.code = upper(trim(p_query)))
     order by (t.code = upper(trim(p_query))) desc, t.country, t.name
     limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'code', code, 'lng', lng, 'lat', lat, 'city', city, 'country', country, 'metres', metres,
    'fare', public.transit_fare('plane', metres),
    'seconds', round(public.transit_wait_s('plane', false) + metres / public.transit_speed('plane'))::int)), '[]'::jsonb)
  from found;
$$;

create or replace function public.stops_near(p_kind text, p_lng double precision, p_lat double precision, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb)
  from (
    select st.id, st.kind, st.name, st.lng, st.lat, st.line_id, st.code, st.park, st.city, st.country,
           l.name as line, round(public.distance_m(p_lng, p_lat, st.lng, st.lat))::int as metres
      from public.transit_stops st left join public.transit_lines l on l.id = st.line_id
     where st.kind = p_kind
       and (p_kind <> 'bus' or (st.lat between p_lat - 0.15 and p_lat + 0.15 and st.lng between p_lng - 0.15 and p_lng + 0.15))
     order by public.distance_m(p_lng, p_lat, st.lng, st.lat)
     limit greatest(1, least(p_limit, 20))
  ) s;
$$;

create or replace function public.transit_destinations(p_stop bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (select * from public.transit_stops where id = p_stop)
  select coalesce(jsonb_agg(d order by d.sort), '[]'::jsonb)
  from (
    select t.id, t.name, t.code, t.lng, t.lat, t.city, t.country,
           m.metres,
           public.transit_fare(f.kind, m.metres) as fare,
           round(public.transit_wait_s(f.kind, false) + m.metres / public.transit_speed(f.kind))::int as seconds,
           case when f.kind = 'train' then t.along_m else m.metres end as sort
      from f
      join public.transit_stops t
        on t.kind = f.kind and t.id <> f.id and f.kind in ('train', 'plane')
       and (f.kind <> 'train' or t.line_id = f.line_id)
       and (f.kind <> 'plane' or t.country is not distinct from f.country) -- flights abroad are searched for (search_airports)
      cross join lateral (
        select case when f.kind = 'train' then abs(t.along_m - f.along_m)
                    else public.distance_m(f.lng, f.lat, t.lng, t.lat) end as metres
      ) m
  ) d;
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

  wait := public.transit_wait_s(f.kind, p_fast_pass);
  insert into public.transit_trips (user_id, mode, line_id, from_name, to_name, to_lng, to_lat, path, path_m, fare, fast_pass, departs_at, arrives_at)
  values (uid, f.kind, f.line_id, f.name, t.name, t.lng, t.lat, p_path, metres, fare, p_fast_pass,
          now() + make_interval(secs => wait),
          now() + make_interval(secs => wait + metres / public.transit_speed_for(f.kind, metres)))
  returning * into trip;

  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
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

revoke execute on function public.search_airports(text, bigint) from public, anon;
grant execute on function public.search_airports(text, bigint) to authenticated;
