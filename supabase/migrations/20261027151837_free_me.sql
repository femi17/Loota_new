-- "Get me out" (owner, 27 Oct 2026: stuck at an airport, "we need an everlasting solution to this"). Whatever the map's
-- roads get wrong (a fence, an airfield, a road that doesn't join up), a hunter can always ask to be put on the nearest
-- road that leads somewhere: up to 2 km away, once every 10 minutes, never mid-trip, frozen, or into a Lockdown dome.
alter table public.player_positions add column if not exists freed_at timestamptz;

create or replace function public.free_me(p_lng double precision, p_lat double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  moved double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid for update;
  if pos.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_position');
  end if;
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'trip');
  end if;
  if exists (select 1 from public.wonder_events e
              where e.wonder = 'hourglass_of_ages' and e.ends_at > now() and uid = any (e.affected)) then
    return jsonb_build_object('ok', false, 'reason', 'frozen');
  end if;
  moved := public.distance_m(pos.lng, pos.lat, p_lng, p_lat);
  if moved > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if pos.freed_at > now() - interval '10 minutes' and moved > 30 then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'next', pos.freed_at + interval '10 minutes');
  end if;
  if public.dome_blocking(uid, p_lng, p_lat) is not null and public.dome_blocking(uid, pos.lng, pos.lat) is null then
    return jsonb_build_object('ok', false, 'reason', 'dome');
  end if;
  update public.player_positions
     set lng = p_lng, lat = p_lat, updated_at = now(), road_fixed_at = now(),
         freed_at = case when moved > 30 then now() else freed_at end
   where user_id = uid;
  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'moved', round(moved));
end;
$$;
revoke execute on function public.free_me(double precision, double precision) from public, anon;
grant execute on function public.free_me(double precision, double precision) to authenticated;
