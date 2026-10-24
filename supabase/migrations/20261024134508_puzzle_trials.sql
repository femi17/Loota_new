-- Key Trials as puzzles (owner, 24 Oct 2026: "I do not want always a question… it should be a task, like solve a
-- puzzle"; "different kinds of mini puzzle game, LinkedIn… Netflix"). A key's trial can be a quiz (as before) or a
-- puzzle: Sentries (after Queens/Starstruck), Route (after Zip) or Adire (after Tango), or one of them at random. A
-- puzzle is made for each attempt (its own seed, harder for later keys) by the game's server (/api/trial/puzzle) the
-- moment the chest opens, kept with its answer here (never sent to the phone), and checked by the server
-- (/api/trial/solve). The clock starts when the puzzle is made; running out of it, or of lives (wrong answers), fails
-- the trial as before (thrown 2 km away).

alter table public.hunt_keys
  add column if not exists trial_kind text not null default 'quiz'
    check (trial_kind in ('quiz', 'sentries', 'route', 'adire', 'puzzle'));

alter table public.trial_attempts
  add column if not exists kind text not null default 'quiz' check (kind in ('quiz', 'sentries', 'route', 'adire')),
  add column if not exists level smallint,
  add column if not exists seed bigint,
  add column if not exists puzzle jsonb,   -- what the player sees
  add column if not exists solution jsonb, -- never sent to the phone
  add column if not exists deadline timestamptz,
  add column if not exists lives smallint not null default 2;

-- Seconds for a puzzle, by kind and level (1 to 3).
create or replace function public.puzzle_seconds(p_kind text, p_level integer) returns integer
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'sentries' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    when 'route' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'adire' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    else 60 end
$$;

create or replace function public.trial_view(t public.trial_attempts, p_seconds integer)
returns jsonb language sql stable set search_path = '' as $$
  select case when t.kind = 'quiz' then jsonb_build_object(
    'attempt', t.id,
    'key', t.key_n,
    'index', t.current,
    'count', jsonb_array_length(t.questions),
    'prompt', t.questions -> t.current ->> 'prompt',
    'choices', t.questions -> t.current -> 'choices',
    'show', t.questions -> t.current ->> 'show',
    'showSeconds', coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0),
    'seconds', p_seconds,
    'secondsLeft', greatest(0, p_seconds + coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0) - extract(epoch from now() - t.asked_at)))
  else jsonb_build_object(
    'attempt', t.id,
    'key', t.key_n,
    'kind', 'puzzle',
    'puzzleKind', t.kind,
    'level', t.level,
    'puzzle', t.puzzle,
    'lives', t.lives,
    'seconds', public.puzzle_seconds(t.kind, t.level),
    'secondsLeft', case when t.deadline is null then null else greatest(0, extract(epoch from t.deadline - now())) end)
  end;
$$;

-- A trial left running: a quiz question out of time, or a puzzle past its clock (or never opened in 3 minutes).
create or replace function public.settle_trial(p_hunt uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trial_attempts%rowtype;
  seconds int;
begin
  select a.* into t from public.trial_attempts a
   where a.hunt_id = p_hunt and a.user_id = p_user and a.status = 'active' for update;
  if not found then
    return null;
  end if;
  if t.kind <> 'quiz' then
    if (t.deadline is not null and now() > t.deadline + interval '5 seconds')
       or (t.deadline is null and now() > t.started_at + interval '3 minutes') then
      return public.fail_trial(t);
    end if;
    return null;
  end if;
  select seconds_per_question into seconds from public.hunts where id = p_hunt;
  if now() > t.asked_at + make_interval(secs => seconds + 2 + coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0)) then
    return public.fail_trial(t);
  end if;
  return null;
end;
$$;

-- The key earned (and any bonuses: first to it, golden minutes, a showdown won): shared by quizzes and puzzles.
create or replace function public.award_trial(t public.trial_attempts, h public.hunts)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  total int;
  held int;
  finished_place int;
  next_riddle text;
  bonuses jsonb;
begin
  update public.trial_attempts set status = 'passed', ended_at = now() where id = t.id returning * into t;
  bonuses := public.key_bonuses(t, h);
  select count(*) into total from public.hunt_keys where hunt_id = t.hunt_id;
  update public.hunt_players
     set keys_held = keys_held + 1, last_key_at = now(), approach_key = null
   where hunt_id = t.hunt_id and user_id = t.user_id
   returning keys_held into held;

  if held >= total then
    -- Lock the hunt's finishers so two players can't take the same place.
    perform 1 from public.hunts where id = t.hunt_id for update;
    select count(*) + 1 into finished_place from public.hunt_players where hunt_id = t.hunt_id and finished_at is not null;
    update public.hunt_players set finished_at = now(), place = finished_place where hunt_id = t.hunt_id and user_id = t.user_id;
    return jsonb_build_object('ok', true, 'result', 'finished', 'keysHeld', held, 'keys', total,
      'place', finished_place, 'winner', finished_place <= h.winners, 'bonuses', bonuses);
  end if;

  select riddle into next_riddle from public.hunt_keys where hunt_id = t.hunt_id and n = held + 1;
  return jsonb_build_object('ok', true, 'result', 'key', 'keysHeld', held, 'keys', total, 'riddle', next_riddle, 'bonuses', bonuses);
