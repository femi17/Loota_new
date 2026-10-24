-- Torn Map in the trials (owner, 24 Oct 2026: more puzzle kinds): its clock, and in the random pick (random_puzzle_kind,
-- so the next kind is one line).

create or replace function public.puzzle_seconds(p_kind text, p_level integer) returns integer
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'sentries' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    when 'route' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'adire' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    when 'tornmap' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    else 60 end
$$;

-- A key set to "a puzzle at random": which one this attempt gets.
create or replace function public.random_puzzle_kind() returns text
language sql volatile set search_path = '' as $$
  select (array['sentries', 'route', 'adire', 'tornmap'])[1 + floor(random() * 4)::integer]
$$;

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
