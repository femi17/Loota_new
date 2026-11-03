-- The hunt city (owner, 3 Nov 2026: "see an example of our hunt city… If a user uses the metal detector to locate where
-- the treasure is located, then go in, we open the roof of the building, and they complete the puzzle… room 1, coins,
-- room 2, the next chapter, room 3, the key, room 4, decoy trap, another room trap. But all these will be shuffled").
-- The key's quarter becomes a few streets of buildings (the story's plots, now buildings: house_enter as before for
-- a building the story warns about, or an empty one). The right one, searched, holds five rooms, each shut by a quick
-- puzzle; what's in each is shuffled per hunter and key: coins, the next chapter, the key, a decoy (a fake chest:
-- a deep trap) and a trap (a soft one). Puzzles are made and checked by the game's server (/api/house/room); their
-- answers stay in house_room_puzzles, which only the server reads. With a metal detector, house_detect says how hot
-- a building is (the right one, the ones next to it, or cold).

create table if not exists public.house_room_puzzles (
  user_id uuid not null,
  hunt_id uuid not null,
  key_n integer not null,
  room integer not null check (room between 1 and 5),
  kind text not null,
  puzzle jsonb not null,
  solution jsonb,
  created_at timestamptz not null default now(),
  solved_at timestamptz,
  outcome text check (outcome in ('coins', 'chapter', 'key', 'decoy', 'trap')),
  primary key (user_id, hunt_id, key_n, room)
);
alter table public.house_room_puzzles enable row level security; -- no policies: only the game's server reads it

/** What's behind each of the five rooms, for this hunter at this key (shuffled, the same every time they look). */
create or replace function public.house_inner_order(p_user uuid, p_hunt uuid, p_key integer)
returns text[] language sql immutable set search_path = '' as $$
  select array_agg(c order by md5(p_user::text || ':' || p_hunt::text || ':' || p_key::text || ':' || c))
    from unnest(array['coins', 'chapter', 'key', 'decoy', 'trap']) c
$$;

/** In the right building, searched (house_dug is the story's right plot). */
create or replace function public.house_inside(k public.hunt_keys, hp public.hunt_players)
returns boolean language sql stable set search_path = '' as $$
  select hp.house_dug is not null and exists (
    select 1 from jsonb_array_elements(k.house -> 'rooms') r where r ->> 'id' = hp.house_dug and r ->> 'role' = 'right')
$$;

-- The quarter as the player sees it, now with the treasure building's rooms (opened ones say what they held).
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
    'inner', case when public.house_inside(k, hp) then (
        select jsonb_agg(jsonb_build_object('n', g, 'open', p.solved_at is not null, 'outcome', p.outcome) order by g)
          from generate_series(1, 5) g
          left join public.house_room_puzzles p on p.user_id = hp.user_id and p.hunt_id = hp.hunt_id and p.key_n = k.n and p.room = g)
      end,
    'at', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat));
$$;

-- The game's server: a room's puzzle, made once (it hands in the puzzle it made; a later call gets the same one).
create or replace function public.house_room_ready(p_user uuid, p_hunt uuid, p_room integer, p_kind text, p_puzzle jsonb, p_solution jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v public.house_room_puzzles%rowtype;
begin
  select * into s from public.house_here(p_hunt, p_user);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  if not public.house_inside(s.k, s.hp) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  if p_room is null or p_room not between 1 and 5 then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution)
  values (p_user, p_hunt, (s.k).n, p_room, p_kind, p_puzzle, p_solution)
  on conflict (user_id, hunt_id, key_n, room) do nothing;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'open', true, 'outcome', v.outcome);
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'open', false, 'kind', v.kind, 'puzzle', v.puzzle);
end;
$$;

-- The game's server: a room's puzzle with its answer, to check one against.
create or replace function public.house_room_get(p_user uuid, p_hunt uuid, p_room integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v public.house_room_puzzles%rowtype;
begin
  select * into s from public.house_here(p_hunt, p_user);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.room is null then
    return jsonb_build_object('ok', false, 'reason', 'no_puzzle');
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'puzzle', v.puzzle, 'solution', v.solution, 'open', v.solved_at is not null);
end;
$$;

-- The game's server, a room solved: it opens, and what's in it happens.
create or replace function public.house_room_open(p_user uuid, p_hunt uuid, p_room integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  h public.hunts%rowtype;
  v public.house_room_puzzles%rowtype;
  got text;
  balance bigint;
  t public.trial_attempts%rowtype;
  opened integer;
begin
  select * into s from public.house_here(p_hunt, p_user);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  if not public.house_inside(s.k, s.hp) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room for update;
  if v.room is null then
    return jsonb_build_object('ok', false, 'reason', 'no_puzzle');
  end if;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', v.outcome, 'already', true);
  end if;
  got := (public.house_inner_order(p_user, p_hunt, (s.k).n))[p_room];
  update public.house_room_puzzles set solved_at = now(), outcome = got
   where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if got = 'coins' then
    balance := public.apply_coin_change(p_user, 25, 'earn', 'Coins in a room at Key ' || (s.k).n, 'room:' || p_hunt || ':' || (s.k).n || ':' || p_user);
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'coins', 25, 'balance', balance);
  elsif got = 'chapter' then
    update public.hunt_players set story_chapters = greatest(story_chapters, keys_held + 3)
     where hunt_id = p_hunt and user_id = p_user returning story_chapters into opened;
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'chapter', (s.hp).keys_held + 2);
  elsif got = 'key' then
    -- The key: as a Key Trial won (its bonuses, the finish), from an attempt made for the room.
    select * into h from public.hunts where id = p_hunt;
    select * into t from public.trial_attempts where hunt_id = p_hunt and user_id = p_user and status = 'active' for update;
    if t.id is null then
      insert into public.trial_attempts (hunt_id, user_id, key_n, questions, kind, level, puzzle, deadline, lives)
      values (p_hunt, p_user, (s.k).n, '[]'::jsonb, v.kind, 1, v.puzzle, now() + interval '1 minute', 1)
      returning * into t;
    end if;
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got) || jsonb_build_object('award', public.award_trial(t, h));
  elsif got = 'decoy' then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'penalty', public.deal_penalty(p_user, p_hunt, 'deep'));
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'penalty', public.deal_penalty(p_user, p_hunt, 'soft'));
end;
$$;

revoke execute on function public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb), public.house_room_get(uuid, uuid, integer),
  public.house_room_open(uuid, uuid, integer), public.house_inner_order(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb), public.house_room_get(uuid, uuid, integer),
  public.house_room_open(uuid, uuid, integer) to service_role;

-- The metal detector in the city: how hot a building is (the right one, the ones either side of it in the story's
-- order, or cold). Only with a detector; it never says which plot is right any other way.
create or replace function public.house_detect(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  mine integer;
  right_at integer;
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
  select ord into mine from jsonb_array_elements((s.k).house -> 'rooms') with ordinality x(r, ord) where r ->> 'id' = p_room;
  select ord into right_at from jsonb_array_elements((s.k).house -> 'rooms') with ordinality x(r, ord) where r ->> 'role' = 'right' limit 1;
  if mine is null then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  return jsonb_build_object('ok', true, 'room', p_room,
    'heat', case when mine = right_at then 'hot' when abs(mine - right_at) = 1 then 'warm' else 'cold' end);
end;
$$;
revoke execute on function public.house_detect(uuid, text) from public, anon;
grant execute on function public.house_detect(uuid, text) to authenticated;
