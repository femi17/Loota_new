-- Travel has limits (owner's call, 14 Oct 2026; design doc 5.3 and 5.6).
--  * Energy is kept here, not just on the player's phone: walking and cycling
--    use it by the metre, rest gives it back (slowly anywhere, fast at a chill
--    spot: a park or a place to eat), and a meal adds 40. At 0 the player
--    faints: an ambulance takes them to the nearest hospital, where they're
--    treated and billed before they can go on.
--  * Bicycle tyres lose air as they ride: pump them at a petrol station or a
--    vulcanizer (a flat costs more to fix).
--  * Motorbikes and cars use fuel and wear their engines. An empty tank stops
--    the vehicle where it is: the player fetches fuel in a keg from a petrol
--    station (buying a keg if they have none; a keg lasts 50 pours). A worn
--    engine may break down: call a mechanic, or service it at a garage.
-- Places come from OpenStreetMap (scripts/build-places.mts, scripts/upload-places.mts).

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------
create table public.places (
  id   bigint generated always as identity primary key,
  kind text not null check (kind in ('fuel', 'hospital', 'eat', 'rest', 'tyres', 'mechanic')),
  name text not null,
  lng  double precision not null,
  lat  double precision not null
);
create index places_kind_place on public.places (kind, lat, lng);
alter table public.places enable row level security;
create policy "Anyone signed in reads places" on public.places for select to authenticated using (true);
revoke insert, update, delete on public.places from anon, authenticated;

-- The nearest places of some kinds to a point (within about 30 km), with their distance.
create function public.places_near(p_kinds text[], p_lng double precision, p_lat double precision, p_limit integer default 3)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb)
  from (
    select p.id, p.kind, p.name, p.lng, p.lat, round(public.distance_m(p_lng, p_lat, p.lng, p.lat))::int as metres
      from public.places p
     where p.kind = any (p_kinds)
       and p.lat between p_lat - 0.3 and p_lat + 0.3 and p.lng between p_lng - 0.3 and p_lng + 0.3
     order by public.distance_m(p_lng, p_lat, p.lng, p.lat)
     limit greatest(1, least(p_limit, 20))
  ) s;
$$;

-- Server only: the place of one of these kinds the player is at (by where the server last saw them), if any.
create function public.place_at(p_kinds text[], p_uid uuid, p_within double precision)
returns public.places language sql stable security definer set search_path = '' as $$
  select p.* from public.places p, public.player_positions pos
   where pos.user_id = p_uid and p.kind = any (p_kinds)
     and p.lat between pos.lat - 0.01 and pos.lat + 0.01 and p.lng between pos.lng - 0.01 and pos.lng + 0.01
     and public.distance_m(pos.lng, pos.lat, p.lng, p.lat) <= p_within
   order by public.distance_m(pos.lng, pos.lat, p.lng, p.lat) limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The player's condition, their vehicles' wear, kegs, hospital visits
-- ---------------------------------------------------------------------------
alter table public.player_positions
  add column energy double precision not null default 100,
  add column fainted_at timestamptz,
  add column resting_since timestamptz;

alter table public.player_vehicles
  add column tyre double precision not null default 100,   -- bicycles: air in the tyres (0 = flat)
  add column engine double precision not null default 100, -- motorbikes and cars: engine condition
  add column broken_at timestamptz,                        -- broke down here; a mechanic is needed
  add column repair_ready_at timestamptz;                  -- the mechanic called will have fixed it by then

create table public.player_kegs (
  user_id   uuid primary key references public.profiles (id) on delete cascade, -- one keg at a time
  uses_left integer not null default 50 check (uses_left >= 0), -- 0: spoilt (a new one must be bought)
  fuel      double precision not null default 0,   -- % of a tank it holds now
  bought_at timestamptz not null default now()
);
alter table public.player_kegs enable row level security;
create policy "Players read their own keg" on public.player_kegs for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.player_kegs from anon, authenticated;

