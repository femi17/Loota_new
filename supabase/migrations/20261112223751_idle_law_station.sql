-- The idling law, taken to the police station (owner, 12 Nov 2026: "instead of them locked up in their current position.
-- They should be driving to the police station. That is where the lock up should happen. Also, the countdown timer should
-- not start but only for active users who are looking to resume, because if it starts and the user is not active, they
-- get locked up again and it becomes a loop").
--   * Caught (an hour still on a main road): the police take them, in a patrol car along the roads, to the nearest police
--     station (15 km at most; police stations come from OpenStreetMap as they're needed, kind 'police'); with none, a
--     roadside police post where they were. The cell is there; they're set down there (off the main road).
--   * The 30 minutes count only while the game is open and in front of them (each ask of the law says so: a heartbeat);
--     away, the clock waits. Out (served or bailed), the still clock starts again, at the station.
set lock_timeout = '8s';

alter table public.places drop constraint places_kind_check,
  add constraint places_kind_check check (kind = any (array['fuel', 'hospital', 'eat', 'rest', 'tyres', 'mechanic', 'police']));

-- Where police stations have been looked up (a 0.1° square, ~11 km), so OpenStreetMap is asked once.
create table public.police_lookups (
  cell text primary key,
  looked_at timestamptz not null default now(),
  found integer not null default 0
);
alter table public.police_lookups enable row level security;

alter table public.idle_arrests
  add column if not exists station text,
  add column if not exists station_lng double precision,
  add column if not exists station_lat double precision,
  add column if not exists route jsonb,
  add column if not exists taken_at timestamptz,
  add column if not exists arrives_at timestamptz,
  add column if not exists remaining_s integer not null default 1800,
  add column if not exists beat_at timestamptz,
  add column if not exists released_at timestamptz;

-- The arrests already made (in place): served ones end; an open one goes to the station with what was left of it.
update public.idle_arrests set released_at = until where released_at is null and bailed_at is null and until <= now();
update public.idle_arrests set remaining_s = greatest(60, ceil(extract(epoch from until - now())))::integer, at = now()
 where released_at is null and bailed_at is null and arrives_at is null;

-- In the cell (or on the way there): not bailed, not released.
create or replace function public.jailed(p_user uuid)
returns public.idle_arrests
language sql
stable
security definer
set search_path to ''
as $$
  select * from public.idle_arrests where user_id = p_user and bailed_at is null and released_at is null order by at desc limit 1
$$;

create or replace function public.arrest_json(a public.idle_arrests)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object('id', a.id, 'at', a.at, 'lng', a.lng, 'lat', a.lat, 'station', a.station, 'stationLng', a.station_lng,
    'stationLat', a.station_lat, 'route', a.route, 'takenAt', a.taken_at, 'arrivesAt', a.arrives_at, 'remaining', a.remaining_s,
    'bail', a.bail, 'vehicle', a.vehicle_kind, 'rentalEnded', a.rental_ended, 'minutes', a.still_minutes, 'now', now())
$$;

-- Taken to the station: the patrol car pulls up (8 s), then drives them there along the given road (60 km/h on the
-- game's clock, as the ambulance), to a police station near the given spot (15 km at most from where they were caught);
-- no station or no road: a roadside police post where they stand. They're set down at the station.
create or replace function public.take_to_station(p_station text, p_lng double precision, p_lat double precision, p_route jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  a public.idle_arrests%rowtype;
  spot public.places%rowtype;
  points integer;
  route_m double precision;
  taken timestamptz := now() + interval '8 seconds';
  arrives timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  a := public.jailed(uid);
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'free');
  end if;
  if a.arrives_at is not null then
    return jsonb_build_object('ok', true, 'arrest', public.arrest_json(a));
  end if;
  if p_route is not null then
    select * into spot from public.places
     where kind = 'police' and lat between p_lat - 0.002 and p_lat + 0.002 and lng between p_lng - 0.002 and p_lng + 0.002
       and public.distance_m(p_lng, p_lat, lng, lat) <= 60
     limit 1;
    points := case when jsonb_typeof(p_route) = 'array' then jsonb_array_length(p_route) else 0 end;
    if spot.id is null or public.distance_m(a.lng, a.lat, spot.lng, spot.lat) > 15000 or points < 2 or points > 5000
       or public.distance_m(a.lng, a.lat, (p_route -> 0 ->> 0)::double precision, (p_route -> 0 ->> 1)::double precision) > 150
       or public.distance_m(spot.lng, spot.lat, (p_route -> (points - 1) ->> 0)::double precision, (p_route -> (points - 1) ->> 1)::double precision) > 400 then
      return jsonb_build_object('ok', false, 'reason', 'route');
    end if;
    route_m := greatest(public.path_length_m(p_route), public.distance_m(a.lng, a.lat, spot.lng, spot.lat));
    arrives := taken + make_interval(secs => 4 + route_m / (60 / 3.6 * 12));
    update public.idle_arrests
       set station = spot.name, station_lng = spot.lng, station_lat = spot.lat, route = p_route, taken_at = taken, arrives_at = arrives
     where id = a.id returning * into a;
  else
    update public.idle_arrests
       set station = 'a roadside police post', station_lng = a.lng, station_lat = a.lat, route = null, taken_at = taken, arrives_at = taken
     where id = a.id returning * into a;
  end if;
  -- Set down at the station (off the main road); its still clock starts when they're out
  update public.player_positions
     set lng = a.station_lng, lat = a.station_lat, mode = 'walk', on_main_road = false, resting_since = null, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('ok', true, 'arrest', public.arrest_json(a));
end;
$$;

-- The law, asked by the game (every minute; every 10 s in the cell), with whether the game is in front of them now.
create or replace function public.idle_law(p_visible boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  p public.player_positions%rowtype;
  a public.idle_arrests%rowtype;
  mins double precision;
  v public.player_vehicles%rowtype;
  rented text;
  served double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  a := public.jailed(uid);
  if a.id is not null then
    if a.arrives_at is null then
      -- Not taken yet (the game finds the station and the road: take_to_station); never asked: the roadside post
      if a.at < now() - interval '3 minutes' then
        return public.take_to_station(null, null, null, null) || jsonb_build_object('state', 'jailed', 'impounded', public.impounded_list(uid));
      end if;
      return jsonb_build_object('state', 'taking', 'arrest', public.arrest_json(a), 'impounded', public.impounded_list(uid));
    end if;
    if now() >= a.arrives_at then
      -- Serving: only while they're here (asked within the last 90 s, the game in front of them)
      served := case when coalesce(p_visible, false) and a.beat_at is not null and now() - a.beat_at <= interval '90 seconds'
                     then extract(epoch from now() - greatest(a.beat_at, a.arrives_at)) else 0 end;
      update public.idle_arrests
         set remaining_s = greatest(0, remaining_s - floor(served)::integer),
             beat_at = case when coalesce(p_visible, false) then now() end
       where id = a.id returning * into a;
      if a.remaining_s <= 0 then
        update public.idle_arrests set released_at = now() where id = a.id;
        update public.player_positions set still_since = now(), on_main_road = false where user_id = uid;
        return jsonb_build_object('state', 'ok', 'released', true, 'station', a.station, 'impounded', public.impounded_list(uid));
      end if;
    end if;
    return jsonb_build_object('state', 'jailed', 'arrest', public.arrest_json(a), 'impounded', public.impounded_list(uid));
  end if;

  select * into p from public.player_positions where user_id = uid for update;
  if p.user_id is null then
    return jsonb_build_object('state', 'ok', 'impounded', public.impounded_list(uid));
  end if;
  mins := extract(epoch from now() - p.still_since) / 60;
  if not p.on_main_road or mins < 45 or public.idle_exempt(p) then
    return jsonb_build_object('state', 'ok', 'impounded', public.impounded_list(uid));
  end if;
  if mins < 60 then
    return jsonb_build_object('state', 'warn', 'minutes', floor(mins), 'left', ceil(60 - mins), 'impounded', public.impounded_list(uid));
  end if;

  -- An hour or more: arrested, the vehicle impounded (a rental back to its renter); the game takes them to the station
  select * into v from public.player_vehicles where user_id = uid and in_use for update;
  if v.id is not null then
    update public.player_vehicles set in_use = false, impounded_at = now() where id = v.id;
  end if;
  select kind into rented from public.vehicle_rentals where user_id = uid and ended_at is null;
  if rented is not null then
    perform public.settle_rental(uid);
  end if;
  insert into public.idle_arrests (user_id, lng, lat, still_minutes, until, bail, vehicle_id, vehicle_kind, rental_ended)
  values (uid, p.lng, p.lat, floor(mins), 'infinity', public.idle_bail(), v.id, v.kind, rented is not null)
  returning * into a;
  update public.player_positions set mode = 'walk', resting_since = null where user_id = uid;
  return jsonb_build_object('state', 'taking', 'arrested', true, 'arrest', public.arrest_json(a), 'impounded', public.impounded_list(uid));
end;
$$;

-- (The old call: as if the game is in front of them.)
create or replace function public.idle_law()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select public.idle_law(true)
$$;

-- Bail: out at once, at the station (off the main road; the still clock starts again).
create or replace function public.pay_bail()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  a public.idle_arrests%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  a := public.jailed(uid);
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'free');
  end if;
  if a.arrives_at is null or a.arrives_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'not_yet'); -- bail is paid at the station
  end if;
  begin
    balance := public.apply_coin_change(uid, -a.bail, 'spend', 'Bail (idling on a main road)', 'bail:' || a.id);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'bail', a.bail);
  end;
  update public.idle_arrests set bailed_at = now() where id = a.id;
  update public.player_positions set still_since = now(), on_main_road = false where user_id = uid;
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

-- The broadcast: the ride to the station and the cell there (the time left, and whether it's counting: they're playing).
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  i integer := position('''jails''' in f);
  j integer := position('''now'', now(),' in f);
  ev text := '''🚔 '' || pr.username || '' was locked up for idling on a main road'' || coalesce('': their '' || j.vehicle_kind || '' impounded'', '''')';
begin
  if i = 0 or j = 0 or j < i or position(ev in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  f := substr(f, 1, i - 1) || '''jails'', coalesce((
      select jsonb_agg(jsonb_build_object(''userId'', j.user_id, ''at'', j.at, ''lng'', j.lng, ''lat'', j.lat,
          ''station'', j.station, ''stationLng'', j.station_lng, ''stationLat'', j.station_lat,
          ''route'', case when jsonb_typeof(j.route) = ''array'' then (select jsonb_agg(pt.v order by pt.i) from jsonb_array_elements(j.route) with ordinality pt(v, i)
                  where (pt.i - 1) % greatest(1, ceil(jsonb_array_length(j.route) / 150.0)::int) = 0 or pt.i = jsonb_array_length(j.route)) end,
          ''takenAt'', j.taken_at, ''arrivesAt'', j.arrives_at, ''out'', coalesce(j.bailed_at, j.released_at), ''bailed'', j.bailed_at is not null,
          ''left'', greatest(0, j.remaining_s - case when j.beat_at > now() - interval ''90 seconds'' then extract(epoch from now() - greatest(j.beat_at, j.arrives_at)) else 0 end),
          ''serving'', j.beat_at > now() - interval ''90 seconds'', ''vehicle'', j.vehicle_kind))
        from public.idle_arrests j
        join public.hunt_players p on p.user_id = j.user_id and p.hunt_id = h.id
       where j.at > now() - interval ''1 day'' and coalesce(j.bailed_at, j.released_at, ''infinity'') > now() - interval ''1 minute''
         and not public.wonder_cloaked(j.user_id, h.id)), ''[]''::jsonb),
' || substr(f, j);
  f := replace(f, ev, '''🚔 '' || pr.username || '' was arrested for idling on a main road'' || coalesce('' and taken to '' || j.station, '''') || coalesce('': their '' || j.vehicle_kind || '' impounded'', '''')');
  execute f;
end $$;

revoke execute on function public.take_to_station(text, double precision, double precision, jsonb), public.idle_law(boolean) from public, anon;
grant execute on function public.take_to_station(text, double precision, double precision, jsonb), public.idle_law(boolean) to authenticated, service_role;
revoke execute on function public.arrest_json(public.idle_arrests) from public, anon, authenticated;
grant execute on function public.arrest_json(public.idle_arrests) to service_role;
