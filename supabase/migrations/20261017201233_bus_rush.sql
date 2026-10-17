-- The bus rush (owner, 17 Oct 2026): at night and at rush hour a city bus is a scramble. Other passengers wait at
-- the stop; when the bus pulls in, the player pushes through by answering quick questions (5, 6 seconds each).
-- Each right answer raises the chance of getting on (10% with none, sure with all five); missing it, the bus leaves
-- full and the player waits for the next one (the fare stays paid; they may still cancel for a refund). The server
-- keeps the answers and decides.

alter table public.transit_trips
  add column rush text check (rush in ('pending', 'boarded')),  -- null: no rush (you just get on)
  add column ride_s double precision,                            -- how long the ride takes once aboard
  add column rush_tries integer not null default 0;

create table public.bus_rushes (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.transit_trips (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  questions   jsonb not null,           -- with the answers: never sent to the player
  seconds     integer not null,         -- for all of them
  crowd       integer not null,         -- others pushing for the same bus
  started_at  timestamptz not null default now(),
  answered_at timestamptz,
  score       integer,
  chance      double precision,
  outcome     text check (outcome in ('boarded', 'missed'))
);
create index bus_rushes_trip on public.bus_rushes (trip_id, id desc);
alter table public.bus_rushes enable row level security;

-- A rush for city buses at night (few buses, everyone going home) and at rush hour.
create or replace function public.bus_rush_due(p_lng double precision, p_lat double precision) returns boolean
language sql stable set search_path = '' as $$
  select public.is_night(p_lng, p_lat) or public.traffic_level(p_lng, p_lat) >= 0.6;
$$;

-- Five quick questions: sums, differences, times tables, halves, what comes next. Three choices each.
create or replace function public.rush_questions(p_count integer) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  qs jsonb := '[]'::jsonb;
  kind integer;
  a integer;
  b integer;
  q text;
  answer integer;
  wrong1 integer;
  wrong2 integer;
  slot integer;
  choices integer[];
begin
  for n in 1 .. p_count loop
    kind := floor(random() * 5)::integer;
    if kind = 0 then
      a := 12 + floor(random() * 78)::integer; b := 12 + floor(random() * 78)::integer;
      q := a || ' + ' || b; answer := a + b;
    elsif kind = 1 then
      a := 40 + floor(random() * 59)::integer; b := 11 + floor(random() * 28)::integer;
      q := a || ' − ' || b; answer := a - b;
    elsif kind = 2 then
      a := 3 + floor(random() * 10)::integer; b := 3 + floor(random() * 10)::integer;
      q := a || ' × ' || b; answer := a * b;
    elsif kind = 3 then
      a := 2 * (10 + floor(random() * 90)::integer);
      q := 'Half of ' || a; answer := a / 2;
    else
      a := 1 + floor(random() * 20)::integer; b := 2 + floor(random() * 8)::integer;
      q := a || ', ' || (a + b) || ', ' || (a + 2 * b) || ', ' || (a + 3 * b) || ', ?'; answer := a + 4 * b;
    end if;
    -- Two near misses, never the answer, never the same.
    wrong1 := answer + (1 + floor(random() * 9)::integer) * (case when random() < 0.5 then -1 else 1 end);
    loop
      wrong2 := answer + (1 + floor(random() * 12)::integer) * (case when random() < 0.5 then -1 else 1 end);
      exit when wrong2 <> wrong1 and wrong2 <> answer;
    end loop;
    slot := floor(random() * 3)::integer;
    choices := case slot when 0 then array[answer, wrong1, wrong2] when 1 then array[wrong1, answer, wrong2] else array[wrong1, wrong2, answer] end;
    qs := qs || jsonb_build_array(jsonb_build_object('q', q, 'choices', to_jsonb(choices), 'answer', slot));
  end loop;
  return qs;
end;
$$;

-- The bus has pulled in: the rush starts (or the one under way is resumed). Questions come without their answers.
create or replace function public.bus_rush_start()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.transit_trips%rowtype;
  r public.bus_rushes%rowtype;
  first_lng double precision;
  first_lat double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into p from public.transit_trips where user_id = uid and ended_at is null for update;
  if p.id is null or p.rush is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'no_rush');
  end if;
  if now() < p.departs_at - interval '4 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'trip', public.trip_json(p));
  end if;
  select * into r from public.bus_rushes where trip_id = p.id and answered_at is null and started_at > now() - interval '90 seconds' order by id desc limit 1;
  if r.id is null then
    first_lng := (p.path -> 0 ->> 0)::double precision;
    first_lat := (p.path -> 0 ->> 1)::double precision;
    insert into public.bus_rushes (trip_id, user_id, questions, seconds, crowd)
    values (p.id, uid, public.rush_questions(5), 30,
            case when public.is_night(first_lng, first_lat) then 7 else 5 end + floor(random() * 4)::integer)
    returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'rush', jsonb_build_object(
    'id', r.id, 'seconds', r.seconds, 'crowd', r.crowd, 'startedAt', r.started_at, 'now', now(), 'tries', p.rush_tries,
    'questions', (select jsonb_agg(q - 'answer' order by i) from jsonb_array_elements(r.questions) with ordinality as x(q, i))));
