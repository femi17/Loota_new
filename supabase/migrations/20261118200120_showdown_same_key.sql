set lock_timeout = '8s';
-- A showdown is for the key you're chasing (owner, 16 Nov 2026: fix the steal rules). Before, a thief could challenge
-- anyone holding a key and, winning, took their own next key: a thief on their last key could finish the hunt (and win a
-- real prize) by beating any key holder, and friends or second accounts could lose on purpose to hand keys over that
-- nobody had found. Now a thief may only challenge a hunter whose latest key is exactly the one the thief needs next, and
-- winning gives the thief exactly that key (the holder goes back before it). A key changes hands; none is made. The last
-- key can't be stolen (whoever holds it has finished), and the Tracker shows only the hunters holding the key you need.

create or replace function public.next_real_key(p_hunt uuid, p_held integer)
returns integer language sql stable security definer set search_path to '' as $$
  select min(k.n) from public.hunt_keys k where k.hunt_id = p_hunt and k.n > coalesce(p_held, 0) and not coalesce(k.relay, false)
$$;
create or replace function public.latest_real_key(p_hunt uuid, p_held integer)
returns integer language sql stable security definer set search_path to '' as $$
  select max(k.n) from public.hunt_keys k where k.hunt_id = p_hunt and k.n <= coalesce(p_held, 0) and not coalesce(k.relay, false)
$$;
revoke execute on function public.next_real_key(uuid, integer), public.latest_real_key(uuid, integer) from public, anon, authenticated;

do $$
declare
  def text;
  fixed text;
  same text := ' and public.latest_real_key(hunt, p.keys_held) = public.next_real_key(hunt, '
            || '(select h.keys_held from public.hunt_players h where h.hunt_id = hunt and h.user_id = uid))';
begin
  -- Who can be challenged: only a holder of the thief's next key
  def := pg_get_functiondef('public.showdown_blocked(uuid, uuid, uuid)'::regprocedure);
  fixed := replace(def, $a$return 'no_key';$a$,
    $b$return 'no_key';
  elsif public.latest_real_key(p_hunt, hp.keys_held) is distinct from
        public.next_real_key(p_hunt, (select h.keys_held from public.hunt_players h where h.hunt_id = p_hunt and h.user_id = p_thief)) then
    return 'other_key';$b$);
  if fixed = def then raise exception 'showdown_blocked: anchor not found'; end if;
  execute fixed;

  -- The Tracker and the challenge bar: only those holding the key you need
  def := pg_get_functiondef('public.tracker_scan()'::regprocedure);
  fixed := replace(def, 'and public.keys_in(hunt, p.keys_held) >= 1', 'and public.keys_in(hunt, p.keys_held) >= 1' || same);
  if fixed = def then raise exception 'tracker_scan: anchor not found'; end if;
  execute fixed;

  def := pg_get_functiondef('public.showdown_targets()'::regprocedure);
  fixed := replace(def, 'and public.keys_in(hunt, p.keys_held) >= 1', 'and public.keys_in(hunt, p.keys_held) >= 1' || same);
  if fixed = def then raise exception 'showdown_targets: anchor not found'; end if;
  execute fixed;

  -- Stolen: the thief gets exactly the key taken (not "their next one")
  def := pg_get_functiondef('public.showdown_end(bigint, text)'::regprocedure);
  fixed := replace(def,
    'select min(kk.n) into next_real from public.hunt_keys kk where kk.hunt_id = s.hunt_id and kk.n > hp.keys_held and not coalesce(kk.relay, false);',
    'next_real := case when hp.keys_held < s.key_n then s.key_n end;');
  if fixed = def then raise exception 'showdown_end: anchor not found'; end if;
  execute fixed;
end;
$$;
