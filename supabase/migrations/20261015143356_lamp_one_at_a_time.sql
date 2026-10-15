-- The lamp holds one thing at a time (owner's call, 15 Oct 2026): the Orb when it
-- has surfaced, otherwise the area's Detour that ends soonest, otherwise a whisper.
-- It stays until it's done (claimed, tried, all claimed, over, or let go), then the
-- next one comes. Whispers now fade after 45 minutes (old leads piled up before).

alter table public.player_lamp add column if not exists current_kind text check (current_kind in ('orb', 'detour', 'whisper'));
alter table public.player_lamp add column if not exists current_id text;

-- Things a player let go of.
create table if not exists public.lamp_dismissed (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  item         text not null, -- 'orb:<id>' or 'detour:<id>'
  dismissed_at timestamptz not null default now(),
  primary key (user_id, item)
);
alter table public.lamp_dismissed enable row level security;

create or replace function public.whisper_minutes() returns integer language sql immutable set search_path = '' as $$ select 45 $$;

-- Is this still waiting for the player?
create or replace function public.lamp_item_open(p_user uuid, p_kind text, p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'orb' then exists (
      select 1 from public.world_items w
       where w.id::text = p_id and w.taken_by is null and w.expires_at > now()
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = p_user and x.item = 'orb:' || p_id))
    when 'detour' then exists (
      select 1 from public.detours d
       where d.id::text = p_id and d.ends_at > now()
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = p_user and x.item = 'detour:' || p_id)
         and (exists (select 1 from public.detour_claims c where c.detour_id = d.id and c.user_id = p_user and c.outcome = 'asked')
              or (not exists (select 1 from public.detour_claims c where c.detour_id = d.id and c.user_id = p_user)
                  and (d.capacity is null or d.claimed < d.capacity))))
    when 'whisper' then exists (
      select 1 from public.player_leads l where l.id::text = p_id and l.user_id = p_user and l.resolved_at is null)
    else false
  end;
$$;

-- What's in the player's lamp: one thing, kept until it's done.
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
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('now', now(), 'current', null);
  end if;
  my_area := public.detour_area(pos.lng, pos.lat);

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

  if not public.lamp_item_open(uid, cur_kind, cur_id) then
    cur_kind := null;
    cur_id := null;
    -- The next thing: the Orb, then the area's Detours (soonest ending first), then a whisper.
    select 'orb', w.id::text into cur_kind, cur_id
      from public.world_items w
     where w.relic = 'lockdown_orb' and w.taken_by is null and w.expires_at > now()
       and not exists (select 1 from public.lamp_dismissed x where x.user_id = uid and x.item = 'orb:' || w.id)
     limit 1;
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
             'endsAt', d.ends_at, 'capacity', d.capacity, 'claimed', d.claimed, 'coins', d.reward_coins, 'relic', d.reward_relic,
             'mine', (select c.outcome from public.detour_claims c where c.detour_id = d.id and c.user_id = uid))
      into item from public.detours d where d.id::text = cur_id;
  elsif cur_kind = 'whisper' then
    select jsonb_build_object('type', 'whisper', 'id', l.id, 'lng', l.lng, 'lat', l.lat,
             'metres', round(public.distance_m(pos.lng, pos.lat, l.lng, l.lat)),
             'endsAt', l.created_at + make_interval(mins => public.whisper_minutes()))
      into item from public.player_leads l where l.id::text = cur_id;
  end if;
  return jsonb_build_object('now', now(), 'current', item);
end;
$$;

-- Let the current thing go: the lamp moves on to the next.
create or replace function public.lamp_dismiss(p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind = 'whisper' then
    update public.player_leads set resolved_at = now() where id::text = p_id and user_id = uid and resolved_at is null;
  elsif p_kind in ('orb', 'detour') then
    insert into public.lamp_dismissed (user_id, item) values (uid, p_kind || ':' || p_id) on conflict do nothing;
  else
    return jsonb_build_object('ok', false);
  end if;
  update public.player_lamp set current_kind = null, current_id = null
   where user_id = uid and current_kind = p_kind and current_id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.lamp_item_open(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.lamp_dismiss(text, text) from public, anon;
grant execute on function public.lamp_dismiss(text, text) to authenticated;