create table public.hospital_visits (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  hospital      text not null,
  lng           double precision not null,   -- where they're treated (and leave from)
  lat           double precision not null,
  approach      jsonb,                       -- the ambulance's way to the player ([[lng, lat], ...]); null: paramedics on foot
  route         jsonb,                       -- and on to the hospital; null: treated where they fell
  bill          integer not null,
  called_at     timestamptz not null default now(),
  picked_at     timestamptz not null,        -- the ambulance reaches them
  arrives_at    timestamptz not null,        -- at the hospital
  discharged_at timestamptz not null,        -- free to go
  left_at       timestamptz                  -- walked out (the visit is over)
);
alter table public.hospital_visits enable row level security;
create policy "Players read their own hospital visit" on public.hospital_visits for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.hospital_visits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rules (match src/game/condition.ts). Speeds are on-screen metres per second (km/h ÷ 3.6 × 12).
-- ---------------------------------------------------------------------------
create function public.base_speed(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'bicycle' then 16 when 'motorbike' then 35 when 'car' then 45 else 5 end / 3.6 * 12;
$$;
-- Energy per metre at a normal pace: walking 0.35 a second, cycling 0.5 a second; riding a motor vehicle, none.
create function public.energy_per_m(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'walk' then 0.35 when 'bicycle' then 0.5 else 0 end / public.base_speed(p_mode);
$$;
create function public.idle_regen() returns double precision language sql immutable set search_path = '' as $$ select 0.25::double precision $$;
create function public.rest_regen() returns double precision language sql immutable set search_path = '' as $$ select 2::double precision $$;
-- A bicycle's tyres go flat over 40 km; an engine wears out over 400 km.
create function public.tyre_per_km() returns double precision language sql immutable set search_path = '' as $$ select 2.5::double precision $$;
create function public.engine_per_km() returns double precision language sql immutable set search_path = '' as $$ select 0.25::double precision $$;

-- A hospital visit as the game needs it (with the server's clock).
create function public.visit_json(h public.hospital_visits)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('hospital', h.hospital, 'lng', h.lng, 'lat', h.lat, 'approach', h.approach, 'route', h.route,
    'bill', h.bill, 'calledAt', h.called_at, 'pickedAt', h.picked_at, 'arrivesAt', h.arrives_at,
    'dischargedAt', h.discharged_at, 'now', now());
$$;

-- What the game needs on loading: energy (with rest since the last move), fainting, keg, hospital.
create function public.my_condition()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'energy', round(least(100, pos.energy + least(extract(epoch from now() - pos.updated_at), 3600)
                    * (case when pos.resting_since is not null then public.rest_regen() else public.idle_regen() end))::numeric, 1),
    'fainted', pos.fainted_at is not null,
    'resting', pos.resting_since is not null,
    'keg', (select jsonb_build_object('usesLeft', k.uses_left, 'fuel', k.fuel) from public.player_kegs k where k.user_id = pos.user_id and k.uses_left > 0),
    'hospital', (select public.visit_json(h) from public.hospital_visits h where h.user_id = pos.user_id and h.left_at is null))
  from public.player_positions pos where pos.user_id = auth.uid();
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
  idle_s := greatest(0, secs - moved_m / public.base_speed(p_mode));
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

create or replace function public.start_vehicle(p_kind text, p_lng double precision, p_lat double precision, p_rent boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos jsonb;
  v public.player_vehicles%rowtype;
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

  -- Get off whatever you're on now.
  perform public.settle_rental(uid);
  update public.player_vehicles set in_use = false, lng = p_lng, lat = p_lat where user_id = uid and in_use;

  select * into v from public.player_vehicles where user_id = uid and kind = p_kind;
  if found and not p_rent then
    -- A mechanic called to a breakdown: fixed (well enough) once they've been.
    if v.broken_at is not null and v.repair_ready_at is not null and now() >= v.repair_ready_at then
      update public.player_vehicles set broken_at = null, repair_ready_at = null, engine = greatest(engine, 40) where id = v.id returning * into v;
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
  return jsonb_build_object('ok', true, 'source', 'rented', 'rate', public.rental_rate(p_kind), 'balance', balance);
end;
$$;

create or replace function public.refuel()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  litres integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into v from public.player_vehicles where user_id = uid and in_use and kind in ('motorbike', 'car') for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  select least(floor(100 - v.fuel)::integer, floor(coins / 2)::integer) into litres from public.profiles where id = uid;
  if litres <= 0 then
    return jsonb_build_object('ok', false, 'reason', case when v.fuel >= 99 then 'full' else 'coins' end);
  end if;
  balance := public.apply_coin_change(uid, -2 * litres, 'spend', 'Fuel for your ' || v.kind, null);
  update public.player_vehicles set fuel = least(100, fuel + litres) where id = v.id returning fuel into v.fuel;
  return jsonb_build_object('ok', true, 'fuel', v.fuel, 'cost', 2 * litres, 'balance', balance);
end;
$$;

create or replace function public.buy_meal()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  balance bigint;
  fresh double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['eat'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  begin
    balance := public.apply_coin_change(uid, -30, 'spend', 'A meal', null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  update public.player_positions set energy = least(100, energy + 40) where user_id = uid returning energy into fresh;
  return jsonb_build_object('ok', true, 'energy', 40, 'now', round(fresh::numeric, 1), 'balance', balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rest at a chill spot (a park, or a place to eat): energy comes back fast until the player moves on.
-- ---------------------------------------------------------------------------
create function public.start_rest()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  spot public.places%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  spot := public.place_at(array['rest', 'eat'], uid, 80);
  if spot.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  update public.player_positions set resting_since = coalesce(resting_since, now()) where user_id = uid and fainted_at is null;
  return jsonb_build_object('ok', true, 'place', spot.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kegs: buy one at a petrol station, fill it, carry it to a vehicle that ran dry, pour.
-- ---------------------------------------------------------------------------
create function public.buy_keg()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  if exists (select 1 from public.player_kegs where user_id = uid and uses_left > 0) then
    return jsonb_build_object('ok', false, 'reason', 'have_one');
  end if;
  begin
    balance := public.apply_coin_change(uid, -25, 'spend', 'A fuel keg', null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  insert into public.player_kegs (user_id) values (uid)
  on conflict (user_id) do update set uses_left = 50, fuel = 0, bought_at = now();
  return jsonb_build_object('ok', true, 'balance', balance, 'usesLeft', 50);
end;
$$;

-- Fill the keg: up to 30% of a tank, 2 coins per %.
create function public.fill_keg()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.player_kegs%rowtype;
  litres integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into k from public.player_kegs where user_id = uid and uses_left > 0 for update;
  if k.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_keg');
  end if;
  if k.fuel >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  select least(30 - floor(k.fuel)::integer, floor(coins / 2)::integer) into litres from public.profiles where id = uid;
  if litres <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end if;
  balance := public.apply_coin_change(uid, -2 * litres, 'spend', 'Fuel in a keg', null);
  update public.player_kegs set fuel = fuel + litres where user_id = uid returning fuel into k.fuel;
  return jsonb_build_object('ok', true, 'fuel', k.fuel, 'cost', 2 * litres, 'balance', balance);
end;
$$;

-- Pour the keg into your own motorbike or car standing nearby. Each pour wears the keg; after 50 it's spoilt.
create function public.pour_keg()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k public.player_kegs%rowtype;
  v public.player_vehicles%rowtype;
  pos public.player_positions%rowtype;
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
   where user_id = uid and kind in ('motorbike', 'car') and not in_use
     and public.distance_m(pos.lng, pos.lat, lng, lat) <= 30
   order by fuel limit 1 for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  update public.player_vehicles set fuel = least(100, fuel + k.fuel) where id = v.id returning fuel into v.fuel;
  update public.player_kegs set fuel = 0, uses_left = uses_left - 1 where user_id = uid returning uses_left into k.uses_left;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'fuel', v.fuel, 'usesLeft', k.uses_left, 'spoilt', k.uses_left = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tyres, engines and breakdowns
-- ---------------------------------------------------------------------------
-- Pump a bicycle's tyres at a petrol station or a vulcanizer: 5 coins, or 20 to fix a flat.
create function public.pump_tyres()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  pos public.player_positions%rowtype;
  cost integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel', 'tyres'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind = 'bicycle' and (in_use or public.distance_m(pos.lng, pos.lat, lng, lat) <= 30) for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  if v.tyre >= 95 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  cost := case when v.tyre <= 0 then 20 else 5 end;
  begin
    balance := public.apply_coin_change(uid, -cost, 'spend', case when cost = 20 then 'Fixed a flat tyre' else 'Pumped tyres' end, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'cost', cost);
  end;
  update public.player_vehicles set tyre = 100 where id = v.id;
  return jsonb_build_object('ok', true, 'cost', cost, 'balance', balance);
end;
$$;

-- Service a motorbike's or car's engine at a mechanic's: 60 coins, as good as new.
create function public.service_vehicle()
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
  if public.place_at(array['mechanic'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and (in_use or public.distance_m(pos.lng, pos.lat, lng, lat) <= 30)
   order by engine limit 1 for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  begin
    balance := public.apply_coin_change(uid, -60, 'spend', 'Serviced your ' || v.kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  update public.player_vehicles set engine = 100, broken_at = null, repair_ready_at = null where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'balance', balance);
end;
$$;

-- Broken down: a mechanic comes out (80 coins) and gets it going within a minute (start_vehicle checks).
create function public.call_mechanic()
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
    balance := public.apply_coin_change(uid, -80, 'spend', 'Mechanic call-out for your ' || v.kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  update public.player_vehicles set repair_ready_at = now() + interval '45 seconds' where id = v.id returning repair_ready_at into v.repair_ready_at;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'readyAt', v.repair_ready_at, 'now', now(), 'balance', balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fainting: the ambulance and the hospital
-- ---------------------------------------------------------------------------

-- The ambulance for a player who has fainted. p_hospital..p_lat is the hospital the game
-- picked (a real one, within 15 km); p_approach the ambulance's way to the player, and
-- p_route on to the hospital. With no hospital (none near, or no road found), paramedics
-- treat the player where they fell. The bill (50 coins, or what they have) is paid now;
-- any rental ends, and their own vehicle stays where they fell.
create function public.call_ambulance(p_hospital text, p_lng double precision, p_lat double precision, p_approach jsonb, p_route jsonb)
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
  -- Off whatever they were riding: a rental ends, their own vehicle stays where they fell.
  perform public.settle_rental(uid);
  update public.player_vehicles set in_use = false, lng = pos.lng, lat = pos.lat where user_id = uid and in_use;
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
  return jsonb_build_object('ok', true, 'visit', public.visit_json(h));
end;
$$;

-- Discharged: the player leaves the hospital on foot, rested (70 energy).
create function public.leave_hospital()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hospital_visits%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hospital_visits where user_id = uid and left_at is null for update;
  if h.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_visit');
  end if;
  if now() < h.discharged_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'visit', public.visit_json(h));
  end if;
  update public.hospital_visits set left_at = now() where user_id = uid;
  update public.player_positions
     set lng = h.lng, lat = h.lat, mode = 'walk', energy = 70, fainted_at = null, resting_since = null, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('ok', true, 'lng', h.lng, 'lat', h.lat, 'hospital', h.hospital, 'energy', 70);
end;
$$;

revoke execute on function public.place_at(text[], uuid, double precision), public.visit_json(public.hospital_visits) from public, anon, authenticated;
revoke execute on function public.places_near(text[], double precision, double precision, integer), public.my_condition(), public.start_rest(),
  public.buy_keg(), public.fill_keg(), public.pour_keg(), public.pump_tyres(), public.service_vehicle(), public.call_mechanic(),
  public.call_ambulance(text, double precision, double precision, jsonb, jsonb), public.leave_hospital() from public, anon;
grant execute on function public.places_near(text[], double precision, double precision, integer), public.my_condition(), public.start_rest(),
  public.buy_keg(), public.fill_keg(), public.pour_keg(), public.pump_tyres(), public.service_vehicle(), public.call_mechanic(),
  public.call_ambulance(text, double precision, double precision, jsonb, jsonb), public.leave_hospital() to authenticated;
