-- Each puzzle its own time (owner, 8 Nov 2026: "add the right time to solving this if 60 secs is not right"): by kind
-- and level, the same table as PUZZLE_SECONDS in src/game/puzzles/index.ts. The Key Trial's puzzles read it through
-- puzzle_seconds(); the hunt city's rooms store theirs (house_room_puzzles.seconds), set by the game's server.
set lock_timeout = '8s';

create or replace function public.puzzle_seconds(p_kind text, p_level integer)
returns integer language sql immutable set search_path = '' as $$
  select (case p_kind
    when 'flags' then array[30, 40, 50]
    when 'brands' then array[30, 40, 50]
    when 'grammar' then array[45, 60, 75]
    when 'algebra' then array[60, 75, 90]
    when 'vowels' then array[60, 90, 120]
    when 'countries' then array[60, 75, 90]
    when 'sudoku' then array[60, 60, 60]
    when 'tornmap' then array[75, 90, 90]
    else array[60, 75, 90]
  end)[greatest(1, least(3, coalesce(p_level, 1)))]
$$;

alter table public.house_room_puzzles add column if not exists seconds integer not null default 60;

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
  if p_room = 1 and not public.house_inside(s.k, s.hp) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.room is null then
    return jsonb_build_object('ok', true, 'try', 0);
  end if;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'open', true, 'outcome', v.outcome);
  end if;
  -- Its own time (3 s grace for the network); out of time, the lock jams for 30 s.
  if now() <= v.started_at + make_interval(secs => v.seconds + 3) then
    return jsonb_build_object('ok', true, 'try', v.tries);
  end if;
  if now() < v.started_at + make_interval(secs => v.seconds + 33) then
    return jsonb_build_object('ok', false, 'reason', 'jammed', 'seconds', ceil(extract(epoch from v.started_at + make_interval(secs => v.seconds + 33) - now())));
  end if;
  return jsonb_build_object('ok', true, 'try', v.tries + 1);
end;
$$;

create or replace function public.house_room_ready(p_user uuid, p_hunt uuid, p_room integer, p_kind text, p_puzzle jsonb, p_solution jsonb, p_try integer, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v public.house_room_puzzles%rowtype;
  secs integer := greatest(20, least(300, coalesce(p_seconds, 60)));
begin
  select * into s from public.house_here(p_hunt, p_user);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  if p_room = 1 and not public.house_inside(s.k, s.hp) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  if p_room is null or p_room not between 1 and 5 then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution, started_at, tries, seconds)
  values (p_user, p_hunt, (s.k).n, p_room, p_kind, p_puzzle, p_solution, now(), coalesce(p_try, 0), secs)
  on conflict (user_id, hunt_id, key_n, room) do update
     set kind = excluded.kind, puzzle = excluded.puzzle, solution = excluded.solution, started_at = now(), tries = excluded.tries, seconds = excluded.seconds
   where public.house_room_puzzles.solved_at is null and public.house_room_puzzles.tries < excluded.tries;
  select * into v from public.house_room_puzzles where user_id = p_user and hunt_id = p_hunt and key_n = (s.k).n and room = p_room;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'open', true, 'outcome', v.outcome);
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'open', false, 'kind', v.kind, 'puzzle', v.puzzle, 'seconds', v.seconds,
    'secondsLeft', greatest(0, ceil(extract(epoch from v.started_at + make_interval(secs => v.seconds) - now()))));
end;
$$;

-- The older call (no time given): 60 seconds.
create or replace function public.house_room_ready(p_user uuid, p_hunt uuid, p_room integer, p_kind text, p_puzzle jsonb, p_solution jsonb, p_try integer)
returns jsonb language sql security definer set search_path = '' as $$
  select public.house_room_ready(p_user, p_hunt, p_room, p_kind, p_puzzle, p_solution, p_try, 60)
$$;

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
    'late', v.solved_at is null and now() > v.started_at + make_interval(secs => v.seconds + 3));
end;
$$;

revoke execute on function public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.house_room_ready(uuid, uuid, integer, text, jsonb, jsonb, integer, integer) to service_role;
