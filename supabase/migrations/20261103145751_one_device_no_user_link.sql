-- player_sessions keeps no link to auth.users, so a player's account can still be removed (a leftover row is harmless).
alter table public.player_sessions drop constraint if exists player_sessions_user_id_fkey;
