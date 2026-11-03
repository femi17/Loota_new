-- A story key (an exact one): away from the place itself is never "this is the place" (owner, 3 Nov 2026: "when I was
-- thrown away, I can still see explore the place from 2km away, and if I open it, it is blank… this is the place
-- indication is also on the screen"). key_pulse said "not here" from outside only before the hunter had first
-- reached the key (approach_key); after that, anywhere fell through to "This is the place" (and the quarter, checked
-- on its own, opened blank). Now outside an exact key is always outside.
do $$
declare
  def text;
  anchor text := $a$  if outside and hp.approach_key is distinct from k.n then$a$;
begin
  def := pg_get_functiondef('public.key_pulse(uuid, double precision, double precision, text)'::regprocedure);
  if position(anchor in def) = 0 then
    raise exception 'key_pulse: expected text not found';
  end if;
  execute replace(def, anchor, $r$  -- An exact key: away from the place itself, the hunter is away (once there before or not).
  if outside and k.exact_m is not null then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'detector', has_detector);
  end if;
$r$ || anchor);
end;
$$;
