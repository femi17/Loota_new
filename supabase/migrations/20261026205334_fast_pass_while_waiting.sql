-- A Fast Pass while waiting (owner, 26 Oct 2026: "I am at the bus stop and I cannot use the fast pass"). It could
-- only be ticked when booking; now it works from the Bag (or the trip banner) while you wait: a bus, train or taxi
-- comes at once (and a crowded bus's scramble is skipped), a flight skips the check-in queue (5 minutes off).

create or replace function public.trip_json(p public.transit_trips) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'mode', p.mode, 'line', p.line_id, 'from', p.from_name, 'to', p.to_name,
    'toLng', p.to_lng, 'toLat', p.to_lat, 'path', p.path, 'metres', round(p.path_m), 'fare', p.fare,
    'departsAt', p.departs_at, 'arrivesAt', p.arrives_at, 'now', now(),
    'rush', p.rush, 'rushTries', p.rush_tries, 'fastPass', p.fast_pass);
$$;

-- Uses a Fast Pass on the trip being waited for (not ok when there is no wait to skip).
create or replace function public.fast_pass_trip(p_uid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.transit_trips%rowtype;
  leaves timestamptz;
begin
  select * into p from public.transit_trips where user_id = p_uid and ended_at is null for update;
  if p.id is null or (now() >= p.departs_at and p.rush is distinct from 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;
  if p.fast_pass then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  leaves := case when p.mode = 'plane'
                 then greatest(now(), p.departs_at - make_interval(secs => public.transit_wait_s('plane', false) - public.transit_wait_s('plane', true)))
                 else now() end;
  update public.transit_trips
     set fast_pass = true,
         rush = case when rush = 'pending' then 'boarded' else rush end,
         arrives_at = leaves + case when rush = 'pending' then make_interval(secs => coalesce(ride_s, 60)) else arrives_at - departs_at end,
         departs_at = leaves
   where id = p.id
  returning * into p;
  return jsonb_build_object('ok', true, 'trip', public.trip_json(p));
end;
$$;
revoke all on function public.fast_pass_trip(uuid) from public, anon, authenticated;

create or replace function public.use_relic(p_relic uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  r public.player_relics%rowtype;
  pos public.player_positions%rowtype;
  fuel_now double precision;
  valid_until timestamptz;
  raised jsonb;
  v public.player_vehicles%rowtype;
  remounted boolean := false;
  skipped jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.player_relics where id = p_relic and user_id = uid for update;
  if not found or r.charges < 1 or r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  if r.relic = 'shield' then
    return jsonb_build_object('ok', false, 'reason', 'passive');
  elsif r.relic = 'fast_pass' then
    -- On the bus, train, taxi or flight being waited for (owner, 26 Oct 2026).
    skipped := public.fast_pass_trip(uid);
    if not (skipped ->> 'ok')::boolean then
      return skipped;
    end if;
    update public.player_relics set charges = charges - 1 where id = r.id;
    return skipped || jsonb_build_object('relic', 'fast_pass');
  elsif r.relic = 'lockdown_orb' then
    raised := public.raise_dome(uid);
    if not (raised ->> 'ok')::boolean then
      return raised;
    end if;
    update public.player_relics set charges = charges - 1 where id = r.id;
    perform public.place_orb(); -- used: it hides again somewhere new
    return raised || jsonb_build_object('relic', 'lockdown_orb');
  elsif r.relic = 'jerry_can' then
    -- A full jerry can (owner, 19 Oct 2026: "I had a jerry can and was still made to buy one"): into the motorbike or
    -- car being ridden, or one standing at the roadside out of fuel within 30 m (then back on it, unless it has a
    -- flat); a tank to 65% at most.
    select * into pos from public.player_positions where user_id = uid;
    select * into v from public.player_vehicles where user_id = uid and kind in ('motorbike', 'car') and in_use for update;
    if v.id is null and pos.user_id is not null then
      select * into v from public.player_vehicles
       where user_id = uid and stranded_at is not null and public.distance_m(lng, lat, pos.lng, pos.lat) <= 30
       limit 1 for update;
    end if;
    if v.id is null then
      select * into v from public.player_vehicles where user_id = uid and stranded_at is not null limit 1;
      if v.id is not null then
        return jsonb_build_object('ok', false, 'reason', 'far', 'kind', v.kind, 'lng', v.lng, 'lat', v.lat);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
    if v.fuel >= public.keg_capacity() then
      return jsonb_build_object('ok', false, 'reason', 'full');
    end if;
    update public.player_vehicles set fuel = public.keg_capacity() where id = v.id returning fuel into fuel_now;
    if v.stranded_at is not null and v.tyre > 0 then
      perform public.settle_rental(uid);
      update public.player_vehicles set in_use = false where user_id = uid and in_use;
      update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
      update public.player_positions set mode = v.kind where user_id = uid;
      remounted := true;
    end if;
  elsif r.relic = 'radar' then
    valid_until := greatest(now(), coalesce((select radar_until from public.player_boosts where user_id = uid), now())) + interval '5 minutes';
    insert into public.player_boosts (user_id, radar_until) values (uid, valid_until)
    on conflict (user_id) do update set radar_until = excluded.radar_until;
  elsif r.relic = 'rain_charm' then
    select * into pos from public.player_positions where user_id = uid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'position');
    end if;
    valid_until := now() + interval '10 minutes';
    insert into public.world_effects (kind, lng, lat, radius_m, ends_at, created_by)
    values ('rain', pos.lng, pos.lat, 5000, valid_until, uid);
  end if;

  update public.player_relics set charges = charges - 1 where id = r.id;
  return jsonb_build_object('ok', true, 'relic', r.relic, 'energy', case when r.relic = 'second_wind' then 50 end,
    'fuel', fuel_now, 'until', valid_until, 'kind', v.kind, 'remounted', remounted);
end;
$function$;
