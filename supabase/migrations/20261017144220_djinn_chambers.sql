-- The Djinn's Wager, part 2: the approach, the chamber and the Wonder (design doc 7.6, 7.7).
--
-- Traps: two hidden rings around each place (600 m and 300 m), each cut into
-- eight directions; the Djinn traps three directions on each ring, the same for
-- everyone that Wager. Crossing a ring where a trap lies springs it, once per
-- approach: quicksand (stuck 25 s), a dart wall (stuck 15 s, 10 energy), a snake
-- pit (25 energy) or a collapsing bridge (thrown back 300 m).
--
-- The chamber: within 60 m of the place, three harder rooms in three minutes,
-- all three to be right. At the real place, the first to master it takes the
-- Wonder (and the Wager ends for everyone). At a decoy the vault is empty.
-- Failing: a whirlwind drops the player at an airport some way off (as if they'd
-- flown there, so the usual landing hop applies); they may come back and try
-- again for as long as the Wager lasts.
--
-- Unclaimed Wagers: the next one offers two Wonders. Wonders are held in secret
-- (player_wonders, readable only by their holder) for 30 days.

alter table public.djinn_wagers add column if not exists extra_wonder text;
alter table public.djinn_entries add column if not exists rings_done integer[] not null default '{}';
alter table public.djinn_entries add column if not exists vault text check (vault in ('empty', 'won'));

create table public.djinn_traps (
  wager_id uuid not null references public.djinn_wagers (id) on delete cascade,
  site_id  bigint not null references public.djinn_sites (id),
  ring     integer not null,              -- metres from the place
  arc      integer not null check (arc between 0 and 7), -- 45° directions from the place, 0 = north
  kind     text not null check (kind in ('quicksand', 'dart_wall', 'snake_pit', 'collapsing_bridge')),
  primary key (wager_id, site_id, ring, arc)
);
alter table public.djinn_traps enable row level security;

create table public.djinn_chambers (
  id          uuid primary key default gen_random_uuid(),
  wager_id    uuid not null references public.djinn_wagers (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  site_id     bigint not null references public.djinn_sites (id),
  rooms       jsonb not null,             -- with their answers (never sent)
  started_at  timestamptz not null default now(),
  deadline    timestamptz not null,
  outcome     text check (outcome in ('won', 'empty', 'whirlwind', 'too_late')),
  answered_at timestamptz
);
create index djinn_chambers_user_idx on public.djinn_chambers (user_id, started_at desc);
alter table public.djinn_chambers enable row level security;

create table public.player_wonders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  wonder     text not null,
  wager_id   uuid references public.djinn_wagers (id) on delete set null,
  won_at     timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at    timestamptz
);
alter table public.player_wonders enable row level security;
create policy "Players read their own Wonders" on public.player_wonders for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.player_wonders from anon, authenticated;

create or replace function public.djinn_chamber_seconds() returns integer language sql immutable set search_path = '' as $$ select 180 $$;

-- The three rooms, harder than the gate: a longer cipher, a floor with false stones, seven stones for the scales.
create or replace function public.djinn_make_chamber() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  phrases text[] := array['THE JAGUAR SLEEPS', 'SAND REMEMBERS', 'GOLD BENEATH STONE', 'THE LAMP IS AWAKE',
                          'SEEK THE SULTAN', 'FIRE AND SALT', 'NINE DOORS WAIT', 'THE RIVER KNOWS',
                          'NO KING SLEEPS HERE', 'THE STARS ARE LYING', 'COUNT THE BONES', 'SILVER UNDER WATER'];
  phrase text := phrases[1 + floor(random() * 12)::integer] || ' ' || phrases[1 + floor(random() * 12)::integer];
  shift integer := 3 + floor(random() * 20)::integer;
  rules text[] := array['prime', 'three', 'four', 'seven'];
  rl text := rules[1 + floor(random() * 4)::integer];
  riddle text;
  rows_n integer := 7;
  cols_n integer := 5;
  safe integer[] := '{}';
  col integer := floor(random() * 5)::integer;
  grid jsonb := '[]'::jsonb;
  row_vals jsonb;
  n integer;
  r integer;
  c integer;
  wanted boolean;
  weights integer[] := '{}';
  pick integer[];
  target integer := 0;
