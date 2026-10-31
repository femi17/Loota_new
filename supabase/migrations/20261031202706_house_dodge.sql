-- Dodging a trap (owner, 31 Oct 2026: "Can they dodge any of the trap? like solve a question under a time limit";
-- "Do both"). Only in a house: a trap room springs a quick challenge (5 seconds to answer; the server allows 7 for the
-- network). The right answer in time: you jump clear (still out of that room, no cost). Wrong, or too slow: the soft
-- penalty. The wrong location is never dodgeable. The answer stays on the server.
--   hunt_players.house_dodge: the challenge waiting for an answer { room, answer, until } (null: none).

alter table public.hunt_players add column if not exists house_dodge jsonb;

-- A quick challenge: a prompt and 4 options (the answer's place among them, 1 to 4, kept on the server).
create or replace function public.house_challenge()
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  kind int := 1 + floor(random() * 5)::int;
  prompt text;
  right_one text;
  wrong text[];
  options text[];
  a int;
  b int;
  pair text[];
  pairs text[][] := array[['🐍','🦎'], ['🦇','🐦'], ['🍎','🍏'], ['🌙','⭐'], ['🐟','🐠'], ['🔥','💧'], ['🔑','🔒'], ['🕯️','💡']];
  arrows text[] := array['⬅️', '➡️', '⬆️', '⬇️'];
  words text[] := array['Left', 'Right', 'Up', 'Down'];
  colours text[] := array['Green', 'Purple', 'Orange', 'Yellow', 'Silver', 'Scarlet', 'Indigo', 'Brown'];
  things text[] := array['Table', 'River', 'Spoon', 'Window', 'Pillow', 'Ladder', 'Candle', 'Basket', 'Engine', 'Garden'];
  i int;
begin
  if kind = 1 then
    a := 3 + floor(random() * 7)::int;
    b := 3 + floor(random() * 7)::int;
    prompt := format('Quick! %s + %s = ?', a, b);
    right_one := (a + b)::text;
    wrong := array[(a + b + 1)::text, (a + b - 1)::text, (a + b + 2)::text];
  elsif kind = 2 then
    i := 1 + floor(random() * array_length(pairs, 1))::int;
    pair := array[pairs[i][1], pairs[i][2]];
    prompt := 'Tap the odd one out!';
    right_one := pair[2];
    -- three of the same; told apart by their place, so give each its own label
    wrong := array[pair[1] || ' ', ' ' || pair[1], pair[1]];
  elsif kind = 3 then
    i := 1 + floor(random() * 4)::int;
    prompt := format('Jump the way it points: %s', arrows[i]);
    right_one := words[i];
    wrong := array(select w from unnest(words) w where w <> words[i]);
  elsif kind = 4 then
    a := 3 + floor(random() * 5)::int;
    prompt := format('How many? %s', repeat('🦇', a));
    right_one := a::text;
    wrong := array[(a - 1)::text, (a + 1)::text, (a + 2)::text];
  else
    prompt := 'Which one is a colour?';
    right_one := colours[1 + floor(random() * array_length(colours, 1))::int];
    wrong := array(select t from unnest(things) t order by random() limit 3);
  end if;
  select array_agg(o order by random()) into options from unnest(array[right_one] || wrong) o;
  return jsonb_build_object('kind', kind, 'prompt', prompt, 'options', to_jsonb(options), 'answer', array_position(options, right_one));
end;
$$;
revoke execute on function public.house_challenge() from public, anon, authenticated;

-- A challenge left unanswered past its time (the app closed, the phone slept): the trap springs.
create or replace function public.house_settle_dodge(p_hunt uuid, uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
begin
  select house_dodge into d from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if d is null then
    return null;
  end if;
  update public.hunt_players set house_dodge = null where hunt_id = p_hunt and user_id = uid;
  return public.deal_penalty(uid, p_hunt, 'soft');
end;
$$;
revoke execute on function public.house_settle_dodge(uuid, uuid) from public, anon, authenticated;

-- Walk into the house (a challenge still waiting from before springs its trap first).
create or replace function public.house_view(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  penalty jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  if (s.hp).house_dodge is not null then
    penalty := public.house_settle_dodge(p_hunt, uid);
    return jsonb_build_object('ok', false, 'reason', 'trapped', 'penalty', penalty);
  end if;
  update public.player_positions set lng = (s.k).spot_lng, lat = (s.k).spot_lat, updated_at = now() where user_id = uid;
  return jsonb_build_object('ok', true) || public.house_public(s.k, s.hp);
end;
$$;

-- Try a room's door: locked, a trap (a challenge to dodge it), or in.
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
  update public.hunt_players set house_room = p_room where hunt_id = p_hunt and user_id = uid returning * into hp;
  return jsonb_build_object('ok', true, 'used', used) || public.house_public(s.k, hp);
end;
$$;

-- Answer the challenge: the right one in time, and you jump clear; otherwise the trap springs.
create or replace function public.house_dodge(p_hunt uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  d jsonb;
  late boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  d := (s.hp).house_dodge;
  if d is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  update public.hunt_players set house_dodge = null where hunt_id = p_hunt and user_id = uid;
  late := (d ->> 'until')::timestamptz < now();
  if not late and p_choice = (d ->> 'answer')::int then
    update public.hunt_players set house_room = null, house_out_until = now() + interval '3 seconds' where hunt_id = p_hunt and user_id = uid;
    return jsonb_build_object('ok', true, 'dodged', true, 'room', d ->> 'room');
  end if;
  return jsonb_build_object('ok', true, 'dodged', false, 'late', late, 'room', d ->> 'room', 'penalty', public.deal_penalty(uid, p_hunt, 'soft'));
end;
$$;
grant execute on function public.house_dodge(uuid, int) to authenticated;
revoke execute on function public.house_dodge(uuid, int) from public, anon;

-- Touching things waits too while a challenge is open.
create or replace function public.house_touch(p_hunt uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  o jsonb;
  room text;
  gained jsonb;
  said text;
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
  select x, r ->> 'id' into o, room
    from jsonb_array_elements((s.k).house -> 'rooms') r, jsonb_array_elements(coalesce(r -> 'objects', '[]'::jsonb)) x
   where x ->> 'id' = p_object;
  if o is null then
    return jsonb_build_object('ok', false, 'reason', 'no_object');
  end if;
  if room is distinct from hp.house_room then
    return jsonb_build_object('ok', false, 'reason', 'not_here');
  end if;
  said := coalesce(o ->> 'look', 'Nothing unusual.');
  if o ? 'needs' and not ((o ->> 'needs') = any (hp.house_items)) then
    said := said || ' ' || coalesce(o ->> 'lockedText', 'It won''t open.');
  elsif o ? 'gives' and not ((o ->> 'gives') = any (hp.house_items)) then
    update public.hunt_players set house_items = array_append(house_items, o ->> 'gives')
     where hunt_id = p_hunt and user_id = uid returning * into hp;
    said := coalesce(o ->> 'found', said);
    gained := jsonb_build_object('id', o ->> 'gives', 'name', (s.k).house -> 'items' -> (o ->> 'gives') ->> 'name',
      'icon', coalesce((s.k).house -> 'items' -> (o ->> 'gives') ->> 'icon', '📦'));
  end if;
  return jsonb_build_object('ok', true, 'text', said, 'gained', gained) || public.house_public(s.k, hp);
end;
$$;
