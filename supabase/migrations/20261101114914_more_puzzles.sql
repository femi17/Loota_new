-- More Key Trial puzzles (owner, 1 Nov 2026: "lets include these puzzles, for the sudoku, we can half solved it"):
-- Sudoku (half done), Threads (join the pairs), Plots (divide into rectangles), Patchwork (fit the patches) and Lost
-- Vowels (words with their vowels gone). Allowed as a key's trial and an attempt's kind, with their clocks, and in the
-- random pick of a key set to "a puzzle".
alter table public.trial_attempts drop constraint if exists trial_attempts_kind_check;
alter table public.trial_attempts add constraint trial_attempts_kind_check
  check (kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels'));
alter table public.hunt_keys drop constraint if exists hunt_keys_trial_kind_check;
alter table public.hunt_keys add constraint hunt_keys_trial_kind_check
  check (trial_kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels', 'puzzle'));

create or replace function public.puzzle_seconds(p_kind text, p_level integer) returns integer
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'sentries' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    when 'route' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'adire' then (array[120, 150, 180])[greatest(1, least(3, p_level))]
    when 'tornmap' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'sudoku' then (array[240, 270, 300])[greatest(1, least(3, p_level))]
    when 'threads' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'plots' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'patchwork' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    when 'vowels' then (array[90, 120, 150])[greatest(1, least(3, p_level))]
    else 60 end
$$;

create or replace function public.random_puzzle_kind() returns text
language sql volatile set search_path = '' as $$
  select (array['sentries', 'route', 'adire', 'tornmap', 'sudoku', 'threads', 'plots', 'patchwork', 'vowels'])[1 + floor(random() * 9)::integer]
$$;
