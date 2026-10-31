-- Clanmates on the map show as their own hunter: clan_positions also returns each one's look.
create or replace function public.clan_positions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('ok', true, 'mates', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'colour', (select colour from public.clans where id = m.clan_id), 'crest', (select crest from public.clans where id = m.clan_id),
    'mates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'look', p.avatar, 'lng', pp.lng, 'lat', pp.lat, 'mode', pp.mode, 'seenAt', pp.updated_at)), '[]'::jsonb)
              from public.clan_members cm join public.profiles p on p.id = cm.user_id join public.player_positions pp on pp.user_id = cm.user_id
              where cm.clan_id = m.clan_id and cm.left_at is null and cm.user_id <> uid and pp.updated_at > now() - interval '1 day'));
end;
$$;
