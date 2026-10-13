-- Hunts (design doc sections 3 and 6): owner-published treasure hunts with
-- sequential keys. Each key has a riddle pointing to an area; inside the area a
-- Final Approach clue and hot/cold distances lead to the exact spot, where a
-- timed Key Trial starts. One wrong answer or timeout throws the player 2 km
-- away. Riddles, spots and answers never leave the server until earned.

alter table public.profiles add column is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- Tables (players read them only through the functions below)
-- ---------------------------------------------------------------------------
create table public.hunts (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (length(title) between 3 and 80),
  prize                text not null check (length(prize) between 2 and 200),
  description          text not null default '' check (length(description) <= 1000),
  winners              int not null check (winners between 1 and 1000),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  questions_per_trial  int not null default 3 check (questions_per_trial between 1 and 10),
  seconds_per_question int not null default 12 check (seconds_per_question between 10 and 15),
  published            boolean not null default false,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.hunt_keys (
  hunt_id       uuid not null references public.hunts (id) on delete cascade,
  n             int not null check (n between 1 and 50),
  riddle        text not null check (length(riddle) between 5 and 500),
  category      text not null check (category in ('maths', 'sequences', 'general', 'nigeria')),
  area_lng      double precision not null check (area_lng between -180 and 180),
  area_lat      double precision not null check (area_lat between -90 and 90),
  area_radius_m int not null default 2000 check (area_radius_m between 100 and 50000),
  approach_clue text check (length(approach_clue) <= 300),
  spot_lng      double precision not null check (spot_lng between -180 and 180),
  spot_lat      double precision not null check (spot_lat between -90 and 90),
  primary key (hunt_id, n)
);

create table public.trial_questions (
  id         bigint generated always as identity primary key,
  category   text not null check (category in ('general', 'nigeria')),
  difficulty int not null default 1 check (difficulty between 1 and 3),
  prompt     text not null,
  choices    text[] not null check (array_length(choices, 1) between 2 and 6),
  answer     int not null -- index into choices, from 0
);

create table public.hunt_players (
  hunt_id        uuid not null references public.hunts (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  joined_at      timestamptz not null default now(),
  keys_held      int not null default 0,
  last_key_at    timestamptz,
  approach_key   int, -- the key whose area the player has reached (Final Approach clue shown)
  last_search_at timestamptz,
  finished_at    timestamptz,
  place          int,
  primary key (hunt_id, user_id)
);

create table public.trial_attempts (
  id         uuid primary key default gen_random_uuid(),
  hunt_id    uuid not null references public.hunts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  key_n      int not null,
  questions  jsonb not null, -- [{prompt, choices, answer}]; answers stay here
  current    int not null default 0,
  asked_at   timestamptz not null default now(),
  status     text not null default 'active' check (status in ('active', 'passed', 'failed')),
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create unique index trial_attempts_one_active on public.trial_attempts (hunt_id, user_id) where status = 'active';
create index hunt_players_board on public.hunt_players (hunt_id, place, keys_held desc, last_key_at);

alter table public.hunts enable row level security;
alter table public.hunt_keys enable row level security;
alter table public.trial_questions enable row level security;
alter table public.hunt_players enable row level security;
alter table public.trial_attempts enable row level security;
revoke all on public.hunts, public.hunt_keys, public.trial_questions, public.hunt_players, public.trial_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trial questions: maths and sequences are made fresh; the rest come from the bank.
-- ---------------------------------------------------------------------------

-- One question with its choices shuffled; `answer` is the index of the correct one.
create function public.build_question(p_prompt text, p_correct text, p_wrong text[])
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  shuffled text[];
begin
  select array_agg(c order by random()) into shuffled from unnest(array[p_correct] || p_wrong) c;
  return jsonb_build_object('prompt', p_prompt, 'choices', to_jsonb(shuffled), 'answer', array_position(shuffled, p_correct) - 1);
end;
$$;

-- Three wrong numbers close to the right one.
create function public.near_numbers(p_answer bigint, p_spread int)
returns text[] language sql volatile set search_path = '' as $$
  select array_agg(x::text) from (
    select p_answer + o * p_spread as x from unnest(array[-3, -2, -1, 1, 2, 3]) o order by random() limit 3
  ) s;
$$;

create function public.make_question(p_category text, p_difficulty int, p_used bigint[] default '{}')
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
    return public.make_question('maths', p_difficulty);
  end if;
  return public.build_question(q.prompt, q.choices[q.answer + 1], q.choices[1:q.answer] || q.choices[q.answer + 2:])
         || jsonb_build_object('bank_id', q.id);
end;
$$;

-- A whole trial for a key; later keys in a hunt get harder questions.
create function public.make_trial(p_category text, p_count int, p_difficulty int)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  questions jsonb := '[]'::jsonb;
  used bigint[] := '{}';
  q jsonb;
begin
  for i in 1..p_count loop
    q := public.make_question(p_category, p_difficulty, used);
    if q ? 'bank_id' then
      used := used || (q ->> 'bank_id')::bigint;
    end if;
    questions := questions || jsonb_build_array(q - 'bank_id');
  end loop;
  return questions;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hunt helpers
-- ---------------------------------------------------------------------------
create function public.hunt_phase(h public.hunts)
returns text language sql stable set search_path = '' as $$
  select case
    when not h.published then 'draft'
    when now() < h.starts_at then 'upcoming'
    when now() >= h.ends_at
      or (select count(*) from public.hunt_players p where p.hunt_id = h.id and p.finished_at is not null) >= h.winners then 'ended'
    else 'live'
  end;
$$;

-- What the player may see of the current question (never the answer).
create function public.trial_view(t public.trial_attempts, p_seconds int)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'attempt', t.id,
    'key', t.key_n,
    'index', t.current,
    'count', jsonb_array_length(t.questions),
    'prompt', t.questions -> t.current ->> 'prompt',
    'choices', t.questions -> t.current -> 'choices',
    'seconds', p_seconds,
    'secondsLeft', greatest(0, p_seconds - extract(epoch from now() - t.asked_at)));
$$;

-- A failed trial: the player lands at a random point 2 km from the key spot
-- (the game then puts them on the nearest road). Their vehicle comes with them.
create function public.fail_trial(t public.trial_attempts)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.hunt_keys%rowtype;
  bearing double precision := random() * 2 * pi();
  to_lng double precision;
  to_lat double precision;
begin
  update public.trial_attempts set status = 'failed', ended_at = now() where id = t.id;
  select * into k from public.hunt_keys where hunt_id = t.hunt_id and n = t.key_n;
  to_lat := k.spot_lat + 2000 * cos(bearing) / 110574;
  to_lng := k.spot_lng + 2000 * sin(bearing) / (111320 * cos(radians(k.spot_lat)));
  update public.player_positions set lng = to_lng, lat = to_lat, updated_at = now() where user_id = t.user_id;
  update public.player_vehicles set lng = to_lng, lat = to_lat where user_id = t.user_id and in_use;
  return jsonb_build_object('lng', to_lng, 'lat', to_lat);
end;
$$;

-- A trial whose time ran out while the player was away counts as failed.
create function public.settle_trial(p_hunt uuid, p_user uuid)
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
  if now() > t.asked_at + make_interval(secs => seconds + 2) then
    return public.fail_trial(t);
  end if;
  return null;
end;
$$;

create function public.distance_band(p_metres double precision)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_metres < 50 then 'under 50 m'
    when p_metres < 100 then 'under 100 m'
    when p_metres < 300 then 'under 300 m'
    when p_metres < 1000 then 'under 1 km'
    when p_metres < 2000 then 'under 2 km'
    when p_metres < 5000 then 'under 5 km'
    when p_metres < 20000 then 'under 20 km'
    when p_metres < 100000 then 'under 100 km'
    when p_metres < 300000 then 'under 300 km'
    else 'more than 300 km'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Player functions
-- ---------------------------------------------------------------------------

-- Published hunts that are coming up, running, or ended in the last week.
create function public.list_hunts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.title, 'prize', h.prize, 'description', h.description,
      'winners', h.winners, 'startsAt', h.starts_at, 'endsAt', h.ends_at,
      'phase', public.hunt_phase(h),
      'keys', (select count(*) from public.hunt_keys k where k.hunt_id = h.id),
      'players', (select count(*) from public.hunt_players p where p.hunt_id = h.id),
      'joined', exists (select 1 from public.hunt_players p where p.hunt_id = h.id and p.user_id = auth.uid()))
    order by h.starts_at), '[]'::jsonb)
  from public.hunts h
  where h.published and h.ends_at > now() - interval '7 days';