begin
  riddle := case rl
    when 'prime' then 'Tread only where nothing divides but one and itself. Some safe stones lead nowhere.'
    when 'three' then 'Tread only where three can share evenly. Some safe stones lead nowhere.'
    when 'four' then 'Tread only where four can share evenly. Some safe stones lead nowhere.'
    else 'Tread only where the sevens can share evenly. Some safe stones lead nowhere.'
  end;
  for r in 1..rows_n loop
    safe := safe || col;
    col := least(cols_n - 1, greatest(0, col + floor(random() * 3)::integer - 1));
  end loop;
  for r in reverse rows_n..1 loop
    row_vals := '[]'::jsonb;
    for c in 0..cols_n - 1 loop
      -- The true path obeys the rule; a few false stones do too, to lure the careless.
      wanted := safe[r] = c or (abs(safe[r] - c) >= 2 and random() < 0.3);
      loop
        n := 2 + floor(random() * 97)::integer;
        exit when public.djinn_rule_holds(rl, n) = wanted;
      end loop;
      row_vals := row_vals || to_jsonb(n);
    end loop;
    grid := grid || jsonb_build_array(row_vals);
  end loop;
  for r in 1..7 loop
    weights := weights || (3 + floor(random() * 37)::integer);
  end loop;
  select array_agg(i order by random()) into pick from generate_series(1, 7) i;
  pick := pick[1:4];
  foreach r in array pick loop
    target := target + weights[r];
  end loop;
  return jsonb_build_object(
    'cipher', jsonb_build_object('text', public.djinn_caesar(phrase, shift), 'answer', phrase),
    'floor', jsonb_build_object('grid', grid, 'rule', rl, 'riddle', riddle),
    'scales', jsonb_build_object('weights', to_jsonb(weights), 'target', target));
end;
$$;

-- Check three answers against a set of rooms: {cipher, floor, scales} true or false.
create or replace function public.djinn_check_rooms(p_rooms jsonb, p_cipher text, p_path integer[], p_weights integer[])
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  cipher_ok boolean;
  floor_ok boolean := true;
  scales_ok boolean;
  grid jsonb := p_rooms -> 'floor' -> 'grid';
  rows_n integer := jsonb_array_length(p_rooms -> 'floor' -> 'grid');
  stones integer := jsonb_array_length(p_rooms -> 'scales' -> 'weights');
  r integer;
  i integer;
  total integer := 0;
begin
  cipher_ok := regexp_replace(upper(coalesce(p_cipher, '')), '[^A-Z]', '', 'g') = regexp_replace(p_rooms -> 'cipher' ->> 'answer', '[^A-Z]', '', 'g');
  if p_path is null or array_length(p_path, 1) is distinct from rows_n then
    floor_ok := false;
  else
    for r in 1..rows_n loop
      if p_path[r] is null or p_path[r] < 0 or p_path[r] >= jsonb_array_length(grid -> 0)
         or (r > 1 and abs(p_path[r] - p_path[r - 1]) > 1)
         or not public.djinn_rule_holds(p_rooms -> 'floor' ->> 'rule', (grid -> (rows_n - r) ->> p_path[r])::integer) then
        floor_ok := false;
        exit;
      end if;
    end loop;
  end if;
  scales_ok := p_weights is not null and array_length(p_weights, 1) between 1 and stones
    and (select count(distinct x) = count(*) and bool_and(x between 0 and stones - 1) from unnest(p_weights) x);
  if scales_ok then
    foreach i in array p_weights loop
      total := total + (p_rooms -> 'scales' -> 'weights' ->> i)::integer;
    end loop;
    scales_ok := total = (p_rooms -> 'scales' ->> 'target')::integer;
  end if;
  return jsonb_build_object('cipher', cipher_ok, 'floor', floor_ok, 'scales', scales_ok);
end;
$$;

-- The direction (0–7, 45° each, 0 = north) from a place to a point.
create or replace function public.djinn_arc(p_from_lng double precision, p_from_lat double precision, p_lng double precision, p_lat double precision)
returns integer language sql immutable set search_path = '' as $$
  select (floor(((degrees(atan2((p_lng - p_from_lng) * cos(radians(p_from_lat)), p_lat - p_from_lat)) + 360 + 22.5)::numeric % 360) / 45))::integer % 8;
