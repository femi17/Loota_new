-- Tools in the key's world: the functions (see key_world_tools).

create or replace function public.tool_price(p_tool text)
returns integer language sql immutable set search_path = '' as $$
  select case p_tool when 'spade' then 80 when 'torch' then 60 when 'detector' then public.detector_price() end
$$;

-- Buy a tool for the key's world (the detector as before).
create or replace function public.buy_tool(p_tool text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me public.profiles%rowtype;
  price integer := public.tool_price(p_tool);
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_tool = 'detector' then
    return public.buy_detector();
  end if;
  if price is null then
    return jsonb_build_object('ok', false, 'reason', 'no_tool');
  end if;
  select * into me from public.profiles where id = uid for update;
  if (p_tool = 'spade' and me.spade) or (p_tool = 'torch' and me.torch) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  if me.coins < price then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', price);
  end if;
  balance := public.apply_coin_change(uid, -price, 'spend', case p_tool when 'spade' then 'A spade' else 'A torch' end, p_tool || ':' || uid);
  if p_tool = 'spade' then
    update public.profiles set spade = true where id = uid;
  else
    update public.profiles set torch = true where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;
revoke execute on function public.buy_tool(text) from public, anon;
grant execute on function public.buy_tool(text) to authenticated;

-- Start digging an open-air place: with a spade it's dug at once (0 seconds); by hand, a minute on the spot.
create or replace function public.house_dig_start(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  r jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  select x into r from jsonb_array_elements((s.k).house -> 'rooms') x where x ->> 'id' = p_room;
  if r is null or not coalesce((r ->> 'outdoor')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if coalesce((select spade from public.profiles where id = uid), false) then
    return jsonb_build_object('ok', true, 'seconds', 0);
  end if;
  update public.hunt_players set house_digging = jsonb_build_object('room', p_room, 'at', now())
   where hunt_id = p_hunt and user_id = uid;
  return jsonb_build_object('ok', true, 'seconds', 60);
end;
$$;
revoke execute on function public.house_dig_start(uuid, text) from public, anon;
grant execute on function public.house_dig_start(uuid, text) to authenticated;

-- house_enter: an open-air place is only dug once the minute is up (or with a spade).
do $$
declare
  def text;
  anchor text := E'  if r is null then\n    return jsonb_build_object(''ok'', false, ''reason'', ''no_room'');\n  end if;\n';
begin
  select pg_get_functiondef('public.house_enter(uuid, text)'::regprocedure) into def;
  if position('house_digging' in def) = 0 then
    if position(anchor in def) = 0 then
      raise exception 'house_enter: anchor not found';
    end if;
    def := replace(def, anchor, anchor || E'  if coalesce((r ->> ''outdoor'')::boolean, false) and not coalesce((select spade from public.profiles where id = uid), false) then\n'
      || E'    if hp.house_digging is null or hp.house_digging ->> ''room'' <> p_room or (hp.house_digging ->> ''at'')::timestamptz > now() - interval ''57 seconds'' then\n'
      || E'      return jsonb_build_object(''ok'', false, ''reason'', ''digging'', ''seconds'', case when hp.house_digging ->> ''room'' = p_room then greatest(1, ceil(60 - extract(epoch from now() - (hp.house_digging ->> ''at'')::timestamptz))) else 60 end);\n'
      || E'    end if;\n'
      || E'    update public.hunt_players set house_digging = null where hunt_id = p_hunt and user_id = uid;\n'
      || E'  end if;\n');
    execute def;
  end if;
end;
$$;

-- The detector: hot at the right place only.
create or replace function public.house_detect(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  r jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not coalesce((select detector from public.profiles where id = uid), false) then
    return jsonb_build_object('ok', false, 'reason', 'no_detector');
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  select x into r from jsonb_array_elements((s.k).house -> 'rooms') x where x ->> 'id' = p_room;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'heat', case when r ->> 'role' = 'right' then 'hot' else 'cold' end);
end;
$$;
