-- Security audit (owner, 9 Nov 2026: "is this secured. Can you run an audit, try to hacker the platform"). The game's
-- live channels were open: anyone with the public app key, even signed out, could join a player's device channel and
-- freeze their game ("open on 2 devices"), listen to the hunters' positions and ids, or fake a rival's progress. They
-- are now private channels (the game joins them with private: true), allowed only by these rules:
--   device:<player>                      only that player (no one else can pretend to be their second device);
--   hunters:<area>                       signed-in players (who see the hunters near them, as before);
--   trial:<hunt>:<key>, keyworld:<hunt>:<key>   players in that hunt.
-- Also: an avatar is at most 4,000 characters (it was unlimited: half a megabyte, shown to everyone near), and
-- racing_now (unused by the game's pages) is no longer callable from outside.
set lock_timeout = '8s';

create or replace function public.in_hunt_channel(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hunt_players hp
                  where hp.user_id = auth.uid() and hp.hunt_id::text = split_part(p_topic, ':', 2));
$$;
revoke all on function public.in_hunt_channel(text) from public, anon;
grant execute on function public.in_hunt_channel(text) to authenticated;

create or replace function public.loota_channel_ok(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
       p_topic = 'device:' || auth.uid()::text
    or p_topic like 'hunters:%'
    or ((p_topic like 'trial:%' or p_topic like 'keyworld:%') and public.in_hunt_channel(p_topic)));
$$;
revoke all on function public.loota_channel_ok(text) from public, anon;
grant execute on function public.loota_channel_ok(text) to authenticated;

create policy "loota players hear their channels" on realtime.messages
  for select to authenticated using (public.loota_channel_ok(realtime.topic()));
create policy "loota players speak on their channels" on realtime.messages
  for insert to authenticated with check (public.loota_channel_ok(realtime.topic()));

alter table public.profiles add constraint profiles_avatar_size check (avatar is null or length(avatar::text) <= 4000);

revoke execute on function public.racing_now(uuid) from public, anon, authenticated;
