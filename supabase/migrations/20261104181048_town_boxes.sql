-- The finds spread over the town (owner, 4 Nov 2026: "do not keep all the item in one house… Let all the small house
-- be able to enter"). The key stays where the story's hint points: a chest at the right place (a building, or dug up
-- in the open), locked by a puzzle: "room" 1, always the key. The coins, the next chapter, a fake chest and a trap are
-- locked boxes in four of the town's small houses, which ones for each hunter alone (rooms 2 to 5, shuffled per hunter
-- as before). So rooms 2 to 5 open anywhere at the place; room 1 only at the right place, found. The right place in the
-- open counts too (the buried chest's puzzle is opened in the key's world, no longer the map's Key Trial).

create or replace function public.house_inner_order(p_user uuid, p_hunt uuid, p_key integer)
returns text[] language sql immutable set search_path = '' as $$
  select array['key'] || (select array_agg(c order by md5(p_user::text || ':' || p_hunt::text || ':' || p_key::text || ':' || c))
    from unnest(array['coins', 'chapter', 'decoy', 'trap']) c)
$$;

create or replace function public.house_inside(k public.hunt_keys, hp public.hunt_players)
returns boolean language sql stable set search_path = '' as $$
  select hp.house_dug is not null and exists (
    select 1 from jsonb_array_elements(k.house -> 'rooms') r where r ->> 'id' = hp.house_dug and r ->> 'role' = 'right')
$$;

-- Room 1 (the key) needs the right place found; the boxes in the houses don't.
do $$
declare
  f text;
  def text;
  guard text := 'if not public.house_inside(s.k, s.hp) then';
begin
  foreach f in array array['public.house_room_try(uuid, uuid, integer)', 'public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb, integer)', 'public.house_room_open(uuid, uuid, integer)'] loop
    select pg_get_functiondef(f::regprocedure) into def;
    if position(guard in def) = 0 then
      raise exception '%: guard not found', f;
    end if;
    execute replace(def, guard, 'if p_room = 1 and not public.house_inside(s.k, s.hp) then');
  end loop;
  -- The rooms' state, whether or not the right place is found yet (only opened ones say what they held)
  select pg_get_functiondef('public.house_public(public.hunt_keys, public.hunt_players)'::regprocedure) into def;
  if position('''inner'', case when public.house_inside(k, hp) then (' in def) = 0 then
    raise exception 'house_public: inner not found';
  end if;
  execute replace(def, '''inner'', case when public.house_inside(k, hp) then (', '''inner'', case when true then (');
end;
$$;
