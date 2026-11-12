-- The lamp, local (lamp_local): until the player's country is known (a first visit), Nigeria's stories and questions
-- only inside Nigeria's box (as the game's own inNigeria), never for everyone.
set lock_timeout = '8s';
do $$
declare
  f text;
begin
  f := pg_get_functiondef('public.spawn_detour(text, double precision, double precision, text)'::regprocedure);
  if position('naija boolean := coalesce(p_country, ''NG'') = ''NG'';' in f) = 0 then raise exception 'spawn_detour: not found'; end if;
  execute replace(f, 'naija boolean := coalesce(p_country, ''NG'') = ''NG'';',
    'naija boolean := coalesce(p_country = ''NG'', p_lng between 2.6 and 14.7 and p_lat between 4.2 and 13.9); -- (not known yet: Nigeria only inside it)');
  f := pg_get_functiondef('public.start_detour(uuid)'::regprocedure);
  if position('coalesce(pos.country, ''NG'') = ''NG''' in f) = 0 then raise exception 'start_detour: not found'; end if;
  execute replace(f, 'coalesce(pos.country, ''NG'') = ''NG''', 'coalesce(pos.country = ''NG'', pos.lng between 2.6 and 14.7 and pos.lat between 4.2 and 13.9)');
end $$;
