-- Quick puzzles in place of Sentries (owner, 4 Nov 2026: "Remove this sentrie game, replace with something else, also,
-- do not forget we can have grammar, simple algebra, type 5 coutries starting with L, guess the flag, guess the Logo
-- or guess the brand"). Five new kinds (Grammar, Algebra, Name the countries, Guess the flag, Guess the brand: made
-- and checked by the game's server, src/game/puzzles), allowed as a key's trial and an attempt's kind; the random
-- pick for "a puzzle" drops Sentries and takes them in; every key set to Sentries becomes "a puzzle". (Sentries stays
-- allowed so a trial already under way can finish.)
set lock_timeout = '8s';
alter table public.trial_attempts drop constraint if exists trial_attempts_kind_check;
alter table public.trial_attempts add constraint trial_attempts_kind_check
  check (kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels', 'grammar', 'algebra', 'countries', 'flags', 'brands'));
alter table public.hunt_keys drop constraint if exists hunt_keys_trial_kind_check;
alter table public.hunt_keys add constraint hunt_keys_trial_kind_check
  check (trial_kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels', 'grammar', 'algebra', 'countries', 'flags', 'brands', 'puzzle'));

create or replace function public.random_puzzle_kind() returns text
language sql volatile set search_path = '' as $$
  select (array['route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels', 'grammar', 'algebra', 'countries', 'flags', 'brands'])[1 + floor(random() * 13)::integer]
$$;

update public.hunt_keys set trial_kind = 'puzzle' where trial_kind = 'sentries';
