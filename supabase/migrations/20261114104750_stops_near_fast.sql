set lock_timeout = '8s';
-- The nearest stops, fast (owner, 14 Nov 2026: Supabase warned the project was depleting its Disk IO budget; asked to fix
-- it). stops_near was 88% of all the database's reads: for a bus its "kind <> 'bus' or (in the box)" could not use the
-- (kind, lat, lng) index, so every one of the ~119,000 bus stops in the world was read to find the few hundred near the
-- player; for a train or a plane, every station on Earth was measured. ~300 ms a call, three calls each time a player's
-- surroundings were checked, and the queries timing out under load.
-- Now: a box round the player, growing (2 km, 5 km, 16 km, 55 km, …, the world) until it holds enough stops that are
-- surely the nearest (nearer than the box's edge); buses within 0.15° only, as before. Same answers, a few ms.

create or replace function public.stops_near(p_kind text, p_lng double precision, p_lat double precision, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  lim integer := greatest(1, least(p_limit, 20));
  d double precision;
  inner_m double precision;
  res jsonb := '[]'::jsonb;
  sure integer;
begin
  foreach d in array array[0.02, 0.05, 0.15, 0.5, 2, 8, 30, 180]::double precision[] loop
    exit when p_kind = 'bus' and d > 0.15; -- buses: only within 0.15° (as before)
    -- Anything nearer than this is surely inside the box (its nearest edge, north-south or east-west)
    inner_m := least(d * 110574, d * 111320 * cos(radians(least(89.9, abs(p_lat) + d))));
    select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb), count(*) filter (where s.metres <= inner_m)
      into res, sure
      from (
        select st.id, st.kind, st.name, st.lng, st.lat, st.line_id, st.code, st.park, st.city, st.country, st.desk_lng, st.desk_lat,
               l.name as line, round(public.distance_m(p_lng, p_lat, st.lng, st.lat))::int as metres
          from public.transit_stops st left join public.transit_lines l on l.id = st.line_id
         where st.kind = p_kind
           and st.lat between p_lat - d and p_lat + d
           and st.lng between p_lng - d and p_lng + d
         order by public.distance_m(p_lng, p_lat, st.lng, st.lat)
         limit lim
      ) s;
    if sure >= lim or d >= 180 then
      return res;
    end if;
  end loop;
  return res; -- (buses: whatever the 0.15° box holds)
end;
$$;
