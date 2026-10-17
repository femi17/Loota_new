-- The Djinn's Wager, part 1: the summons, the gate puzzle and the eight seals
-- (design doc 7.6). Once a week the Djinn summons every player at once; solving
-- his gate puzzle earns favour, which burns decoys from his map of eight seals.
-- Only one seal is real. The player breaks one; the way there is theirs for the
-- three days the Wager lasts. (The chamber at the place, the traps on the way and
-- the Wonder itself come next.)
--
-- The weekly surprise start (djinn_auto) stays off until the chambers exist; the
-- owner can summon the Djinn by hand from /admin.

create table public.djinn_sites (
  id        bigint generated always as identity primary key,
  name      text not null unique,
  country   text not null,
  lng       double precision not null,
  lat       double precision not null,
  continent text not null check (continent in ('africa', 'americas', 'asia', 'europe', 'oceania')),
  setting   text not null check (setting in ('desert', 'jungle', 'mountain', 'coast', 'river', 'city', 'plain')),
  kind      text not null check (kind in ('temple', 'tomb', 'fortress', 'lost_city', 'monument', 'natural')),
  verse     text not null
);
alter table public.djinn_sites enable row level security;

create table public.djinn_wagers (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  wonder     text not null,
  site_ids   bigint[] not null,          -- the eight seals, in the order shown
  real_site  bigint not null references public.djinn_sites (id),
  riddle     text not null,
  gate       jsonb not null,             -- the gate puzzle, with its answers (never sent)
  winner     uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz
);
create index djinn_wagers_time_idx on public.djinn_wagers (starts_at desc);
alter table public.djinn_wagers enable row level security;

