-- The house (owner, 31 Oct 2026: "a scene, like an open house, like sims"; "7 pathways… someone who is in the right
-- location but goes to a wrong path gets a soft punishment"; "the story points to a room, to collect something and then
-- use in another room"; objects must not glow; not every key has a house). A story key may have a house: at its place
-- the hunter walks into it; one room holds the chest, some rooms are traps (a random soft penalty, thrown out), some are
-- safe and hold things; a room can be locked until the hunter carries the right thing.
--   hunt_keys.house (server only), e.g.
--     { "title": "The keeper's house",
--       "items": { "brass-key": { "name": "A small brass key", "icon": "🗝️" } },
--       "rooms": [ { "id": "study", "name": "Study", "kind": "study", "role": "safe",
--                    "objects": [ { "id": "portrait", "kind": "picture", "label": "An old man's portrait",
--                                   "look": "A stern old man in a sailor's cap.", "gives": "brass-key",
--                                   "found": "Taped behind the frame: a small brass key." } ] },
--                  { "id": "bedroom", "name": "Bedroom", "kind": "bedroom", "role": "right", "needs": "brass-key",
--                    "lockedText": "Locked. A small brass keyhole." },
--                  { "id": "cellar", "name": "Cellar", "kind": "cellar", "role": "trap" } ] }
--     role: right (the chest), trap (a soft penalty), safe. An object may need an item (lockedText until then) and give
--     one (found). Rooms 3 to 7.
--   hunt_players: house_key (the key the house state is for), house_room (the room they're in), house_items (things
--   carried, and "open:<room>" for doors unlocked), house_out_until (thrown out: the door won't open until then).

alter table public.hunt_keys add column if not exists house jsonb;
alter table public.hunt_players
  add column if not exists house_key integer,
  add column if not exists house_room text,
  add column if not exists house_items text[] not null default '{}',
  add column if not exists house_out_until timestamptz;

-- A soft penalty is the house's: its wait keeps the door shut (not the riddle clock), and it always throws you out.
create or replace function public.deal_penalty(p_user uuid, p_hunt uuid, p_tier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  hp public.hunt_players%rowtype;
  pen public.penalties%rowtype;
  cost integer;
  have bigint;
  balance bigint;
  energy_now integer;
  move_to jsonb;
  out_until timestamptz;
begin
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = p_user;
  select * into pen from public.penalties
   where tier = p_tier and active and code is distinct from hp.last_penalty
     and (effect <> 'back' or hp.leg_lng is not null)
   order by random() limit 1;
  if pen.code is null then
    return null;
  end if;
  cost := pen.amount;
  if pen.effect = 'wait' and p_tier = 'deep' then
    update public.hunt_players set riddle_at = now() + make_interval(secs => pen.amount) where hunt_id = p_hunt and user_id = p_user;
  elsif pen.effect = 'coins' then
    select coins into have from public.profiles where id = p_user;
    cost := least(pen.amount, coalesce(have, 0))::integer;
    if cost > 0 then
      balance := public.apply_coin_change(p_user, -cost, 'spend', 'A trap: ' || pen.title, null);
    else
      balance := coalesce(have, 0);
    end if;
  elsif pen.effect = 'energy' then
    update public.player_positions set energy = greatest(0, energy - pen.amount) where user_id = p_user returning energy into energy_now;
  elsif pen.effect = 'back' then
    update public.player_positions set lng = hp.leg_lng, lat = hp.leg_lat, updated_at = now(), resting_since = null where user_id = p_user;
    update public.player_vehicles set lng = hp.leg_lng, lat = hp.leg_lat where user_id = p_user and in_use;
    move_to := jsonb_build_object('lng', hp.leg_lng, 'lat', hp.leg_lat);
  end if;
  if p_tier = 'soft' then
    -- Thrown out of the house: the door stays shut for the wait (or a few seconds to get your breath back).
    out_until := now() + make_interval(secs => case when pen.effect = 'wait' then pen.amount else 15 end);
    update public.hunt_players set house_room = null, house_out_until = out_until where hunt_id = p_hunt and user_id = p_user;
  end if;
  update public.hunt_players set last_penalty = pen.code, penalties_taken = penalties_taken + 1 where hunt_id = p_hunt and user_id = p_user;
  return jsonb_build_object('code', pen.code, 'tier', pen.tier, 'title', pen.title, 'body', pen.body, 'scene', pen.scene,
    'effect', pen.effect, 'amount', cost, 'balance', balance, 'energy', energy_now, 'moveTo', move_to,
    'until', case when p_tier = 'soft' then out_until when pen.effect = 'wait' then now() + make_interval(secs => pen.amount) end);
end;
$$;
revoke execute on function public.deal_penalty(uuid, uuid, text) from public, anon, authenticated;

-- The hunter's house, if they stand at their next key's place and it has one: the house state starts again for each
-- key. Answers what the hunter may see (never which room is right, which are traps or what anything hides).
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
    update public.hunt_players p set house_key = k.n, house_room = null, house_items = '{}', house_out_until = null
     where p.hunt_id = p_hunt and p.user_id = uid returning * into hp;
  end if;
  return next;
end;
$$;
revoke execute on function public.house_here(uuid, uuid) from public, anon, authenticated;

create or replace function public.house_public(k public.hunt_keys, hp public.hunt_players)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'key', k.n,
    'title', coalesce(k.house ->> 'title', 'The house'),
    'room', hp.house_room,
    'outUntil', hp.house_out_until,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r ->> 'id', 'name', r ->> 'name', 'kind', r ->> 'kind',
                'locked', r ? 'needs' and not (('open:' || (r ->> 'id')) = any (hp.house_items)),
                'chest', (r ->> 'role') = 'right' and hp.house_room = (r ->> 'id')) order by ord), '[]'::jsonb)
              from jsonb_array_elements(k.house -> 'rooms') with ordinality as x(r, ord)),
    'objects', (select coalesce(jsonb_agg(jsonb_build_object('id', o ->> 'id', 'room', r ->> 'id', 'kind', o ->> 'kind', 'label', o ->> 'label')), '[]'::jsonb)
                from jsonb_array_elements(k.house -> 'rooms') r, jsonb_array_elements(coalesce(r -> 'objects', '[]'::jsonb)) o),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i, 'name', k.house -> 'items' -> i ->> 'name', 'icon', coalesce(k.house -> 'items' -> i ->> 'icon', '📦'))), '[]'::jsonb)
              from unnest(hp.house_items) i where i not like 'open:%'),
    'at', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat));
