-- Shorter flights (owner, 3 Nov 2026: "if we are travelling the world, can you shorten the international flight time,
-- 83 mins, to wait could be a long time for users"). A flight used to take its distance at 750 km/h (× 12, the game's
-- clock) after 7½ minutes of check-in and boarding: Lagos to Tokyo was about an hour and a half. Now the flight is
-- 2 minutes plus 40 seconds per 1,000 km, at most 12 minutes, after 3 minutes of check-in and boarding (1 with a Fast
-- Pass): Lagos to London about 8 minutes in all, Lagos to Tokyo about 14. Mirrored in src/game/transit.ts.

create or replace function public.flight_s(p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select least(720, 120 + greatest(0, p_metres) / 1000000 * 40)
$$;

create or replace function public.transit_speed_for(p_mode text, p_metres double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case
    when p_mode = 'bus' and p_metres > public.bus_range_m() then 60 / 3.6 * 12
    when p_mode = 'plane' then greatest(p_metres, 1) / public.flight_s(p_metres)
    else public.transit_speed(p_mode) end;
$$;

create or replace function public.transit_wait_s(p_mode text, p_fast_pass boolean)
returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bus' then case when p_fast_pass then 0 else 35 end
    when 'train' then case when p_fast_pass then 0 else 50 end
    when 'plane' then case when p_fast_pass then 60 else 180 end
  end;
$$;

-- The times the travel panel and the flight search show, from the same rule.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.search_airports(text, bigint)'::regprocedure);
  if position('metres / public.transit_speed(''plane'')' in def) = 0 then
    raise exception 'search_airports: expected text not found';
  end if;
  execute replace(def, 'metres / public.transit_speed(''plane'')', 'metres / public.transit_speed_for(''plane'', metres)');

  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname = 'transit_destinations' and p.pronamespace = 'public'::regnamespace;
  if position('m.metres / public.transit_speed(f.kind)' in def) = 0 then
    raise exception 'transit_destinations: expected text not found';
  end if;
  execute replace(def, 'm.metres / public.transit_speed(f.kind)', 'm.metres / public.transit_speed_for(f.kind, m.metres)');
end;
$$;
