set lock_timeout = '8s';
-- Caught after a police chase: arrested (owner, 13 Nov 2026: "They caught me as shown, but not persecution. I should be
-- taking away with my vehicle parked on the road, and the police car - Like the ambulance takes me to the police
-- station"). As the idling law's arrest: the patrol car drives them to the nearest police station, the cell there (5 min
-- a star, counted only while they play; bail to get out at once), the fine as before. The vehicle they rode stays parked
-- at the roadside where they were caught: back beside it, they get on again (or send a recovery truck for it).

alter table public.idle_arrests add column if not exists reason text not null default 'idle';
alter table public.idle_arrests drop constraint if exists idle_arrests_reason_check;
alter table public.idle_arrests add constraint idle_arrests_reason_check check (reason in ('idle', 'chase'));
alter table public.idle_arrests add column if not exists stars integer;
alter table public.idle_arrests add column if not exists parked_kind text;

create or replace function public.arrest_json(a public.idle_arrests)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object('id', a.id, 'at', a.at, 'lng', a.lng, 'lat', a.lat, 'station', a.station, 'stationLng', a.station_lng,
    'stationLat', a.station_lat, 'route', a.route, 'takenAt', a.taken_at, 'arrivesAt', a.arrives_at, 'remaining', a.remaining_s,
    'bail', a.bail, 'vehicle', a.vehicle_kind, 'rentalEnded', a.rental_ended, 'minutes', a.still_minutes, 'now', now(),
    'reason', a.reason, 'stars', a.stars, 'parked', a.parked_kind)
$$;

create or replace function public.police_chase_end(p_event bigint, p_caught boolean, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  c public.police_chases%rowtype;
  pos public.player_positions%rowtype;
  fine integer := 0;
  balance bigint;
  lvl integer;
  parked text;
  rented text;
  arrested boolean := false;
  how text := case when p_caught then 'caught' when p_outcome = 'called_off' then 'called_off' else 'escaped' end;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into c from public.police_chases where event_id = p_event and user_id = uid and ended_at is null for update;
  select * into e from public.road_events where id = p_event and user_id = uid and kind = 'checkpoint' and outcome = 'chased' for update;
  if c.event_id is null or e.id is null or c.started_at < now() - interval '6 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  lvl := c.level;
  if p_caught then
    select least((case lvl when 3 then 200 when 2 then 100 else 50 end * greatest(1, cardinality(e.missing)))::integer, coins)::integer
      into fine from public.profiles where id = uid;
    if fine > 0 then
      balance := public.apply_coin_change(uid, -fine, 'spend', 'Caught after a police chase (' || repeat('★', lvl) || ')', 'chase:' || e.id);
    end if;
    update public.road_events set outcome = 'fined' where id = e.id;
    -- Arrested: the vehicle ridden stays parked at the roadside here; a rental goes back; the police take them away
    select * into pos from public.player_positions where user_id = uid for update;
    if pos.user_id is not null and (public.jailed(uid)).id is null then
      update public.player_vehicles
         set in_use = false, stranded_at = now(), lng = pos.lng, lat = pos.lat
       where user_id = uid and in_use and impounded_at is null
      returning kind into parked;
      select kind into rented from public.vehicle_rentals where user_id = uid and ended_at is null;
      if rented is not null then
        perform public.settle_rental(uid);
      end if;
      insert into public.idle_arrests (user_id, lng, lat, still_minutes, until, bail, rental_ended, reason, stars, parked_kind, remaining_s)
      values (uid, pos.lng, pos.lat, 0, 'infinity', public.idle_bail(), rented is not null, 'chase', lvl, parked, 300 * lvl);
      update public.player_positions set mode = 'walk', resting_since = null where user_id = uid;
      arrested := true;
    end if;
  else
    update public.road_events set outcome = 'declined' where id = e.id;
  end if;
  update public.police_chases set ended_at = now(), outcome = how,
         notes = notes || jsonb_build_array(jsonb_build_array(floor(extract(epoch from now()) * 1000), 'end', how))
   where event_id = p_event;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'caught', p_caught, 'outcome', how, 'level', lvl, 'fine', fine, 'balance', balance,
    'arrested', arrested, 'parked', parked, 'cellS', case when arrested then 300 * lvl end,
    'holdS', case when p_caught and not arrested then 60 * lvl else 0 end);
end;
$$;
revoke execute on function public.police_chase_end(bigint, boolean, text) from public, anon;
grant execute on function public.police_chase_end(bigint, boolean, text) to authenticated, service_role;

-- A vehicle left at the roadside with fuel (the police took them away): beside it, they get on again
do $$
declare
  f text := pg_get_functiondef('public.start_vehicle(text, double precision, double precision, boolean)'::regprocedure);
  a text := '    if v.stranded_at is not null then
      update public.player_positions set mode = ''walk'' where user_id = uid;
      return jsonb_build_object(''ok'', false, ''reason'', ''stranded'', ''lng'', v.lng, ''lat'', v.lat);
    end if;';
begin
  if position(a in f) = 0 then
    raise exception 'start_vehicle: not found';
  end if;
  execute replace(f, a, '    -- Left parked at the roadside with fuel in it (the police took them away): beside it, back on
    if v.stranded_at is not null and (v.kind = ''bicycle'' or v.fuel > 0) and public.distance_m(p_lng, p_lat, v.lng, v.lat) <= 30 then
      update public.player_vehicles set stranded_at = null where id = v.id returning * into v;
    end if;
    if v.stranded_at is not null then
      update public.player_positions set mode = ''walk'' where user_id = uid;
      return jsonb_build_object(''ok'', false, ''reason'', ''stranded'', ''lng'', v.lng, ''lat'', v.lat, ''parked'', v.kind = ''bicycle'' or v.fuel > 0);
    end if;');
end $$;

-- The broadcast: why the arrest, the vehicle left behind, the news
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a1 text := '''serving'', j.beat_at > now() - interval ''90 seconds'', ''vehicle'', j.vehicle_kind))';
  a2 text := '''🚔 '' || pr.username || '' was arrested for idling on a main road'' || coalesce('' and taken to '' || j.station, '''') || coalesce('': their '' || j.vehicle_kind || '' impounded'', '''')';
  a3 text := '''why'', case when v.kind <> ''bicycle'' and v.tyre <= 0 then ''flat'' else ''fuel'' end';
begin
  if position(a1 in f) = 0 or position(a2 in f) = 0 or position(a3 in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  f := replace(f, a1, '''serving'', j.beat_at > now() - interval ''90 seconds'', ''vehicle'', j.vehicle_kind,
          ''reason'', j.reason, ''stars'', j.stars, ''parked'', j.parked_kind))');
  f := replace(f, a2, 'case when j.reason = ''chase''
                     then ''🚔 '' || pr.username || '' was caught after a police chase'' || coalesce('' and taken to '' || j.station, '''') || coalesce('': their '' || j.parked_kind || '' left at the roadside'', '''')
                     else ' || a2 || ' end');
  f := replace(f, a3, '''why'', case when v.kind <> ''bicycle'' and v.tyre <= 0 then ''flat'' when v.kind <> ''bicycle'' and v.fuel <= 0 then ''fuel'' else ''left'' end');
  execute f;
end $$;