$$;

-- A point p_metres from a place, in the direction of another point (or straight north).
create or replace function public.djinn_away(p_lng double precision, p_lat double precision, p_towards_lng double precision, p_towards_lat double precision, p_metres double precision)
returns double precision[] language plpgsql immutable set search_path = '' as $$
declare
  dx double precision := (p_towards_lng - p_lng) * 111320 * cos(radians(p_lat));
  dy double precision := (p_towards_lat - p_lat) * 110574;
  d double precision := sqrt(dx * dx + dy * dy);
begin
  if d < 1 then
    dx := 0; dy := 1; d := 1;
  end if;
  return array[p_lng + dx / d * p_metres / (111320 * cos(radians(p_lat))), p_lat + dy / d * p_metres / 110574];
end;
$$;

-- The player's open Wager entry with a chosen seal, if any.
create or replace function public.djinn_my_quest(p_user uuid)
returns table (wager_id uuid, site_id bigint, real_site bigint, site_lng double precision, site_lat double precision, site_name text)
language sql stable security definer set search_path = '' as $$
  select w.id, s.id, w.real_site, s.lng, s.lat, s.name
    from public.djinn_wagers w
    join public.djinn_entries e on e.wager_id = w.id and e.user_id = p_user
    join public.djinn_sites s on s.id = e.chosen_site
   where w.starts_at <= now() and w.ends_at > now() and w.winner is null and e.vault is null
   order by w.starts_at desc limit 1;
$$;

-- Walking up to the chosen place: springs a trap when a trapped ring is crossed.
-- Returns where the player stands relative to the place, and the trap if one sprang.
create or replace function public.djinn_approach()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  q record;
  pos public.player_positions%rowtype;
  e public.djinn_entries%rowtype;
  d double precision;
  rr integer;
  t public.djinn_traps%rowtype;
  sprung jsonb;
  spot double precision[];
  kinds text[] := array['quicksand', 'dart_wall', 'snake_pit', 'collapsing_bridge'];
  arcs integer[];
  a integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into q from public.djinn_my_quest(uid);
  if q.wager_id is null then
    return jsonb_build_object('quest', false);
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('quest', true, 'metres', null);
  end if;
  d := public.distance_m(pos.lng, pos.lat, q.site_lng, q.site_lat);

  -- The traps around this place for this Wager: three directions on each ring.
  if not exists (select 1 from public.djinn_traps where wager_id = q.wager_id and site_id = q.site_id) then
    perform pg_advisory_xact_lock(hashtext('djinn-traps:' || q.wager_id || ':' || q.site_id));
    if not exists (select 1 from public.djinn_traps where wager_id = q.wager_id and site_id = q.site_id) then
      foreach rr in array array[600, 300] loop
        select array_agg(x) into arcs from (select x from generate_series(0, 7) x order by random() limit 3) s;
        foreach a in array arcs loop
          insert into public.djinn_traps (wager_id, site_id, ring, arc, kind)
          values (q.wager_id, q.site_id, rr, a, kinds[1 + floor(random() * 4)::integer]);
        end loop;
      end loop;
    end if;
  end if;

  select * into e from public.djinn_entries where wager_id = q.wager_id and user_id = uid for update;
  -- Crossing a ring (once per approach): the outer one first.
  foreach rr in array array[600, 300] loop
    if d < rr and not (rr = any (e.rings_done)) then
      e.rings_done := e.rings_done || rr;
      select * into t from public.djinn_traps
       where wager_id = q.wager_id and site_id = q.site_id and djinn_traps.ring = rr
         and arc = public.djinn_arc(q.site_lng, q.site_lat, pos.lng, pos.lat);
      if t.kind is not null and sprung is null then
        if t.kind = 'snake_pit' then
          update public.player_positions set energy = greatest(1, coalesce(energy, 100) - 25) where user_id = uid;
          sprung := jsonb_build_object('kind', t.kind, 'energy', -25);
        elsif t.kind = 'dart_wall' then
          update public.player_positions set energy = greatest(1, coalesce(energy, 100) - 10) where user_id = uid;
          sprung := jsonb_build_object('kind', t.kind, 'energy', -10, 'stuck', 15);
        elsif t.kind = 'quicksand' then
          sprung := jsonb_build_object('kind', t.kind, 'stuck', 25);
        else
          -- The bridge gives way: back out past the ring.
          spot := public.djinn_away(q.site_lng, q.site_lat, pos.lng, pos.lat, rr + 300);
          update public.player_positions set lng = spot[1], lat = spot[2], updated_at = now() where user_id = uid;
          e.rings_done := array_remove(e.rings_done, rr); -- they'll have to cross it again
          sprung := jsonb_build_object('kind', t.kind, 'lng', spot[1], 'lat', spot[2]);
        end if;
      end if;
    end if;
  end loop;
  update public.djinn_entries set rings_done = e.rings_done where wager_id = q.wager_id and user_id = uid;
  select energy into pos.energy from public.player_positions where user_id = uid;
  return jsonb_build_object('quest', true, 'place', q.site_name, 'metres', round(d), 'trap', sprung, 'energy', round(pos.energy::numeric, 1));
