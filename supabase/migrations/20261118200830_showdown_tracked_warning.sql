set lock_timeout = '8s';
-- "Someone has a Tracker out near you" only for those that Tracker can see (16 Nov 2026, with showdown_same_key): a
-- Tracker now shows only the hunters holding the key its owner needs next, so a holder of any other key isn't warned.
do $$
declare
  def text;
  fixed text;
begin
  def := pg_get_functiondef('public.showdown_mine()'::regprocedure);
  fixed := replace(def, 'where b.tracker_until > now() and b.user_id <> uid',
    'where b.tracker_until > now() and b.user_id <> uid'
    || ' and public.next_real_key(hunt, p.keys_held) = public.latest_real_key(hunt, (select h.keys_held from public.hunt_players h where h.hunt_id = hunt and h.user_id = uid))');
  if fixed = def then raise exception 'showdown_mine: anchor not found'; end if;
  execute fixed;
end;
$$;
