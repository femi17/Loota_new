-- Owner, 26 Oct 2026: (1) "the hunt for each day should be from 9 am to 9 pm. After that users can be allowed free
-- roam": between a hunt's start and end, it's live only from 09:00 to 20:59 Lagos time; outside those hours it's
-- 'paused' (no searching, no detector, no trials, no riddle clock: free roam), and it picks up again at 9 am.
-- (2) The Lamp ("when one is completed… it shows another immediately. It should not be"): once its current thing is
-- done (claimed, tried, over, let go) it rests 15 minutes before the next. (3) Cruise tokens ("too much… it should not
-- be easy to find"): seen only within 150 m.

-- A hunt can run all day (the automated tests' hunts do, so they pass at any hour).
alter table public.hunts add column if not exists all_day boolean not null default false;

create or replace function public.hunt_phase(h public.hunts)
returns text language sql stable set search_path = '' as $$
  select case
    when not h.published then 'draft'
    when now() < h.starts_at then 'upcoming'
    when now() >= h.ends_at
      or (select count(*) from public.hunt_players p where p.hunt_id = h.id and p.finished_at is not null) >= h.winners then 'ended'
    when not h.all_day and extract(hour from now() at time zone 'Africa/Lagos') not between 9 and 20 then 'paused'
    else 'live'
  end;
$$;

alter table public.player_lamp add column if not exists rest_until timestamptz;
create or replace function public.lamp_rest_minutes() returns integer language sql immutable set search_path = '' as $$ select 15 $$;

create or replace function public.lamp_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  my_area text;
  active integer;
  latest timestamptz;
  lamp public.player_lamp%rowtype;
  cur_kind text;
  cur_id text;
  lead uuid;
  item jsonb;
  hunting boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('now', now(), 'current', null);
  end if;
  my_area := public.detour_area(pos.lng, pos.lat);
  hunting := public.in_live_hunt(uid); -- in free roam: smaller rewards, and no Orb

  -- Keep two Detours going in the area, a new one at most every 8 minutes.
  perform pg_advisory_xact_lock(hashtext('detours:' || my_area));
  select count(*) filter (where ends_at > now()), max(starts_at) into active, latest from public.detours where area = my_area;
  if active < 2 and (latest is null or latest < now() - interval '8 minutes') then
    perform public.spawn_detour(my_area, pos.lng, pos.lat);
  end if;

  -- Whispers fade.
  update public.player_leads set resolved_at = now()
   where user_id = uid and resolved_at is null and created_at < now() - make_interval(mins => public.whisper_minutes());

  insert into public.player_lamp (user_id) values (uid) on conflict (user_id) do nothing;
  select * into lamp from public.player_lamp where user_id = uid for update;
  cur_kind := lamp.current_kind;
  cur_id := lamp.current_id;
  if cur_kind = 'orb' and not hunting then
    cur_kind := null; -- the hunt ended: the Orb is no longer the lamp's business
  end if;

  if not public.lamp_item_open(uid, cur_kind, cur_id) then
    -- The last thing is done (claimed, tried, over, let go): the lamp rests a while before the next.
    if lamp.current_kind is not null then
      update public.player_lamp set current_kind = null, current_id = null, rest_until = now() + make_interval(mins => public.lamp_rest_minutes())
       where user_id = uid returning * into lamp;
    end if;
    if lamp.rest_until > now() then
      return jsonb_build_object('now', now(), 'current', null, 'hunt', hunting, 'restUntil', lamp.rest_until);
    end if;
    cur_kind := null;
    cur_id := null;
    -- The next thing: the Orb (within 25 km, in a hunt), then the area's Detours (soonest ending first), then a whisper.
    if hunting then
      select 'orb', w.id::text into cur_kind, cur_id
        from public.world_items w
       where w.relic = 'lockdown_orb' and w.taken_by is null and w.expires_at > now()
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = uid and x.item = 'orb:' || w.id)
         and public.distance_m(pos.lng, pos.lat, w.lng, w.lat) < 25000
       limit 1;
    end if;
    if cur_kind is null then
      select 'detour', d.id::text into cur_kind, cur_id
        from public.detours d
       where d.area = my_area and d.ends_at > now() and (d.capacity is null or d.claimed < d.capacity)
         and not exists (select 1 from public.detour_claims c where c.detour_id = d.id and c.user_id = uid)
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = uid and x.item = 'detour:' || d.id)
       order by d.ends_at
       limit 1;
    end if;
    if cur_kind is null then
      select 'whisper', l.id::text into cur_kind, cur_id
        from public.player_leads l where l.user_id = uid and l.resolved_at is null order by l.created_at limit 1;
    end if;
    -- Nothing else: a new whisper, every 30 minutes at most.
    if cur_kind is null and (lamp.whisper_at is null or lamp.whisper_at < now() - interval '30 minutes') then
      lead := public.whisper_lead(uid, pos.lng, pos.lat);
      if lead is not null then
        cur_kind := 'whisper';
        cur_id := lead::text;
        update public.player_lamp set whisper_at = now() where user_id = uid;
      end if;
    end if;
    update public.player_lamp set current_kind = cur_kind, current_id = cur_id where user_id = uid;
  end if;

  if cur_kind = 'orb' then
    select jsonb_build_object('type', 'orb', 'id', w.id, 'lng', w.lng, 'lat', w.lat,
             'metres', round(public.distance_m(pos.lng, pos.lat, w.lng, w.lat)), 'endsAt', w.expires_at)
      into item from public.world_items w where w.id::text = cur_id;
  elsif cur_kind = 'detour' then
    select jsonb_build_object('type', 'detour', 'id', d.id, 'kind', d.kind, 'title', d.title, 'story', d.story, 'place', d.place_name,
             'lng', d.lng, 'lat', d.lat, 'metres', round(public.distance_m(pos.lng, pos.lat, d.lng, d.lat)),
             'endsAt', d.ends_at, 'capacity', d.capacity, 'claimed', d.claimed,
             'coins', (public.detour_reward(d, hunting)).coins, 'relic', (public.detour_reward(d, hunting)).relic,
             'mine', (select c.outcome from public.detour_claims c where c.detour_id = d.id and c.user_id = uid))
      into item from public.detours d where d.id::text = cur_id;
  elsif cur_kind = 'whisper' then
    select jsonb_build_object('type', 'whisper', 'id', l.id, 'lng', l.lng, 'lat', l.lat,
             'metres', round(public.distance_m(pos.lng, pos.lat, l.lng, l.lat)),
             'endsAt', l.created_at + make_interval(mins => public.whisper_minutes()))
      into item from public.player_leads l where l.id::text = cur_id;
  end if;
  return jsonb_build_object('now', now(), 'current', item, 'hunt', hunting);
end;
$$;

create or replace function public.cruise_drops_near()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'lng', d.lng, 'lat', d.lat)), '[]'::jsonb)
    from public.player_positions p
    join public.cruise_drops d on d.taken_at is null and d.expires_at > now()
     and d.lat between p.lat - 0.002 and p.lat + 0.002 and d.lng between p.lng - 0.002 and p.lng + 0.002
     and public.distance_m(p.lng, p.lat, d.lng, d.lat) <= 150
   where p.user_id = auth.uid();
$$;
