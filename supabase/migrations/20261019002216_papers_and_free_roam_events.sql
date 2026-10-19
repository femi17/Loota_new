-- Vehicle papers and gear, and road events in free roam (owner, 19 Oct 2026: "I bought a bicycle but no light to ride
-- at night; no licence or registration for my motorbike, no helmet"; "free roam is part of the game too, and should
-- have all the events").
--   Gear and papers: a bicycle's light; a motorbike's helmet and registration (plate); a car's registration and
--   insurance (with the vehicle); a rider's licence (motorbikes) and a driver's licence (cars) (with the player). Bought
--   once (buy_addon). Rentals and taxis come with their own.
--   The checkpoint asks for them: whatever is missing on the vehicle you're riding is a 20-coin fine each; all in order,
--   the officer asks the usual road-safety question. At night a cyclist without a light can be stopped too.
--   Road events (the checkpoint, the stranded traveller, the street seller) happen in free roam as well as in a hunt; in
--   free roam a traveller you help gives you 15 coins (in a hunt, the way to your next key).

alter table public.profiles
  add column if not exists rider_licence boolean not null default false,
  add column if not exists driver_licence boolean not null default false;
alter table public.player_vehicles
  add column if not exists light boolean not null default false,
  add column if not exists helmet boolean not null default false,
  add column if not exists registered boolean not null default false,
  add column if not exists insured boolean not null default false;
alter table public.road_events add column if not exists missing text[] not null default '{}';

-- Prices (match ADDONS in src/game/economy.ts).
create or replace function public.addon_price(p_addon text, p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_addon
    when 'light' then 40
    when 'helmet' then 80
    when 'rider_licence' then 150
    when 'driver_licence' then 300
    when 'registration' then case p_kind when 'car' then 400 else 200 end
    when 'insurance' then 250
  end;
$$;

-- Buy a vehicle's gear or a licence. p_kind: the vehicle it's for (a licence: motorbike = rider's, car = driver's).
create or replace function public.buy_addon(p_addon text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  have boolean;
  price integer;
  balance bigint;
  label text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not ((p_addon = 'light' and p_kind = 'bicycle') or (p_addon = 'helmet' and p_kind = 'motorbike')
          or (p_addon = 'registration' and p_kind in ('motorbike', 'car')) or (p_addon = 'insurance' and p_kind = 'car')
          or (p_addon = 'rider_licence' and p_kind = 'motorbike') or (p_addon = 'driver_licence' and p_kind = 'car')) then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if p_addon in ('rider_licence', 'driver_licence') then
    select case p_addon when 'rider_licence' then rider_licence else driver_licence end into have from public.profiles where id = uid;
  else
    select * into v from public.player_vehicles where user_id = uid and kind = p_kind for update;
    if v.id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
    have := case p_addon when 'light' then v.light when 'helmet' then v.helmet when 'registration' then v.registered else v.insured end;
  end if;
  if have then
    return jsonb_build_object('ok', false, 'reason', 'have');
  end if;
  price := public.addon_price(p_addon, p_kind);
  label := case p_addon
    when 'light' then 'A bicycle light'
    when 'helmet' then 'A helmet'
    when 'rider_licence' then 'A rider''s licence'
    when 'driver_licence' then 'A driver''s licence'
    when 'registration' then 'Registration for your ' || p_kind
    else 'Insurance for your car' end;
  begin
    balance := public.apply_coin_change(uid, -price, 'spend', label, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', price);
  end;
  if p_addon = 'rider_licence' then
    update public.profiles set rider_licence = true where id = uid;
  elsif p_addon = 'driver_licence' then
    update public.profiles set driver_licence = true where id = uid;
  else
    update public.player_vehicles set
      light = light or p_addon = 'light',
      helmet = helmet or p_addon = 'helmet',
      registered = registered or p_addon = 'registration',
      insured = insured or p_addon = 'insurance'
     where id = v.id;
  end if;
  return jsonb_build_object('ok', true, 'price', price, 'balance', balance);
end;
$$;
revoke execute on function public.buy_addon(text, text) from public, anon;
grant execute on function public.buy_addon(text, text) to authenticated;

-- What a checkpoint finds missing on what the player is riding (their own vehicle; rentals come with theirs).
create or replace function public.missing_papers(p_user uuid, p_mode text, p_lng double precision, p_lat double precision)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v public.player_vehicles%rowtype;
  p public.profiles%rowtype;
  missing text[] := '{}';
begin
  if p_mode not in ('bicycle', 'motorbike', 'car')
     or exists (select 1 from public.vehicle_rentals where user_id = p_user and kind = p_mode and ended_at is null) then
    return missing;
  end if;
  select * into v from public.player_vehicles where user_id = p_user and kind = p_mode;
  if v.id is null then
    return missing;
  end if;
  select * into p from public.profiles where id = p_user;
  if p_mode = 'bicycle' then
    if public.is_night(p_lng, p_lat) and not v.light then
      missing := array['light'];
    end if;
  elsif p_mode = 'motorbike' then
    if not v.helmet then missing := array_append(missing, 'helmet'); end if;
    if not p.rider_licence then missing := array_append(missing, 'rider_licence'); end if;
    if not v.registered then missing := array_append(missing, 'registration'); end if;
  else
    if not p.driver_licence then missing := array_append(missing, 'driver_licence'); end if;
    if not v.registered then missing := array_append(missing, 'registration'); end if;
    if not v.insured then missing := array_append(missing, 'insurance'); end if;
  end if;
  return missing;
end;
$$;
revoke execute on function public.missing_papers(uuid, text, double precision, double precision) from public, anon, authenticated;

create or replace function public.road_event_json(e public.road_events) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'kind', e.kind, 'npc', e.npc,
    'prompt', e.question ->> 'prompt', 'choices', e.question -> 'choices', 'missing', to_jsonb(e.missing));
$$;

-- Maybe something happens on the road now (while travelling, in a hunt or in free roam). p_hunt: the hunt the game is
-- showing, if any (only a live hunt the player is in counts).
create or replace function public.road_event_roll(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  pos public.player_positions%rowtype;
  e public.road_events%rowtype;
  what text;
  in_hunt boolean;
  missing text[];
  officers text[] := array['Officer Bello', 'Inspector Okafor', 'Sergeant Ade', 'Officer Musa'];
  travellers text[] := array['Mr Femi', 'Blessing', 'Uncle Joe', 'Aisha', 'Emeka'];
  sellers text[] := array['Mama Titi', 'Iya Basira', 'Aunty Grace', 'Mama Nkechi'];
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_hunt is not null then
    select * into h from public.hunts where id = p_hunt and published;
    select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  end if;
  in_hunt := h.id is not null and public.hunt_phase(h) = 'live' and hp.user_id is not null and hp.finished_at is null;
  -- One still waiting for an answer (a reload): the same one.
  select * into e from public.road_events where user_id = uid and resolved_at is null and created_at > now() - interval '3 minutes' order by id desc limit 1;
  if e.id is not null then
    return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
  end if;
  if exists (select 1 from public.road_events where user_id = uid and created_at > now() - interval '4 minutes') or random() >= 1.0 / 3 then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  if (in_hunt and exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active'))
     or exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  select * into pos from public.player_positions where user_id = uid;
  missing := public.missing_papers(uid, pos.mode, pos.lng, pos.lat);
  if pos.mode in ('motorbike', 'car') then
    what := case when random() < 0.6 then 'checkpoint' else 'traveller' end;
  elsif pos.mode = 'bicycle' and cardinality(missing) > 0 then
    what := case when random() < 0.5 then 'checkpoint' else 'seller' end; -- riding without a light at night
  else
    what := case when random() < 0.5 then 'seller' else 'traveller' end;
  end if;
  insert into public.road_events (user_id, hunt_id, kind, npc, question, missing)
  values (uid, case when in_hunt then p_hunt end, what,
          case what when 'checkpoint' then officers[1 + floor(random() * array_length(officers, 1))::integer]
                    when 'seller' then sellers[1 + floor(random() * array_length(sellers, 1))::integer]
                    else travellers[1 + floor(random() * array_length(travellers, 1))::integer] end,
          case what when 'checkpoint' then public.road_safety_question()
                    when 'seller' then public.make_classic_question(case when random() < 0.5 then 'nigeria' else 'general' end, 1) - 'bank_id' end,
          case when what = 'checkpoint' then missing else '{}' end)
  returning * into e;
  return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
end;
$$;

-- The player's answer. checkpoint: a choice, or -2 to pay the fine (missing papers are fined whatever is chosen).
-- traveller: 1 to help, 0 not. seller: a choice, or -1 no thanks.
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
  reward integer := 0;
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
    if cardinality(e.missing) = 0 and right_answer then
      result := 'passed';
    else
      -- Missing papers: 20 coins each; in order but a wrong answer (or paying): 20.
      select least(20 * greatest(1, cardinality(e.missing)), coins)::integer into fine from public.profiles where id = uid;
      if fine > 0 then
        balance := public.apply_coin_change(uid, -fine, 'spend',
          case when cardinality(e.missing) > 0 then 'Fine at a police checkpoint: no ' || array_to_string(e.missing, ', ') else 'Fine at a police checkpoint' end, null);
      end if;
      result := 'fined';
    end if;
  elsif e.kind = 'seller' then
    if right_answer then
      reward := 25;
      balance := public.apply_coin_change(uid, reward, 'earn', 'A street seller''s riddle', 'road-event:' || e.id);
      result := 'won';
    else
      result := case when p_choice = -1 then 'declined' else 'lost' end;
    end if;
  else
    if p_choice = 1 then
      if e.hunt_id is not null then
        -- In a hunt: which way the player's next key's area lies, and roughly how far.
        select * into pos from public.player_positions where user_id = uid;
        select * into hp from public.hunt_players where hunt_id = e.hunt_id and user_id = uid;
        select * into k from public.hunt_keys where hunt_id = e.hunt_id and n = coalesce(hp.keys_held, 0) + 1;
        if k.n is not null and pos.user_id is not null then
          bearing := degrees(atan2((k.area_lng - pos.lng) * cos(radians(pos.lat)), k.area_lat - pos.lat));
          hint := jsonb_build_object('direction', dirs[1 + (floor((bearing + 360 + 22.5) / 45)::integer % 8)],
            'band', public.distance_band(public.distance_m(pos.lng, pos.lat, k.area_lng, k.area_lat)), 'key', k.n);
        end if;
      else
        -- In free roam: they thank you with a little money.
        reward := 15;
        balance := public.apply_coin_change(uid, reward, 'earn', 'Helped a stranded traveller', 'road-event:' || e.id);
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
    'fine', fine, 'reward', reward, 'hint', hint, 'balance', balance, 'missing', to_jsonb(e.missing),
    'holdS', case when result in ('fined', 'helped') then 15 else 0 end);
end;
$$;
