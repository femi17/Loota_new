-- Vehicle recovery (owner, 7 Nov 2026: "I went to bolivia, so my fuel for both motobike and car finished. I let them on
-- the road and came back… do we charge them for someone to help them locate it and it takes 24hrs depending on the
-- location"; chose a recovery service). A motorbike or car left at the roadside (out of fuel or with a flat) more than
-- recovery_min_m() from the player can be sent for from the vehicle panel: coins now, and it is back in the pocket after a
-- wait. Both grow with the distance: about 2 hours nearby, up to 24 hours from far away. It comes back with its tyre
-- fixed and recovery_fuel() in the tank (enough to reach a petrol station). Mirrored in src/game/economy.ts (recovery).
create or replace function public.recovery_min_m() returns integer language sql immutable set search_path = '' as $$ select 2000 $$;
create or replace function public.recovery_fuel() returns integer language sql immutable set search_path = '' as $$ select 15 $$;

-- The fee in coins and the wait in minutes, for a vehicle km kilometres away.
create or replace function public.recovery_quote(p_kind text, p_km double precision)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'fee', case when p_kind = 'car' then least(1500, round(100 + 0.12 * greatest(p_km, 0)))
                else least(900, round(60 + 0.08 * greatest(p_km, 0))) end,
    'minutes', least(1440, round(120 + 0.5 * greatest(p_km, 0))))
$$;

create or replace function public.recover_vehicle(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  me public.player_positions%rowtype;
  km double precision;
  q jsonb;
  ready timestamptz;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into v from public.player_vehicles where user_id = uid and kind = p_kind for update;
  if v.id is null or v.kind = 'bicycle' then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  if v.recovery_ready_at is not null and v.recovery_ready_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'already', 'readyAt', v.recovery_ready_at);
  end if;
  if v.stranded_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_stranded');
  end if;
  select * into me from public.player_positions where user_id = uid;
  if me.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  km := public.distance_m(me.lng, me.lat, v.lng, v.lat) / 1000.0;
  if km * 1000 < public.recovery_min_m() then
    return jsonb_build_object('ok', false, 'reason', 'near', 'lng', v.lng, 'lat', v.lat);
  end if;
  q := public.recovery_quote(v.kind, km);
  begin
    balance := public.apply_coin_change(uid, -(q ->> 'fee')::integer, 'spend',
      'Recovery truck for your ' || v.kind || ' (' || round(km::numeric) || ' km away)', null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'fee', (q ->> 'fee')::integer);
  end;
  ready := now() + make_interval(mins => (q ->> 'minutes')::integer);
  update public.player_vehicles
     set stranded_at = null, recovery_ready_at = ready, in_use = false,
         fuel = greatest(fuel, public.recovery_fuel()), tyre = case when tyre <= 0 then 100 else tyre end,
         flat_wheel = null, flat_helper = null, flat_fix_how = null, flat_fix_ready_at = null,
         lng = me.lng, lat = me.lat
   where id = v.id;
  return jsonb_build_object('ok', true, 'readyAt', ready, 'fee', (q ->> 'fee')::integer, 'minutes', (q ->> 'minutes')::integer,
    'km', round(km::numeric), 'balance', balance);
end;
$$;
revoke all on function public.recover_vehicle(text) from public, anon;
grant execute on function public.recover_vehicle(text) to authenticated;

-- Taking a vehicle out: not one still on the recovery truck.
CREATE OR REPLACE FUNCTION public.start_vehicle(p_kind text, p_lng double precision, p_lat double precision, p_rent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  pos jsonb;
  v public.player_vehicles%rowtype;
  pick public.vehicle_pickups%rowtype;
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

  select * into v from public.player_vehicles where user_id = uid and kind = p_kind;
  -- On the recovery truck: back in the pocket at recovery_ready_at.
  if v.id is not null and not p_rent and v.recovery_ready_at is not null and v.recovery_ready_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'recovering', 'readyAt', v.recovery_ready_at);
  end if;
  -- Renting: only where the renter has brought the bicycle or motorbike. Cars are taxis, not rentals.
  if p_rent or v.id is null then
    if p_kind = 'car' then
      return jsonb_build_object('ok', false, 'reason', 'taxi');
    end if;
    select * into pick from public.vehicle_pickups where user_id = uid and kind = p_kind and ended_at is null and expires_at > now();
    if pick.user_id is null then
      return jsonb_build_object('ok', false, 'reason', 'pickup');
    end if;
    if public.distance_m(p_lng, p_lat, pick.lng, pick.lat) > public.pickup_at_m() then
      return jsonb_build_object('ok', false, 'reason', 'far_pickup', 'lng', pick.lng, 'lat', pick.lat);
    end if;
  end if;

  -- Get off whatever you're on now.
  perform public.settle_rental(uid);
  update public.player_vehicles set in_use = false, lng = p_lng, lat = p_lat where user_id = uid and in_use;

  if v.id is not null and not p_rent then
    -- A mechanic called to a breakdown: fixed (well enough) once they've been.
    if v.broken_at is not null and v.repair_ready_at is not null and now() >= v.repair_ready_at then
      update public.player_vehicles
         set broken_at = null, repair_ready_at = null,
             engine = case when kind = 'bicycle' then engine else greatest(engine, 40) end,
             tyre = case when kind = 'bicycle' then 100 else tyre end
       where id = v.id returning * into v;
    end if;
    if v.broken_at is not null then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', case when v.repair_ready_at is not null then 'repairing' else 'broken' end,
        'readyAt', v.repair_ready_at);
    end if;
    -- A flat at the roadside: change it there first (start_flat_fix).
    if v.kind <> 'bicycle' and v.tyre <= 0 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'flat', 'lng', v.lng, 'lat', v.lat, 'jack', v.jack);
    end if;
    if v.stranded_at is not null then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'stranded', 'lng', v.lng, 'lat', v.lat);
    end if;
    if v.kind <> 'bicycle' and v.fuel <= 0 then
      update public.player_positions set mode = 'walk' where user_id = uid;
      return jsonb_build_object('ok', false, 'reason', 'fuel');
    end if;
    -- Out of the pocket, wherever the player is.
    update public.player_vehicles set in_use = true, recovery_ready_at = null, lng = p_lng, lat = p_lat where id = v.id;
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
  update public.vehicle_pickups set ended_at = now() where user_id = uid and ended_at is null;
  return jsonb_build_object('ok', true, 'source', 'rented', 'rate', public.rental_rate(p_kind), 'balance', balance);
end;
$function$;
