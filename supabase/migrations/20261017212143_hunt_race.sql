-- The race, felt (owner, 17 Oct 2026: "the hunt experience is everything; how not to make it boring").
-- hunt_feed: what's just happened in the hunt (keys found, trials begun, hunters finishing, Wonders), each with how
-- far it was from the player; the hunters chasing the same key within 2 km (where, so the screen can point); how many
-- are already in the player's key's area; and the player's rank. Polled every few seconds during a hunt.
-- (Further than 2 km, only the Eye of the Djinn sees hunters.)

create or replace function public.hunt_feed(p_hunt uuid, p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  mine public.player_positions%rowtype;
  since timestamptz;
  my_rank integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null then
    return null;
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  select * into mine from public.player_positions where user_id = uid;
  -- Never more than the last 10 minutes of news.
  since := greatest(coalesce(p_since, now() - interval '2 minutes'), now() - interval '10 minutes');

  select r.rank into my_rank from (
    select p.user_id, row_number() over (order by p.place nulls last, p.keys_held desc, p.last_key_at nulls last, p.joined_at) as rank
      from public.hunt_players p where p.hunt_id = p_hunt
  ) r where r.user_id = uid;

  return jsonb_build_object(
    'now', now(),
    'phase', public.hunt_phase(h),
    'rank', my_rank,
    'hunters', (select count(*) from public.hunt_players where hunt_id = p_hunt),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'who', ev.who, 'mine', ev.who_id = uid, 'key', ev.key_n,
               'place', ev.place, 'text', ev.text,
               'metres', case when ev.who_id <> uid and mine.user_id is not null and pp.user_id is not null and not public.wonder_cloaked(ev.who_id, p_hunt)
                              then round(public.distance_m(mine.lng, mine.lat, pp.lng, pp.lat) / 100) * 100 end)
             order by ev.at)
        from (
          select t.ended_at as at, 'key' as kind, pr.username as who, t.user_id as who_id, t.key_n, null::integer as place, null::text as text
            from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
           where t.hunt_id = p_hunt and t.status = 'passed' and t.ended_at > since
          union all
          select t.started_at, 'trial', pr.username, t.user_id, t.key_n, null, null
            from public.trial_attempts t join public.profiles pr on pr.id = t.user_id
           where t.hunt_id = p_hunt and t.started_at > since
          union all
          select p.finished_at, 'finished', pr.username, p.user_id, null, p.place, null
            from public.hunt_players p join public.profiles pr on pr.id = p.user_id
           where p.hunt_id = p_hunt and p.finished_at > since
          union all
          select p.joined_at, 'joined', pr.username, p.user_id, null, null, null
            from public.hunt_players p join public.profiles pr on pr.id = p.user_id
           where p.hunt_id = p_hunt and p.joined_at > since
        ) ev
        left join public.player_positions pp on pp.user_id = ev.who_id), '[]'::jsonb),
    -- Hunters chasing the same key, within 2 km, nearest first (never the cloaked).
    'rivals', case when hp.user_id is not null and hp.finished_at is null and mine.user_id is not null then coalesce((
      select jsonb_agg(jsonb_build_object('name', x.username, 'lng', x.lng, 'lat', x.lat, 'metres', round(x.m)) order by x.m)
        from (
          select pr.username, pp.lng, pp.lat, public.distance_m(mine.lng, mine.lat, pp.lng, pp.lat) as m
            from public.hunt_players p
            join public.profiles pr on pr.id = p.user_id
            join public.player_positions pp on pp.user_id = p.user_id
           where p.hunt_id = p_hunt and p.user_id <> uid and p.finished_at is null and p.keys_held = hp.keys_held
             and pp.updated_at > now() - interval '10 minutes'
             and pp.lat between mine.lat - 0.02 and mine.lat + 0.02 and pp.lng between mine.lng - 0.02 and mine.lng + 0.02
             and not public.wonder_cloaked(p.user_id, p_hunt)
           order by 4 limit 5
        ) x where x.m <= 2000), '[]'::jsonb) else '[]'::jsonb end,
    -- How many others are already in the area of the key the player is after.
    'inMyArea', case when hp.user_id is not null and hp.finished_at is null then
      (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.user_id <> uid and p.finished_at is null
          and p.keys_held = hp.keys_held and p.approach_key = hp.keys_held + 1) else 0 end);
end;
$$;

revoke execute on function public.hunt_feed(uuid, timestamptz) from public, anon;
grant execute on function public.hunt_feed(uuid, timestamptz) to authenticated;
