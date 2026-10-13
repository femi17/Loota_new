-- Economy v1 (design doc sections 5 and 10): rent or buy bicycles, motorbikes
-- and cars; fuel for owned motor vehicles; meals for energy. The server knows
-- what each player is riding, so nobody can claim a faster mode than they have.

alter table public.player_positions drop constraint player_positions_mode_check;
alter table public.player_positions add constraint player_positions_mode_check
  check (mode in ('walk', 'bicycle', 'motorbike', 'car'));

-- Top on-screen speed in m/s (real speed x game speed 12 x sprint 1.6); matches src/game/movement.ts.
create or replace function public.max_travel_speed(p_mode text)
returns double precision language sql immutable set search_path = '' as $$
  select (case p_mode when 'bicycle' then 16.0 when 'motorbike' then 35.0 when 'car' then 45.0 else 5.0 end) / 3.6 * 12 * 1.6;
$$;

-- Prices in coins; matches src/game/economy.ts.
create function public.vehicle_price(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 600 when 'motorbike' then 2500 when 'car' then 8000 end;
$$;
create function public.rental_rate(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 4 when 'motorbike' then 10 when 'car' then 20 end; -- coins per real minute
$$;
create function public.fuel_per_km(p_kind text) returns double precision language sql immutable set search_path = '' as $$
  select case p_kind when 'motorbike' then 0.8 when 'car' then 1.2 else 0 end; -- % of a tank per on-screen km
$$;

create table public.player_vehicles (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  kind      text not null check (kind in ('bicycle', 'motorbike', 'car')),
  fuel      double precision not null default 100 check (fuel between 0 and 100),
  lng       double precision not null, -- where it's parked (or last seen while riding)
  lat       double precision not null,
  in_use    boolean not null default false,
  bought_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table public.vehicle_rentals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('bicycle', 'motorbike', 'car')),
  started_at   timestamptz not null default now(),
  paid_minutes integer not null default 1,
  ended_at     timestamptz,
  charged      integer not null default 0
);
create unique index vehicle_rentals_one_active on public.vehicle_rentals (user_id) where ended_at is null;

alter table public.player_vehicles enable row level security;
alter table public.vehicle_rentals enable row level security;
create policy "Players read their own vehicles" on public.player_vehicles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Players read their own rentals" on public.vehicle_rentals for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.player_vehicles, public.vehicle_rentals from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Close a player's rental, charging every started minute up to the last time
-- they moved (so closing the app doesn't run up a bill). Never takes the
-- balance below zero. Internal: called by the functions below.
create function public.settle_rental(p_uid uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.vehicle_rentals%rowtype;
  last_seen timestamptz;
  ended timestamptz;
  minutes integer;
  due integer;
  balance bigint;
begin
  select * into r from public.vehicle_rentals where user_id = p_uid and ended_at is null for update;
  if not found then
    return 0;
  end if;
  select updated_at into last_seen from public.player_positions where user_id = p_uid;
  ended := greatest(r.started_at, least(now(), coalesce(last_seen, now())));
  minutes := greatest(1, ceil(extract(epoch from ended - r.started_at) / 60))::integer;
  due := greatest(0, (minutes - r.paid_minutes) * public.rental_rate(r.kind));
  select coins into balance from public.profiles where id = p_uid;
  due := least(due, balance)::integer;
  if due > 0 then
    perform public.apply_coin_change(p_uid, -due, 'spend', 'Rented a ' || r.kind || ' for ' || minutes || ' min', 'rental:' || r.id);
  end if;
  update public.vehicle_rentals set ended_at = ended, charged = public.rental_rate(r.kind) * r.paid_minutes + due where id = r.id;
  return due;
end;
$$;
revoke execute on function public.settle_rental(uuid) from public, anon, authenticated;

-- What the player is riding right now: an active rental, an owned vehicle in use, or 'walk'.
create function public.current_mode(p_uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select kind from public.vehicle_rentals where user_id = p_uid and ended_at is null),
    (select kind from public.player_vehicles where user_id = p_uid and in_use),
    'walk');
$$;
revoke execute on function public.current_mode(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_position, now also checking the travel mode is one the player has, and
-- using fuel on owned motorbikes and cars.
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

-- ---------------------------------------------------------------------------
-- Get on a vehicle: your own (if you're within 30 m of where it's parked, or
-- p_rent is false and it's here) or a rental (first minute paid now).
create function public.start_vehicle(p_kind text, p_lng double precision, p_lat double precision, p_rent boolean default false)
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

-- Get off and walk: a rental is billed and ends; your own vehicle is parked here.
create function public.stop_vehicle(p_lng double precision, p_lat double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos jsonb;
  charged integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  pos := public.save_position(p_lng, p_lat, public.current_mode(uid));
  if not (pos ->> 'ok')::boolean then
    p_lng := (pos ->> 'lng')::double precision;
    p_lat := (pos ->> 'lat')::double precision;
  end if;
  charged := public.settle_rental(uid);
  update public.player_vehicles set in_use = false, lng = p_lng, lat = p_lat where user_id = uid and in_use;
  update public.player_positions set mode = 'walk' where user_id = uid;
  select coins into balance from public.profiles where id = uid;
  return jsonb_build_object('ok', true, 'charged', charged, 'balance', balance);
end;
$$;

-- Buy a vehicle; it's parked where you are. (Replaced in
-- 20261013124632_buy_vehicle_without_reference.sql.)
create function public.buy_vehicle(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  at_lng double precision;
  at_lat double precision;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('bicycle', 'motorbike', 'car') then
    raise exception 'Unknown vehicle';
  end if;
  if exists (select 1 from public.player_vehicles where user_id = uid and kind = p_kind) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  select lng, lat into at_lng, at_lat from public.player_positions where user_id = uid;
  if not found then
    select home_lng, home_lat into at_lng, at_lat from public.profiles where id = uid;
  end if;
  begin
    balance := public.apply_coin_change(uid, -public.vehicle_price(p_kind), 'spend', 'Bought a ' || p_kind, 'buy:' || uid || ':' || p_kind);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  insert into public.player_vehicles (user_id, kind, lng, lat) values (uid, p_kind, at_lng, at_lat);
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

-- Fill up the motorbike or car you're riding (the game only offers this at a petrol station).
create function public.refuel()
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

-- A meal at a restaurant, café or fast-food place (the game adds the energy).
create function public.buy_meal()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  begin
    balance := public.apply_coin_change(uid, -30, 'spend', 'A meal', null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  return jsonb_build_object('ok', true, 'energy', 40, 'balance', balance);
end;
$$;

revoke execute on function public.start_vehicle(text, double precision, double precision, boolean) from public, anon;
revoke execute on function public.stop_vehicle(double precision, double precision) from public, anon;
revoke execute on function public.buy_vehicle(text) from public, anon;
revoke execute on function public.refuel() from public, anon;
revoke execute on function public.buy_meal() from public, anon;
grant execute on function public.start_vehicle(text, double precision, double precision, boolean) to authenticated;
grant execute on function public.stop_vehicle(double precision, double precision) to authenticated;
grant execute on function public.buy_vehicle(text) to authenticated;
grant execute on function public.refuel() to authenticated;
grant execute on function public.buy_meal() to authenticated;
