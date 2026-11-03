-- shorter_flights counted 40 s per km, not per 1,000 km (every flight came to the 12-minute cap).
create or replace function public.flight_s(p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select least(720, 120 + greatest(0, p_metres) / 1000000 * 40)
$$;
