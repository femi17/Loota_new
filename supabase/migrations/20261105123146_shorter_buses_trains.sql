-- Shorter bus and train journeys (owner, 5 Nov 2026: "Like you did the plane, reduce the bus and train time too").
-- As flights (shorter_flights): a short fixed time plus a little per distance, with a cap. Before, a city bus ran at
-- 25 km/h, a long-distance bus 60 km/h and a train 70 km/h on the game's clock (× 12): Lagos to Abuja by bus about an
-- hour, 500 km by train about 36 minutes. Now:
--   a city bus (up to 40 km): 45 s plus 4 s a km, at most 3½ minutes;
--   a long-distance bus: 2 minutes plus a minute per 100 km, at most 10 minutes;
--   a train: 1½ minutes plus 45 s per 100 km, at most 8 minutes;
-- and the wait at the stop: a bus 20 s (was 35), a train 30 s (was 50). Taxis and planes as they were.
-- Mirrored in src/game/transit.ts.

create or replace function public.bus_s(p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when p_metres > public.bus_range_m()
    then least(600, 120 + greatest(0, p_metres) / 100000 * 60)
    else least(210, 45 + greatest(0, p_metres) / 1000 * 4) end
$$;

create or replace function public.train_s(p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select least(480, 90 + greatest(0, p_metres) / 100000 * 45)
$$;

create or replace function public.transit_speed_for(p_mode text, p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case
    when p_mode = 'bus' then greatest(p_metres, 1) / public.bus_s(p_metres)
    when p_mode = 'train' then greatest(p_metres, 1) / public.train_s(p_metres)
    when p_mode = 'plane' then greatest(p_metres, 1) / public.flight_s(p_metres)
    else public.transit_speed(p_mode) end;
$$;

create or replace function public.transit_wait_s(p_mode text, p_fast_pass boolean)
returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then case when p_fast_pass then 0 else 20 end
    when 'train' then case when p_fast_pass then 0 else 30 end
    when 'plane' then case when p_fast_pass then 60 else 180 end
  end;
$$;
