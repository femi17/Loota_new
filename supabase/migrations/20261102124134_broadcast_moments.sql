-- The broadcast's ticker catches up with the game (owner, 2 Nov 2026: "What about the broadcast screen… is that
-- ready?"; then "continue"). New moments on the show: a story trap (a decoy) sprung, a trap's penalty, the chest dug
-- up in a key's quarter, a faint (the ambulance or the paramedics) and a Lamp prize won.
--   hunt_events: what the game's records don't keep a time for (decoys, penalties, digs), written by a trigger on
--   hunt_players, so the game's own functions are untouched. Read only by broadcast_state (no policies: RLS on).

create table if not exists public.hunt_events (
  id bigint generated always as identity primary key,
  hunt_id uuid not null, -- (no foreign keys: a hunt or player removed leaves only harmless old lines)
  user_id uuid,
  kind text not null,
  text text not null,
  at timestamptz not null default now()
);
create index if not exists hunt_events_hunt_at on public.hunt_events (hunt_id, at desc);
alter table public.hunt_events enable row level security;

create or replace function public.hunt_players_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text;
  place text;
  pen text;
  recent bigint;
  r jsonb;
begin
  select username into who from public.profiles where id = new.user_id;
  who := coalesce(who, 'A hunter');
  -- A story trap: the decoy just sprung (key_pulse), then its penalty in the same go (folded into one line).
  if coalesce(array_length(new.decoys_sprung, 1), 0) > coalesce(array_length(old.decoys_sprung, 1), 0) then
    select d.place into place from public.hunt_decoys d where d.id = new.decoys_sprung[array_length(new.decoys_sprung, 1)];
    insert into public.hunt_events (hunt_id, user_id, kind, text)
    values (new.hunt_id, new.user_id, 'decoy', who || ' fell for a story trap at ' || coalesce(place, 'the wrong place') || '!');
  end if;
  if new.penalties_taken > old.penalties_taken then
    select title into pen from public.penalties where code = new.last_penalty;
    select id into recent from public.hunt_events
     where hunt_id = new.hunt_id and user_id = new.user_id and kind = 'decoy' and at > now() - interval '10 seconds'
     order by at desc limit 1;
    if recent is not null then
      update public.hunt_events set text = rtrim(text, '!') || ': ' || coalesce(pen, 'caught') || '!' where id = recent;
    else
      insert into public.hunt_events (hunt_id, user_id, kind, text)
      values (new.hunt_id, new.user_id, 'trap', who || ' was caught by a trap: ' || coalesce(pen, 'ouch') || '!');
    end if;
  end if;
  -- The chest dug up in the key's quarter (the right plot).
  if new.house_dug is not null and new.house_dug is distinct from old.house_dug then
    select x into r
      from public.hunt_keys k, jsonb_array_elements(k.house -> 'rooms') x
     where k.hunt_id = new.hunt_id and k.n = new.house_key and x ->> 'id' = new.house_dug;
    if r ->> 'role' = 'right' then
      insert into public.hunt_events (hunt_id, user_id, kind, text)
      values (new.hunt_id, new.user_id, 'chest', who || ' dug up the chest at Key ' || new.house_key || '!');
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.hunt_players_events() from public, anon, authenticated;

create or replace trigger hunt_players_events
  after update on public.hunt_players
  for each row
  when (old.decoys_sprung is distinct from new.decoys_sprung
     or old.penalties_taken is distinct from new.penalties_taken
     or old.house_dug is distinct from new.house_dug)
  execute function public.hunt_players_events();

create or replace function public.broadcast_state(p_hunt uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
          'lastKeyAt', p.last_key_at,
          'lng', case when public.wonder_cloaked(p.user_id, h.id) then null else pp.lng end,
          'lat', case when public.wonder_cloaked(p.user_id, h.id) then null else pp.lat end,
          'mode', pp.mode, 'seenAt', pp.updated_at,
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
      select jsonb_agg(recent.e order by recent.at desc) from (
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
            select we.at, 'wonder', we.username, we.user_id, we.message
              from public.wonder_events we
             where we.hunt_id = h.id
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
            union all
            -- Story traps, penalties, chests dug up (hunt_events, above)
            select e.at, e.kind, pr.username, e.user_id, e.text
              from public.hunt_events e left join public.profiles pr on pr.id = e.user_id
             where e.hunt_id = h.id
            union all
            -- Fainted: the ambulance to hospital, or the paramedics by the road
            select v.called_at, 'faint', pr.username, v.user_id,
                   pr.username || case when v.route is null then ' fainted from exhaustion: the paramedics are on their way'
                                       else ' fainted from exhaustion and was rushed to ' || v.hospital || ' by ambulance' end
              from public.hospital_visits v
              join public.hunt_players p on p.user_id = v.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = v.user_id
             where v.called_at between h.starts_at and h.ends_at
            union all
            -- A Lamp prize won during the hunt
            select c.answered_at, 'lamp', pr.username, c.user_id,
                   pr.username || ' won the Lamp''s prize at ' || d.place_name || '!'
              from public.detour_claims c
              join public.detours d on d.id = c.detour_id
              join public.hunt_players p on p.user_id = c.user_id and p.hunt_id = h.id
              join public.profiles pr on pr.id = c.user_id
             where c.outcome = 'won' and c.answered_at between h.starts_at and h.ends_at
          ) ev
         where ev.at > now() - interval '6 hours'
         order by ev.at desc
         limit 40
      ) recent), '[]'::jsonb));
end;
$function$;
