-- The idling law (owner, 12 Nov 2026: "if user knows, they want to be idle, they need to be at a relex joint. If a user
-- stays on the major road for 1hr+ either by standing or in any vehicle but not moving. The person should be locked in a
-- cell, and then their vehicle impounded"; chose: 30 min in the cell or bail; the vehicle back for a release fee, gone
-- after 7 days unpaid; time away from the game counts; an officer's warning at 45 min; everywhere, hunts and free roam).
-- The game tells the server when the player is on a main road (motorway, trunk, primary, secondary: note_main_road);
-- the server knows how long they've stood still (still_since, kept by a trigger as they move). At a chill spot (a place
-- to rest or eat within 80 m), on a trip, in hospital or fainted, or in a key's place or the Djinn's world: no law.
set lock_timeout = '8s';

alter table public.player_positions
  add column if not exists still_since timestamptz not null default now(),
  add column if not exists on_main_road boolean not null default false;
alter table public.player_vehicles add column if not exists impounded_at timestamptz;

-- Standing still since: reset whenever they've moved more than 15 m.
create or replace function public.keep_still_since()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if public.distance_m(old.lng, old.lat, new.lng, new.lat) > 15 then
    new.still_since := now();
  end if;
  return new;
end;
$$;
create trigger player_positions_still_since before update of lng, lat on public.player_positions
  for each row execute function public.keep_still_since();

create table public.idle_arrests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  lng double precision not null,
  lat double precision not null,
  still_minutes integer not null,
  until timestamptz not null,
  bail integer not null,
  bailed_at timestamptz,
  vehicle_id uuid references public.player_vehicles (id) on delete set null,
  vehicle_kind text,
  rental_ended boolean not null default false
);
create index idle_arrests_user on public.idle_arrests (user_id, until desc);
alter table public.idle_arrests enable row level security;

create or replace function public.idle_bail() returns integer language sql immutable set search_path to '' as $$ select 150 $$;
create or replace function public.impound_fee() returns integer language sql immutable set search_path to '' as $$ select 200 $$;

-- The game: on a main road now, or not.
create or replace function public.note_main_road(p_on boolean)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.player_positions set on_main_road = coalesce(p_on, false)
   where user_id = auth.uid() and on_main_road is distinct from coalesce(p_on, false);
$$;

/** In the cell now (not bailed out, not served). */
create or replace function public.jailed(p_user uuid)
returns public.idle_arrests
language sql
stable
security definer
set search_path to ''
as $$
  select * from public.idle_arrests where user_id = p_user and until > now() and bailed_at is null order by until desc limit 1
$$;

-- Where the law doesn't reach: a chill spot, a trip, the hospital, fainted, a key's place or the Djinn's world.
create or replace function public.idle_exempt(p public.player_positions)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p.fainted_at is not null
      or exists (select 1 from public.transit_trips t where t.user_id = p.user_id and t.ended_at is null)
      or exists (select 1 from public.hospital_visits h where h.user_id = p.user_id and h.left_at is null)
      or exists (select 1 from public.places pl
                  where pl.kind in ('rest', 'eat') and pl.lat between p.lat - 0.002 and p.lat + 0.002 and pl.lng between p.lng - 0.002 and p.lng + 0.002
                    and public.distance_m(p.lng, p.lat, coalesce(pl.street_lng, pl.lng), coalesce(pl.street_lat, pl.lat)) <= 80)
      or exists (select 1 from public.hunt_players hp join public.hunt_keys k on k.hunt_id = hp.hunt_id and k.n = hp.keys_held + 1
                  where hp.user_id = p.user_id and hp.finished_at is null and k.house is not null
                    and public.distance_m(p.lng, p.lat, k.spot_lng, k.spot_lat) <= 300)
      or exists (select 1 from public.djinn_worlds dw join public.djinn_sites s on s.id = dw.site_id join public.djinn_wagers w on w.id = dw.wager_id
                  where dw.user_id = p.user_id and w.ends_at > now() and public.distance_m(p.lng, p.lat, s.lng, s.lat) <= 320)
$$;