$$;
revoke execute on function public.house_public(public.hunt_keys, public.hunt_players) from public, anon, authenticated;

-- Walk into the house: the hunter stands at the chest's spot (the house is built round it).
create or replace function public.house_view(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.house_here(p_hunt, uid);
  if s.reason is not null then
    return jsonb_build_object('ok', false, 'reason', s.reason);
  end if;
  update public.player_positions set lng = (s.k).spot_lng, lat = (s.k).spot_lat, updated_at = now() where user_id = uid;
  return jsonb_build_object('ok', true) || public.house_public(s.k, s.hp);
end;
$$;

-- Try a room's door: locked (unless the hunter carries what opens it), a trap (a soft penalty, thrown out), or in.
create or replace function public.house_enter(p_hunt uuid, p_room text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s record;
  r jsonb;
  used jsonb;
  penalty jsonb;
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
    penalty := public.deal_penalty(uid, p_hunt, 'soft');
    return jsonb_build_object('ok', true, 'trap', true, 'used', used, 'penalty', penalty);
  end if;
  update public.hunt_players set house_room = p_room where hunt_id = p_hunt and user_id = uid returning * into hp;
  return jsonb_build_object('ok', true, 'used', used) || public.house_public(s.k, hp);
end;
$$;

-- Touch something in the room you're in: what you see, and what you find (an object may need something first).
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

grant execute on function public.house_view(uuid), public.house_enter(uuid, text), public.house_touch(uuid, text) to authenticated;
revoke execute on function public.house_view(uuid), public.house_enter(uuid, text), public.house_touch(uuid, text) from public, anon;

-- The chest of a key with a house opens only from its right room (no searching round the outside).
create or replace function public.search_here(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  t public.trial_attempts%rowtype;
  pos jsonb;
  to_spot double precision;
  to_area double precision;
  total int;
  thrown jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if not found or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_joined');
  end if;
  if hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'finished');
  end if;

  thrown := public.settle_trial(p_hunt, uid);
  if thrown is not null then
    return jsonb_build_object('ok', false, 'reason', 'thrown') || thrown;
  end if;
  select * into t from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active';
  if found then
    return jsonb_build_object('ok', true, 'result', 'trial', 'trial', public.trial_view(t, h.seconds_per_question));
  end if;

  -- The riddle clock is running and they haven't named the place yet.
  if hp.riddle_n = hp.keys_held + 1 and hp.riddle_at is not null and hp.guess_n is distinct from hp.riddle_n then
    return jsonb_build_object('ok', false, 'reason', 'answer_first');
  end if;

  if hp.last_search_at > now() - interval '4 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'wait');
  end if;
  update public.hunt_players set last_search_at = now() where hunt_id = p_hunt and user_id = uid;

  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return pos || jsonb_build_object('reason', 'position');
  end if;

  select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_key');
  end if;
  -- A house: the chest is in one of its rooms, and only that room's chest opens.
  if k.house is not null and not exists (select 1 from jsonb_array_elements(k.house -> 'rooms') r
                                          where r ->> 'id' = hp.house_room and r ->> 'role' = 'right') then
    return jsonb_build_object('ok', false, 'reason', 'house');
  end if;
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);

  if to_spot <= 60 then
    select count(*) into total from public.hunt_keys where hunt_id = p_hunt;
    if k.trial_kind = 'quiz' then
      insert into public.trial_attempts (hunt_id, user_id, key_n, questions)
      values (p_hunt, uid, k.n, public.make_trial(k.category, h.questions_per_trial, least(3, 1 + ((k.n - 1) * 3) / greatest(total, 1))))
      returning * into t;
    else
      -- A puzzle: made by the game's server when the phone asks for it (/api/trial/puzzle); its clock starts then.
      insert into public.trial_attempts (hunt_id, user_id, key_n, questions, kind, level, seed)
      values (p_hunt, uid, k.n, '[]'::jsonb,
              case when k.trial_kind = 'puzzle' then public.random_puzzle_kind() else k.trial_kind end,
              least(3, 1 + ((k.n - 1) * 3) / greatest(total, 1)), floor(random() * 2147483647)::bigint)
      returning * into t;
    end if;
    return jsonb_build_object('ok', true, 'result', 'trial', 'trial', public.trial_view(t, h.seconds_per_question));
  end if;

  if to_area <= k.area_radius_m or to_spot <= 1000 then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
    return jsonb_build_object('ok', true, 'result', 'area',
      'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'),
      'band', public.distance_band(to_spot));
  end if;

  return jsonb_build_object('ok', true, 'result', 'cold', 'band', public.distance_band(to_area));
