-- A story hunt can wait for its story (owner, 31 Oct 2026: no paid API; the owner asks Claude Code to write the day's
-- story, and it is imported into the waiting hunt with npm run story:import).
alter table public.hunts drop constraint if exists hunts_story_status_check;
alter table public.hunts add constraint hunts_story_status_check check (story_status in ('waiting', 'writing', 'ready', 'failed'));
