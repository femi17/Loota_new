-- Things that happen on the road during a hunt (owner, 17 Oct 2026: don't let the journey be boring). Every few
-- minutes of travel the server may stop the player with an event, played as a scene:
--   checkpoint (on a motorbike or in a car): the officer asks a road-safety question; right, on you go; wrong (or
--     choosing to pay), a 20-coin fine and 15 seconds held.
--   traveller (anyone): help a stranded traveller (15 seconds) and they tell you which way your key's area lies and
--     roughly how far; or say you're in a hurry.
--   seller (on foot or a bicycle): a street seller's riddle; right, 25 coins.
-- At most one every 4 minutes, a 1 in 3 chance each time the game asks (about every 45 s while moving).

create table public.road_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  hunt_id     uuid references public.hunts (id) on delete set null,
  kind        text not null check (kind in ('checkpoint', 'traveller', 'seller')),
  npc         text not null,
  question    jsonb,          -- with the answer: never sent to the player
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  outcome     text check (outcome in ('passed', 'fined', 'helped', 'declined', 'won', 'lost'))
);
create index road_events_user on public.road_events (user_id, created_at desc);
alter table public.road_events enable row level security;

-- Road safety, Nigerian roads (the checkpoint's questions).
create or replace function public.road_safety_question() returns jsonb
language sql volatile set search_path = '' as $$
  select q from (values
    ('{"prompt":"In Nigeria, which side of the road do you drive on?","choices":["Right","Left","The middle"],"answer":0}'::jsonb),
    ('{"prompt":"What does a red traffic light mean?","choices":["Go faster","Stop","Turn left only"],"answer":1}'::jsonb),
    ('{"prompt":"Who must wear a helmet on a motorbike?","choices":["Only the rider","The rider and the passenger","Nobody at night"],"answer":1}'::jsonb),
    ('{"prompt":"An amber traffic light means…","choices":["Speed up","Get ready to stop","Hoot"],"answer":1}'::jsonb),
    ('{"prompt":"A zebra crossing is for…","choices":["Parking","People crossing on foot","Overtaking"],"answer":1}'::jsonb),
    ('{"prompt":"Who must wear a seat belt in the front of a car?","choices":["Only the driver","The driver and the front passenger","Nobody in town"],"answer":1}'::jsonb),
    ('{"prompt":"Which document shows a vehicle is insured?","choices":["Insurance certificate","Bus ticket","Receipt for fuel"],"answer":0}'::jsonb),
    ('{"prompt":"Using a phone while driving is…","choices":["Fine if it''s short","Against the law","Only allowed at night"],"answer":1}'::jsonb),
    ('{"prompt":"On a road with two lanes your way, you should overtake on the…","choices":["Left","Right","Kerb"],"answer":0}'::jsonb),
    ('{"prompt":"What should you do when an ambulance comes with its siren on?","choices":["Race it","Pull over and let it pass","Stop in the middle of the road"],"answer":1}'::jsonb)
  ) as bank(q) order by random() limit 1;
$$;

create or replace function public.road_event_json(e public.road_events) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'kind', e.kind, 'npc', e.npc,
    'prompt', e.question ->> 'prompt', 'choices', e.question -> 'choices');
$$;

