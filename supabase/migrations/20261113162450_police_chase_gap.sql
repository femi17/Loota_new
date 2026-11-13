set lock_timeout = '8s';
-- The chase's head start (police_chase_wanted): 120 m was about a second at a motorbike's pace on the game's clock; the
-- patrol car now starts 300 m back (an officer on foot 60 m), only a little faster than the hunter on a straight.
do $$
declare
  f text := pg_get_functiondef('public.road_event_answer(bigint, integer)'::regprocedure);
  a text := 'when ''walk'' then jsonb_build_object(''chaser'', ''officer'', ''gapM'', 40, ''seconds'', 240)
      else jsonb_build_object(''chaser'', ''patrol'', ''gapM'', 120, ''seconds'', 240)';
begin
  if position(a in f) = 0 then
    raise exception 'road_event_answer: not found';
  end if;
  execute replace(f, a, 'when ''walk'' then jsonb_build_object(''chaser'', ''officer'', ''gapM'', 60, ''seconds'', 240)
      else jsonb_build_object(''chaser'', ''patrol'', ''gapM'', 300, ''seconds'', 240)');
end $$;
