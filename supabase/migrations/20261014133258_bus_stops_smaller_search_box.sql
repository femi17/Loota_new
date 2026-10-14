-- With roadside stops every ~700 m of main road (scripts/add-roadside-stops.mts)
-- there are tens of thousands of bus stops: search a box of about 16 km.
create or replace function public.stops_near(p_kind text, p_lng double precision, p_lat double precision, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s order by s.metres), '[]'::jsonb)
  from (
    select st.id, st.kind, st.name, st.lng, st.lat, st.line_id, st.code, st.park,
           l.name as line, round(public.distance_m(p_lng, p_lat, st.lng, st.lat))::int as metres
      from public.transit_stops st left join public.transit_lines l on l.id = st.line_id
     where st.kind = p_kind
       and (p_kind <> 'bus' or (st.lat between p_lat - 0.15 and p_lat + 0.15 and st.lng between p_lng - 0.15 and p_lng + 0.15))
     order by public.distance_m(p_lng, p_lat, st.lng, st.lat)
     limit greatest(1, least(p_limit, 20))
  ) s;
$$;