-- Maybe something happens on the road now (in a live hunt the player is in, while travelling).
create or replace function public.road_event_roll(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  pos public.player_positions%rowtype;
  e public.road_events%rowtype;
  what text;
  officers text[] := array['Officer Bello', 'Inspector Okafor', 'Sergeant Ade', 'Officer Musa'];
  travellers text[] := array['Mr Femi', 'Blessing', 'Uncle Joe', 'Aisha', 'Emeka'];
  sellers text[] := array['Mama Titi', 'Iya Basira', 'Aunty Grace', 'Mama Nkechi'];
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if h.id is null or public.hunt_phase(h) <> 'live' or hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  -- One still waiting for an answer (a reload): the same one.
  select * into e from public.road_events where user_id = uid and resolved_at is null and created_at > now() - interval '3 minutes' order by id desc limit 1;
  if e.id is not null then
    return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
  end if;
  if exists (select 1 from public.road_events where user_id = uid and created_at > now() - interval '4 minutes') or random() >= 1.0 / 3 then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  if exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active')
     or exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.mode in ('motorbike', 'car') then
    what := case when random() < 0.6 then 'checkpoint' else 'traveller' end;
  else
    what := case when random() < 0.5 then 'seller' else 'traveller' end;
  end if;
  insert into public.road_events (user_id, hunt_id, kind, npc, question)
  values (uid, p_hunt, what,
          case what when 'checkpoint' then officers[1 + floor(random() * array_length(officers, 1))::integer]
                    when 'seller' then sellers[1 + floor(random() * array_length(sellers, 1))::integer]
                    else travellers[1 + floor(random() * array_length(travellers, 1))::integer] end,
          case what when 'checkpoint' then public.road_safety_question()
                    when 'seller' then public.make_question(case when random() < 0.5 then 'nigeria' else 'general' end, 1) - 'bank_id' end)
  returning * into e;
  return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
end;
$$;

-- The player's answer. checkpoint: a choice, or -2 to pay the fine. traveller: 1 to help, 0 not. seller: a choice, or -1 no thanks.
create or replace function public.road_event_answer(p_event bigint, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  pos public.player_positions%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  right_answer boolean;
  fine integer := 0;
  balance bigint;
  result text;
  hint jsonb;
  bearing double precision;
  dirs text[] := array['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into e from public.road_events where id = p_event and user_id = uid and resolved_at is null for update;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  right_answer := e.question is not null and p_choice >= 0 and p_choice = (e.question ->> 'answer')::integer;

  if e.kind = 'checkpoint' then
    if right_answer then
      result := 'passed';
    else
      select least(20, coins)::integer into fine from public.profiles where id = uid;
      if fine > 0 then
        balance := public.apply_coin_change(uid, -fine, 'spend', 'Fine at a police checkpoint', null);
      end if;
      result := 'fined';
    end if;
  elsif e.kind = 'seller' then
    if right_answer then
      balance := public.apply_coin_change(uid, 25, 'earn', 'A street seller''s riddle', 'road-event:' || e.id);
      result := 'won';
    else
      result := case when p_choice = -1 then 'declined' else 'lost' end;
    end if;
  else
    if p_choice = 1 then
      -- Which way the player's next key's area lies, and roughly how far.
      select * into pos from public.player_positions where user_id = uid;
      select * into hp from public.hunt_players where hunt_id = e.hunt_id and user_id = uid;
      select * into k from public.hunt_keys where hunt_id = e.hunt_id and n = coalesce(hp.keys_held, 0) + 1;
      if k.n is not null and pos.user_id is not null then
        bearing := degrees(atan2((k.area_lng - pos.lng) * cos(radians(pos.lat)), k.area_lat - pos.lat));
        hint := jsonb_build_object('direction', dirs[1 + (floor((bearing + 360 + 22.5) / 45)::integer % 8)],
          'band', public.distance_band(public.distance_m(pos.lng, pos.lat, k.area_lng, k.area_lat)), 'key', k.n);
      end if;
      result := 'helped';
    else
      result := 'declined';
    end if;
  end if;

  update public.road_events set resolved_at = now(), outcome = result where id = e.id;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'outcome', result, 'right', right_answer,
    'correct', case when e.question is not null then e.question -> 'choices' ->> (e.question ->> 'answer')::integer end,
    'fine', fine, 'reward', case when result = 'won' then 25 else 0 end, 'hint', hint, 'balance', balance,
    'holdS', case when result in ('fined', 'helped') then 15 else 0 end);
end;
$$;

revoke execute on function public.road_safety_question(), public.road_event_json(public.road_events) from public, anon, authenticated;
revoke execute on function public.road_event_roll(uuid), public.road_event_answer(bigint, integer) from public, anon;
grant execute on function public.road_event_roll(uuid), public.road_event_answer(bigint, integer) to authenticated;