/** The vehicles in the pound (not yet gone: 7 days). */
create or replace function public.impounded_list(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'since', v.impounded_at,
           'goneAt', v.impounded_at + interval '7 days', 'fee', public.impound_fee()) order by v.impounded_at), '[]'::jsonb)
    from public.player_vehicles v
   where v.user_id = p_user and v.impounded_at is not null and v.impounded_at > now() - interval '7 days'
$$;

-- The law, asked by the game (on opening, and every minute): fine, a warning (45 min still on a main road), or the cell
-- (an hour: locked up 30 min, the vehicle in use impounded, a rental ended). Also what's in the pound.
create or replace function public.idle_law()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  p public.player_positions%rowtype;
  a public.idle_arrests%rowtype;
  mins double precision;
  v public.player_vehicles%rowtype;
  rented text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  a := public.jailed(uid);
  if a.id is not null then
    return jsonb_build_object('state', 'jailed', 'until', a.until, 'bail', a.bail, 'now', now(), 'vehicle', a.vehicle_kind,
      'rentalEnded', a.rental_ended, 'impounded', public.impounded_list(uid));
  end if;
  select * into p from public.player_positions where user_id = uid for update;
  if p.user_id is null then
    return jsonb_build_object('state', 'ok', 'impounded', public.impounded_list(uid));
  end if;
  mins := extract(epoch from now() - p.still_since) / 60;
  if not p.on_main_road or mins < 45 or public.idle_exempt(p) then
    return jsonb_build_object('state', 'ok', 'impounded', public.impounded_list(uid));
  end if;
  if mins < 60 then
    return jsonb_build_object('state', 'warn', 'minutes', floor(mins), 'left', ceil(60 - mins), 'impounded', public.impounded_list(uid));
  end if;

  -- An hour or more: locked up, the vehicle impounded (a rental goes back to its renter, paid up)
  select * into v from public.player_vehicles where user_id = uid and in_use for update;
  if v.id is not null then
    update public.player_vehicles set in_use = false, impounded_at = now() where id = v.id;
  end if;
  select kind into rented from public.vehicle_rentals where user_id = uid and ended_at is null;
  if rented is not null then
    perform public.settle_rental(uid);
  end if;
  insert into public.idle_arrests (user_id, lng, lat, still_minutes, until, bail, vehicle_id, vehicle_kind, rental_ended)
  values (uid, p.lng, p.lat, floor(mins), now() + interval '30 minutes', public.idle_bail(), v.id, v.kind, rented is not null)
  returning * into a;
  -- On foot when they come out; the clock starts again then
  update public.player_positions set mode = 'walk', resting_since = null, still_since = a.until where user_id = uid;
  return jsonb_build_object('state', 'jailed', 'arrested', true, 'until', a.until, 'bail', a.bail, 'now', now(), 'minutes', floor(mins),
    'vehicle', a.vehicle_kind, 'rentalEnded', a.rental_ended, 'impounded', public.impounded_list(uid));
end;
$$;

-- Bail: out at once, for the bail.
create or replace function public.pay_bail()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  a public.idle_arrests%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  a := public.jailed(uid);
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'free');
  end if;
  begin
    balance := public.apply_coin_change(uid, -a.bail, 'spend', 'Bail (idling on a main road)', 'bail:' || a.id);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'bail', a.bail);
  end;
  update public.idle_arrests set bailed_at = now() where id = a.id;
  update public.player_positions set still_since = now() where user_id = uid;
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

-- A vehicle out of the pound, for the fee: brought to where the player is (not while in the cell; not after 7 days).
create or replace function public.release_vehicle(p_vehicle uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  v public.player_vehicles%rowtype;
  p public.player_positions%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if (public.jailed(uid)).id is not null then
    return jsonb_build_object('ok', false, 'reason', 'jailed');
  end if;
  select * into v from public.player_vehicles where id = p_vehicle and user_id = uid for update;
  if v.id is null or v.impounded_at is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  if v.impounded_at <= now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  begin
    balance := public.apply_coin_change(uid, -public.impound_fee(), 'spend', 'Released a ' || v.kind || ' from the pound', 'impound:' || v.id || ':' || v.impounded_at);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'fee', public.impound_fee());
  end;
  select * into p from public.player_positions where user_id = uid;
  update public.player_vehicles set impounded_at = null, in_use = false, lng = coalesce(p.lng, lng), lat = coalesce(p.lat, lat) where id = v.id;
  return jsonb_build_object('ok', true, 'balance', balance, 'kind', v.kind);