end;
$$;

-- The answers (-1: no answer). On: the bus leaves with the player now. Missed: the next bus, and another rush.
create or replace function public.bus_rush_answer(p_rush bigint, p_choices integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.bus_rushes%rowtype;
  p public.transit_trips%rowtype;
  got integer := 0;
  odds double precision;
  boarded boolean;
  first_lng double precision;
  first_lat double precision;
  next_in integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.bus_rushes where id = p_rush and user_id = uid and answered_at is null for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  select * into p from public.transit_trips where id = r.trip_id and ended_at is null and rush = 'pending' for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  -- Right answers count only within the time (a few seconds' grace for the network).
  if now() <= r.started_at + make_interval(secs => r.seconds + 4) then
    for i in 0 .. jsonb_array_length(r.questions) - 1 loop
      if p_choices[i + 1] is not null and p_choices[i + 1] = (r.questions -> i ->> 'answer')::integer then
        got := got + 1;
      end if;
    end loop;
  end if;
  odds := least(1, 0.1 + 0.18 * got);
  boarded := random() < odds;
  update public.bus_rushes set answered_at = now(), score = got, chance = odds, outcome = case when boarded then 'boarded' else 'missed' end where id = r.id;
  if boarded then
    update public.transit_trips set rush = 'boarded', departs_at = now(), arrives_at = now() + make_interval(secs => coalesce(ride_s, 60))
     where id = p.id returning * into p;
  else
    first_lng := (p.path -> 0 ->> 0)::double precision;
    first_lat := (p.path -> 0 ->> 1)::double precision;
    next_in := public.transit_wait_s('bus', false) * case when public.is_night(first_lng, first_lat) then public.night_bus_wait() else 1 end;
    update public.transit_trips
       set departs_at = now() + make_interval(secs => next_in),
           arrives_at = now() + make_interval(secs => next_in + coalesce(ride_s, 60)),
           rush_tries = rush_tries + 1
     where id = p.id returning * into p;
  end if;
  return jsonb_build_object('ok', true, 'boarded', boarded, 'score', got, 'of', jsonb_array_length(r.questions),
    'chance', round(odds::numeric, 2), 'trip', public.trip_json(p));
end;
$$;

revoke execute on function public.bus_rush_due(double precision, double precision), public.rush_questions(integer) from public, anon, authenticated;
revoke execute on function public.bus_rush_start(), public.bus_rush_answer(bigint, integer[]) from public, anon;
grant execute on function public.bus_rush_start(), public.bus_rush_answer(bigint, integer[]) to authenticated;

create or replace function public.start_trip(p_from bigint, p_to bigint, p_path jsonb, p_fast_pass boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.transit_stops%rowtype;
  t public.transit_stops%rowtype;
  pos public.player_positions%rowtype;
  straight double precision;
  metres double precision;
  points integer;
  fare integer;
  pass uuid;
  balance bigint;
  trip public.transit_trips%rowtype;
  wait integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'on_trip');
  end if;
  select * into f from public.transit_stops where id = p_from;
  select * into t from public.transit_stops where id = p_to;
  if f.id is null or t.id is null or f.kind <> t.kind or f.id = t.id then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;
  if f.kind = 'train' and t.line_id is distinct from f.line_id then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;
  straight := public.distance_m(f.lng, f.lat, t.lng, t.lat);
  -- Buses: within 40 km from any stop; further (up to 1,500 km) only between motor parks.
  if f.kind = 'bus' and (straight < 150 or (straight > public.bus_range_m() and not (f.park and t.park and straight <= 1500000))) then
    return jsonb_build_object('ok', false, 'reason', 'route');
  end if;

  -- A rental must be returned first; your own vehicle goes into your pocket (below, once it's certain).
  if exists (select 1 from public.vehicle_rentals where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'vehicle');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, f.lng, f.lat) > public.transit_reach_m(f.kind) then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if public.dome_blocking(uid, t.lng, t.lat) is not null then
    return jsonb_build_object('ok', false, 'reason', 'dome');
  end if;

  -- The path must run from this stop to that one.
  points := case when jsonb_typeof(p_path) = 'array' then jsonb_array_length(p_path) else 0 end;
  if points < 2 or points > 5000
     or public.distance_m(f.lng, f.lat, (p_path -> 0 ->> 0)::double precision, (p_path -> 0 ->> 1)::double precision) > 400
     or public.distance_m(t.lng, t.lat, (p_path -> (points - 1) ->> 0)::double precision, (p_path -> (points - 1) ->> 1)::double precision) > 400 then
    return jsonb_build_object('ok', false, 'reason', 'path');
  end if;
  metres := case f.kind
    when 'bus' then greatest(public.path_length_m(p_path), straight)
    when 'train' then abs(t.along_m - f.along_m)
    else straight
  end;

  fare := public.transit_fare(f.kind, metres);
  begin
    balance := public.apply_coin_change(uid, -fare, 'spend',
      initcap(f.kind) || ' fare: ' || f.name || ' to ' || t.name, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'fare', fare);
  end;

  if p_fast_pass then
    select id into pass from public.player_relics
     where user_id = uid and relic = 'fast_pass' and charges > 0 and expires_at > now()
     order by expires_at limit 1 for update;
    if pass is null then
      raise exception 'No Fast Pass to use'; -- undoes the fare too
    end if;
    update public.player_relics set charges = charges - 1 where id = pass;
  end if;

  perform public.pocket_vehicle(uid);
  -- At night city buses come less often; in town, traffic slows buses at rush hour.
  wait := public.transit_wait_s(f.kind, p_fast_pass) * case when f.kind = 'bus' and public.is_night(f.lng, f.lat) then public.night_bus_wait() else 1 end;
  insert into public.transit_trips (user_id, mode, line_id, from_name, to_name, to_lng, to_lat, path, path_m, fare, fast_pass, departs_at, arrives_at, rush, ride_s)
  values (uid, f.kind, f.line_id, f.name, t.name, t.lng, t.lat, p_path, metres, fare, p_fast_pass,
          now() + make_interval(secs => wait),
          now() + make_interval(secs => wait + metres / public.transit_speed_for(f.kind, metres)
                                     * case when f.kind = 'bus' and metres <= public.bus_range_m() then public.traffic_factor(f.lng, f.lat) else 1 end),
          -- A city bus at night or at rush hour is a scramble (bus_rush_start); a Fast Pass skips it.
          case when f.kind = 'bus' and metres <= public.bus_range_m() and not p_fast_pass and public.bus_rush_due(f.lng, f.lat) then 'pending' end,
          metres / public.transit_speed_for(f.kind, metres)
            * case when f.kind = 'bus' and metres <= public.bus_range_m() then public.traffic_factor(f.lng, f.lat) else 1 end)
  returning * into trip;

  return jsonb_build_object('ok', true, 'balance', balance, 'trip', public.trip_json(trip));
end;
$$;

create or replace function public.finish_trip()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.transit_trips%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into p from public.transit_trips where user_id = uid and ended_at is null for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_trip');
  end if;
  if p.rush = 'pending' or now() < p.arrives_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'trip', public.trip_json(p));
  end if;
  update public.transit_trips set ended_at = now(), outcome = 'arrived' where id = p.id;
  insert into public.player_positions (user_id, lng, lat, mode, updated_at)
  values (uid, p.to_lng, p.to_lat, 'walk', now())
  on conflict (user_id) do update set lng = excluded.lng, lat = excluded.lat, mode = 'walk', updated_at = now();
  return jsonb_build_object('ok', true, 'lng', p.to_lng, 'lat', p.to_lat, 'name', p.to_name, 'mode', p.mode);
end;
$$;

create or replace function public.cancel_trip()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.transit_trips%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into p from public.transit_trips where user_id = uid and ended_at is null for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_trip');
  end if;
  if now() >= p.departs_at and p.rush is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'left');
  end if;
  update public.transit_trips set ended_at = now(), outcome = 'cancelled' where id = p.id;
  balance := public.apply_coin_change(uid, p.fare, 'refund', 'Refund: ' || p.mode || ' to ' || p.to_name, 'trip-refund:' || p.id);
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

create or replace function public.trip_json(p public.transit_trips)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'mode', p.mode, 'line', p.line_id, 'from', p.from_name, 'to', p.to_name,
    'toLng', p.to_lng, 'toLat', p.to_lat, 'path', p.path, 'metres', round(p.path_m), 'fare', p.fare,
    'departsAt', p.departs_at, 'arrivesAt', p.arrives_at, 'now', now(),
    'rush', p.rush, 'rushTries', p.rush_tries);
$$;
