-- Ticket desks the server insists on (owner, 19 Oct 2026). A train's ticket is bought at the station's ticket office,
-- a flight checked in at the airport's desk: start_trip refuses either unless the player's saved position is at it.
-- Each desk is where the game draws it: the road nearest the station (within 140 m) or the airport (within 1.9 km)
-- that the hunter can reach (not a cut-off pocket such as an airfield's own roads), worked out from our road data
-- by scripts/compute-desks.mts and stored with the stop. Stops without one (abroad, beyond our road data) keep the
-- old rule: within reach of the stop.

alter table public.transit_stops add column if not exists desk_lng double precision, add column if not exists desk_lat double precision;

-- How far from the desk counts as at it (the game shows the button within 30 m).
create or replace function public.desk_reach_m() returns double precision language sql immutable set search_path = '' as $$ select 60::double precision $$;

create or replace function public.stops_near(p_kind text, p_lng double precision, p_lat double precision, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb)
  from (
    select st.id, st.kind, st.name, st.lng, st.lat, st.line_id, st.code, st.park, st.city, st.country, st.desk_lng, st.desk_lat,
           l.name as line, round(public.distance_m(p_lng, p_lat, st.lng, st.lat))::int as metres
      from public.transit_stops st left join public.transit_lines l on l.id = st.line_id
     where st.kind = p_kind
       and (p_kind <> 'bus' or (st.lat between p_lat - 0.15 and p_lat + 0.15 and st.lng between p_lng - 0.15 and p_lng + 0.15))
     order by public.distance_m(p_lng, p_lat, st.lng, st.lat)
     limit greatest(1, least(p_limit, 20))
  ) s;
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
  if pos.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if f.kind in ('train', 'plane') and f.desk_lng is not null then
    -- A train ticket is bought at the station's ticket office, a flight checked in at the airport's desk (that's
    -- the rule wherever the desk is known; it stands within the stop's reach, so it replaces the reach check).
    if public.distance_m(pos.lng, pos.lat, f.desk_lng, f.desk_lat) > public.desk_reach_m() then
      return jsonb_build_object('ok', false, 'reason', 'desk');
    end if;
  elsif public.distance_m(pos.lng, pos.lat, f.lng, f.lat) > public.transit_reach_m(f.kind) then
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
  insert into public.transit_trips (user_id, mode, line_id, from_name, to_name, to_lng, to_lat, path, path_m, fare, fast_pass, departs_at, arrives_at, rush, ride_s)
  values (uid, f.kind, f.line_id, f.name, t.name, t.lng, t.lat, p_path, metres, fare, p_fast_pass,
          now() + make_interval(secs => wait),
          now() + make_interval(secs => wait + metres / public.transit_speed_for(f.kind, metres)
                                     * case when f.kind = 'bus' and metres <= public.bus_range_m() then public.traffic_factor(f.lng, f.lat) else 1 end),
          -- A city bus at night or at rush hour is a scramble (bus_rush_start); a Fast Pass skips it.
          case when f.kind = 'bus' and metres <= public.bus_range_m() and not p_fast_pass and public.bus_rush_due(f.lng, f.lat) then 'pending' end,
          metres / public.transit_speed_for(f.kind, metres)
            * case when f.kind = 'bus' and metres <= public.bus_range_m() then public.traffic_factor(f.lng, f.lat) else 1 end)
  returning * into trip;

  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;

-- The stops you're at: within reach of the stop, or at its desk (a desk can stand further from the stop's point).
create or replace function public.transit_near(p_lng double precision, p_lat double precision)
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
      if (s ->> 'metres')::double precision <= public.transit_reach_m(kind)
         or (s ->> 'desk_lng' is not null
             and public.distance_m(p_lng, p_lat, (s ->> 'desk_lng')::double precision, (s ->> 'desk_lat')::double precision) <= public.desk_reach_m()) then
        here := here || jsonb_build_array(s);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('here', here, 'nearest', nearest);
end;
$$;
