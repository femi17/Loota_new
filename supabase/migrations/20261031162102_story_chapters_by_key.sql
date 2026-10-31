-- A story hunt's chapters open with the keys (owner, 31 Oct 2026: "only when you obtain the first key, you get the next
-- chapter scroll with the key"): the opening and chapter 1 at the start, then one more for every key found.
-- hunt_players.story_chapters: how many chapters this player's scroll has opened, so far. It only ever grows: a key
-- taken by a Thief's Hand does not close a chapter already read.
alter table public.hunt_players add column if not exists story_chapters int not null default 0;
