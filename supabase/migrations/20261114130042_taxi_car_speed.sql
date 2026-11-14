set lock_timeout = '8s';
-- The taxi at a car's speed (owner, 14 Nov 2026: "why is the taxi slow. the taxi is within the city so it should have the
-- normal speed like the person is driving a car"). The ride took its way's length at 45 km/h times the area's traffic
-- (up to 1.8 times as long in a rush hour), where a player's own car only slows in a jam it meets; now the ride is the
-- way at 45 km/h, as driving. The driver comes for you at a car's speed too (45 km/h, was 30), still slowed by traffic.
create or replace function public.driver_speed()
returns double precision language sql immutable set search_path to '' as $$ select 45 / 3.6 * 12 $$;

do $$
declare
  f text := pg_get_functiondef('public.board_taxi()'::regprocedure);
  a text := 'now() + make_interval(secs => pick.trip_m / public.transit_speed(''taxi'') * public.traffic_factor(pick.lng, pick.lat))';
begin
  if position(a in f) = 0 then
    raise exception 'board_taxi: not found';
  end if;
  execute replace(f, a, 'now() + make_interval(secs => pick.trip_m / public.transit_speed(''taxi''))');
end $$;