end;
$$;

-- Into the chamber (within 60 m of the place): three rooms against the clock. Asking again while an
-- attempt is open gives the same rooms.
create or replace function public.djinn_enter_chamber()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  q record;
  pos public.player_positions%rowtype;
  ch public.djinn_chambers%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into q from public.djinn_my_quest(uid);
  if q.wager_id is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, q.site_lng, q.site_lat) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  select * into ch from public.djinn_chambers
   where wager_id = q.wager_id and user_id = uid and outcome is null and deadline > now()
   order by started_at desc limit 1;
  if ch.id is null then
    insert into public.djinn_chambers (wager_id, user_id, site_id, rooms, deadline)
    values (q.wager_id, uid, q.site_id, public.djinn_make_chamber(), now() + make_interval(secs => public.djinn_chamber_seconds()))
    returning * into ch;
  end if;
  return jsonb_build_object('ok', true, 'chamber', ch.id, 'place', q.site_name, 'deadline', ch.deadline, 'now', now(),
    'seconds', public.djinn_chamber_seconds(),
    'cipher', ch.rooms -> 'cipher' -> 'text',
    'floor', jsonb_build_object('grid', ch.rooms -> 'floor' -> 'grid', 'riddle', ch.rooms -> 'floor' -> 'riddle'),
    'scales', ch.rooms -> 'scales');
end;
$$;

