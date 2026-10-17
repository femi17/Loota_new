-- The whirlwind always carries the player at least 10 km (up to 300 km), even where the only
-- airport near a place is close by; the chamber's cipher uses two different phrases.

create or replace function public.djinn_make_chamber() returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  phrases text[] := array['THE JAGUAR SLEEPS', 'SAND REMEMBERS', 'GOLD BENEATH STONE', 'THE LAMP IS AWAKE',
                          'SEEK THE SULTAN', 'FIRE AND SALT', 'NINE DOORS WAIT', 'THE RIVER KNOWS',
                          'NO KING SLEEPS HERE', 'THE STARS ARE LYING', 'COUNT THE BONES', 'SILVER UNDER WATER'];
  first_pick integer := 1 + floor(random() * 12)::integer;
  phrase text := phrases[first_pick] || ' ' || phrases[1 + (first_pick + floor(random() * 11)::integer) % 12]; -- two different phrases
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
    -- The whirlwind: dropped at an airport 10–300 km away (a random one of the nearest few), as if flown there.
    result := 'whirlwind';
    select * into site from public.djinn_sites where id = ch.site_id;
    select s.name, s.lng, s.lat into drop_at
      from public.transit_stops s
     where s.kind = 'plane' and s.lat between site.lat - 3 and site.lat + 3 and s.lng between site.lng - 3 and site.lng + 3
       and public.distance_m(site.lng, site.lat, s.lng, s.lat) between 10000 and 300000
     order by random() limit 1;
    if drop_at.name is null then
      select s.name, s.lng, s.lat into drop_at from public.transit_stops s
       where s.kind = 'plane' and public.distance_m(site.lng, site.lat, s.lng, s.lat) >= 10000
       order by public.distance_m(site.lng, site.lat, s.lng, s.lat) limit 1;
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
