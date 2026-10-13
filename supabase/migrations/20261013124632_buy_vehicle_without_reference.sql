-- A fixed payment reference would make a later re-purchase free (the wallet
-- treats a repeated reference as already paid). The one-of-each rule on
-- player_vehicles already stops double purchases.
create or replace function public.buy_vehicle(p_kind text)
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
    balance := public.apply_coin_change(uid, -public.vehicle_price(p_kind), 'spend', 'Bought a ' || p_kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  insert into public.player_vehicles (user_id, kind, lng, lat) values (uid, p_kind, at_lng, at_lat);
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;
