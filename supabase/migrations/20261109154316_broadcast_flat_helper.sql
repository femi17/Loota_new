-- The vulcanizer on the broadcast (owner, 9 Nov 2026: "The vulcanizer, following you back to the vehicle, should be
-- implemented too"). Each hunter in broadcast_state now says who is walking back with them to change a flat (their
-- vehicle's flat_helper), so the broadcast draws them behind the hunter as the game does.
set lock_timeout = '8s';

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  if position('''inTrial'', exists (' in d) = 0 or position('''helper''' in d) > 0 then
    raise exception 'broadcast_state changed';
  end if;
  execute replace(d, '''inTrial'', exists (', '''helper'', (select v.flat_helper from public.player_vehicles v where v.user_id = p.user_id and v.flat_helper is not null limit 1),
          ''inTrial'', exists (');
end;
$$;
