-- The riddle clock (owner, 25 Oct 2026: "all users get to answer within 15 seconds, if you do not get or input your
-- answer in that time, you get to wait, while those who inputted a location get to travel, remember no one knows if
-- the location is correct"). When a hunter first sees a riddle (start_riddle), they have 15 s to name the place
-- (lock_guess); miss it and they wait 60 s, then get another 15 s, and so on. Nobody is told whether their place is
-- right: they find out by getting there. Reach your place and it isn't the key's area (key_pulse): the answer is
-- cleared and a new 15 s starts. Until they've answered, a hunter whose clock has started can't search.

alter table public.hunt_players
  add column if not exists riddle_n integer,          -- the stop whose clock is running
  add column if not exists riddle_at timestamptz,     -- when that clock started
  add column if not exists guess_n integer,           -- the stop the answer is for
  add column if not exists guess_lng double precision,
  add column if not exists guess_lat double precision,
  add column if not exists guess_name text,
  add column if not exists guess_at timestamptz;

create or replace function public.riddle_answer_s() returns integer language sql immutable set search_path = '' as $$ select 15 $$;
create or replace function public.riddle_wait_s() returns integer language sql immutable set search_path = '' as $$ select 60 $$;

-- Where a hunter's clock stands for stop n: ready (not started), answer (until endsAt), wait (until), or locked.
create or replace function public.riddle_clock(hp public.hunt_players, n integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  c double precision;
begin
  if hp.guess_n = n then
    return jsonb_build_object('phase', 'locked', 'key', n,
      'guess', jsonb_build_object('name', hp.guess_name, 'lng', hp.guess_lng, 'lat', hp.guess_lat));
  end if;
  if hp.riddle_n is distinct from n or hp.riddle_at is null then
    return jsonb_build_object('phase', 'ready', 'key', n, 'answerS', public.riddle_answer_s(), 'waitS', public.riddle_wait_s());
  end if;
  e := extract(epoch from now() - hp.riddle_at);
  c := floor(e / cycle);
  if e - c * cycle < public.riddle_answer_s() then
    return jsonb_build_object('phase', 'answer', 'key', n, 'now', now(),
      'endsAt', hp.riddle_at + make_interval(secs => c * cycle + public.riddle_answer_s()));
  end if;
  return jsonb_build_object('phase', 'wait', 'key', n, 'now', now(),
    'until', hp.riddle_at + make_interval(secs => (c + 1) * cycle));
end;
$$;
revoke execute on function public.riddle_clock(public.hunt_players, integer) from public, anon, authenticated;

-- The clock, as it stands (nothing changes).
create or replace function public.riddle_state(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
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
    return jsonb_build_object('ok', false, 'reason', 'not_hunting');
  end if;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, hp.keys_held + 1);
end;
$$;

-- The hunter sees the riddle: their 15 seconds start (once per stop; again only after a wrong place).
create or replace function public.start_riddle(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid for update;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_hunting');
  end if;
  n := hp.keys_held + 1;
  if hp.guess_n is distinct from n and (hp.riddle_n is distinct from n or hp.riddle_at is null) then
    update public.hunt_players set riddle_n = n, riddle_at = now() where hunt_id = p_hunt and user_id = uid
    returning * into hp;
  end if;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;

-- Lock in a place for the riddle, within the 15 seconds (a second or two of grace for the network).
create or replace function public.lock_guess(p_hunt uuid, p_lng double precision, p_lat double precision, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_lng is null or p_lat is null or abs(p_lng) > 180 or abs(p_lat) > 90 or coalesce(length(trim(p_name)), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_place');
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid for update;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_hunting');
  end if;
  n := hp.keys_held + 1;
  if hp.guess_n = n then
    return jsonb_build_object('ok', false, 'reason', 'locked') || public.riddle_clock(hp, n);
  end if;
  if hp.riddle_n is distinct from n or hp.riddle_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_started') || public.riddle_clock(hp, n);
  end if;
  e := extract(epoch from now() - hp.riddle_at);
  if e - floor(e / cycle) * cycle >= public.riddle_answer_s() + 2 then
    return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
  end if;
  update public.hunt_players
     set guess_n = n, guess_lng = p_lng, guess_lat = p_lat, guess_name = left(trim(p_name), 120), guess_at = now()
   where hunt_id = p_hunt and user_id = uid
  returning * into hp;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;

revoke execute on function public.riddle_state(uuid), public.start_riddle(uuid),
  public.lock_guess(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.riddle_state(uuid), public.start_riddle(uuid),
  public.lock_guess(uuid, double precision, double precision, text) to authenticated;

-- The detector: as before (trap chests and all); and at the hunter's own answer, if it isn't the key's area, the
-- answer is cleared and a new 15 seconds start ("wrongPlace").
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
  far_m double precision; -- how far the detector reaches (twice as far in golden minutes)
  trap jsonb;
  outside boolean;
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
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);
  far_m := case when public.golden_until(h) is not null then 2 else 1 end;
  reach := greatest(coalesce(k.area_radius_m, 1000), 1000) * far_m;
  outside := to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m;
  -- At their answer, and it isn't here: a new 15 seconds to answer again.
  if outside and hp.guess_n = k.n and public.distance_m(p_lng, p_lat, hp.guess_lng, hp.guess_lat) <= 150 then
    update public.hunt_players set guess_n = null, riddle_n = k.n, riddle_at = now() where hunt_id = p_hunt and user_id = uid;
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'wrongPlace', hp.guess_name);
  end if;
  if outside and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n);
  end if;
  if hp.approach_key is distinct from k.n then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
  end if;
  -- The Masquerade's decoy, rising like the real chest (not once it's been sprung).
  if k.trap_lng is not null and not (k.n = any (hp.traps_sprung))
     and public.distance_m(p_lng, p_lat, k.trap_lng, k.trap_lat) <= 60 then
    trap := jsonb_build_object('lng', k.trap_lng, 'lat', k.trap_lat);
  end if;
  heat := round((greatest(0, least(1, 1 - ln(greatest(to_spot, 60) / 60) / ln(reach / 60))) * 20)::numeric) / 20;
  return jsonb_build_object('ok', true, 'inArea', true, 'key', k.n, 'heat', heat, 'near', to_spot <= 60,
    'spot', case when to_spot <= 60 then jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat, 'scene', k.scene) end,
    'trap', trap,
    'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'));
end;
$$;

-- Searching: as before, but a hunter whose clock is running must name the place first.
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