create table public.djinn_entries (
  wager_id        uuid not null references public.djinn_wagers (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  gate_started_at timestamptz,
  gate_deadline   timestamptz,
  gate_score      integer,               -- rooms solved (0–3); null until answered
  favour          integer not null default 0,
  burned          bigint[] not null default '{}',
  chosen_site     bigint references public.djinn_sites (id),
  chosen_at       timestamptz,
  retry_at        timestamptz,            -- turned away at the gate: try again after this
  primary key (wager_id, user_id)
);
alter table public.djinn_entries enable row level security;

-- Off until the chambers exist: then the Djinn summons everyone once a week by himself.
create or replace function public.djinn_auto() returns boolean language sql immutable set search_path = '' as $$ select false $$;
create or replace function public.djinn_gate_seconds() returns integer language sql immutable set search_path = '' as $$ select 240 $$;

-- The riddle's words: each trait has its phrase, and the seals' verses use the same words.
create or replace function public.djinn_clue(p_trait text, p_value text) returns text
language sql immutable set search_path = '' as $$
  select case p_trait || ':' || p_value
    when 'continent:africa' then 'where the first people walked'
    when 'continent:americas' then 'beyond the western ocean'
    when 'continent:asia' then 'where the silk roads ran'
    when 'continent:europe' then 'among the old kingdoms of the north'
    when 'continent:oceania' then 'at the bottom of the world'
    when 'setting:desert' then 'where the sand drinks every footprint'
    when 'setting:jungle' then 'where the green swallows the stones'
    when 'setting:mountain' then 'where the clouds come down to rest'
    when 'setting:coast' then 'where the salt wind never sleeps'
    when 'setting:river' then 'beside a great river'
    when 'setting:city' then 'where the roofs crowd together'
    when 'setting:plain' then 'on a plain open to the sky'
    when 'kind:temple' then 'in a house where gods were prayed to'
    when 'kind:tomb' then 'in the bed of a sleeping king'
    when 'kind:fortress' then 'behind walls that would not fall'
    when 'kind:lost_city' then 'in a city whose people vanished'
    when 'kind:monument' then 'at a thing built to be seen'
    when 'kind:natural' then 'in a wonder no hand made'
  end;
$$;

create or replace function public.djinn_is_prime(n integer) returns boolean
language sql immutable set search_path = '' as $$
  select n > 1 and not exists (select 1 from generate_series(2, floor(sqrt(n))::integer) d where n % d = 0);
$$;

create or replace function public.djinn_rule_holds(p_rule text, n integer) returns boolean
language sql immutable set search_path = '' as $$
  select case p_rule
    when 'prime' then public.djinn_is_prime(n)
    when 'three' then n % 3 = 0
    when 'four' then n % 4 = 0
    when 'seven' then n % 7 = 0
    else false
  end;
$$;

-- Shift the letters A–Z of a phrase by p_shift.
create or replace function public.djinn_caesar(p_text text, p_shift integer) returns text
language sql immutable set search_path = '' as $$
  select string_agg(case when c between 'A' and 'Z' then chr(65 + ((ascii(c) - 65 + p_shift) % 26 + 26) % 26) else c end, '' order by i)
    from unnest(string_to_array(upper(p_text), null)) with ordinality as t(c, i);
$$;

-- The gate: three rooms. A cipher wheel, a cursed floor, the scales of an idol.
create or replace function public.djinn_make_gate() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  phrases text[] := array['THE JAGUAR SLEEPS', 'SAND REMEMBERS', 'GOLD BENEATH STONE', 'THE LAMP IS AWAKE',
                          'SEEK THE SULTAN', 'FIRE AND SALT', 'NINE DOORS WAIT', 'THE RIVER KNOWS'];
  phrase text := phrases[1 + floor(random() * array_length(phrases, 1))::integer];
  shift integer := 3 + floor(random() * 20)::integer;
  rules text[] := array['prime', 'three', 'four', 'seven'];
  rl text := rules[1 + floor(random() * 4)::integer];
  riddle text;
  rows_n integer := 6;
  cols_n integer := 5;
  safe integer[] := '{}';
  col integer := floor(random() * 5)::integer;
  grid jsonb := '[]'::jsonb;
  row_vals jsonb;
  n integer;
  r integer;
  c integer;
  weights integer[] := '{}';
  pick integer[];
  target integer := 0;
begin
  riddle := case rl
    when 'prime' then 'Step only on stones that nothing divides but one and themselves.'
    when 'three' then 'Step only on stones that three can share evenly.'
    when 'four' then 'Step only on stones that four can share evenly.'
    else 'Step only on stones the sevens can share evenly.'
  end;
  -- A safe way from the bottom row to the top, one row at a time, never more than one stone sideways.
  for r in 1..rows_n loop
    safe := safe || col;
    col := least(cols_n - 1, greatest(0, col + floor(random() * 3)::integer - 1));
  end loop;
  -- Rows from the top (shown first) to the bottom (where the player starts).
  for r in reverse rows_n..1 loop
    row_vals := '[]'::jsonb;
    for c in 0..cols_n - 1 loop
      loop
        n := 2 + floor(random() * 59)::integer;
        exit when public.djinn_rule_holds(rl, n) = (safe[r] = c);
      end loop;
      row_vals := row_vals || to_jsonb(n);
    end loop;
    grid := grid || jsonb_build_array(row_vals);
  end loop;
  -- Six stones; three of them balance the idol.
  for r in 1..6 loop
    weights := weights || (2 + floor(random() * 24)::integer);
  end loop;
  select array_agg(i order by random()) into pick from generate_series(1, 6) i;
  pick := pick[1:3];
  foreach r in array pick loop
    target := target + weights[r];
  end loop;
  return jsonb_build_object(
    'cipher', jsonb_build_object('text', public.djinn_caesar(phrase, shift), 'answer', phrase),
    'floor', jsonb_build_object('grid', grid, 'rule', rl, 'riddle', riddle),
    'scales', jsonb_build_object('weights', to_jsonb(weights), 'target', target));
end;
$$;

-- A new Wager: one real place and seven decoys that each share some, but never all, of its traits.
create or replace function public.djinn_open_wager()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  truth public.djinn_sites%rowtype;
  decoys bigint[];
  seals bigint[];
  wonders text[] := array['cataclysm_orb', 'djinn_coin', 'orb_of_oblivion', 'orb_of_return', 'eye_of_the_djinn', 'hourglass_of_ages',
                          'master_key', 'phantom_cloak', 'carpet_of_kings', 'thiefs_hand', 'djinns_bargain', 'sandstorm_crown',
                          'mirror_of_many', 'seers_seal'];
  new_id uuid;
begin
  if exists (select 1 from public.djinn_wagers where ends_at > now() and winner is null) then
    return null; -- one at a time
  end if;
  select * into truth from public.djinn_sites order by random() limit 1;
  if truth.id is null then
    raise exception 'No Djinn sites loaded';
  end if;
  -- Hardest decoys first: those sharing two of the three traits.
  select array_agg(id) into decoys from (
    select s.id
      from public.djinn_sites s
     where s.id <> truth.id
       and (s.continent = truth.continent)::int + (s.setting = truth.setting)::int + (s.kind = truth.kind)::int < 3
     order by ((s.continent = truth.continent)::int + (s.setting = truth.setting)::int + (s.kind = truth.kind)::int) desc, random()
     limit 7) d;
  select array_agg(x order by random()) into seals from unnest(decoys || truth.id) x;
  insert into public.djinn_wagers (ends_at, wonder, site_ids, real_site, riddle, gate)
  values (now() + interval '3 days', wonders[1 + floor(random() * array_length(wonders, 1))::integer], seals, truth.id,
          'My treasure lies ' || public.djinn_clue('continent', truth.continent) || ', ' || public.djinn_clue('setting', truth.setting)
            || ', ' || public.djinn_clue('kind', truth.kind) || '.',
          public.djinn_make_gate())
  returning id into new_id;
  return new_id;
end;
$$;

-- The week's surprise moment (Lagos time): a day from Monday to Thursday, between 9 am and 9 pm.
create or replace function public.djinn_planned_start(p_week_start timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select p_week_start
         + make_interval(days => abs(hashtext('djinn:' || p_week_start::text)) % 4)
         + make_interval(hours => 9 + abs(hashtext('djinn-hour:' || p_week_start::text)) % 12);
$$;

-- Ran out of time at the gate without answering: turned away for two hours, like a wrong answer.
create or replace function public.djinn_timed_out(e public.djinn_entries) returns timestamptz
language sql stable set search_path = '' as $$
  select case when e.gate_started_at is not null and e.gate_score is null and now() > e.gate_deadline + interval '5 seconds'
              then e.gate_deadline + interval '2 hours' end;
$$;

-- The player's view of the Djinn: the Wager (if one is on), and where they are in it.
create or replace function public.djinn_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
  week_start timestamptz := date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  stage text;
  seals jsonb;
  chosen jsonb;
  winner_name text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  -- The weekly surprise (when switched on): never while a hunt is live.
  if public.djinn_auto() and now() >= public.djinn_planned_start(week_start)
     and not exists (select 1 from public.djinn_wagers where starts_at >= week_start)
     and not exists (select 1 from public.hunts h where public.hunt_phase(h) = 'live') then
    perform pg_advisory_xact_lock(hashtext('djinn:open'));
    if not exists (select 1 from public.djinn_wagers where starts_at >= week_start) then
      perform public.djinn_open_wager();
    end if;
  end if;

  -- The Wager on now, or one claimed in the last day (to show who took it).
  select * into w from public.djinn_wagers
   where starts_at <= now() and (ends_at > now() or claimed_at > now() - interval '1 day')
   order by starts_at desc limit 1;
  if w.id is null then
    return jsonb_build_object('now', now(), 'wager', null);
  end if;
  if w.winner is not null then
    select username into winner_name from public.profiles where id = w.winner;
  end if;

  select * into e from public.djinn_entries where wager_id = w.id and user_id = uid;
  stage := case
    when w.winner is not null or w.ends_at <= now() then 'over'
    when e.chosen_site is not null then 'chosen'
    when e.gate_score >= 1 then 'seals'
    when coalesce(e.retry_at, public.djinn_timed_out(e)) > now() then 'turned_away'
    when e.gate_started_at is not null and e.gate_score is null and now() <= e.gate_deadline + interval '5 seconds' then 'gate'
    else 'summoned'
  end;

  if stage in ('seals', 'chosen') then
    select jsonb_agg(jsonb_build_object('id', s.id, 'verse', s.verse, 'burned', s.id = any (e.burned)) order by array_position(w.site_ids, s.id))
      into seals from public.djinn_sites s where s.id = any (w.site_ids);
  end if;
  if e.chosen_site is not null then
    select jsonb_build_object('id', s.id, 'name', s.name, 'country', s.country, 'lng', s.lng, 'lat', s.lat, 'verse', s.verse)
      into chosen from public.djinn_sites s where s.id = e.chosen_site;
  end if;

  return jsonb_build_object(
    'now', now(),
    'wager', jsonb_build_object('id', w.id, 'wonder', w.wonder, 'startsAt', w.starts_at, 'endsAt', w.ends_at,
      'claimedBy', winner_name, 'claimedAt', w.claimed_at),
    'stage', stage,
    'gate', case when stage = 'gate' then jsonb_build_object(
      'deadline', e.gate_deadline, 'seconds', public.djinn_gate_seconds(),
      'cipher', w.gate -> 'cipher' -> 'text',
      'floor', jsonb_build_object('grid', w.gate -> 'floor' -> 'grid', 'riddle', w.gate -> 'floor' -> 'riddle'),
      'scales', w.gate -> 'scales') end,
    'retryAt', case when stage = 'turned_away' then coalesce(e.retry_at, public.djinn_timed_out(e)) end,
    'favour', e.favour,
    'riddle', case when stage in ('seals', 'chosen') then w.riddle end,
    'seals', seals,
    'chosen', chosen);
end;
$$;

-- Face the gate: the clock starts.
create or replace function public.djinn_start_gate()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into w from public.djinn_wagers where starts_at <= now() and ends_at > now() and winner is null order by starts_at desc limit 1;
  if w.id is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  select * into e from public.djinn_entries where wager_id = w.id and user_id = uid for update;
  if e.gate_score >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'passed');
  end if;
  if coalesce(e.retry_at, public.djinn_timed_out(e)) > now() then
    return jsonb_build_object('ok', false, 'reason', 'turned_away', 'retryAt', coalesce(e.retry_at, public.djinn_timed_out(e)));
  end if;
  if e.gate_started_at is not null and e.gate_score is null and now() <= e.gate_deadline then
    return jsonb_build_object('ok', true); -- already at it
  end if;
  insert into public.djinn_entries (wager_id, user_id, gate_started_at, gate_deadline)
  values (w.id, uid, now(), now() + make_interval(secs => public.djinn_gate_seconds()))
  on conflict (wager_id, user_id) do update
    set gate_started_at = excluded.gate_started_at, gate_deadline = excluded.gate_deadline, gate_score = null, retry_at = null;
  return jsonb_build_object('ok', true);
end;
$$;

-- Speak to the Djinn: the cipher's words, the way across the floor (a column per row, bottom
-- row first) and the stones for the scales (their places, 0–5). Favour burns decoys.
create or replace function public.djinn_answer_gate(p_cipher text, p_path integer[], p_weights integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
  cipher_ok boolean;
  floor_ok boolean := true;
  scales_ok boolean;
  grid jsonb;
  rows_n integer;
  r integer;
  score integer;
  fav integer;
  burn bigint[] := '{}';
  total integer := 0;
  i integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into w from public.djinn_wagers where starts_at <= now() and ends_at > now() and winner is null order by starts_at desc limit 1;
  if w.id is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  select * into e from public.djinn_entries where wager_id = w.id and user_id = uid for update;
  if e.gate_started_at is null or e.gate_score is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_at_gate');
  end if;

  -- 1. The cipher: the phrase, any case, spaces as they come.
  cipher_ok := regexp_replace(upper(coalesce(p_cipher, '')), '[^A-Z]', '', 'g') = regexp_replace(w.gate -> 'cipher' ->> 'answer', '[^A-Z]', '', 'g');

  -- 2. The floor: one stone per row from the bottom up, each one beside or ahead of the last, all obeying the rule.
  grid := w.gate -> 'floor' -> 'grid';
  rows_n := jsonb_array_length(grid);
  if p_path is null or array_length(p_path, 1) is distinct from rows_n then
    floor_ok := false;
  else
    for r in 1..rows_n loop
      if p_path[r] is null or p_path[r] < 0 or p_path[r] >= jsonb_array_length(grid -> 0)
         or (r > 1 and abs(p_path[r] - p_path[r - 1]) > 1)
         or not public.djinn_rule_holds(w.gate -> 'floor' ->> 'rule', (grid -> (rows_n - r) ->> p_path[r])::integer) then
        floor_ok := false;
        exit;
      end if;
    end loop;
  end if;

  -- 3. The scales: different stones that add up to the idol's weight.
  scales_ok := p_weights is not null and array_length(p_weights, 1) between 1 and 6
    and (select count(distinct x) = count(*) and bool_and(x between 0 and 5) from unnest(p_weights) x);
  if scales_ok then
    foreach i in array p_weights loop
      total := total + (w.gate -> 'scales' -> 'weights' ->> i)::integer;
    end loop;
    scales_ok := total = (w.gate -> 'scales' ->> 'target')::integer;
  end if;

  if now() > e.gate_deadline + interval '5 seconds' then
    cipher_ok := false; floor_ok := false; scales_ok := false; -- too slow: the gate closed
  end if;
  score := cipher_ok::int + floor_ok::int + scales_ok::int;
  fav := case score when 3 then 2 when 2 then 1 else 0 end;
  if fav > 0 then
    select array_agg(x) into burn from (
      select x from unnest(w.site_ids) x where x <> w.real_site order by random() limit fav) b;
  end if;
  update public.djinn_entries
     set gate_score = score, favour = fav, burned = coalesce(burn, '{}'),
         retry_at = case when score = 0 then now() + interval '2 hours' end,
         gate_started_at = case when score = 0 then null else gate_started_at end
   where wager_id = w.id and user_id = uid;
  return jsonb_build_object('ok', true, 'score', score, 'favour', fav,
    'rooms', jsonb_build_object('cipher', cipher_ok, 'floor', floor_ok, 'scales', scales_ok),
    'retryAt', case when score = 0 then now() + interval '2 hours' end);
end;
$$;

-- Break a seal: the choice is final for the Wager.
create or replace function public.djinn_choose(p_site bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
  s public.djinn_sites%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into w from public.djinn_wagers where starts_at <= now() and ends_at > now() and winner is null order by starts_at desc limit 1;
  if w.id is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  select * into e from public.djinn_entries where wager_id = w.id and user_id = uid for update;
  if e.gate_score is null or e.gate_score < 1 then
    return jsonb_build_object('ok', false, 'reason', 'gate');
  end if;
  if e.chosen_site is not null then
    return jsonb_build_object('ok', false, 'reason', 'chosen');
  end if;
  if not (p_site = any (w.site_ids)) or p_site = any (e.burned) then
    return jsonb_build_object('ok', false, 'reason', 'seal');
  end if;
  update public.djinn_entries set chosen_site = p_site, chosen_at = now() where wager_id = w.id and user_id = uid;
  select * into s from public.djinn_sites where id = p_site;
  return jsonb_build_object('ok', true, 'site', jsonb_build_object('id', s.id, 'name', s.name, 'country', s.country, 'lng', s.lng, 'lat', s.lat, 'verse', s.verse));
end;
$$;

revoke execute on function public.djinn_open_wager(), public.djinn_make_gate() from public, anon, authenticated;
revoke execute on function public.djinn_state(), public.djinn_start_gate(), public.djinn_answer_gate(text, integer[], integer[]), public.djinn_choose(bigint) from public, anon;
grant execute on function public.djinn_state(), public.djinn_start_gate(), public.djinn_answer_gate(text, integer[], integer[]), public.djinn_choose(bigint) to authenticated;
