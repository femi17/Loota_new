-- A motor park is a compound, its point often set back from the road (owner, 9 Nov 2026, at Mallam Karto Park, Kano:
-- "it directed me to a motor park, but getting there, nothing happens. I should buy ticket since this is a inter state
-- motor park"; the park's point is 48 m from the nearest road, and a bus could only be boarded within 40 m). A park
-- counts you there within 150 m (as a train station does); its ticket office stands at the road nearest it.
-- (A CASE inside a PL/pgSQL IF needs brackets: IF reads its condition up to the first THEN.)
set lock_timeout = '8s';

create or replace function public.park_reach_m()
returns double precision language sql immutable set search_path = '' as $$ select 150::double precision $$;

do $$
declare
  d text;
  fixes text[][] := array[
    array['public.start_trip(bigint,bigint,jsonb,boolean)',
          E'  elsif public.distance_m(pos.lng, pos.lat, f.lng, f.lat) > public.transit_reach_m(f.kind) then',
          E'  elsif public.distance_m(pos.lng, pos.lat, f.lng, f.lat) > (case when f.park then public.park_reach_m() else public.transit_reach_m(f.kind) end) then'],
    array['public.transit_near(double precision,double precision)',
          E'      if (s ->> ''metres'')::double precision <= public.transit_reach_m(kind)',
          E'      if (s ->> ''metres'')::double precision <= (case when coalesce((s ->> ''park'')::boolean, false) then public.park_reach_m() else public.transit_reach_m(kind) end)']
  ];
  i int;
begin
  for i in 1 .. array_length(fixes, 1) loop
    d := pg_get_functiondef(fixes[i][1]::regprocedure);
    if position(fixes[i][2] in d) = 0 then
      raise exception 'not found in %: %', fixes[i][1], fixes[i][2];
    end if;
    execute replace(d, fixes[i][2], fixes[i][3]);
  end loop;
end;
$$;