end;
$$;

-- In the cell, nobody moves (as the Hourglass holds them).
do $$
declare
  f text := pg_get_functiondef('public.save_position(double precision, double precision, text)'::regprocedure);
  a text := '  if moved_m > allowed_m then';
begin
  if position(a in f) = 0 then
    raise exception 'save_position: not found';
  end if;
  execute replace(f, a, '  -- Locked in a cell (the idling law): no moving until it''s served or bailed.
  if moved_m > 10 and (public.jailed(uid)).id is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''jailed'', ''lng'', from_lng, ''lat'', from_lat, ''until'', (public.jailed(uid)).until);
  end if;

' || a);
end $$;

-- An impounded vehicle can't be taken out of the pocket; one gone (7 days unpaid) is no longer owned.
do $$
declare
  f text := pg_get_functiondef('public.start_vehicle(text, double precision, double precision, boolean)'::regprocedure);
  a text := '  select * into v from public.player_vehicles where user_id = uid and kind = p_kind;';
begin
  if position(a in f) = 0 then
    raise exception 'start_vehicle: not found';
  end if;
  execute replace(f, a, a || '
  -- In the pound (the idling law): released for the fee first; after 7 days it''s gone.
  if v.id is not null and v.impounded_at is not null then
    if p_rent then
      v := null;
    elsif v.impounded_at > now() - interval ''7 days'' then
      return jsonb_build_object(''ok'', false, ''reason'', ''impounded'', ''id'', v.id, ''fee'', public.impound_fee());
    else
      return jsonb_build_object(''ok'', false, ''reason'', ''impound_gone'');
    end if;
  end if;');
end $$;

-- Buying one of a kind that went from the pound: it's a new one.
create or replace function public.buy_vehicle(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  at_lng double precision;
  at_lat double precision;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind not in ('bicycle', 'motorbike', 'car') then
    raise exception 'Unknown vehicle';
  end if;
  if exists (select 1 from public.player_vehicles where user_id = uid and kind = p_kind
              and (impounded_at is null or impounded_at > now() - interval '7 days')) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  select lng, lat into at_lng, at_lat from public.player_positions where user_id = uid;
  if not found then
    select home_lng, home_lat into at_lng, at_lat from public.profiles where id = uid;
  end if;
  begin
    balance := public.apply_coin_change(uid, -public.vehicle_price(p_kind), 'spend', 'Bought a ' || p_kind, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end;
  -- (the one lost to the pound becomes the new one)
  update public.player_vehicles
     set impounded_at = null, in_use = false, lng = at_lng, lat = at_lat, bought_at = now(),
         fuel = default, tyre = default, engine = default, broken_at = null, repair_ready_at = null, light = default,
         helmet = default, registered = default, insured = default, stranded_at = null, jack = default, flat_fix_how = null,
         flat_fix_ready_at = null, flat_wheel = null, flat_helper = null, recovery_ready_at = null
   where user_id = uid and kind = p_kind and impounded_at <= now() - interval '7 days';
  if not found then
    insert into public.player_vehicles (user_id, kind, lng, lat) values (uid, p_kind, at_lng, at_lat);
  end if;
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

revoke execute on function public.note_main_road(boolean), public.idle_law(), public.pay_bail(), public.release_vehicle(uuid) from public, anon;
grant execute on function public.note_main_road(boolean), public.idle_law(), public.pay_bail(), public.release_vehicle(uuid) to authenticated, service_role;
revoke execute on function public.jailed(uuid), public.idle_exempt(public.player_positions), public.impounded_list(uuid), public.keep_still_since(),
  public.idle_bail(), public.impound_fee() from public, anon, authenticated;
grant execute on function public.jailed(uuid), public.idle_exempt(public.player_positions), public.impounded_list(uuid),
  public.idle_bail(), public.impound_fee() to service_role;