-- The chamber's answers. All three right in time: the Wonder (real place, first) or an empty vault
-- (a decoy). Otherwise the whirlwind.
create or replace function public.djinn_answer_chamber(p_chamber uuid, p_cipher text, p_path integer[], p_weights integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ch public.djinn_chambers%rowtype;
  w public.djinn_wagers%rowtype;
  marks jsonb;
  all_ok boolean;
  result text;
  drop_at record;
  site public.djinn_sites%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into ch from public.djinn_chambers where id = p_chamber and user_id = uid and outcome is null for update;
  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into w from public.djinn_wagers where id = ch.wager_id for update;
  marks := public.djinn_check_rooms(ch.rooms, p_cipher, p_path, p_weights);
  all_ok := (marks ->> 'cipher')::boolean and (marks ->> 'floor')::boolean and (marks ->> 'scales')::boolean
            and now() <= ch.deadline + interval '5 seconds';

  if all_ok and ch.site_id <> w.real_site then
    result := 'empty';
    update public.djinn_entries set vault = 'empty' where wager_id = w.id and user_id = uid;
  elsif all_ok and (w.winner is not null or w.ends_at <= now()) then
    result := 'too_late';
  elsif all_ok then
    result := 'won';
    update public.djinn_wagers set winner = uid, claimed_at = now() where id = w.id;
    update public.djinn_entries set vault = 'won' where wager_id = w.id and user_id = uid;
    insert into public.player_wonders (user_id, wonder, wager_id) values (uid, w.wonder, w.id);
    if w.extra_wonder is not null then
      insert into public.player_wonders (user_id, wonder, wager_id) values (uid, w.extra_wonder, w.id);
    end if;
  else
    -- The whirlwind: dropped at an airport 10–150 km away (a random one of the nearest few), as if flown there.
    result := 'whirlwind';
    select * into site from public.djinn_sites where id = ch.site_id;
    select s.name, s.lng, s.lat into drop_at
      from public.transit_stops s
     where s.kind = 'plane' and s.lat between site.lat - 1.5 and site.lat + 1.5 and s.lng between site.lng - 1.5 and site.lng + 1.5
       and public.distance_m(site.lng, site.lat, s.lng, s.lat) between 10000 and 150000
     order by random() limit 1;
    if drop_at.name is null then
      select s.name, s.lng, s.lat into drop_at from public.transit_stops s
       where s.kind = 'plane' order by public.distance_m(site.lng, site.lat, s.lng, s.lat) limit 1;
    end if;
    update public.player_positions set lng = drop_at.lng, lat = drop_at.lat, mode = 'walk', updated_at = now(), resting_since = null
     where user_id = uid;
    -- As if they'd flown there: save_position allows the hop from the airfield to its nearest road.
    insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at, ended_at, outcome)
    values (uid, 'plane', 'The whirlwind', drop_at.name, drop_at.lng, drop_at.lat,
            jsonb_build_array(jsonb_build_array(site.lng, site.lat), jsonb_build_array(drop_at.lng, drop_at.lat)),
            public.distance_m(site.lng, site.lat, drop_at.lng, drop_at.lat), 0, now(), now(), now(), 'arrived');
    update public.djinn_entries set rings_done = '{}' where wager_id = w.id and user_id = uid; -- the traps wait again
  end if;
  update public.djinn_chambers set outcome = result, answered_at = now() where id = ch.id;
  return jsonb_build_object('ok', true, 'outcome', result, 'rooms', marks, 'wonder', w.wonder, 'extraWonder', w.extra_wonder,
    'dropAt', case when result = 'whirlwind' then jsonb_build_object('name', drop_at.name, 'lng', drop_at.lng, 'lat', drop_at.lat) end);
end;
$$;

-- Other hunters who broke the same seal: how many, and how close the nearest is to the place.
create or replace function public.djinn_rivals()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  q record;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into q from public.djinn_my_quest(uid);
  if q.wager_id is null then
    return null;
  end if;
  select jsonb_build_object('count', count(*), 'nearest', min(round(public.distance_m(p.lng, p.lat, q.site_lng, q.site_lat))))
    into result
    from public.djinn_entries e join public.player_positions p on p.user_id = e.user_id
   where e.wager_id = q.wager_id and e.chosen_site = q.site_id and e.user_id <> uid and e.vault is null;
  return result;
end;
$$;

-- A new Wager (as before), now with a second Wonder when the last one went unclaimed, and never a
-- Wonder someone already holds.
create or replace function public.djinn_open_wager()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  truth public.djinn_sites%rowtype;
  decoys bigint[];
  seals bigint[];
  all_wonders text[] := array['cataclysm_orb', 'djinn_coin', 'orb_of_oblivion', 'orb_of_return', 'eye_of_the_djinn', 'hourglass_of_ages',
                              'master_key', 'phantom_cloak', 'carpet_of_kings', 'thiefs_hand', 'djinns_bargain', 'sandstorm_crown',
                              'mirror_of_many', 'seers_seal'];
  free text[];
  prev public.djinn_wagers%rowtype;
  new_id uuid;
