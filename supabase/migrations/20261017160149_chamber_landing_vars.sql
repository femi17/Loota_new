-- The whirlwind's landing spot as plain variables: a record that was never filled (any outcome but the
-- whirlwind) made the answer fail with "record is not assigned yet" on some connections.

create or replace function public.djinn_answer_chamber(p_chamber uuid, p_cipher text, p_path integer[], p_weights integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ch public.djinn_chambers%rowtype;
  w public.djinn_wagers%rowtype;
  marks jsonb;
  all_ok boolean;
  result text;
  land_name text; -- where the whirlwind sets them down
  land_lng double precision;
  land_lat double precision;
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
  elsif public.coin_saves(uid) then
    -- A Djinn's Coin: the wind can't take them (the Coin is spent).
    result := 'coin';
    insert into public.wonder_events (wonder, user_id, username, message)
    select 'djinn_coin', uid, pr.username, pr.username || '''s Djinn''s Coin glowed: the Djinn''s whirlwind couldn''t carry them off!'
      from public.profiles pr where pr.id = uid;
  else
    -- The whirlwind: set down at an airport 10–300 km away (a random one of the nearest few), as if flown there.
    result := 'whirlwind';
    select * into site from public.djinn_sites where id = ch.site_id;
    select s.name, s.lng, s.lat into land_name, land_lng, land_lat
      from public.transit_stops s
     where s.kind = 'plane' and s.lat between site.lat - 3 and site.lat + 3 and s.lng between site.lng - 3 and site.lng + 3
       and public.distance_m(site.lng, site.lat, s.lng, s.lat) between 10000 and 300000
     order by random() limit 1;
    if land_name is null then
      select s.name, s.lng, s.lat into land_name, land_lng, land_lat from public.transit_stops s
       where s.kind = 'plane' and public.distance_m(site.lng, site.lat, s.lng, s.lat) >= 10000
       order by public.distance_m(site.lng, site.lat, s.lng, s.lat) limit 1;
    end if;
    update public.player_positions set lng = land_lng, lat = land_lat, mode = 'walk', updated_at = now(), resting_since = null
     where user_id = uid;
    -- As if they'd flown there: save_position allows the hop from the airfield to its nearest road.
    insert into public.transit_trips (user_id, mode, from_name, to_name, to_lng, to_lat, path, path_m, fare, departs_at, arrives_at, ended_at, outcome)
    values (uid, 'plane', 'The whirlwind', land_name, land_lng, land_lat,
            jsonb_build_array(jsonb_build_array(site.lng, site.lat), jsonb_build_array(land_lng, land_lat)),
            public.distance_m(site.lng, site.lat, land_lng, land_lat), 0, now(), now(), now(), 'arrived');
    update public.djinn_entries set rings_done = '{}' where wager_id = w.id and user_id = uid; -- the traps wait again
  end if;
  -- (A Coin save is kept as a failed attempt: the chamber failed, the Coin spared them.)
  update public.djinn_chambers set outcome = case when result = 'coin' then 'whirlwind' else result end, answered_at = now() where id = ch.id;
  return jsonb_build_object('ok', true, 'outcome', result, 'rooms', marks, 'wonder', w.wonder, 'extraWonder', w.extra_wonder,
    'dropAt', case when result = 'whirlwind' then jsonb_build_object('name', land_name, 'lng', land_lng, 'lat', land_lat) end);
end;
$$;
