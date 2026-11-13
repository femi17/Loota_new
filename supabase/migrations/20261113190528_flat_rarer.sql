set lock_timeout = '8s';
-- Flats on motorbikes and cars (owner, 13 Nov 2026: "I just bought a new bike, and it already had a flat. Flat comes
-- often for motorbike and car. Fix it. Also, when vehicle have flat, it doesnt show on the broadcast").
-- Before: any motor tyre punctured at 1% a km, and on the game's clock a motorbike rides ~7 km a minute: a new one went
-- flat in 2 minutes. Now motor tyres wear (0.4 a km, as engines do) and only worn ones (below 40, after ~150 km) can
-- puncture, at 0.3% a km. A service at a mechanic gives new tyres; a fixed flat is a new tyre too.
-- And the broadcast: a flat (or an empty tank) is news, and the vehicle left at the roadside is in each hunter's state.

create or replace function public.puncture_per_km()
returns double precision language sql immutable set search_path to '' as $$ select 0.003::double precision $$;

-- What happened on the road, as news for the hunts the player is in now
create or replace function public.road_news(p_user uuid, p_kind text, p_text text)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into public.hunt_events (hunt_id, user_id, kind, text)
  select p.hunt_id, p_user, p_kind, p_text
    from public.hunt_players p join public.hunts h on h.id = p.hunt_id
   where p.user_id = p_user and now() between h.starts_at and h.ends_at
$$;
revoke execute on function public.road_news(uuid, text, text) from public, anon, authenticated;
grant execute on function public.road_news(uuid, text, text) to service_role;

do $$
declare
  f text := pg_get_functiondef('public.save_position(double precision, double precision, text)'::regprocedure);
  a1 text := '                     when tyre > 0 and random() < moved_m / 1000 * public.puncture_per_km() then 0
                     else tyre end,';
  a2 text := '    stopped := case when v.broken_at is not null then ''broken'' when v.tyre <= 0 then ''flat'' else ''fuel'' end;
  end if;';
  a3 text := '  moved_m double precision;';
  a4 text := '  update public.player_vehicles
     set lng = p_lng, lat = p_lat,';
begin
  if position(a1 in f) = 0 or position(a2 in f) = 0 or position(a3 in f) = 0 or position(a4 in f) = 0 then
    raise exception 'save_position: not found';
  end if;
  f := replace(f, a1, '                     -- motorbikes and cars: tyres wear; only worn ones can puncture
                     when tyre <= 0 then tyre
                     when tyre < 40 and random() < moved_m / 1000 * public.puncture_per_km() then 0
                     else greatest(1, tyre - moved_m / 1000 * 0.4) end,');
  f := replace(f, a2, a2 || '
  -- News for the broadcast: a flat, or out of fuel at the roadside
  if stopped in (''flat'', ''fuel'') then
    perform public.road_news(uid, ''road_'' || stopped, case stopped
      when ''flat'' then ''🛞 '' || coalesce((select username from public.profiles where id = uid), ''A hunter'') || ''''''s '' || v.kind || '' got a flat tyre: off to find a vulcanizer''
      else ''⛽ '' || coalesce((select username from public.profiles where id = uid), ''A hunter'') || ''''''s '' || v.kind || '' ran out of fuel at the roadside'' end);
  end if;
  if v.id is not null and v.kind = ''bicycle'' and tyre_was > 0 and v.tyre <= 0 then
    perform public.road_news(uid, ''road_flat'', ''🛞 '' || coalesce((select username from public.profiles where id = uid), ''A hunter'') || ''''''s bicycle got a flat: pushing it at walking pace'');
  end if;');
  f := replace(f, a3, a3 || '
  tyre_was double precision;');
  f := replace(f, a4, '  select tyre into tyre_was from public.player_vehicles where user_id = uid and in_use limit 1;
' || a4);
  execute f;
end $$;

do $$
declare
  f text := pg_get_functiondef('public.service_vehicle()'::regprocedure);
  a text := 'update public.player_vehicles set engine = 100, broken_at = null, repair_ready_at = null where id = v.id;';
begin
  if position(a in f) = 0 then
    raise exception 'service_vehicle: not found';
  end if;
  execute replace(f, a, 'update public.player_vehicles set engine = 100, broken_at = null, repair_ready_at = null,
         tyre = case when kind <> ''bicycle'' and tyre > 0 then 100 else tyre end where id = v.id; -- new tyres too');
end $$;

do $$
declare
  f text := pg_get_functiondef('public.repair_collect(bigint)'::regprocedure);
  a text := 'tyre = case when kind = ''bicycle'' then 100 else tyre end,';
begin
  if position(a in f) = 0 then
    raise exception 'repair_collect: not found';
  end if;
  execute replace(f, a, 'tyre = case when kind = ''bicycle'' or tyre > 0 then 100 else tyre end,');
end $$;

-- The flat fixed: news too
do $$
declare
  fn text;
  f text;
  a text;
begin
  foreach fn in array array['public.finish_flat_fix()', 'public.put_wheel_on()'] loop
    f := pg_get_functiondef(fn::regprocedure);
    a := case when fn like '%finish%' then 'update public.player_vehicles set tyre = 100, flat_fix_how = null, flat_fix_ready_at = null, flat_wheel = null, flat_helper = null where id = v.id;'
              else 'update public.player_vehicles set tyre = 100, flat_wheel = null, flat_helper = null where id = v.id;' end;
    if position(a in f) = 0 then
      raise exception '% : not found', fn;
    end if;
    execute replace(f, a, a || '
  perform public.road_news(uid, ''road_fixed'', ''🛞 '' || coalesce((select username from public.profiles where id = uid), ''A hunter'') || ''''''s '' || v.kind || '' has a new tyre: back on the road'');');
  end loop;
end $$;

-- broadcast_state: the vehicle each hunter left at the roadside (a flat or no fuel), and since when
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a text := '''helper'', (select v.flat_helper from public.player_vehicles v';
begin
  if position(a in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  execute replace(f, a, '''parked'', (select jsonb_build_object(''kind'', v.kind, ''lng'', v.lng, ''lat'', v.lat,
              ''why'', case when v.kind <> ''bicycle'' and v.tyre <= 0 then ''flat'' else ''fuel'' end, ''wheel'', v.flat_wheel, ''since'', v.stranded_at)
            from public.player_vehicles v
           where v.user_id = p.user_id and v.stranded_at is not null and v.impounded_at is null and v.lng is not null
           order by v.stranded_at desc limit 1),
          ' || a);
end $$;
