-- Every hunter gets the same kind of puzzle at a key, each their own puzzle of it (owner, 8 Nov 2026: "remember all
-- the users gets same category but different questions"). The Key Trial's kind was drawn at random for each attempt;
-- now it comes from the hunt and the key (never the kind the key before had), the puzzle itself from the attempt's own
-- seed as before. The hunt city's room puzzles do the same in the game's server (src/lib/house-rooms.ts roomKind).
set lock_timeout = '8s';

create or replace function public.key_puzzle_kind(p_hunt uuid, p_key integer)
returns text language sql immutable set search_path = '' as $$
  with kinds as (select array['route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels', 'grammar', 'algebra', 'countries', 'flags', 'brands'] a),
       pick as (select abs(hashtext(p_hunt::text || ':' || p_key)) % 13 as i, abs(hashtext(p_hunt::text || ':' || (p_key - 1))) % 13 as j)
  select a[1 + case when p_key > 1 and i = j then (i + 1) % 13 else i end] from kinds, pick
$$;

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.search_here(uuid,double precision,double precision,text)'::regprocedure);
  if position('public.random_puzzle_kind()' in d) = 0 then
    raise exception 'search_here no longer draws a random kind';
  end if;
  execute replace(d, 'public.random_puzzle_kind()', 'public.key_puzzle_kind(k.hunt_id, k.n)');
end;
$$;
