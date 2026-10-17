-- A failed Key Trial says whether a Djinn's Coin spared the player the throw (fail_trial, wonder_powers).

create or replace function public.answer_trial(p_attempt uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.trial_attempts%rowtype;
  h public.hunts%rowtype;
  q jsonb;
  total int;
  held int;
  finished_place int;
  next_riddle text;
  landed jsonb;
begin
  select * into t from public.trial_attempts where id = p_attempt and user_id = uid and status = 'active' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;
  select * into h from public.hunts where id = t.hunt_id;
  q := t.questions -> t.current;

  if now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2) or p_choice is distinct from (q ->> 'answer')::int then
    landed := public.fail_trial(t);
    return jsonb_build_object('ok', true, 'result', 'failed',
      'reason', case when p_choice = -1 or now() > t.asked_at + make_interval(secs => h.seconds_per_question + 2) then 'timeout' else 'wrong' end,
      'correct', q -> 'choices' ->> (q ->> 'answer')::int,
      'lng', landed -> 'lng', 'lat', landed -> 'lat', 'saved', coalesce((landed ->> 'saved')::boolean, false));
  end if;

  if t.current + 1 < jsonb_array_length(t.questions) then
    update public.trial_attempts set current = current + 1, asked_at = now() where id = t.id returning * into t;
    return jsonb_build_object('ok', true, 'result', 'next', 'trial', public.trial_view(t, h.seconds_per_question));
  end if;

  -- Key earned.
  update public.trial_attempts set status = 'passed', ended_at = now() where id = t.id;
  select count(*) into total from public.hunt_keys where hunt_id = t.hunt_id;
  update public.hunt_players
     set keys_held = keys_held + 1, last_key_at = now(), approach_key = null
   where hunt_id = t.hunt_id and user_id = uid
   returning keys_held into held;

  if held >= total then
    -- Lock the hunt's finishers so two players can't take the same place.
    perform 1 from public.hunts where id = t.hunt_id for update;
    select count(*) + 1 into finished_place from public.hunt_players where hunt_id = t.hunt_id and finished_at is not null;
    update public.hunt_players set finished_at = now(), place = finished_place where hunt_id = t.hunt_id and user_id = uid;
    return jsonb_build_object('ok', true, 'result', 'finished', 'keysHeld', held, 'keys', total,
      'place', finished_place, 'winner', finished_place <= h.winners);
  end if;

  select riddle into next_riddle from public.hunt_keys where hunt_id = t.hunt_id and n = held + 1;
  return jsonb_build_object('ok', true, 'result', 'key', 'keysHeld', held, 'keys', total, 'riddle', next_riddle);
end;
$$;
