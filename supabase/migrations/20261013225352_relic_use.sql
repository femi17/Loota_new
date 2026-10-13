-- Using relics (design doc 7): Second Wind, Jerry Can, Radar and Rain Charm are
-- used from the bag; a Shield works by itself, blocking the next effect that
-- would slow its owner. Fast Pass waits for buses and planes.
--
-- Fairness (7.2): effects cover an area, never one person; nobody is slowed by
-- more than 2 effects an hour; effects never apply within 500 m of a key spot
-- in a live hunt.

-- Area effects anyone in range can see (weather is public).
create table public.world_effects (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('rain')),
  lng        double precision not null check (lng between -180 and 180),
  lat        double precision not null check (lat between -90 and 90),
  radius_m   integer not null check (radius_m between 100 and 50000),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null
);
create index world_effects_active on public.world_effects (ends_at);

-- What each effect did to each player (decided once, so it can't be re-rolled).
create table public.player_effect_hits (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  effect_id uuid not null references public.world_effects (id) on delete cascade,
  outcome   text not null check (outcome in ('slowed', 'shielded', 'limit')),
  at        timestamptz not null default now(),
  primary key (user_id, effect_id)
);

-- Timed boosts from relics.
create table public.player_boosts (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  radar_until timestamptz
);

alter table public.world_effects enable row level security;
alter table public.player_effect_hits enable row level security;
alter table public.player_boosts enable row level security;
revoke all on public.world_effects, public.player_effect_hits, public.player_boosts from anon, authenticated;

-- Compass bearing in degrees (0 = north, clockwise) from one point to another.
create function public.bearing_deg(lng1 double precision, lat1 double precision, lng2 double precision, lat2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select mod(degrees(atan2((lng2 - lng1) * cos(radians(lat1)), lat2 - lat1))::numeric + 360, 360)::double precision;
$$;

-- Is this point within 500 m of a key spot in a live hunt? (Effects never apply there.)
create function public.near_live_key(p_lng double precision, p_lat double precision)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hunt_keys k join public.hunts h on h.id = k.hunt_id
     where public.hunt_phase(h) = 'live' and public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat) < 500
  );
$$;

