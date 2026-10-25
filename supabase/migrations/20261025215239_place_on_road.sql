-- Back onto the road (owner, 25 Oct 2026: "I cannot get on any of my vehicle"). A hunter thrown 2 km out of a trial
-- landed off any road; the map put them on the nearest road 380 m away, which the server took for walking too fast,
-- and every save (and getting on a vehicle) was refused from then on. The map now says so: a hunter it has to move
-- onto a road is placed there directly, up to 800 m from their last spot, at most once every two minutes.

alter table public.player_positions add column if not exists road_fixed_at timestamptz;

create or replace function public.place_on_road(p_lng double precision, p_lat double precision)
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
  moved := public.distance_m(pos.lng, pos.lat, p_lng, p_lat);
  if moved > 800 then
    return jsonb_build_object('ok', false, 'reason', 'far', 'lng', pos.lng, 'lat', pos.lat);
  end if;
  if pos.road_fixed_at > now() - interval '2 minutes' and moved > 30 then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'lng', pos.lng, 'lat', pos.lat);
  end if;
  update public.player_positions
     set lng = p_lng, lat = p_lat, updated_at = now(), road_fixed_at = case when moved > 30 then now() else road_fixed_at end
   where user_id = uid;
  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'moved', round(moved));
end;
$$;
revoke execute on function public.place_on_road(double precision, double precision) from public, anon;
grant execute on function public.place_on_road(double precision, double precision) to authenticated;
