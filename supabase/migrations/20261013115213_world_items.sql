-- Free-roam world (design doc sections 7 and 9): coin drops, intel scrolls and
-- relics placed on real roads. The server decides what exists and where, and
-- confirms every pickup.

-- The world is split into squares of 0.005 degrees (about 550 m), stocked when
-- a player first comes near and restocked every 6 hours.
create table public.world_cells (
  cell       text primary key, -- "x:y" = floor(lng / 0.005) : floor(lat / 0.005)
  spawned_at timestamptz not null,
  decoy_lng  double precision, -- an empty spot that decoy intel can point to
  decoy_lat  double precision
);

create table public.world_items (
  id         uuid primary key default gen_random_uuid(),
  cell       text not null references public.world_cells (cell) on delete cascade,
  kind       text not null check (kind in ('coins', 'cache', 'intel', 'relic')),
  relic      text check (relic in ('rain_charm', 'shield', 'radar', 'fast_pass', 'second_wind', 'jerry_can')),
  coins      integer not null default 0 check (coins >= 0),
  -- Caches and relics stay hidden until intel points to them or a player is very close.
  hidden     boolean not null default false,
  lng        double precision not null check (lng between -180 and 180),
  lat        double precision not null check (lat between -90 and 90),
  expires_at timestamptz not null,
  taken_by   uuid references public.profiles (id) on delete set null,
  taken_at   timestamptz,
  check ((kind = 'relic') = (relic is not null))
);

create index world_items_cell_idx on public.world_items (cell) where taken_by is null;

create table public.player_relics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  relic       text not null check (relic in ('rain_charm', 'shield', 'radar', 'fast_pass', 'second_wind', 'jerry_can')),
  charges     integer not null check (charges >= 0),
  expires_at  timestamptz not null,
  acquired_at timestamptz not null default now()
);

create index player_relics_user_idx on public.player_relics (user_id);

-- Where a player's intel scrolls point. Whether a lead is a decoy is never sent to the player.
create table public.player_leads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_id     uuid references public.world_items (id) on delete set null,
  is_decoy    boolean not null,
  lng         double precision not null,
  lat         double precision not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index player_leads_open_idx on public.player_leads (user_id) where resolved_at is null;

-- Row level security. World tables are only reached through the functions
-- below (or server code with the secret key), so hidden finds stay hidden.
alter table public.world_cells enable row level security;
alter table public.world_items enable row level security;
alter table public.player_relics enable row level security;
alter table public.player_leads enable row level security;

revoke all on public.world_cells, public.world_items from anon, authenticated;

create policy "Players read their own relics"
  on public.player_relics for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.player_relics from anon, authenticated;

create policy "Players read their own leads"
  on public.player_leads for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.player_leads from anon, authenticated;
grant select (id, lng, lat, created_at, resolved_at) on public.player_leads to authenticated;

-- ---------------------------------------------------------------------------
create function public.distance_m(lng1 double precision, lat1 double precision, lng2 double precision, lat2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

create function public.cell_of(lng double precision, lat double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  select floor(lng / 0.005)::bigint || ':' || floor(lat / 0.005)::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Server only: claim the right to (re)stock a square. True for exactly one
-- caller per 6 hours, so two players arriving together don't double-stock it.
create function public.claim_cell(p_cell text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.world_cells (cell, spawned_at) values (p_cell, now())
  on conflict (cell) do update set spawned_at = now()
    where public.world_cells.spawned_at < now() - interval '6 hours';
  return found;
end;
$$;

revoke execute on function public.claim_cell(text) from public, anon, authenticated;
grant execute on function public.claim_cell(text) to service_role;

-- ---------------------------------------------------------------------------
-- What a player can see around their saved position: items within 800 m
-- (hidden ones only if very close or an intel lead points to them), their open
-- leads, and which nearby squares need stocking. Uses the server's record of
-- where the player is, so nobody can probe far-away spots for hidden finds.
create function public.world_nearby()
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
         and public.distance_m(here_lng, here_lat, w.lng, w.lat) < 800
         and (not w.hidden
              or public.distance_m(here_lng, here_lat, w.lng, w.lat) < 40
              or exists (select 1 from public.player_leads l
                          where l.user_id = uid and l.item_id = w.id and l.resolved_at is null))
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

revoke execute on function public.world_nearby() from public, anon;
grant execute on function public.world_nearby() to authenticated;

-- ---------------------------------------------------------------------------
-- Pick up an item. Saves the player's position first (same anti-teleport
-- check), then requires them to be within 30 m. Each item can be taken once.
create function public.pickup_item(p_item uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pos jsonb;
  item public.world_items%rowtype;
  target_id uuid;
  lead_lng double precision;
  lead_lat double precision;
  decoy boolean;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position', 'lng', pos -> 'lng', 'lat', pos -> 'lat');
  end if;

  select * into item from public.world_items where id = p_item for update;
  if not found or item.taken_by is not null or item.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if public.distance_m(p_lng, p_lat, item.lng, item.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;

  update public.world_items set taken_by = uid, taken_at = now() where id = p_item;

  if item.kind in ('coins', 'cache') then
    balance := public.apply_coin_change(
      uid, item.coins, 'earn',
      case item.kind when 'cache' then 'Found a coin cache' else 'Picked up coins' end,
      'item:' || p_item
    );
    return jsonb_build_object('ok', true, 'kind', item.kind, 'coins', item.coins, 'balance', balance);
  end if;

  if item.kind = 'relic' then
    insert into public.player_relics (user_id, relic, charges, expires_at)
    values (uid, item.relic, case item.relic when 'rain_charm' then 2 else 1 end, now() + interval '7 days');
    return jsonb_build_object('ok', true, 'kind', 'relic', 'relic', item.relic);
  end if;

  -- Intel: 3 in 4 point to a real hidden find within 3 km; the rest are decoys.
  decoy := random() < 0.25;
  if not decoy then
    select w.id, w.lng, w.lat into target_id, lead_lng, lead_lat
      from public.world_items w
     where w.hidden and w.taken_by is null and w.expires_at > now()
       and public.distance_m(p_lng, p_lat, w.lng, w.lat) < 3000
       and not exists (select 1 from public.player_leads l where l.user_id = uid and l.item_id = w.id)
     order by random() limit 1;
    decoy := target_id is null;
  end if;
  if decoy then
    select c.decoy_lng, c.decoy_lat into lead_lng, lead_lat
      from public.world_cells c
     where c.decoy_lng is not null and public.distance_m(p_lng, p_lat, c.decoy_lng, c.decoy_lat) < 3000
     order by random() limit 1;
    if lead_lng is null then
      return jsonb_build_object('ok', true, 'kind', 'intel', 'lead', null);
    end if;
  end if;

  insert into public.player_leads (user_id, item_id, is_decoy, lng, lat)
  values (uid, case when decoy then null else target_id end, decoy, lead_lng, lead_lat);
  return jsonb_build_object('ok', true, 'kind', 'intel', 'lead', jsonb_build_object('lng', lead_lng, 'lat', lead_lat));
end;
$$;

revoke execute on function public.pickup_item(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.pickup_item(uuid, double precision, double precision, text) to authenticated;
