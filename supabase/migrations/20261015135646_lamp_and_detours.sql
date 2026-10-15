-- The Lamp and Detours (design doc 7.4 and 7.5, 15 Oct 2026).
--
-- Nothing hidden lies openly on the map any more: finds only show within 40 m
-- (stumbled upon) or once a lead points to them, and leads, Detours and the
-- Lockdown Orb reach the player through the lamp (lamp_state).
--
-- Detours: small offers everyone in the same area (a 0.1° square, about 11 km)
-- shares, so they race each other. Flash: gone after 20–40 minutes. Rush: only
-- the first N. Flash rush: both, with a better reward. At the place, a quick
-- question (make_question) before the reward.
--
-- Whispers: every 30 minutes or so, a player with no open lead gets one: a
-- hidden find within 3 km, or (1 in 4) a decoy. Intel scrolls no longer lie
-- on the map (world-spawn.ts stops placing them).

create table public.detours (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('flash', 'rush', 'flash_rush')),
  area         text not null,
  title        text not null,
  story        text not null,
  place_name   text not null,
  lng          double precision not null,
  lat          double precision not null,
  reward_coins integer not null default 0 check (reward_coins >= 0),
  reward_relic text check (reward_relic in ('rain_charm', 'shield', 'radar', 'fast_pass', 'second_wind', 'jerry_can')),
  capacity     integer check (capacity > 0),
  claimed      integer not null default 0,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null
);
create index detours_area_idx on public.detours (area, ends_at);
alter table public.detours enable row level security;

