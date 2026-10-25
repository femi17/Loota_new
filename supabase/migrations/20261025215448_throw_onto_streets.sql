-- Thrown onto a street (owner, 25 Oct 2026: "I cannot get on any of my vehicle": thrown 2 km out of a Key Trial, the
-- owner landed off any road, in a spot the map couldn't bring them back from). A failed trial now throws the hunter to
-- a street spot (places.street_*, found from our road data) 1.5–2.5 km from the key; only where there's none, a
-- random point 2 km away as before (the map then puts them on the nearest road: place_on_road).

create or replace function public.fail_trial(t public.trial_attempts)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.hunt_keys%rowtype;
  bearing double precision := random() * 2 * pi();
  to_lng double precision;
  to_lat double precision;
  who text;
begin
  update public.trial_attempts set status = 'failed', ended_at = now() where id = t.id;
  if public.coin_saves(t.user_id) then
    select username into who from public.profiles where id = t.user_id;
    insert into public.wonder_events (wonder, user_id, username, hunt_id, message)
    values ('djinn_coin', t.user_id, who, t.hunt_id, who || '''s Djinn''s Coin glowed: they failed a Key Trial and stood their ground!');
    select lng, lat into to_lng, to_lat from public.player_positions where user_id = t.user_id;
    return jsonb_build_object('lng', to_lng, 'lat', to_lat, 'saved', true);
  end if;
  select * into k from public.hunt_keys where hunt_id = t.hunt_id and n = t.key_n;
  -- A street about 2 km away.
  select p.street_lng, p.street_lat into to_lng, to_lat from public.places p
   where p.street_lng is not null
     and p.lat between k.spot_lat - 0.03 and k.spot_lat + 0.03 and p.lng between k.spot_lng - 0.03 and k.spot_lng + 0.03
     and public.distance_m(k.spot_lng, k.spot_lat, p.street_lng, p.street_lat) between 1500 and 2500
   order by random() limit 1;
  if to_lng is null then
    to_lat := k.spot_lat + 2000 * cos(bearing) / 110574;
    to_lng := k.spot_lng + 2000 * sin(bearing) / (111320 * cos(radians(k.spot_lat)));
  end if;
  update public.player_positions set lng = to_lng, lat = to_lat, updated_at = now() where user_id = t.user_id;
  update public.player_vehicles set lng = to_lng, lat = to_lat where user_id = t.user_id and in_use;
  return jsonb_build_object('lng', to_lng, 'lat', to_lat);
end;
$$;
