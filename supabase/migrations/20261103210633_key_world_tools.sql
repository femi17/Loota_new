-- Tools in the key's world (owner, 3 Nov 2026: "for user who has digging tool, they should be able to use it here like
-- touch light, metal detector, digger, maybe show all the inventory and coin, user should be able to buy thing"; the
-- spade: "1 min digging" by hand; the torch lights the treasure building's dark rooms; spade 80, torch 60). A spade and
-- a torch are bought once and kept, as the metal detector is. Digging in the open by hand takes a minute on the spot
-- (house_dig_start, then house_enter once the minute is up); with a spade, at once. The detector finds only the key
-- ("the metal detector should only detect the key"): hot at the right place, cold everywhere else.

-- (The tables, on their own: the live game held locks; the functions follow in key_world_tools_functions.)
set lock_timeout = '8s';
alter table public.profiles
  add column if not exists spade boolean not null default false,
  add column if not exists torch boolean not null default false;
alter table public.hunt_players add column if not exists house_digging jsonb;
