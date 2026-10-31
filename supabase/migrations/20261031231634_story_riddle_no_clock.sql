-- No answer clock in a story hunt (owner, 1 Nov 2026: "If users knows the answer, let them begin to travel when they
-- are ready"). The story is the riddle: a hunter names the key's place whenever they like (phase 'open'), with no 15
-- seconds and no minute's wait. A penalty's wait (a clock started in the future) still holds them until it ends.
-- Older hunts keep the clock.
create or replace function public.riddle_clock(hp public.hunt_players, n integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  c double precision;
  story boolean := exists (select 1 from public.hunts where id = hp.hunt_id and story is not null);
begin
  if hp.guess_n = n then
    return jsonb_build_object('phase', 'locked', 'key', n, 'story', story,
      'guess', jsonb_build_object('name', hp.guess_name, 'lng', hp.guess_lng, 'lat', hp.guess_lat));
  end if;
  if story then
    -- A penalty's wait first; then not yet started (start_riddle marks the stop, so a search needs a named place); then open.
    if hp.riddle_at > now() then
      return jsonb_build_object('phase', 'wait', 'key', n, 'story', true, 'now', now(), 'until', hp.riddle_at);
    end if;
    if hp.riddle_n is distinct from n or hp.riddle_at is null then
      return jsonb_build_object('phase', 'ready', 'key', n, 'story', true);
    end if;
    return jsonb_build_object('phase', 'open', 'key', n, 'story', true);
  end if;
  if hp.riddle_n is distinct from n or hp.riddle_at is null then
    return jsonb_build_object('phase', 'ready', 'key', n, 'answerS', public.riddle_answer_s(), 'waitS', public.riddle_wait_s());
  end if;
  if hp.riddle_at > now() then
    return jsonb_build_object('phase', 'wait', 'key', n, 'now', now(), 'until', hp.riddle_at);
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

-- Naming a place: in a story hunt, any time (not during a penalty's wait); otherwise within the 15 seconds.
create or replace function public.lock_guess(p_hunt uuid, p_lng double precision, p_lat double precision, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  here record;
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
  if h.story is not null then
    if hp.riddle_at > now() then
      return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
    end if;
  else
    if hp.riddle_n is distinct from n or hp.riddle_at is null then
      return jsonb_build_object('ok', false, 'reason', 'not_started') || public.riddle_clock(hp, n);
    end if;
    if hp.riddle_at > now() then
      return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
    end if;
    e := extract(epoch from now() - hp.riddle_at);
    if e - floor(e / cycle) * cycle >= public.riddle_answer_s() + 2 then
      return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
    end if;
  end if;
  select lng, lat into here from public.player_positions where user_id = uid;
  update public.hunt_players
     set guess_n = n, guess_lng = p_lng, guess_lat = p_lat, guess_name = left(trim(p_name), 120), guess_at = now(),
         leg_lng = here.lng, leg_lat = here.lat
   where hunt_id = p_hunt and user_id = uid
  returning * into hp;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;

-- Opening a riddle never cuts short a penalty's wait (a story hunt opens it after a wrong place, too).
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
    update public.hunt_players set riddle_n = n, riddle_at = greatest(now(), coalesce(riddle_at, now()))
     where hunt_id = p_hunt and user_id = uid
    returning * into hp;
  end if;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;
