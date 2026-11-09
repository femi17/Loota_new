-- The hunter's answers on the broadcast's puzzle card (owner, 9 Nov 2026: "the users answers in the 3d world is not
-- displayed to users"). At a key's place the game keeps the board's last ten states (when, the box, what's been put
-- in) in the scene's data, replaced each time (scene_update's meta); a board (a sudoku's grid, say) is a few hundred
-- characters, so the meta may be up to 12,000 (was 2,000).
set lock_timeout = '8s';

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.scene_update(bigint,jsonb,jsonb,bigint)'::regprocedure);
  if position('length(p_meta::text) > 2000' in d) = 0 then
    raise exception 'scene_update changed';
  end if;
  execute replace(d, 'length(p_meta::text) > 2000', 'length(p_meta::text) > 12000');
end;
$$;