-- ---------------------------------------------------------------------------
-- Use a relic from the bag.
-- ---------------------------------------------------------------------------
create function public.use_relic(p_relic uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.player_relics%rowtype;
  pos public.player_positions%rowtype;
  fuel_now double precision;
  valid_until timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.player_relics where id = p_relic and user_id = uid for update;
  if not found or r.charges < 1 or r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  if r.relic = 'shield' then
    return jsonb_build_object('ok', false, 'reason', 'passive');
  elsif r.relic = 'fast_pass' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  elsif r.relic = 'jerry_can' then
    update public.player_vehicles set fuel = least(100, fuel + 30)
     where user_id = uid and in_use and kind <> 'bicycle'
     returning fuel into fuel_now;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
  elsif r.relic = 'radar' then
    valid_until := greatest(now(), coalesce((select radar_until from public.player_boosts where user_id = uid), now())) + interval '5 minutes';
    insert into public.player_boosts (user_id, radar_until) values (uid, valid_until)
    on conflict (user_id) do update set radar_until = excluded.radar_until;
  elsif r.relic = 'rain_charm' then
    select * into pos from public.player_positions where user_id = uid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'position');
    end if;
    valid_until := now() + interval '10 minutes';
    insert into public.world_effects (kind, lng, lat, radius_m, ends_at, created_by)
    values ('rain', pos.lng, pos.lat, 5000, valid_until, uid);
  end if;

  update public.player_relics set charges = charges - 1 where id = r.id;
  return jsonb_build_object('ok', true, 'relic', r.relic, 'energy', case when r.relic = 'second_wind' then 50 end,
    'fuel', fuel_now, 'until', valid_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- The effects over the player now, and what each does to them. Decided once per
-- player and effect: a Shield (used up) blocks it; past 2 slowing effects in
-- the last hour, it can't slow them; near a live key spot it doesn't apply.
-- ---------------------------------------------------------------------------
create function public.my_effects()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  e public.world_effects%rowtype;
  outcome text;
  shield uuid;
  result jsonb := '[]'::jsonb;
begin
  select * into pos from public.player_positions where user_id = uid;
  if not found then
    return result;
  end if;
  for e in
    select * from public.world_effects
     where ends_at > now() and public.distance_m(pos.lng, pos.lat, lng, lat) <= radius_m
     order by starts_at
  loop
    select h.outcome into outcome from public.player_effect_hits h where h.user_id = uid and h.effect_id = e.id;
    if outcome is null then
      if public.near_live_key(pos.lng, pos.lat) then
        outcome := 'exempt'; -- not recorded: it may apply once they leave the key area
      else
        select id into shield from public.player_relics
         where user_id = uid and relic = 'shield' and charges > 0 and expires_at > now()
         order by expires_at limit 1 for update;
        if shield is not null then
          update public.player_relics set charges = charges - 1 where id = shield;
          outcome := 'shielded';
        elsif (select count(*) from public.player_effect_hits h
                where h.user_id = uid and h.outcome = 'slowed' and h.at > now() - interval '1 hour') >= 2 then
          outcome := 'limit';
        else
          outcome := 'slowed';
        end if;
        insert into public.player_effect_hits (user_id, effect_id, outcome) values (uid, e.id, outcome);
      end if;
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', e.id, 'kind', e.kind, 'lng', e.lng, 'lat', e.lat, 'radiusM', e.radius_m,
      'endsAt', e.ends_at, 'outcome', outcome, 'mine', e.created_by = uid));
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Radar (while active): which way, and roughly how far, to the nearest relic
-- within 3 km, and, on a hunt's Final Approach, to the key spot. Only
-- directions and rounded distances are sent, never the places themselves.
-- ---------------------------------------------------------------------------
create function public.radar_ping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  valid_until timestamptz;
  pos public.player_positions%rowtype;
  relic record;
  spot record;
begin
  select radar_until into valid_until from public.player_boosts where user_id = uid;
  if valid_until is null or valid_until <= now() then
    return jsonb_build_object('active', false);
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if not found then
    return jsonb_build_object('active', true, 'until', valid_until);
  end if;

  select i.lng, i.lat, public.distance_m(pos.lng, pos.lat, i.lng, i.lat) as d into relic
    from public.world_items i
   where i.kind = 'relic' and i.taken_by is null and i.expires_at > now()
     and i.lng between pos.lng - 0.03 and pos.lng + 0.03 and i.lat between pos.lat - 0.03 and pos.lat + 0.03
   order by d limit 1;

  select k.spot_lng as lng, k.spot_lat as lat, public.distance_m(pos.lng, pos.lat, k.spot_lng, k.spot_lat) as d into spot
    from public.hunt_players p
    join public.hunts h on h.id = p.hunt_id
    join public.hunt_keys k on k.hunt_id = p.hunt_id and k.n = p.keys_held + 1
   where p.user_id = uid and p.finished_at is null and p.approach_key = k.n and public.hunt_phase(h) = 'live'
   limit 1;

  return jsonb_build_object('active', true, 'until', valid_until,
    'relic', case when relic.d is not null and relic.d <= 3000 then jsonb_build_object(
      'bearing', round(public.bearing_deg(pos.lng, pos.lat, relic.lng, relic.lat)), 'metres', round(relic.d / 10) * 10) end,
    'key', case when spot.d is not null then jsonb_build_object(
      'bearing', round(public.bearing_deg(pos.lng, pos.lat, spot.lng, spot.lat)), 'metres', round(spot.d / 10) * 10) end);
end;
$$;

revoke execute on function public.bearing_deg(double precision, double precision, double precision, double precision),
  public.near_live_key(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.use_relic(uuid), public.my_effects(), public.radar_ping() from public, anon;
grant execute on function public.use_relic(uuid), public.my_effects(), public.radar_ping() to authenticated;
