-- Three locks in a chain at a key's place (owner, 12 Nov 2026: "for key location… Let it have 3 puzzles to solve. 1 is
-- too simple and easy. from 1 to another, another to look for the next puzzle to another house, then they key the
-- key"). The key's chest (room 1, in the right house) is the first lock: opened, it holds a note naming the house of
-- the second lock (room 6); that one, the third (room 7); the third holds the key. Rooms 2–5 keep their coins, story
-- page, fake chest and trap. A lock can't be opened (nor its puzzle dealt) before the one before it is.
set lock_timeout = '8s';

create or replace function public.house_inner_order(p_user uuid, p_hunt uuid, p_key integer)
returns text[] language sql immutable set search_path = '' as $$
  select array['lock'] || (select array_agg(c order by md5(p_user::text || ':' || p_hunt::text || ':' || p_key::text || ':' || c))
    from unnest(array['coins', 'chapter', 'decoy', 'trap']) c) || array['lock', 'key']
$$;

/** The lock before this one in the chain (room 6 needs room 1 open, room 7 needs room 6): null when it's open or none. */
create or replace function public.house_chain_waiting(p_user uuid, p_hunt uuid, p_key integer, p_room integer)
returns integer language sql stable security definer set search_path = '' as $$
  select before from (select case p_room when 6 then 1 when 7 then 6 end as before) b
   where before is not null
     and not exists (select 1 from public.house_room_puzzles p
                      where p.user_id = p_user and p.hunt_id = p_hunt and p.key_n = p_key and p.room = b.before and p.solved_at is not null);
$$;
revoke all on function public.house_chain_waiting(uuid, uuid, integer, integer) from public, anon, authenticated;

do $$
declare
  d text;
  f text;
begin
  -- Rooms 1 to 7
  foreach f in array array['public.house_room_detect(uuid,integer)', 'public.house_room_ready(uuid,uuid,integer,text,jsonb,jsonb,integer,integer)',
                           'public.house_room_ready(uuid,uuid,integer,text,jsonb,jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('not between 1 and 5' in d) = 0 then
      raise exception '% changed', f;
    end if;
    execute replace(d, 'not between 1 and 5', 'not between 1 and 7');
  end loop;
  -- The rooms the hunter sees: 1 to 7
  d := pg_get_functiondef('public.house_public(public.hunt_keys,public.hunt_players)'::regprocedure);
  if position('generate_series(1, 5)' in d) = 0 then
    raise exception 'house_public changed';
  end if;
  execute replace(d, 'generate_series(1, 5)', 'generate_series(1, 7)');
  -- Not before the lock before it: the try, and the puzzle dealt
  d := pg_get_functiondef('public.house_room_try(uuid,uuid,integer)'::regprocedure);
  if position('  select * into v from public.house_room_puzzles where user_id = p_user' in d) = 0 then
    raise exception 'house_room_try changed';
  end if;
  execute replace(d, '  select * into v from public.house_room_puzzles where user_id = p_user',
    '  if public.house_chain_waiting(p_user, p_hunt, (s.k).n, p_room) is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''chain'', ''before'', public.house_chain_waiting(p_user, p_hunt, (s.k).n, p_room));
  end if;
  select * into v from public.house_room_puzzles where user_id = p_user');
  d := pg_get_functiondef('public.house_room_ready(uuid,uuid,integer,text,jsonb,jsonb,integer,integer)'::regprocedure);
  if position('  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution, started_at, tries, seconds)' in d) = 0 then
    raise exception 'house_room_ready changed';
  end if;
  execute replace(d, '  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution, started_at, tries, seconds)',
    '  if public.house_chain_waiting(p_user, p_hunt, (s.k).n, p_room) is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''chain'');
  end if;
  insert into public.house_room_puzzles (user_id, hunt_id, key_n, room, kind, puzzle, solution, started_at, tries, seconds)');
  -- Opened: a lock holds the way to the next one
  d := pg_get_functiondef('public.house_room_open(uuid,uuid,integer)'::regprocedure);
  if position('  if got = ''coins'' then' in d) = 0 or position('  if v.solved_at is not null then' in d) = 0 then
    raise exception 'house_room_open changed';
  end if;
  d := replace(d, '  if v.solved_at is not null then',
    '  if public.house_chain_waiting(p_user, p_hunt, (s.k).n, p_room) is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''chain'');
  end if;
  if v.solved_at is not null then');
  execute replace(d, '  if got = ''coins'' then',
    '  if got = ''lock'' then
    return jsonb_build_object(''ok'', true, ''room'', p_room, ''outcome'', got, ''next'', case p_room when 1 then 6 else 7 end, ''lock'', case p_room when 1 then 1 else 2 end);
  end if;
  if got = ''coins'' then');
end;
$$;