$$;

create function public.join_hunt(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h public.hunts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if public.hunt_phase(h) = 'ended' then
    return jsonb_build_object('ok', false, 'reason', 'ended');
  end if;
  insert into public.hunt_players (hunt_id, user_id) values (p_hunt, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Everything the player's hunt screen shows.
create function public.hunt_state(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  t public.trial_attempts%rowtype;
  phase text;
  total int;
  thrown jsonb;
begin
  select * into h from public.hunts where id = p_hunt and published;
  if not found then
    return null;
  end if;
  thrown := public.settle_trial(p_hunt, uid);
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  phase := public.hunt_phase(h);
  select count(*) into total from public.hunt_keys where hunt_id = p_hunt;

  if hp.user_id is not null and phase = 'live' and hp.finished_at is null then
    select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
    select * into t from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active';
  end if;

  return jsonb_build_object(
    'id', h.id, 'title', h.title, 'prize', h.prize, 'winners', h.winners,
    'startsAt', h.starts_at, 'endsAt', h.ends_at, 'phase', phase,
    'keys', total, 'joined', hp.user_id is not null,
    'keysHeld', coalesce(hp.keys_held, 0), 'finishedAt', hp.finished_at, 'place', hp.place,
    'winnersFound', (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.finished_at is not null),
    'riddle', k.riddle, 'category', k.category,
    'clue', case when k.n is not null and hp.approach_key = k.n then coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.') end,
    'trial', case when t.id is not null then public.trial_view(t, h.seconds_per_question) end,
    'thrown', thrown);
end;
$$;

-- "Search here": is the key at this spot? Saves the position first (the server
-- only trusts positions that passed the speed check).
create function public.search_here(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
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

  if to_spot <= 40 then
    select count(*) into total from public.hunt_keys where hunt_id = p_hunt;
    insert into public.trial_attempts (hunt_id, user_id, key_n, questions)
    values (p_hunt, uid, k.n, public.make_trial(k.category, h.questions_per_trial, least(3, 1 + ((k.n - 1) * 3) / greatest(total, 1))))
    returning * into t;
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

-- Answer the current question (p_choice -1 means time ran out). Checked here
-- only: the phone never has the answers.
create function public.answer_trial(p_attempt uuid, p_choice int)
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
      'lng', landed -> 'lng', 'lat', landed -> 'lat');
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

-- The leaderboard: finishers by place, then most keys, earliest first.
create function public.hunt_board(p_hunt uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_to_json(b)::jsonb order by b.rank), '[]'::jsonb) from (
    select row_number() over (order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at) as rank,
           pr.username, p.keys_held as "keysHeld", p.place, p.user_id = auth.uid() as me
      from public.hunt_players p
      join public.profiles pr on pr.id = p.user_id
      join public.hunts h on h.id = p.hunt_id and h.published
     where p.hunt_id = p_hunt
     order by rank
     limit 20
  ) b;
$$;

-- Only players call these; the internals stay private.
revoke execute on function public.build_question(text, text, text[]), public.near_numbers(bigint, int),
  public.make_question(text, int, bigint[]), public.make_trial(text, int, int), public.hunt_phase(public.hunts),
  public.trial_view(public.trial_attempts, int), public.fail_trial(public.trial_attempts), public.settle_trial(uuid, uuid),
  public.distance_band(double precision)
  from public, anon, authenticated;
revoke execute on function public.list_hunts(), public.join_hunt(uuid), public.hunt_state(uuid),
  public.search_here(uuid, double precision, double precision, text), public.answer_trial(uuid, int), public.hunt_board(uuid)
  from public, anon;
grant execute on function public.list_hunts(), public.join_hunt(uuid), public.hunt_state(uuid),
  public.search_here(uuid, double precision, double precision, text), public.answer_trial(uuid, int), public.hunt_board(uuid)
  to authenticated;
