-- Detours inside the streets (owner, 25 Oct 2026: "Items to find, relics, quiz location should not be on the main
-- road, it should be inside the streets"). Each place gets a spot on an ordinary street within 200 m of it, clear of
-- main roads (found from our road data by the server, as players come near: places.street_*); a Detour at that place
-- is held there ("near <the place>"). Places without one yet are picked only when there's nothing else.

alter table public.places
  add column if not exists street_lng double precision,
  add column if not exists street_lat double precision,
  add column if not exists street_checked_at timestamptz;
create index if not exists places_street_unchecked on public.places (lat, lng) where street_checked_at is null;

create or replace function public.spawn_detour(p_area text, p_lng double precision, p_lat double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  spot public.places%rowtype;
  roll double precision := random();
  pick integer;
  d_kind text;
  d_title text;
  d_story text;
  d_coins integer := 0;
  d_relic text;
  d_capacity integer;
  d_minutes integer;
  flash_titles text[] := array['A merchant''s lost pouch', 'The fallen trinket', 'The tailor''s secret', 'A forgotten parcel'];
  flash_stories text[] := array[
    'A merchant''s mule kicked a pouch loose near %s. Street boys are already sniffing around: it won''t last.',
    'An old woman near %s swears something glowing fell off a danfo''s roof. Get there before the sweepers do.',
    'A tailor near %s sewed something strange into a coat hem and left it on the line. Quick, before the owner comes back.',
    'A dispatch rider dropped a parcel in a street near %s and rode off. Someone will pick it up soon.'];
  rush_titles text[] := array['Gold at the roadside', 'The drummer''s call', 'The generous madam'];
  rush_stories text[] := array[
    'A courier''s bag split open near %s. The first %s hunters to get there share what fell out.',
    'A drummer in a street near %s will reward the first %s hunters who find him. After that, he packs up and goes.',
    'A rich madam near %s is celebrating, and the first %s hunters to greet her get a gift.'];
  flash_rush_titles text[] := array['The smugglers'' stash', 'The vanishing stall'];
  flash_rush_stories text[] := array[
    'Smugglers hid a stash near %s. The first %s hunters to crack its lock take a share, and the police are on their way.',
    'A stall near %s appears for only half an hour and serves only the first %s customers. Its goods are rare.'];
begin
  -- A place with its street spot found, if any (in the streets, off the main roads).
  select * into spot from public.places
   where lat between p_lat - 0.04 and p_lat + 0.04 and lng between p_lng - 0.04 and p_lng + 0.04
     and public.distance_m(p_lng, p_lat, lng, lat) between 500 and 4000
   order by street_lng is null, random() limit 1;
  if spot.id is null then
    return; -- no named places around here (yet)
  end if;

  if roll < 0.5 then
    d_kind := 'flash';
    d_minutes := 20 + floor(random() * 21)::integer;
    pick := 1 + floor(random() * array_length(flash_titles, 1))::integer;
    d_title := flash_titles[pick];
    d_story := format(flash_stories[pick], spot.name);
    if random() < 0.7 then d_coins := 30 + floor(random() * 51)::integer;
    else d_relic := (array['shield', 'second_wind', 'jerry_can'])[1 + floor(random() * 3)::integer]; end if;
  elsif roll < 0.8 then
    d_kind := 'rush';
    d_minutes := 60;
    d_capacity := 5 + floor(random() * 16)::integer;
    pick := 1 + floor(random() * array_length(rush_titles, 1))::integer;
    d_title := rush_titles[pick];
    d_story := format(rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_coins := 40 + floor(random() * 61)::integer;
    else d_relic := (array['shield', 'second_wind', 'jerry_can'])[1 + floor(random() * 3)::integer]; end if;
  else
    d_kind := 'flash_rush';
    d_minutes := 30;
    d_capacity := 3 + floor(random() * 6)::integer;
    pick := 1 + floor(random() * array_length(flash_rush_titles, 1))::integer;
    d_title := flash_rush_titles[pick];
    d_story := format(flash_rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_relic := (array['radar', 'fast_pass'])[1 + floor(random() * 2)::integer];
    else d_coins := 120 + floor(random() * 81)::integer; end if;
  end if;

  insert into public.detours (kind, area, title, story, place_name, lng, lat, reward_coins, reward_relic, capacity, ends_at)
  values (d_kind, p_area, d_title, d_story, spot.name, coalesce(spot.street_lng, spot.lng), coalesce(spot.street_lat, spot.lat),
          d_coins, d_relic, d_capacity, now() + make_interval(mins => d_minutes));
end;
$$;
revoke execute on function public.spawn_detour(text, double precision, double precision) from public, anon, authenticated;
