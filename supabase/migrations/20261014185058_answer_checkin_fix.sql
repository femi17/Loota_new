-- answer_checkin's variables clashed with the check-in columns (correct, reward) in its
-- update; renamed.
create or replace function public.answer_checkin(p_checkin uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.landmark_checkins%rowtype;
  l public.landmarks%rowtype;
  right_answer integer;
  is_correct boolean;
  is_first boolean;
  pay integer := 0;
  balance bigint;
  target uuid;
  lead_lng double precision;
  lead_lat double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into c from public.landmark_checkins where id = p_checkin and user_id = uid and answered_at is null for update;
  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into l from public.landmarks where id = c.landmark_id;
  right_answer := (l.questions -> c.question ->> 'answer')::integer;
  -- A few seconds' grace for the network.
  is_correct := p_choice = right_answer and now() <= c.deadline + interval '3 seconds';
  if is_correct then
    is_first := not exists (select 1 from public.landmark_checkins x where x.user_id = uid and x.landmark_id = l.id and x.correct);
    pay := case when is_first then public.landmark_reward(l.tier) else public.landmark_reward(l.tier) / 3 end;
    balance := public.apply_coin_change(uid, pay, 'earn', 'Checked in at ' || l.name, 'checkin:' || c.id);
    -- Intel: a real hidden find within 3 km of the landmark, if any is waiting.
    select w.id, w.lng, w.lat into target, lead_lng, lead_lat
      from public.world_items w
     where w.hidden and w.taken_by is null and w.expires_at > now()
       and w.lat between l.lat - 0.03 and l.lat + 0.03 and w.lng between l.lng - 0.03 and l.lng + 0.03
       and public.distance_m(l.lng, l.lat, w.lng, w.lat) < 3000
       and not exists (select 1 from public.player_leads pl where pl.user_id = uid and pl.item_id = w.id)
     order by random() limit 1;
    if target is not null then
      insert into public.player_leads (user_id, item_id, is_decoy, lng, lat) values (uid, target, false, lead_lng, lead_lat);
    end if;
  end if;
  update public.landmark_checkins set answered_at = now(), correct = is_correct, reward = pay where id = c.id;
  return jsonb_build_object('ok', true, 'correct', is_correct, 'late', p_choice = right_answer and not is_correct,
    'answer', l.questions -> c.question -> 'options' ->> right_answer, 'fact', l.fact, 'reward', pay, 'first', coalesce(is_first, false),
    'balance', balance, 'lead', case when target is not null then jsonb_build_object('lng', lead_lng, 'lat', lead_lat) end);
end;
$$;
