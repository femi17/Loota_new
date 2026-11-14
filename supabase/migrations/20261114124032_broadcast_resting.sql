set lock_timeout = '8s';
-- Resting on the broadcast (owner, 14 Nov 2026: "When a user is resting, that they sit on the road the broadcast doesnt
-- have that"): since when each hunter has been resting (player_positions.resting_since; cleared once they move on).
do $$
declare
  f text := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  a text := '''mode'', pp.mode, ''seenAt'', pp.updated_at,';
begin
  if position(a in f) = 0 then
    raise exception 'broadcast_state: not found';
  end if;
  execute replace(f, a, '''mode'', pp.mode, ''seenAt'', pp.updated_at, ''restingSince'', pp.resting_since,');
end $$;
