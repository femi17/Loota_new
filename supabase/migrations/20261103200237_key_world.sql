-- The key's world (owner, 3 Nov 2026: "See mini loota html… here I can move, free, it is just like when you get to the
-- location you are thrown into another world. You can even mimic the key location"; "A whole world, but we just limit
-- the viewing… the metal detector should only detect the key not the next chapter or the coins, users either have to
-- guess or use clues from the chapter"). The story's house may say what the key's place looks like (`scene`: its ground
-- and landmark pieces, e.g. a station, a bronze dog, a scramble crossing); the game builds the world from it. Inside the
-- treasure building the detector reads each of the five rooms: hot only for the key's room, cold for the rest (the
-- coins, the next chapter, the fake chest and the trap alike).

do $$
declare
  def text;
begin
  select pg_get_functiondef('public.house_public(public.hunt_keys, public.hunt_players)'::regprocedure) into def;
  if position('''scene''' in def) = 0 then
    def := replace(def, '''layout'', k.house ->> ''layout'',', '''layout'', k.house ->> ''layout'', ''scene'', k.house -> ''scene'',');
    execute def;
  end if;
end;
$$;

create or replace function public.house_room_detect(p_hunt uuid, p_room integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
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
  if not public.house_inside(s.k, s.hp) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  if p_room is null or p_room not between 1 and 5 then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  return jsonb_build_object('ok', true, 'room', p_room,
    'heat', case when (public.house_inner_order(uid, p_hunt, (s.k).n))[p_room] = 'key' then 'hot' else 'cold' end);
end;
$$;

revoke execute on function public.house_room_detect(uuid, integer) from public, anon;
grant execute on function public.house_room_detect(uuid, integer) to authenticated;
