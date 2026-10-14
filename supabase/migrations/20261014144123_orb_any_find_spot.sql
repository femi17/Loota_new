-- No more coin drops lying around (owner's call, 14 Oct 2026): the world holds
-- intel scrolls and hidden finds only. The Lockdown Orb used a coin drop's
-- spot (a point on a road); any find's spot, past or present, will do.
create or replace function public.place_orb()
returns void language plpgsql security definer set search_path = '' as $$
declare
  near_lng double precision;
  near_lat double precision;
  spot record;
begin
  if exists (select 1 from public.world_items where relic = 'lockdown_orb' and taken_by is null and expires_at > now())
     or exists (select 1 from public.player_relics where relic = 'lockdown_orb' and charges > 0 and expires_at > now()) then
    return;
  end if;
  select k.spot_lng, k.spot_lat into near_lng, near_lat
    from public.hunt_keys k join public.hunts h on h.id = k.hunt_id
   where public.hunt_phase(h) in ('live', 'upcoming')
   order by random() limit 1;
  near_lng := coalesce(near_lng, 3.38);
  near_lat := coalesce(near_lat, 6.52);
  select i.cell, i.lng, i.lat into spot
    from public.world_items i
   where i.relic is distinct from 'lockdown_orb'
     and i.lng between near_lng - 0.04 and near_lng + 0.04 and i.lat between near_lat - 0.04 and near_lat + 0.04
     and public.distance_m(near_lng, near_lat, i.lng, i.lat) between 1000 and 4000
   order by random() limit 1;
  if spot.cell is null then
    select i.cell, i.lng, i.lat into spot
      from public.world_items i
     where i.relic is distinct from 'lockdown_orb'
       and i.lng between near_lng - 0.1 and near_lng + 0.1 and i.lat between near_lat - 0.1 and near_lat + 0.1
     order by random() limit 1;
  end if;
  if spot.cell is null then
    return; -- nowhere stocked yet; tried again later
  end if;
  insert into public.world_items (cell, kind, relic, hidden, lng, lat, expires_at)
  values (spot.cell, 'relic', 'lockdown_orb', false, spot.lng, spot.lat, now() + interval '3 days');
end;
$$;
