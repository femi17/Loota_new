set lock_timeout = '8s';
-- Roadside chess: a mate-in-one this player hasn't had before (owner, 19 Nov 2026: "The games are repeated"); once
-- they've had every one, any.
do $$
declare
  def text := pg_get_functiondef('public.road_game(text)'::regprocedure);
  anchor text := 'select * into pz from public.chess_puzzles order by random() limit 1;';
begin
  if position(anchor in def) = 0 then
    raise exception 'road_game: anchor not found';
  end if;
  def := replace(def, anchor, $r$select * into pz from public.chess_puzzles c
     where not exists (select 1 from public.road_events e where e.user_id = auth.uid() and e.game ->> 'type' = 'chess' and e.game ->> 'fen' = c.fen)
     order by random() limit 1;
    if pz.id is null then
      select * into pz from public.chess_puzzles order by random() limit 1;
    end if;$r$);
  execute def;
end $$;