create table public.detour_claims (
  detour_id   uuid not null references public.detours (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  question    jsonb not null,
  deadline    timestamptz not null,
  outcome     text not null default 'asked' check (outcome in ('asked', 'won', 'wrong', 'late', 'full')),
  asked_at    timestamptz not null default now(),
  answered_at timestamptz,
  primary key (detour_id, user_id)
);
alter table public.detour_claims enable row level security;

-- When each player last got a whisper.
create table public.player_lamp (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  whisper_at timestamptz
);
alter table public.player_lamp enable row level security;

create or replace function public.detour_area(p_lng double precision, p_lat double precision) returns text
language sql immutable set search_path = '' as $$ select floor(p_lng / 0.1)::bigint || ':' || floor(p_lat / 0.1)::bigint $$;

-- A new Detour for an area, at a real place 0.5–4 km from where the player is.
create or replace function public.spawn_detour(p_area text, p_lng double precision, p_lat double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  spot public.places%rowtype;
  roll double precision := random();
  pick integer;
  d_kind text;
  d_title text;
  d_story text;
  d_coins integer := 0;
  d_relic text;
  d_capacity integer;
  d_minutes integer;
  flash_titles text[] := array['A merchant''s lost pouch', 'The fallen trinket', 'The tailor''s secret', 'A forgotten parcel'];
  flash_stories text[] := array[
    'A merchant''s mule kicked a pouch loose near %s. Street boys are already sniffing around: it won''t last.',
    'An old woman at %s swears something glowing fell off a danfo''s roof. Get there before the sweepers do.',
    'A tailor near %s sewed something strange into a coat hem and left it on the line. Quick, before the owner comes back.',
    'A dispatch rider dropped a parcel outside %s and rode off. Someone will pick it up soon.'];
  rush_titles text[] := array['Gold at the roadside', 'The drummer''s call', 'The generous madam'];
  rush_stories text[] := array[
    'A courier''s bag split open near %s. The first %s hunters to get there share what fell out.',
    'A drummer at %s will reward the first %s hunters who find him. After that, he packs up and goes.',
    'A rich madam at %s is celebrating, and the first %s hunters to greet her get a gift.'];
  flash_rush_titles text[] := array['The smugglers'' stash', 'The vanishing stall'];
  flash_rush_stories text[] := array[
    'Smugglers hid a stash near %s. The first %s hunters to crack its lock take a share, and the police are on their way.',
    'A stall near %s appears for only half an hour and serves only the first %s customers. Its goods are rare.'];
begin
  select * into spot from public.places
   where lat between p_lat - 0.04 and p_lat + 0.04 and lng between p_lng - 0.04 and p_lng + 0.04
     and public.distance_m(p_lng, p_lat, lng, lat) between 500 and 4000
   order by random() limit 1;
  if spot.id is null then
    return; -- no named places around here (yet)
  end if;

  if roll < 0.5 then
    d_kind := 'flash';
    d_minutes := 20 + floor(random() * 21)::integer;
    pick := 1 + floor(random() * array_length(flash_titles, 1))::integer;
    d_title := flash_titles[pick];
    d_story := format(flash_stories[pick], spot.name);
    if random() < 0.7 then d_coins := 30 + floor(random() * 51)::integer;
    else d_relic := (array['shield', 'second_wind', 'jerry_can'])[1 + floor(random() * 3)::integer]; end if;
  elsif roll < 0.8 then
    d_kind := 'rush';
    d_minutes := 60;
    d_capacity := 5 + floor(random() * 16)::integer;
    pick := 1 + floor(random() * array_length(rush_titles, 1))::integer;
    d_title := rush_titles[pick];
    d_story := format(rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_coins := 40 + floor(random() * 61)::integer;
    else d_relic := (array['shield', 'second_wind', 'jerry_can'])[1 + floor(random() * 3)::integer]; end if;
  else
    d_kind := 'flash_rush';
    d_minutes := 30;
    d_capacity := 3 + floor(random() * 6)::integer;
    pick := 1 + floor(random() * array_length(flash_rush_titles, 1))::integer;
    d_title := flash_rush_titles[pick];
    d_story := format(flash_rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_relic := (array['radar', 'fast_pass'])[1 + floor(random() * 2)::integer];
    else d_coins := 120 + floor(random() * 81)::integer; end if;
  end if;

  insert into public.detours (kind, area, title, story, place_name, lng, lat, reward_coins, reward_relic, capacity, ends_at)
  values (d_kind, p_area, d_title, d_story, spot.name, spot.lng, spot.lat, d_coins, d_relic, d_capacity,
          now() + make_interval(mins => d_minutes));
end;
$$;

-- A whisper: a lead to a hidden find within 3 km, or (1 in 4) to a decoy spot. Null if nothing is stocked nearby.
create or replace function public.whisper_lead(p_user uuid, p_lng double precision, p_lat double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  go_decoy boolean := random() < 0.25;
  target uuid;
  lead_lng double precision;
  lead_lat double precision;
  lead_id uuid;
begin
  if not go_decoy then
    select w.id, w.lng, w.lat into target, lead_lng, lead_lat
      from public.world_items w
     where w.hidden and w.taken_by is null and w.expires_at > now()
       and w.lat between p_lat - 0.03 and p_lat + 0.03 and w.lng between p_lng - 0.03 and p_lng + 0.03
       and public.distance_m(p_lng, p_lat, w.lng, w.lat) between 300 and 3000
       and not exists (select 1 from public.player_leads l where l.user_id = p_user and l.item_id = w.id)
     order by random() limit 1;
    go_decoy := target is null;
  end if;
  if go_decoy then
    select c.decoy_lng, c.decoy_lat into lead_lng, lead_lat
      from public.world_cells c
     where c.decoy_lng is not null
       and c.decoy_lat between p_lat - 0.03 and p_lat + 0.03 and c.decoy_lng between p_lng - 0.03 and p_lng + 0.03
       and public.distance_m(p_lng, p_lat, c.decoy_lng, c.decoy_lat) between 300 and 3000
     order by random() limit 1;
    if lead_lng is null then
      return null;
    end if;
  end if;
  insert into public.player_leads (user_id, item_id, is_decoy, lng, lat)
  values (p_user, case when go_decoy then null else target end, go_decoy, lead_lng, lead_lat)
  returning id into lead_id;
  return lead_id;
end;
$$;

-- What's in the player's lamp: the area's Detours (spawning new ones as old ones end),
-- their whispers (leads), and the Lockdown Orb if it's lying somewhere in the world.
create or replace function public.lamp_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  my_area text;
  active integer;
  latest timestamptz;
  whispered timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('detours', '[]'::jsonb, 'whispers', '[]'::jsonb, 'orb', null, 'now', now());
  end if;
  my_area := public.detour_area(pos.lng, pos.lat);

  -- Keep two Detours going in the area, a new one at most every 8 minutes.
  perform pg_advisory_xact_lock(hashtext('detours:' || my_area));
  select count(*) filter (where ends_at > now()), max(starts_at) into active, latest from public.detours where area = my_area;
  if active < 2 and (latest is null or latest < now() - interval '8 minutes') then
    perform public.spawn_detour(my_area, pos.lng, pos.lat);
  end if;

  -- A whisper every 30 minutes, when the player has no open lead.
  select whisper_at into whispered from public.player_lamp where user_id = uid;
  if (whispered is null or whispered < now() - interval '30 minutes')
     and not exists (select 1 from public.player_leads where user_id = uid and resolved_at is null)
     and public.whisper_lead(uid, pos.lng, pos.lat) is not null then
    insert into public.player_lamp (user_id, whisper_at) values (uid, now())
    on conflict (user_id) do update set whisper_at = excluded.whisper_at;
  end if;

  return jsonb_build_object(
    'now', now(),
    'detours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'title', d.title, 'story', d.story, 'place', d.place_name,
        'lng', d.lng, 'lat', d.lat, 'metres', round(public.distance_m(pos.lng, pos.lat, d.lng, d.lat)),
        'endsAt', d.ends_at, 'capacity', d.capacity, 'claimed', d.claimed,
        'coins', d.reward_coins, 'relic', d.reward_relic,
        'mine', (select c.outcome from public.detour_claims c where c.detour_id = d.id and c.user_id = uid))
        order by d.ends_at)
        from public.detours d where d.area = my_area and d.ends_at > now()), '[]'::jsonb),
    'whispers', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'lng', l.lng, 'lat', l.lat,
        'metres', round(public.distance_m(pos.lng, pos.lat, l.lng, l.lat)), 'since', l.created_at) order by l.created_at)
        from public.player_leads l where l.user_id = uid and l.resolved_at is null), '[]'::jsonb),
    'orb', (
      select jsonb_build_object('lng', w.lng, 'lat', w.lat, 'metres', round(public.distance_m(pos.lng, pos.lat, w.lng, w.lat)), 'endsAt', w.expires_at)
        from public.world_items w
       where w.relic = 'lockdown_orb' and w.taken_by is null and w.expires_at > now()
       limit 1));
