-- The idling law on the broadcast (owner, 12 Nov 2026: "The lockup should happen on the broadcast page too"): the
-- hunters in a cell (and for a minute after they're out: the broadcast plays a few seconds behind), with when they went
-- in, when they come out (served, or bailed), what was impounded; and news of it: locked up, bailed out.
set lock_timeout = '8s';
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a text := '    ''now'', now(),';
  b text := '            -- A Lamp prize won during the hunt';
begin
  if position(a in f) = 0 or position(b in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  f := replace(f, a, '    ''jails'', coalesce((
      select jsonb_agg(jsonb_build_object(''userId'', j.user_id, ''at'', j.at, ''until'', least(j.until, coalesce(j.bailed_at, j.until)),
          ''bailed'', j.bailed_at is not null, ''vehicle'', j.vehicle_kind, ''minutes'', j.still_minutes, ''lng'', j.lng, ''lat'', j.lat))
        from public.idle_arrests j
        join public.hunt_players p on p.user_id = j.user_id and p.hunt_id = h.id
       where j.at > now() - interval ''2 hours'' and least(j.until, coalesce(j.bailed_at, j.until)) > now() - interval ''1 minute''
         and not public.wonder_cloaked(j.user_id, h.id)), ''[]''::jsonb),
' || a);
  f := replace(f, b, '            -- The idling law: locked up, and out on bail
            select j.at, ''jail'', pr.username, j.user_id,
                   ''🚔 '' || pr.username || '' was locked up for idling on a main road'' || coalesce('': their '' || j.vehicle_kind || '' impounded'', '''')
              from public.idle_arrests j
              join public.hunt_players p on p.user_id = j.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = j.user_id
             where j.at between h.starts_at and h.ends_at
            union all
            select j.bailed_at, ''bail'', pr.username, j.user_id, ''🚔 '' || pr.username || '' paid bail and walked out of the cell''
              from public.idle_arrests j
              join public.hunt_players p on p.user_id = j.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = j.user_id
             where j.bailed_at is not null and j.bailed_at between h.starts_at and h.ends_at
            union all
' || b);
  execute f;
end $$;