begin
  if exists (select 1 from public.djinn_wagers where ends_at > now() and winner is null) then
    return null; -- one at a time
  end if;
  select array_agg(x order by random()) into free from unnest(all_wonders) x
   where not exists (select 1 from public.player_wonders pw where pw.wonder = x and pw.used_at is null and pw.expires_at > now());
  if free is null then
    free := all_wonders;
  end if;
  select * into prev from public.djinn_wagers order by starts_at desc limit 1;
  select * into truth from public.djinn_sites order by random() limit 1;
  if truth.id is null then
    raise exception 'No Djinn sites loaded';
  end if;
  select array_agg(id) into decoys from (
    select s.id
      from public.djinn_sites s
     where s.id <> truth.id
       and (s.continent = truth.continent)::int + (s.setting = truth.setting)::int + (s.kind = truth.kind)::int < 3
     order by ((s.continent = truth.continent)::int + (s.setting = truth.setting)::int + (s.kind = truth.kind)::int) desc, random()
     limit 7) d;
  select array_agg(x order by random()) into seals from unnest(decoys || truth.id) x;
  insert into public.djinn_wagers (ends_at, wonder, extra_wonder, site_ids, real_site, riddle, gate)
  values (now() + interval '3 days', free[1],
          case when prev.id is not null and prev.winner is null and array_length(free, 1) > 1 then free[2] end,
          seals, truth.id,
          'My treasure lies ' || public.djinn_clue('continent', truth.continent) || ', ' || public.djinn_clue('setting', truth.setting)
            || ', ' || public.djinn_clue('kind', truth.kind) || '.',
          public.djinn_make_gate())
  returning id into new_id;
  return new_id;
end;
$$;

-- The player's view of the Djinn (as before), with the vault's outcome and the second Wonder.
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
  if public.djinn_auto() and now() >= public.djinn_planned_start(week_start)
     and not exists (select 1 from public.djinn_wagers where starts_at >= week_start)
     and not exists (select 1 from public.hunts h where public.hunt_phase(h) = 'live') then
    perform pg_advisory_xact_lock(hashtext('djinn:open'));
    if not exists (select 1 from public.djinn_wagers where starts_at >= week_start) then
      perform public.djinn_open_wager();
    end if;
  end if;

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
    when w.winner = uid then 'won'
    when w.winner is not null or w.ends_at <= now() then 'over'
    when e.vault = 'empty' then 'fooled'
    when e.chosen_site is not null then 'chosen'
    when e.gate_score >= 1 then 'seals'
    when coalesce(e.retry_at, public.djinn_timed_out(e)) > now() then 'turned_away'
    when e.gate_started_at is not null and e.gate_score is null and now() <= e.gate_deadline + interval '5 seconds' then 'gate'
    else 'summoned'
  end;

  if stage in ('seals', 'chosen', 'fooled') then
    select jsonb_agg(jsonb_build_object('id', s.id, 'verse', s.verse, 'burned', s.id = any (e.burned)) order by array_position(w.site_ids, s.id))
      into seals from public.djinn_sites s where s.id = any (w.site_ids);
  end if;
  if e.chosen_site is not null then
    select jsonb_build_object('id', s.id, 'name', s.name, 'country', s.country, 'lng', s.lng, 'lat', s.lat, 'verse', s.verse)
      into chosen from public.djinn_sites s where s.id = e.chosen_site;
  end if;

  return jsonb_build_object(
    'now', now(),
    'wager', jsonb_build_object('id', w.id, 'wonder', w.wonder, 'extraWonder', w.extra_wonder, 'startsAt', w.starts_at, 'endsAt', w.ends_at,
      'claimedBy', winner_name, 'claimedAt', w.claimed_at),
    'stage', stage,
    'gate', case when stage = 'gate' then jsonb_build_object(
      'deadline', e.gate_deadline, 'seconds', public.djinn_gate_seconds(),
      'cipher', w.gate -> 'cipher' -> 'text',
      'floor', jsonb_build_object('grid', w.gate -> 'floor' -> 'grid', 'riddle', w.gate -> 'floor' -> 'riddle'),
      'scales', w.gate -> 'scales') end,
    'retryAt', case when stage = 'turned_away' then coalesce(e.retry_at, public.djinn_timed_out(e)) end,
    'favour', e.favour,
    'riddle', case when stage in ('seals', 'chosen', 'fooled') then w.riddle end,
    'seals', seals,
    'chosen', chosen);
end;
$$;

revoke execute on function public.djinn_make_chamber(), public.djinn_my_quest(uuid) from public, anon, authenticated;
revoke execute on function public.djinn_approach(), public.djinn_enter_chamber(), public.djinn_answer_chamber(uuid, text, integer[], integer[]), public.djinn_rivals()
  from public, anon;
grant execute on function public.djinn_approach(), public.djinn_enter_chamber(), public.djinn_answer_chamber(uuid, text, integer[], integer[]), public.djinn_rivals()
  to authenticated;
