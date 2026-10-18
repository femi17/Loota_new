-- Different kinds of Key Trial question (owner, 18 Oct 2026: "how not to make it boring"). Each category now mixes
-- in new formats with its classic questions:
--   maths      count (how many 🥭 in a row of fruit), number memory (four numbers flash for 3 s: which came third?)
--   sequences  number memory
--   general    memory (five things flash for 3 s: which one was NOT there?), odd one out (not a fruit, can't fly)
--   nigeria    unscramble (L A G O S…), odd one out (which is NOT a Nigerian state?)
-- A question may carry `show` (what's on screen with it) and `showSeconds` (shown only that long, then hidden): the
-- trial's clock allows those seconds on top. The categories stay the four the hunts use.

create or replace function public.make_classic_question(p_category text, p_difficulty int, p_used bigint[] default '{}')
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  a int; b int; c int; ans bigint; seq bigint[]; step int; i int;
  q public.trial_questions%rowtype;
begin
  if p_category = 'maths' then
    if p_difficulty = 1 then
      a := 10 + floor(random() * 80); b := 2 + floor(random() * 40);
      if random() < 0.5 then
        return public.build_question(a || ' + ' || b || ' = ?', (a + b)::text, public.near_numbers(a + b, 1 + floor(random() * 2)::int));
      end if;
      return public.build_question((a + b) || ' − ' || b || ' = ?', a::text, public.near_numbers(a, 1 + floor(random() * 2)::int));
    elsif p_difficulty = 2 then
      a := 3 + floor(random() * 10); b := 3 + floor(random() * 10);
      return public.build_question(a || ' × ' || b || ' = ?', (a * b)::text, public.near_numbers(a * b, a));
    end if;
    a := 3 + floor(random() * 10); b := 3 + floor(random() * 10); c := 5 + floor(random() * 40);
    return public.build_question(a || ' × ' || b || ' + ' || c || ' = ?', (a * b + c)::text, public.near_numbers(a * b + c, 1 + floor(random() * 3)::int * (case when random() < 0.5 then 1 else 10 end)));
  end if;

  if p_category = 'sequences' then
    a := 1 + floor(random() * 20);
    step := 2 + floor(random() * 8);
    seq := array[a];
    for i in 2..5 loop
      seq := seq || case p_difficulty
        when 1 then seq[i - 1] + step                          -- 4, 9, 14, 19, …
        when 2 then seq[i - 1] * 2 + (step % 3)                -- 3, 7, 15, 31, …
        else seq[i - 1] + step * (i - 1)                       -- gaps grow: 5, 8, 14, 23, …
      end;
    end loop;
    ans := seq[5];
    return public.build_question(
      'What comes next? ' || array_to_string(seq[1:4], ', ') || ', …',
      ans::text,
      public.near_numbers(ans, greatest(1, step / 2)));
  end if;

  -- From the bank, not repeating a question in this trial.
  select * into q from public.trial_questions
   where category = p_category and difficulty <= p_difficulty and not (id = any (p_used))
   order by random() limit 1;
  if not found then
    return public.make_classic_question('maths', p_difficulty);
  end if;
  return public.build_question(q.prompt, q.choices[q.answer + 1], q.choices[1:q.answer] || q.choices[q.answer + 2:])
         || jsonb_build_object('bank_id', q.id);
end;
$$;

-- How many of one thing in a row of fruit (it stays on screen).
create or replace function public.count_question() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  pool text[] := array['🥭', '🍊', '🌶', '🥥', '🍌', '🍍'];
  target text;
  others text[];
  n integer;
  total integer;
  items text[] := '{}';
begin
  target := pool[1 + floor(random() * array_length(pool, 1))::integer];
  others := array(select x from unnest(pool) x where x <> target order by random() limit 2);
  n := 2 + floor(random() * 5)::integer;
  total := n + 4 + floor(random() * 4)::integer;
  for i in 1 .. n loop
    items := items || target;
  end loop;
  for i in 1 .. total - n loop
    items := items || others[1 + floor(random() * 2)::integer];
  end loop;
  return public.build_question('How many ' || target || ' do you see?', n::text,
           array(select x::text from unnest(array[n - 1, n + 1, n + 2, n - 2]) x where x > 0 limit 3))
         || jsonb_build_object('show', (select string_agg(x, ' ' order by random()) from unnest(items) x));
end;
$$;

-- Five things flash for 3 seconds: which one was NOT there?
create or replace function public.memory_question() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  pool text[] := array['🚕', '🛵', '🥭', '🌶', '🥁', '⚽', '📱', '🔑', '🎩', '🐐', '🦜', '🍲', '🚌', '🌴'];
  picked text[];
begin
  picked := array(select x from unnest(pool) x order by random() limit 6);
  return public.build_question('Which one was NOT there?', picked[6], array(select x from unnest(picked[1:5]) x order by random() limit 3))
         || jsonb_build_object('show', array_to_string(picked[1:5], ' '), 'showSeconds', 3);
end;
$$;

-- Four numbers flash for 3 seconds: which came first, second, third or fourth?
create or replace function public.memory_number_question() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  nums integer[] := '{}';
  v integer;
  slot integer;
begin
  while coalesce(array_length(nums, 1), 0) < 4 loop
    v := 10 + floor(random() * 90)::integer;
    if not (v = any (nums)) then
      nums := nums || v;
    end if;
  end loop;
  slot := 1 + floor(random() * 4)::integer;
  return public.build_question('Which number came ' || (array['first', 'second', 'third', 'fourth'])[slot] || '?', nums[slot]::text,
           array(select x::text from unnest(nums) x where x <> nums[slot]))
         || jsonb_build_object('show', array_to_string(nums, '   '), 'showSeconds', 3);
end;
$$;

-- A Nigerian word or place with its letters jumbled.
create or replace function public.scramble_question() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  words text[] := array['LAGOS', 'ABUJA', 'ENUGU', 'IBADAN', 'JOLLOF', 'AMALA', 'EGUSI', 'BENIN', 'CALABAR', 'OWERRI',
                        'ZARIA', 'AKURE', 'ILORIN', 'GARRI', 'OKADA', 'DANFO', 'AGEGE', 'SUYA', 'KANO', 'MAKURDI'];
  word text;
  mixed text;
  tries integer := 0;
begin
  word := words[1 + floor(random() * array_length(words, 1))::integer];
  loop
    mixed := (select string_agg(c, ' ' order by random()) from regexp_split_to_table(word, '') c);
    tries := tries + 1;
    exit when replace(mixed, ' ', '') <> word or tries > 6;
  end loop;
  return public.build_question('Unscramble: ' || mixed, initcap(word),
           array(select initcap(x) from unnest(words) x where x <> word order by abs(length(x) - length(word)), random() limit 3));
end;
$$;

-- Which one doesn't belong?
create or replace function public.oddone_question(p_nigeria boolean) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  states text[] := array['Kano', 'Oyo', 'Edo', 'Enugu', 'Kaduna', 'Rivers', 'Ogun', 'Delta', 'Imo', 'Borno', 'Bauchi', 'Ekiti', 'Kwara'];
  outsiders text[] := array['Accra', 'Togo', 'Nairobi', 'Dakar', 'Cotonou', 'Ashanti', 'Lomé'];
  fruit text[] := array['Mango', 'Orange', 'Pawpaw', 'Pineapple', 'Banana', 'Guava'];
  not_fruit text[] := array['Carrot', 'Onion', 'Yam', 'Cassava'];
  fliers text[] := array['Eagle', 'Parrot', 'Pigeon', 'Hawk', 'Owl'];
  walkers text[] := array['Goat', 'Cow', 'Dog', 'Tortoise'];
begin
  if p_nigeria then
    return public.build_question('Which is NOT a Nigerian state?', outsiders[1 + floor(random() * array_length(outsiders, 1))::integer],
             array(select x from unnest(states) x order by random() limit 3));
  end if;
  if random() < 0.5 then
    return public.build_question('Which is NOT a fruit?', not_fruit[1 + floor(random() * array_length(not_fruit, 1))::integer],
             array(select x from unnest(fruit) x order by random() limit 3));
  end if;
  return public.build_question('Which of these can''t fly?', walkers[1 + floor(random() * array_length(walkers, 1))::integer],
           array(select x from unnest(fliers) x order by random() limit 3));
end;
$$;

-- A question for a Key Trial: about half the time one of the new kinds for the category, else a classic one.
create or replace function public.make_question(p_category text, p_difficulty integer, p_used bigint[] default '{}'::bigint[])
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  r double precision := random();
begin
  if p_category = 'maths' then
    if r < 0.25 then
      return public.count_question();
    elsif r < 0.45 then
      return public.memory_number_question();
    end if;
  elsif p_category = 'sequences' then
    if r < 0.35 then
      return public.memory_number_question();
    end if;
  elsif p_category = 'general' then
    if r < 0.25 then
      return public.memory_question();
    elsif r < 0.5 then
      return public.oddone_question(false);
    end if;
  elsif p_category = 'nigeria' then
    if r < 0.25 then
      return public.scramble_question();
    elsif r < 0.5 then
      return public.oddone_question(true);
    end if;
  end if;
  return public.make_classic_question(p_category, p_difficulty, p_used);
end;
$$;

create or replace function public.trial_view(t public.trial_attempts, p_seconds int)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'attempt', t.id,
    'key', t.key_n,
    'index', t.current,
    'count', jsonb_array_length(t.questions),
    'prompt', t.questions -> t.current ->> 'prompt',
    'choices', t.questions -> t.current -> 'choices',
    'show', t.questions -> t.current ->> 'show',
    'showSeconds', coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0),
    'seconds', p_seconds,
    'secondsLeft', greatest(0, p_seconds + coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0) - extract(epoch from now() - t.asked_at)));
$$;

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
  extra integer; -- seconds a memory question is shown before it's asked
begin
  select * into t from public.trial_attempts where id = p_attempt and user_id = uid and status = 'active' for update;
  if not found then
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
  select seconds_per_question into seconds from public.hunts where id = p_hunt;
  if now() > t.asked_at + make_interval(secs => seconds + 2 + coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0)) then
    return public.fail_trial(t);
  end if;
  return null;
end;
$$;

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
                    when 'seller' then public.make_classic_question(case when random() < 0.5 then 'nigeria' else 'general' end, 1) - 'bank_id' end)
  returning * into e;
  return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
end;
$$;

revoke execute on function public.make_classic_question(text, integer, bigint[]), public.count_question(), public.memory_question(),
  public.memory_number_question(), public.scramble_question(), public.oddone_question(boolean) from public, anon, authenticated;
