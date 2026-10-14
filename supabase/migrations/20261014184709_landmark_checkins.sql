-- Landmark check-ins (design doc 9; owner's choice, 14 Oct 2026): visit a famous
-- place, answer a question about it in 20 seconds, and earn coins (by the place's
-- fame and remoteness) and intel (a lead to a hidden find nearby, if there is one).
-- One try per landmark a day; after the first right answer, visits pay a third.
-- Landmarks and questions come from scripts/data/landmarks.json
-- (scripts/upload-landmarks.mts). Answers never leave the server.

create table public.landmarks (
  id        bigint generated always as identity primary key,
  name      text not null unique,
  city      text not null,
  lng       double precision not null,
  lat       double precision not null,
  radius_m  double precision not null,  -- how close counts as "here" (it always reaches a road)
  tier      smallint not null check (tier between 1 and 3),
  fact      text not null,
  questions jsonb not null              -- [{"q", "options": [...], "answer": index}]
);

create table public.landmark_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  landmark_id bigint not null references public.landmarks (id) on delete cascade,
  question    smallint not null,
  asked_at    timestamptz not null default now(),
  deadline    timestamptz not null,
  answered_at timestamptz,
  correct     boolean,
  reward      integer not null default 0
);
create index landmark_checkins_player on public.landmark_checkins (user_id, landmark_id, asked_at desc);

-- Only through the functions below (questions hold their answers).
alter table public.landmarks enable row level security;
alter table public.landmark_checkins enable row level security;
revoke all on public.landmarks, public.landmark_checkins from anon, authenticated;

-- Coins for a right answer: a city sight 40, a major landmark 80, an iconic or remote one 150.
create function public.landmark_reward(p_tier smallint) returns integer language sql immutable set search_path = '' as $$
  select case p_tier when 3 then 150 when 2 then 80 else 40 end;
$$;

-- Landmarks nearest a point, with what a visit pays now and when the next try is allowed.
create function public.landmarks_near(p_lng double precision, p_lat double precision, p_limit integer default 8)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.metres), '[]'::jsonb)
  from (
    select l.id, l.name, l.city, l.lng, l.lat, l.radius_m as "radiusM", l.tier,
           round(public.distance_m(p_lng, p_lat, l.lng, l.lat))::int as metres,
           exists (select 1 from public.landmark_checkins c where c.user_id = auth.uid() and c.landmark_id = l.id and c.correct) as visited,
           case when exists (select 1 from public.landmark_checkins c where c.user_id = auth.uid() and c.landmark_id = l.id and c.correct)
                then public.landmark_reward(l.tier) / 3 else public.landmark_reward(l.tier) end as reward,
           (select max(c.asked_at) + interval '1 day' from public.landmark_checkins c
             where c.user_id = auth.uid() and c.landmark_id = l.id and c.asked_at > now() - interval '1 day') as "nextAt"
      from public.landmarks l
     order by public.distance_m(p_lng, p_lat, l.lng, l.lat)
     limit greatest(1, least(p_limit, 40))
  ) x;
$$;

-- Check in at a landmark the player is at: a random question about it, 20 seconds to answer.
create function public.start_checkin(p_landmark bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  l public.landmarks%rowtype;
  pos public.player_positions%rowtype;
  last_try timestamptz;
  q integer;
  c public.landmark_checkins%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into l from public.landmarks where id = p_landmark;
  if l.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, l.lng, l.lat) > l.radius_m then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  select max(asked_at) into last_try from public.landmark_checkins where user_id = uid and landmark_id = l.id;
  if last_try > now() - interval '1 day' then
    return jsonb_build_object('ok', false, 'reason', 'tomorrow', 'nextAt', last_try + interval '1 day');
  end if;
  q := floor(random() * jsonb_array_length(l.questions))::integer;
  insert into public.landmark_checkins (user_id, landmark_id, question, deadline)
  values (uid, l.id, q, now() + interval '20 seconds')
  returning * into c;
  return jsonb_build_object('ok', true, 'checkinId', c.id, 'landmark', l.name,
    'question', l.questions -> q ->> 'q', 'options', l.questions -> q -> 'options',
    'seconds', 20, 'deadline', c.deadline, 'now', now());
end;
$$;

-- Answer: right (in time) pays coins and gives a lead to a hidden find near the landmark.
create function public.answer_checkin(p_checkin uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.landmark_checkins%rowtype;
  l public.landmarks%rowtype;
  right_answer integer;
  correct boolean;
  is_first boolean;
  reward integer := 0;
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
  correct := p_choice = right_answer and now() <= c.deadline + interval '3 seconds';
  if correct then
    is_first := not exists (select 1 from public.landmark_checkins x where x.user_id = uid and x.landmark_id = l.id and x.correct);
    reward := case when is_first then public.landmark_reward(l.tier) else public.landmark_reward(l.tier) / 3 end;
    balance := public.apply_coin_change(uid, reward, 'earn', 'Checked in at ' || l.name, 'checkin:' || c.id);
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
  update public.landmark_checkins set answered_at = now(), correct = answer_checkin.correct, reward = answer_checkin.reward where id = c.id;
  return jsonb_build_object('ok', true, 'correct', correct, 'late', p_choice = right_answer and not correct,
    'answer', l.questions -> c.question -> 'options' ->> right_answer, 'fact', l.fact, 'reward', reward, 'first', coalesce(is_first, false),
    'balance', balance, 'lead', case when target is not null then jsonb_build_object('lng', lead_lng, 'lat', lead_lat) end);
end;
$$;

revoke execute on function public.landmarks_near(double precision, double precision, integer), public.start_checkin(bigint), public.answer_checkin(uuid, integer) from public, anon;
grant execute on function public.landmarks_near(double precision, double precision, integer), public.start_checkin(bigint), public.answer_checkin(uuid, integer) to authenticated;
