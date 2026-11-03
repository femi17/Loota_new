-- A flat is seen to by a vulcanizer, who isn't by the roadside (owner, 3 Nov 2026: "If you have flat, it is not right
-- there you get a vulcanizer. You find one, and you do either one of the two thing, roll your tire to the vulcanizer, or
-- you go to the vulcanizer, they come back with you to fix it"). Your own jack and spare still change it on the spot.
--   Roll it: take_wheel_off beside the vehicle (flat_wheel 'off'), fix_wheel at a vulcanizer or a petrol station's
--   tyre man (20 coins: 'fixed'), put_wheel_on back beside the vehicle (the tyre as new; back on it with fuel).
--   Bring him: bring_vulcanizer at one (flat_helper = his name, walking back with you); then start_flat_fix('mechanic')
--   beside the vehicle as before (40 coins when done), which now needs him there.

alter table public.player_vehicles
  add column if not exists flat_wheel text check (flat_wheel in ('off', 'fixed')),
  add column if not exists flat_helper text check (char_length(flat_helper) <= 40);

create or replace function public.wheel_fix_price() returns integer language sql immutable set search_path = '' as $$ select 20 $$;

-- Beside the flat (30 m): the wheel comes off, to roll to a vulcanizer.
create or replace function public.take_wheel_off()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and tyre <= 0 and stranded_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_flat');
  end if;
  if v.flat_wheel is not null then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if v.flat_helper is not null then
    return jsonb_build_object('ok', false, 'reason', 'helper');
  end if;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, v.lng, v.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far', 'lng', v.lng, 'lat', v.lat);
  end if;
  update public.player_vehicles set flat_wheel = 'off' where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind);
end;
$$;

create or replace function public.fix_wheel()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  price integer := public.wheel_fix_price();
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel', 'tyres'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into v from public.player_vehicles where user_id = uid and flat_wheel = 'off' for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_wheel');
  end if;
  begin
    balance := public.apply_coin_change(uid, -price, 'spend', 'A vulcanizer patched your ' || v.kind || '''s tyre', null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'cost', price);
  end;
  update public.player_vehicles set flat_wheel = 'fixed' where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'cost', price, 'balance', balance);
end;
$$;

create or replace function public.put_wheel_on()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
  remount boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles where user_id = uid and flat_wheel = 'fixed' for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_wheel');
  end if;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, v.lng, v.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far', 'lng', v.lng, 'lat', v.lat);
  end if;
  remount := v.fuel > 0;
  update public.player_vehicles set tyre = 100, flat_wheel = null, flat_helper = null where id = v.id;
  if remount then
    perform public.settle_rental(uid);
    update public.player_vehicles set in_use = false where user_id = uid and in_use;
    update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
    update public.player_positions set mode = v.kind where user_id = uid;
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'remounted', remount, 'fuel', v.fuel);
end;
$$;

-- p_name: the vulcanizer's name the player sees (the game names the people at a place).
create or replace function public.bring_vulcanizer(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.place_at(array['fuel', 'tyres'], uid, 80) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and tyre <= 0 and stranded_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_flat');
  end if;
  if v.flat_wheel is not null then
    return jsonb_build_object('ok', false, 'reason', 'wheel');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  update public.player_vehicles set flat_helper = left(coalesce(nullif(trim(p_name), ''), 'The vulcanizer'), 40) where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'lng', v.lng, 'lat', v.lat,
    'metres', round(public.distance_m(pos.lng, pos.lat, v.lng, v.lat)));
end;
$$;

-- Beside the flat: your jack (free), or the vulcanizer you brought (paid when done). Never with the wheel off.
create or replace function public.start_flat_fix(p_how text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
  secs integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_how not in ('jack', 'mechanic') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and tyre <= 0 and stranded_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_flat');
  end if;
  if v.flat_wheel is not null then
    return jsonb_build_object('ok', false, 'reason', 'wheel');
  end if;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, v.lng, v.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far', 'lng', v.lng, 'lat', v.lat);
  end if;
  if p_how = 'jack' and not v.jack then
    return jsonb_build_object('ok', false, 'reason', 'no_jack');
  end if;
  if p_how = 'mechanic' and v.flat_helper is null then
    return jsonb_build_object('ok', false, 'reason', 'no_helper');
  end if;
  if p_how = 'mechanic' and (select coins from public.profiles where id = uid) < public.flat_fix_price() then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', public.flat_fix_price());
  end if;
  secs := public.flat_fix_seconds(p_how);
  update public.player_vehicles set flat_fix_how = p_how, flat_fix_ready_at = now() + make_interval(secs => secs) where id = v.id;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'how', p_how, 'seconds', secs,
    'price', case when p_how = 'mechanic' then public.flat_fix_price() else 0 end, 'readyAt', now() + make_interval(secs => secs), 'now', now());
end;
$$;

create or replace function public.finish_flat_fix()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  v public.player_vehicles%rowtype;
  balance bigint;
  price integer := 0;
  remount boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into v from public.player_vehicles
   where user_id = uid and kind in ('motorbike', 'car') and flat_fix_ready_at is not null for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if now() < v.flat_fix_ready_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'readyAt', v.flat_fix_ready_at);
  end if;
  if v.flat_fix_how = 'mechanic' then
    price := public.flat_fix_price();
    begin
      balance := public.apply_coin_change(uid, -price, 'spend', 'A vulcanizer changed your ' || v.kind || '''s tyre', null);
    exception when check_violation then
      update public.player_vehicles set flat_fix_how = null, flat_fix_ready_at = null where id = v.id;
      return jsonb_build_object('ok', false, 'reason', 'coins', 'price', price);
    end;
  end if;
  select * into pos from public.player_positions where user_id = uid;
  remount := v.fuel > 0;
  update public.player_vehicles set tyre = 100, flat_fix_how = null, flat_fix_ready_at = null, flat_wheel = null, flat_helper = null where id = v.id;
  if remount then
    perform public.settle_rental(uid);
    update public.player_vehicles set in_use = false where user_id = uid and in_use;
    update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
    update public.player_positions set mode = v.kind where user_id = uid;
  end if;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'how', v.flat_fix_how, 'price', price, 'balance', balance,
    'remounted', remount, 'fuel', v.fuel);
end;
$$;

revoke execute on function public.take_wheel_off(), public.fix_wheel(), public.put_wheel_on(), public.bring_vulcanizer(text) from public, anon;
grant execute on function public.take_wheel_off(), public.fix_wheel(), public.put_wheel_on(), public.bring_vulcanizer(text) to authenticated;