end;
$$;

-- At a Detour's place: a quick question (30 seconds) before the reward.
create or replace function public.start_detour(p_detour uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.detours%rowtype;
  pos public.player_positions%rowtype;
  q jsonb;
  claim public.detour_claims%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into d from public.detours where id = p_detour;
  if d.id is null or d.ends_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'over');
  end if;
  if d.capacity is not null and d.claimed >= d.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, d.lng, d.lat) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if exists (select 1 from public.detour_claims where detour_id = d.id and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'tried');
  end if;
  q := public.make_question((array['maths', 'sequences', 'general', 'nigeria'])[1 + floor(random() * 4)::integer], 1 + floor(random() * 2)::integer) - 'bank_id';
  insert into public.detour_claims (detour_id, user_id, question, deadline)
  values (d.id, uid, q, now() + interval '30 seconds')
  returning * into claim;
  return jsonb_build_object('ok', true, 'title', d.title, 'question', q ->> 'prompt', 'options', q -> 'choices',
    'seconds', 30, 'deadline', claim.deadline, 'now', now());
end;
$$;

create or replace function public.answer_detour(p_detour uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  claim public.detour_claims%rowtype;
  d public.detours%rowtype;
  right_answer integer;
  result text;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into claim from public.detour_claims where detour_id = p_detour and user_id = uid and outcome = 'asked' for update;
  if claim.detour_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into d from public.detours where id = p_detour for update;
  right_answer := (claim.question ->> 'answer')::integer;
  if p_choice <> right_answer then
    result := 'wrong';
  elsif now() > claim.deadline + interval '3 seconds' then
    result := 'late';
  elsif d.capacity is not null and d.claimed >= d.capacity then
    result := 'full';
  else
    result := 'won';
    update public.detours set claimed = claimed + 1 where id = d.id;
    if d.reward_coins > 0 then
      balance := public.apply_coin_change(uid, d.reward_coins, 'earn', 'Detour: ' || d.title, 'detour:' || d.id);
    end if;
    if d.reward_relic is not null then
      insert into public.player_relics (user_id, relic, charges, expires_at)
      values (uid, d.reward_relic, case d.reward_relic when 'rain_charm' then 2 else 1 end, now() + interval '7 days');
    end if;
  end if;
  update public.detour_claims set outcome = result, answered_at = now() where detour_id = p_detour and user_id = uid;
  return jsonb_build_object('ok', true, 'outcome', result, 'answer', claim.question -> 'choices' ->> right_answer,
    'coins', case when result = 'won' then d.reward_coins else 0 end,
    'relic', case when result = 'won' then d.reward_relic end, 'balance', balance);
end;
$$;

-- Finds no longer lie openly on the map: only within 40 m, or where a lead points.
create or replace function public.world_nearby()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  here_lng double precision;
  here_lat double precision;
  cx bigint;
  cy bigint;
  decoys integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select lng, lat into here_lng, here_lat from public.player_positions where user_id = uid;
  if not found then
    select home_lng, home_lat into here_lng, here_lat from public.profiles where id = uid;
  end if;
  if here_lng is null then
    raise exception 'Set your home first';
  end if;
  cx := floor(here_lng / 0.005);
  cy := floor(here_lat / 0.005);

  -- Arriving at a decoy lead: there's nothing here.
  with done as (
    update public.player_leads set resolved_at = now()
     where user_id = uid and resolved_at is null and is_decoy
       and public.distance_m(here_lng, here_lat, lng, lat) < 30
    returning 1
  )
  select count(*) into decoys from done;

  -- Leads to finds that are gone are closed too.
  update public.player_leads l set resolved_at = now()
   from public.world_items w
   where l.user_id = uid and l.resolved_at is null and l.item_id = w.id
     and (w.taken_by is not null or w.expires_at < now());

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'relic', w.relic, 'lng', w.lng, 'lat', w.lat))
        from public.world_items w
       where w.taken_by is null and w.expires_at > now()
         and w.cell in (
           select (cx + dx) || ':' || (cy + dy) from generate_series(-2, 2) dx, generate_series(-2, 2) dy
         )
         and (public.distance_m(here_lng, here_lat, w.lng, w.lat) < 40
              or exists (select 1 from public.player_leads l
                          where l.user_id = uid and l.item_id = w.id and l.resolved_at is null
                            and public.distance_m(here_lng, here_lat, w.lng, w.lat) < 150))
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'lng', l.lng, 'lat', l.lat))
        from public.player_leads l where l.user_id = uid and l.resolved_at is null
    ), '[]'::jsonb),
    'decoysFound', decoys,
    'staleCells', coalesce((
      select jsonb_agg(c.cell order by abs(c.dx) + abs(c.dy))
        from (select (cx + dx) || ':' || (cy + dy) as cell, dx, dy
                from generate_series(-1, 1) dx, generate_series(-1, 1) dy) c
       where not exists (select 1 from public.world_cells wc
                          where wc.cell = c.cell and wc.spawned_at > now() - interval '6 hours')
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.spawn_detour(text, double precision, double precision), public.whisper_lead(uuid, double precision, double precision)
  from public, anon, authenticated;
revoke execute on function public.lamp_state(), public.start_detour(uuid), public.answer_detour(uuid, integer) from public, anon;
grant execute on function public.lamp_state(), public.start_detour(uuid), public.answer_detour(uuid, integer) to authenticated;
