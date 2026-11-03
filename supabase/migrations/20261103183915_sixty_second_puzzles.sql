-- 60 seconds a puzzle (owner, 3 Nov 2026: "each puzzle time should be 60. You need to verify all the puzzle ditched
-- out can be completed with 60secs"). The Key Trial's puzzles had 90 s to 5 min (sudoku); now every kind at every key
-- has 60 s, the puzzles made smaller to fit (src/game/puzzles/index.ts; scripts/tests/puzzle-sixty-check.mts). The
-- hunt city's room puzzles get the same clock: a room's puzzle runs 60 s (3 s grace for the network); out of time, its
-- lock jams for 30 s, then a new puzzle of its kind is set (the try counts up: the game's server makes it from it).

create or replace function public.puzzle_seconds(p_kind text, p_level integer)
returns integer language sql immutable set search_path = '' as $$ select 60 $$;

alter table public.house_room_puzzles
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists tries integer not null default 0;

-- The game's server, before making a room's puzzle: which try it is (or jammed, or open already).
create or replace function public.house_room_try(p_user uuid, p_hunt uuid, p_room integer)
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
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.room is null then
    return jsonb_build_object('ok', true, 'try', 0);
  end if;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'open', true, 'outcome', v.outcome);
  end if;
  if now() <= v.started_at + interval '63 seconds' then
    return jsonb_build_object('ok', true, 'try', v.tries);
  end if;
  if now() < v.started_at + interval '93 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'jammed', 'seconds', ceil(extract(epoch from v.started_at + interval '93 seconds' - now())));
  end if;
  return jsonb_build_object('ok', true, 'try', v.tries + 1);
end;
$$;

-- The game's server: a room's puzzle for this try (a later try replaces the one that ran out), and its time left.
create or replace function public.house_room_ready(p_user uuid, p_hunt uuid, p_room integer, p_kind text, p_puzzle jsonb, p_solution jsonb, p_try integer)
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
  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution, started_at, tries)
  values (p_user, p_hunt, (s.k).n, p_room, p_kind, p_puzzle, p_solution, now(), coalesce(p_try, 0))
  on conflict (user_id, hunt_id, key_n, room) do update
     set kind = excluded.kind, puzzle = excluded.puzzle, solution = excluded.solution, started_at = now(), tries = excluded.tries
   where public.house_room_puzzles.solved_at is null and public.house_room_puzzles.tries < excluded.tries;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'open', true, 'outcome', v.outcome);
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'open', false, 'kind', v.kind, 'puzzle', v.puzzle,
    'secondsLeft', greatest(0, ceil(extract(epoch from v.started_at + interval '60 seconds' - now()))));
end;
$$;

-- The game's server: a room's puzzle with its answer, and whether its time has run out.
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
  return jsonb_build_object('ok', true, 'kind', v.kind, 'puzzle', v.puzzle, 'solution', v.solution, 'open', v.solved_at is not null,
    'late', v.solved_at is null and now() > v.started_at + interval '63 seconds');
end;
$$;

revoke execute on function public.house_room_try(uuid, uuid, integer), public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.house_room_try(uuid, uuid, integer), public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb, integer) to service_role;

-- Buried treasure (owner, 3 Nov 2026: "some treasure might be under the ground no need to enter a house, the metal
-- detector helps here… some houses might be empty, no decoy just nothing"). A story place may be outdoor (a yard, a
-- garden, a well, a square: "outdoor": true in the story's house): no building, the treasure buried in it; dug, the
-- chest comes up (opened, the Key Trial). Only the right building (not outdoor) holds the five rooms. The detector
-- reads outdoor places too.
create or replace function public.house_inside(k public.hunt_keys, hp public.hunt_players)
returns boolean language sql stable set search_path = '' as $$
  select hp.house_dug is not null and exists (
    select 1 from jsonb_array_elements(k.house -> 'rooms') r
     where r ->> 'id' = hp.house_dug and r ->> 'role' = 'right' and not coalesce((r ->> 'outdoor')::boolean, false))
$$;

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
                'outdoor', coalesce((r ->> 'outdoor')::boolean, false),
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
