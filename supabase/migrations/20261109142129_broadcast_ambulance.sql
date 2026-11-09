-- The ambulance on the broadcast (owner, 9 Nov 2026: "on the broadcast fix the ambulance pickup, it is not showing, user
-- had to walk to hospital"). broadcast_state now lists each hunter's hospital visit of the last half hour (where the
-- ambulance comes from, the way to the hospital, when it picks them up, arrives and they're discharged; the ways thinned
-- to 150 points); the broadcast plays it by the clock as the game does, instead of walking them there along the roads.
set lock_timeout = '8s';

do $$
declare
  d text;
  thin text := '(select jsonb_agg(pt.v order by pt.i) from jsonb_array_elements(%s) with ordinality pt(v, i)
                  where (pt.i - 1) %% greatest(1, ceil(jsonb_array_length(%s) / 150.0)::int) = 0 or pt.i = jsonb_array_length(%s))';
begin
  d := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  if position('''now'', now(),' in d) = 0 or position('''visits''' in d) > 0 then
    raise exception 'broadcast_state changed';
  end if;
  execute replace(d, '''now'', now(),', '''visits'', coalesce((
      select jsonb_agg(jsonb_build_object(''userId'', v.user_id, ''hospital'', v.hospital, ''lng'', v.lng, ''lat'', v.lat,
          ''calledAt'', v.called_at, ''pickedAt'', v.picked_at, ''arrivesAt'', v.arrives_at, ''dischargedAt'', v.discharged_at,
          ''approach'', case when jsonb_typeof(v.approach) = ''array'' then ' || format(thin, 'v.approach', 'v.approach', 'v.approach') || ' end,
          ''route'', case when jsonb_typeof(v.route) = ''array'' then ' || format(thin, 'v.route', 'v.route', 'v.route') || ' end))
        from public.hospital_visits v
        join public.hunt_players p on p.user_id = v.user_id and p.hunt_id = h.id
       where v.called_at > now() - interval ''30 minutes'' and v.discharged_at > now() - interval ''1 minute''
         and not public.wonder_cloaked(v.user_id, h.id)), ''[]''::jsonb),
    ''now'', now(),');
end;
$$;
