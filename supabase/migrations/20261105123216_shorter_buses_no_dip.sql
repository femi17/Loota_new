-- shorter_buses_trains made a long-distance bus just past 40 km quicker (2½ min) than a city bus just short of it
-- (3½): a long-distance bus now takes at least as long as the longest city ride. Mirrored in src/game/transit.ts.
create or replace function public.bus_s(p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when p_metres > public.bus_range_m()
    then least(600, greatest(210, 120 + greatest(0, p_metres) / 100000 * 60))
    else least(210, 45 + greatest(0, p_metres) / 1000 * 4) end
$$;