end;
$$;
revoke execute on function public.award_trial(public.trial_attempts, public.hunts) from public, anon, authenticated;

create or replace function public.answer_trial(p_attempt uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trial_attempts%rowtype;
  h public.hunts%rowtype;
  q jsonb;
  landed jsonb;
  extra integer; -- seconds a memory question is shown before it's asked
begin
  select * into t from public.trial_attempts where id = p_attempt and user_id = uid and status = 'active' for update;
  if not found or t.kind <> 'quiz' then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;
  select * into h from public.hunts where id = t.hunt_id;
  q := t.questions -> t.current;
  extra := coalesce((q ->> 'showSeconds')::integer, 0);

  if now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2 + extra) or p_choice is distinct from (q ->> 'answer')::int then
    landed := public.fail_trial(t);
    return jsonb_build_object('ok', true, 'result', 'failed',
      'reason', case when p_choice = -1 or now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2 + extra) then 'timeout' else 'wrong' end,
      'correct', q -> 'choices' ->> (q ->> 'answer')::int,
      'lng', landed -> 'lng', 'lat', landed -> 'lat', 'saved', coalesce((landed ->> 'saved')::boolean, false));
  end if;

  if t.current + 1 < jsonb_array_length(t.questions) then
    update public.trial_attempts set current = current + 1, asked_at = now() where id = t.id returning * into t;
    return jsonb_build_object('ok', true, 'result', 'next', 'trial', public.trial_view(t, h.seconds_per_question));
  end if;
  return public.award_trial(t, h);
end;
$$;

-- The game's server made the attempt's puzzle: keep it (and its answer) and start the clock. Only the first one counts.
create or replace function public.puzzle_ready(p_attempt uuid, p_puzzle jsonb, p_solution jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trial_attempts%rowtype;
begin
  update public.trial_attempts
     set puzzle = p_puzzle, solution = p_solution, deadline = now() + make_interval(secs => public.puzzle_seconds(kind, level))
   where id = p_attempt and status = 'active' and kind <> 'quiz' and puzzle is null
   returning * into t;
  if not found then
    select * into t from public.trial_attempts where id = p_attempt;
  end if;
  return public.trial_view(t, 0);
end;
$$;

-- The game's server checked a puzzle's answer: right, the key; wrong, a life (none left: failed); late, failed.
create or replace function public.puzzle_result(p_attempt uuid, p_right boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trial_attempts%rowtype;
  h public.hunts%rowtype;
  landed jsonb;
begin
  select * into t from public.trial_attempts where id = p_attempt and status = 'active' and kind <> 'quiz' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;
  select * into h from public.hunts where id = t.hunt_id;
  if t.deadline is null or now() > t.deadline + interval '3 seconds' then
    landed := public.fail_trial(t);
    return jsonb_build_object('ok', true, 'result', 'failed', 'reason', 'timeout', 'correct', null,
      'lng', landed -> 'lng', 'lat', landed -> 'lat', 'saved', coalesce((landed ->> 'saved')::boolean, false));
  end if;
  if p_right then
    return public.award_trial(t, h);
  end if;
  if t.lives > 1 then
    update public.trial_attempts set lives = lives - 1 where id = t.id;
    return jsonb_build_object('ok', true, 'result', 'wrong', 'lives', t.lives - 1);
  end if;
  landed := public.fail_trial(t);
  return jsonb_build_object('ok', true, 'result', 'failed', 'reason', 'wrong', 'correct', null,
    'lng', landed -> 'lng', 'lat', landed -> 'lat', 'saved', coalesce((landed ->> 'saved')::boolean, false));
end;
$$;
revoke execute on function public.puzzle_ready(uuid, jsonb, jsonb), public.puzzle_result(uuid, boolean) from public, anon, authenticated;
grant execute on function public.puzzle_ready(uuid, jsonb, jsonb), public.puzzle_result(uuid, boolean) to service_role;

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
              case when k.trial_kind = 'puzzle' then (array['sentries', 'route', 'adire'])[1 + floor(random() * 3)::integer] else k.trial_kind end,
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
