-- The broadcast follows hunters on a bus, train or plane (owner, 3 Nov 2026: "The broadcast is not following the users.
-- Fenzy is on a plane to tokyo now. Also, we should have a direction drawn for planes. It could be interesting to see
-- the plane path"). A trip saves no positions (save_position refuses during one), so the screen showed the hunter at
-- the departure airport. broadcast_state now also sends each hunter's trip under way (its path, thinned to about 150
-- points, and its times; the screen places them along it by the clock and draws the route), the server's time, and
-- flights in the ticker: took off, landed.
do $$
declare
  def text;
  trips text := $t$'trips', coalesce((
      select jsonb_agg(jsonb_build_object('userId', t.user_id, 'mode', t.mode, 'from', t.from_name, 'to', t.to_name,
          'departsAt', t.departs_at, 'arrivesAt', t.arrives_at,
          'path', (select jsonb_agg(pt.v order by pt.i)
                     from jsonb_array_elements(t.path) with ordinality pt(v, i)
                    where (pt.i - 1) % greatest(1, ceil(jsonb_array_length(t.path) / 150.0)::int) = 0
                       or pt.i = jsonb_array_length(t.path))))
        from public.transit_trips t
        join public.hunt_players p on p.user_id = t.user_id and p.hunt_id = h.id
       where t.ended_at is null and t.booked_at > now() - interval '1 day' and t.arrives_at > now() - interval '10 minutes'
         and jsonb_typeof(t.path) = 'array' and not public.wonder_cloaked(t.user_id, h.id)), '[]'::jsonb),
    'now', now(),
    'events', coalesce(($t$;
  flights text := $f$            union all
            -- Flights: took off, landed
            select t.departs_at, 'flight', pr.username, t.user_id,
                   '✈️ ' || pr.username || ' took off from ' || t.from_name || ' for ' || t.to_name
              from public.transit_trips t
              join public.hunt_players p on p.user_id = t.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = t.user_id
             where t.mode = 'plane' and t.departs_at <= now() and t.departs_at between h.starts_at and h.ends_at
               and coalesce(t.outcome, '') <> 'cancelled'
            union all
            select t.arrives_at, 'landed', pr.username, t.user_id,
                   '✈️ ' || pr.username || ' landed at ' || t.to_name
              from public.transit_trips t
              join public.hunt_players p on p.user_id = t.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = t.user_id
             where t.mode = 'plane' and t.arrives_at <= now() and t.arrives_at between h.starts_at and h.ends_at
               and coalesce(t.outcome, '') <> 'cancelled'
          ) ev$f$;
begin
  def := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  if position($q$'events', coalesce(($q$ in def) = 0 or position(E'\n          ) ev' in def) = 0 then
    raise exception 'broadcast_state: expected text not found';
  end if;
  def := replace(def, $q$'events', coalesce(($q$, trips);
  def := replace(def, E'\n          ) ev', E'\n' || flights);
  execute def;
end;
$$;
