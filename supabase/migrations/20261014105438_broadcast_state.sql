-- The broadcast (design doc 11): everything the live show's spectator screen
-- needs about one hunt, for the owner only. Live positions arrive separately
-- over Realtime; this fills in the rest every few seconds. Key spots are never
-- included: viewers may be players.
--
-- Events are read from what the game already records (trial attempts,
-- finishes, joins, domes), so no game rule had to change for the show.
create function public.broadcast_state(p_hunt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  h public.hunts%rowtype;
  total int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Owner only';
  end if;
  select * into h from public.hunts where id = p_hunt;
  if not found then
    return null;
  end if;
  select count(*) into total from public.hunt_keys where hunt_id = h.id;

  return jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'prize', h.prize, 'winners', h.winners,
      'startsAt', h.starts_at, 'endsAt', h.ends_at, 'phase', public.hunt_phase(h), 'keys', total),
    'hunters', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.user_id, 'name', pr.username, 'look', pr.avatar, 'keysHeld', p.keys_held, 'place', p.place,
          'lastKeyAt', p.last_key_at, 'lng', pp.lng, 'lat', pp.lat, 'mode', pp.mode, 'seenAt', pp.updated_at,
          'inTrial', exists (select 1 from public.trial_attempts t where t.hunt_id = h.id and t.user_id = p.user_id and t.status = 'active'))
        order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at)
        from public.hunt_players p
        join public.profiles pr on pr.id = p.user_id
        left join public.player_positions pp on pp.user_id = p.user_id
       where p.hunt_id = h.id), '[]'::jsonb),
    'domes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'lng', d.lng, 'lat', d.lat, 'radiusM', d.radius_m, 'endsAt', d.ends_at,
          'key', d.key_n, 'raisedBy', pr.username, 'needed', d.needed,
          'attackers', (select count(*) from public.dome_hits x where x.dome_id = d.id and x.at > now() - interval '30 seconds')))
        from public.hunt_domes d left join public.profiles pr on pr.id = d.raised_by
       where d.hunt_id = h.id and d.broken_at is null and d.ends_at > now()), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(e order by e.at desc) from (
        select jsonb_build_object('at', ev.at, 'kind', ev.kind, 'who', ev.who, 'whoId', ev.who_id, 'text', ev.text) as e, ev.at
          from (
            select t.ended_at as at, 'key' as kind, pr.username as who, t.user_id as who_id,
                   pr.username || ' earned Key ' || t.key_n || '!' as text
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id and t.status = 'passed'
            union all
            select t.ended_at, 'failed', pr.username, t.user_id,
                   pr.username || ' failed the Key ' || t.key_n || ' trial and was thrown 2 km away'
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id and t.status = 'failed'
            union all
            select t.started_at, 'trial', pr.username, t.user_id,
                   pr.username || ' found Key ' || t.key_n || ' and started the Key Trial'
              from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
             where t.hunt_id = h.id
            union all
            select p.finished_at, 'finished', pr.username, p.user_id,
                   pr.username || ' finished ' || case p.place when 1 then '1st' when 2 then '2nd' when 3 then '3rd' else p.place || 'th' end
                   || case when p.place <= h.winners then ' and WINS!' else '' end
              from public.hunt_players p join public.profiles pr on pr.id = p.user_id
             where p.hunt_id = h.id and p.finished_at is not null
            union all
            select p.joined_at, 'joined', pr.username, p.user_id, pr.username || ' joined the hunt'
              from public.hunt_players p join public.profiles pr on pr.id = p.user_id
             where p.hunt_id = h.id
            union all
            select d.starts_at, 'dome', pr.username, d.raised_by,
                   coalesce(pr.username, 'Someone') || ' raised a Lockdown dome over Key ' || d.key_n || '!'
              from public.hunt_domes d left join public.profiles pr on pr.id = d.raised_by
             where d.hunt_id = h.id
            union all
            select d.broken_at, 'siege', null, null, 'Siege! The dome over Key ' || d.key_n || ' has been broken'
              from public.hunt_domes d
             where d.hunt_id = h.id and d.broken_at is not null
          ) ev
         where ev.at > now() - interval '6 hours'
         order by ev.at desc
         limit 40
      ) recent), '[]'::jsonb));
end;
$$;

revoke execute on function public.broadcast_state(uuid) from public, anon;
grant execute on function public.broadcast_state(uuid) to authenticated;
