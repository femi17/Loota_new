-- The chain's locks (owner, 12 Nov 2026): rooms 6 and 7 (the second and third locks), and a lock's outcome ('lock': its
-- note points to the next one). The table's own rules allowed only rooms 1–5 and the five old outcomes.
set lock_timeout = '8s';
alter table public.house_room_puzzles
  drop constraint house_room_puzzles_outcome_check,
  add constraint house_room_puzzles_outcome_check check (outcome = any (array['coins', 'chapter', 'key', 'decoy', 'trap', 'lock'])),
  drop constraint house_room_puzzles_room_check,
  add constraint house_room_puzzles_room_check check (room between 1 and 7);
