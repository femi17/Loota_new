-- The key's quarter (owner, 1 Nov 2026: "we create our own open street… where user can walk freely… to figure where
-- the treasure is actually buried"; the quarter replaces the house at every key). A house's rooms are the quarter's
-- plots. Walking about is free: stepping onto a plot (house_step) only notes where the hunter stands (and opens a gate
-- with the thing it needs); digging (house_enter, as entering a room was) is what springs a trap or finds the chest.
-- The chest shows only where the hunter has dug (house_dug).
alter table public.hunt_players add column if not exists house_dug text;

-- A new key's quarter starts afresh: nothing carried, nothing dug.
create or replace function public.house_here(p_hunt uuid, uid uuid)
returns table (k public.hunt_keys, hp public.hunt_players, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  h public.hunts%rowtype;
  here record;
begin
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    reason := 'not_live'; return next; return;
  end if;
  select * into hp from public.hunt_players p where p.hunt_id = p_hunt and p.user_id = uid for update;
  if hp.user_id is null or hp.finished_at is not null then
    reason := 'not_hunting'; return next; return;
  end if;
  select * into k from public.hunt_keys hk where hk.hunt_id = p_hunt and hk.n = hp.keys_held + 1;
  if k.n is null or k.house is null then
    reason := 'no_house'; return next; return;
  end if;
  select lng, lat into here from public.player_positions where user_id = uid;
  if here.lng is null or (public.distance_m(here.lng, here.lat, k.area_lng, k.area_lat) > greatest(coalesce(k.exact_m, 120), 120)
      and public.distance_m(here.lng, here.lat, k.spot_lng, k.spot_lat) > greatest(coalesce(k.exact_m, 120), 120)) then
    reason := 'away'; return next; return;
  end if;
  if hp.house_key is distinct from k.n then
    update public.hunt_players p set house_key = k.n, house_room = null, house_dug = null, house_items = '{}', house_out_until = null
     where p.hunt_id = p_hunt and p.user_id = uid returning * into hp;
  end if;
  return next;
end;
$$;
revoke execute on function public.house_here(uuid, uuid) from public, anon, authenticated;

-- What the hunter may see: the chest only on the plot they dug.
create or replace function public.house_public(k public.hunt_keys, hp public.hunt_players)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'key', k.n,
    'title', coalesce(k.house ->> 'title', 'The house'),
    'style', coalesce(k.house ->> 'style', 'cottage'),
    'layout', k.house ->> 'layout',
    'room', hp.house_room,
    'dug', hp.house_dug,
    'outUntil', hp.house_out_until,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r ->> 'id', 'name', r ->> 'name', 'kind', r ->> 'kind',
                'locked', coalesce(r ? 'needs' and not (('open:' || (r ->> 'id')) = any (hp.house_items)), false),
                'chest', coalesce((r ->> 'role') = 'right' and hp.house_dug = (r ->> 'id'), false)) order by ord), '[]'::jsonb)
              from jsonb_array_elements(k.house -> 'rooms') with ordinality as x(r, ord)),
    'objects', (select coalesce(jsonb_agg(jsonb_build_object('id', o ->> 'id', 'room', r ->> 'id', 'kind', o ->> 'kind', 'label', o ->> 'label')), '[]'::jsonb)
                from jsonb_array_elements(k.house -> 'rooms') r, jsonb_array_elements(coalesce(r -> 'objects', '[]'::jsonb)) o),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i, 'name', k.house -> 'items' -> i ->> 'name', 'icon', coalesce(k.house -> 'items' -> i ->> 'icon', '📦'))), '[]'::jsonb)
              from unnest(hp.house_items) i where i not like 'open:%'),
    'at', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat));
$$;
revoke execute on function public.house_public(public.hunt_keys, public.hunt_players) from public, anon, authenticated;

-- Stepping onto a plot: free. Its gate opens with the thing it needs (used up), or stays shut with its hint.
create or replace function public.house_step(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  r jsonb;
  used jsonb;
  hp public.hunt_players%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  hp := s.hp;
  if hp.house_dodge is not null then
    return jsonb_build_object('ok', false, 'reason', 'dodge');
  end if;
  if p_room is null then
    update public.hunt_players set house_room = null where hunt_id = p_hunt and user_id = uid returning * into hp;
    return jsonb_build_object('ok', true) || public.house_public(s.k, hp);
  end if;
  select x into r from jsonb_array_elements((s.k).house -> 'rooms') x where x ->> 'id' = p_room;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if r ? 'needs' and not (('open:' || p_room) = any (hp.house_items)) then
    if not ((r ->> 'needs') = any (hp.house_items)) then
      return jsonb_build_object('ok', true, 'locked', true, 'text', coalesce(r ->> 'lockedText', 'The gate is locked.'));
    end if;
    update public.hunt_players set house_items = array_append(house_items, 'open:' || p_room)
     where hunt_id = p_hunt and user_id = uid returning * into hp;
    used := jsonb_build_object('id', r ->> 'needs', 'name', (s.k).house -> 'items' -> (r ->> 'needs') ->> 'name');
  end if;
  update public.hunt_players set house_room = p_room where hunt_id = p_hunt and user_id = uid returning * into hp;
  return jsonb_build_object('ok', true, 'used', used) || public.house_public(s.k, hp);
end;
$$;
revoke execute on function public.house_step(uuid, text) from public, anon;
grant execute on function public.house_step(uuid, text) to authenticated;

-- Digging on a plot (as entering a room was): a trap's challenge, or the plot dug (the chest, on the right one).
create or replace function public.house_enter(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  r jsonb;
  used jsonb;
  challenge jsonb;
  hp public.hunt_players%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  hp := s.hp;
  if hp.house_dodge is not null then
    if (hp.house_dodge ->> 'until')::timestamptz < now() then
      return jsonb_build_object('ok', true, 'trap', true, 'penalty', public.house_settle_dodge(p_hunt, uid));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'dodge');
  end if;
  if hp.house_out_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'out', 'until', hp.house_out_until);
  end if;
  select x into r from jsonb_array_elements((s.k).house -> 'rooms') x where x ->> 'id' = p_room;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if r ? 'needs' and not (('open:' || p_room) = any (hp.house_items)) then
    if not ((r ->> 'needs') = any (hp.house_items)) then
      return jsonb_build_object('ok', true, 'locked', true, 'text', coalesce(r ->> 'lockedText', 'The door is locked.'));
    end if;
    update public.hunt_players set house_items = array_append(house_items, 'open:' || p_room)
     where hunt_id = p_hunt and user_id = uid returning * into hp;
    used := jsonb_build_object('id', r ->> 'needs', 'name', (s.k).house -> 'items' -> (r ->> 'needs') ->> 'name');
  end if;
  if r ->> 'role' = 'trap' then
    challenge := public.house_challenge();
    update public.hunt_players
       set house_dodge = jsonb_build_object('room', p_room, 'answer', challenge -> 'answer', 'until', now() + interval '7 seconds')
     where hunt_id = p_hunt and user_id = uid;
    return jsonb_build_object('ok', true, 'trap', true, 'used', used,
      'dodge', jsonb_build_object('prompt', challenge -> 'prompt', 'options', challenge -> 'options', 'seconds', 5));
  end if;
  update public.hunt_players set house_room = p_room, house_dug = p_room where hunt_id = p_hunt and user_id = uid returning * into hp;
  return jsonb_build_object('ok', true, 'used', used) || public.house_public(s.k, hp);
end;
$$;
