set lock_timeout = '8s';
-- Home is a public spot, never the player's address (owner, 16 Nov 2026: "Fix 2 first"). The home was saved to about a
-- metre from the phone's location at sign-up; the avatar starts there and the Orb of Return sends everyone back there, so
-- while a hunter stood at home every nearby hunter, the Tracker (exact distance and bearing, the spot within 300 m) and
-- the broadcast showed where a real person lives. Now the place chosen is only a hint: home becomes a bus stop picked at
-- random 200 m – 1.5 km from it (any stop or station within 3 km when there's no bus stop; failing that, a random point
-- 300–700 m away). The exact place is never stored. Existing homes move the same way, with anything left at the old spot.

create or replace function public.public_spot_near(p_lng double precision, p_lat double precision)
returns table (lng double precision, lat double precision)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  bearing double precision := random() * 2 * pi();
  metres double precision := 300 + random() * 400;
begin
  return query
    select st.lng, st.lat from public.transit_stops st
     where st.kind = 'bus'
       and st.lat between p_lat - 0.015 and p_lat + 0.015
       and st.lng between p_lng - 0.015 and p_lng + 0.015
       and public.distance_m(p_lng, p_lat, st.lng, st.lat) between 200 and 1500
     order by random() limit 1;
  if found then
    return;
  end if;
  return query
    select st.lng, st.lat from public.transit_stops st
     where st.lat between p_lat - 0.03 and p_lat + 0.03
       and st.lng between p_lng - 0.03 and p_lng + 0.03
       and public.distance_m(p_lng, p_lat, st.lng, st.lat) between 200 and 3000
     order by random() limit 1;
  if found then
    return;
  end if;
  return query select
    p_lng + degrees(metres * sin(bearing) / (6371000 * cos(radians(p_lat)))),
    p_lat + degrees(metres * cos(bearing) / 6371000);
end;
$$;
revoke execute on function public.public_spot_near(double precision, double precision) from public, anon, authenticated;

create or replace function public.set_home(lng double precision, lat double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_set timestamptz;
  spot record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if lng not between -180 and 180 or lat not between -90 and 90 then
    raise exception 'Invalid location';
  end if;

  select home_set_at into last_set from public.profiles where id = auth.uid() for update;
  if last_set is not null and last_set > now() - interval '30 days' then
    raise exception 'Home can only be moved once every 30 days';
  end if;

  -- Only a public spot near the place chosen is kept (never the place itself)
  select * into spot from public.public_spot_near(lng, lat);
  update public.profiles
     set home_lng = spot.lng, home_lat = spot.lat, home_set_at = now()
   where id = auth.uid();

  -- The first home: welcome to Loota.
  if last_set is null then
    perform public.apply_coin_change(auth.uid(), public.welcome_coins(), 'earn', 'Welcome to Loota', 'welcome:' || auth.uid());
  end if;
end;
$$;

-- Existing homes: each moved to a public spot near it; the hunter and any vehicle still at the old spot (within 40 m) go too
do $$
declare
  p record;
  spot record;
begin
  for p in select id, home_lng, home_lat from public.profiles where home_lng is not null and home_lat is not null loop
    select * into spot from public.public_spot_near(p.home_lng, p.home_lat);
    update public.player_positions
       set lng = spot.lng, lat = spot.lat, updated_at = now()
     where user_id = p.id and public.distance_m(lng, lat, p.home_lng, p.home_lat) <= 40;
    update public.player_vehicles
       set lng = spot.lng, lat = spot.lat
     where user_id = p.id and lng is not null and public.distance_m(lng, lat, p.home_lng, p.home_lat) <= 40;
    update public.profiles set home_lng = spot.lng, home_lat = spot.lat where id = p.id;
  end loop;
end;
$$;