end;
$$;

-- The key's pulse: at a story key's place, whether it has a house to walk into.
create or replace function public.key_pulse(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  pos jsonb;
  to_spot double precision;
  to_area double precision;
  reach double precision;
  heat double precision;
  far_m double precision; -- how far the detector reaches (twice as far in golden minutes, 1.5 times with a detector)
  trap jsonb;
  outside boolean;
  has_detector boolean;
  penalty jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', case when hp.user_id is null then 'not_joined' else 'finished' end);
  end if;
  if exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'trial');
  end if;
  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
  if k.n is null then
    return jsonb_build_object('ok', false, 'reason', 'no_key');
  end if;
  select coalesce(detector, false) into has_detector from public.profiles where id = uid;
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);
  far_m := (case when public.golden_until(h) is not null then 2 else 1 end) * (case when has_detector then 1.5 else 1 end);
  reach := greatest(coalesce(k.area_radius_m, 1000), 1000) * far_m;
  -- An exact key: only the place itself (or the chest) counts, however good the detector.
  outside := case when k.exact_m is not null then to_area > k.exact_m and to_spot > k.exact_m
                  else to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m end;
  -- At their answer, and it isn't here: a new 15 seconds to answer again (and, at a story key, a deep penalty).
  if outside and hp.guess_n = k.n and public.distance_m(p_lng, p_lat, hp.guess_lng, hp.guess_lat) <= 150 then
    update public.hunt_players set guess_n = null, riddle_n = k.n, riddle_at = now() where hunt_id = p_hunt and user_id = uid;
    if k.exact_m is not null then
      penalty := public.deal_penalty(uid, p_hunt, 'deep');
    end if;
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'wrongPlace', hp.guess_name, 'detector', has_detector, 'penalty', penalty);
  end if;
  if outside and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'detector', has_detector);
  end if;
  if hp.approach_key is distinct from k.n then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
  end if;
  -- A story key: no hot and cold, the chest is right there.
  if k.exact_m is not null then
    return jsonb_build_object('ok', true, 'inArea', true, 'exact', true, 'key', k.n, 'near', to_spot <= 60,
      'spot', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat, 'scene', k.scene), 'detector', has_detector,
      'house', k.house is not null, 'clue', 'This is the place.');
  end if;
  -- The Masquerade's decoy, rising like the real chest (not once it's been sprung).
  if k.trap_lng is not null and not (k.n = any (hp.traps_sprung))
     and public.distance_m(p_lng, p_lat, k.trap_lng, k.trap_lat) <= 60 then
    trap := jsonb_build_object('lng', k.trap_lng, 'lat', k.trap_lat);
  end if;
  heat := round((greatest(0, least(1, 1 - ln(greatest(to_spot, 60) / 60) / ln(reach / 60))) * 20)::numeric) / 20;
  return jsonb_build_object('ok', true, 'inArea', true, 'key', k.n, 'heat', heat, 'near', to_spot <= 60,
    'spot', case when to_spot <= 60 then jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat, 'scene', k.scene) end,
    'trap', trap, 'detector', has_detector,
    'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'));
end;
$$;
