-- Taken to the station (idle_law_station): the fallback to a roadside police post counted 3 minutes from the arrest, so
-- someone arrested who closed the game straight after came back to the roadside post, not the ride. Now it counts from
-- when the game is trying (asking all the while); away and back, it tries afresh.
set lock_timeout = '8s';
alter table public.idle_arrests add column if not exists taking_since timestamptz;
do $$
declare
  f text := pg_get_functiondef('public.idle_law(boolean)'::regprocedure);
  a text := '      if a.at < now() - interval ''3 minutes'' then
        return public.take_to_station(null, null, null, null) || jsonb_build_object(''state'', ''jailed'', ''impounded'', public.impounded_list(uid));
      end if;';
begin
  if position(a in f) = 0 then
    raise exception 'idle_law: not found';
  end if;
  execute replace(f, a, '      -- The game finds the station and the road (take_to_station). Trying for 3 minutes without managing it (asked all the
      -- while): the roadside post. Away and back (no ask for 2 minutes): it tries afresh.
      if a.taking_since is null or a.beat_at < now() - interval ''2 minutes'' or a.beat_at is null then
        update public.idle_arrests set taking_since = now(), beat_at = now() where id = a.id returning * into a;
      else
        update public.idle_arrests set beat_at = now() where id = a.id returning * into a;
      end if;
      if a.taking_since < now() - interval ''3 minutes'' then
        return public.take_to_station(null, null, null, null) || jsonb_build_object(''state'', ''jailed'', ''impounded'', public.impounded_list(uid));
      end if;');
end $$;
-- (beat_at is the cell's heartbeat once there: taken, it starts afresh)
do $$
declare
  f text := pg_get_functiondef('public.take_to_station(text, double precision, double precision, jsonb)'::regprocedure);
  a text := 'route = p_route, taken_at = taken, arrives_at = arrives';
  b text := 'route = null, taken_at = taken, arrives_at = taken';
begin
  if position(a in f) = 0 or position(b in f) = 0 then
    raise exception 'take_to_station: not found';
  end if;
  f := replace(f, a, a || ', beat_at = null');
  f := replace(f, b, b || ', beat_at = null');
  execute f;
end $$;
