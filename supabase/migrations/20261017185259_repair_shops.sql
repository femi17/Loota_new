-- Repair shops (owner, 17 Oct 2026): a broken-down vehicle (a bicycle damaged in a collapse, a motorbike or car
-- that broke down) is taken to a repair shop near the player: a bicycle repairer, or a mechanic's workshop for a
-- motorbike or car, at a random spot 250 m–1.2 km away (on the map's own places, so it's by a road). Inside, the
-- keeper asks what's wrong, names the price and the wait; agreed, the player pays and waits (or walks off and
-- it's done anyway). The mechanic called out to the player now costs more than walking in.
--   Bicycle: 40 coins, 2 minutes. Motorbike: 120, 3 minutes. Car: 200, 4 minutes.
--   Call-out (comes to you, 45 seconds): 60 for a bicycle, 150 for a motorbike or car.

create or replace function public.call_out_price(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 60 else 150 end;
$$;
create or replace function public.repair_price(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 40 when 'motorbike' then 120 else 200 end;
$$;
create or replace function public.repair_wait_s(p_kind text) returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'bicycle' then 120 when 'motorbike' then 180 else 240 end;
$$;

create table public.repair_jobs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('bicycle', 'motorbike', 'car')),
  shop       text not null,
  keeper     text not null,
  lng        double precision not null,
  lat        double precision not null,
  price      integer not null,
  wait_s     integer not null,
  created_at timestamptz not null default now(),
  agreed_at  timestamptz,
  ready_at   timestamptz,
  closed_at  timestamptz  -- collected, or the vehicle was fixed some other way
);
create unique index repair_jobs_open on public.repair_jobs (user_id, kind) where closed_at is null;
alter table public.repair_jobs enable row level security;

create or replace function public.repair_job_json(j public.repair_jobs) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', j.id, 'kind', j.kind, 'shop', j.shop, 'keeper', j.keeper, 'lng', j.lng, 'lat', j.lat,
    'price', j.price, 'waitS', j.wait_s, 'agreedAt', j.agreed_at, 'readyAt', j.ready_at, 'now', now());
$$;

-- Jobs whose vehicle isn't broken any more (fixed by a call-out, a service, or taken out once ready) are done.
create or replace function public.close_done_repairs(p_uid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.repair_jobs j set closed_at = now()
   where j.user_id = p_uid and j.closed_at is null
     and not exists (select 1 from public.player_vehicles v where v.user_id = p_uid and v.kind = j.kind and v.broken_at is not null);
$$;

-- The repair shop for a broken-down vehicle: the one already found, or a new one near the player.
create or replace function public.repair_shop(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  j public.repair_jobs%rowtype;
  spot_lng double precision;
  spot_lat double precision;
  bearing double precision := random() * 2 * pi();
  pick integer;
  bike_shops text[] := array['Mama Bisi''s Bicycle Repairs', 'Chinedu the Bike Doctor', 'Alhaji Musa Cycles', 'Iya Femi Bicycle Clinic', 'Baba Kunle Fix-Am', 'Sunday Cycle Works'];
  bike_keepers text[] := array['Mama Bisi', 'Chinedu', 'Alhaji Musa', 'Iya Femi', 'Baba Kunle', 'Sunday'];
  motor_shops text[] := array['Emeka Auto Works', 'Baba Sule Motor Mechanic', 'Oga Tunde''s Workshop', 'Ifeanyi Motors', 'Aunty Ngozi Auto Clinic'];
  motor_keepers text[] := array['Emeka', 'Baba Sule', 'Oga Tunde', 'Ifeanyi', 'Aunty Ngozi'];
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from public.player_vehicles where user_id = uid and kind = p_kind and broken_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'not_broken');
  end if;
  perform public.close_done_repairs(uid);
  select * into j from public.repair_jobs where user_id = uid and kind = p_kind and closed_at is null;
  if j.id is not null then
    return jsonb_build_object('ok', true, 'job', public.repair_job_json(j));
  end if;

  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  -- Somewhere real nearby (the map's places stand by roads), else a spot 500 m off.
  select p.lng, p.lat into spot_lng, spot_lat from public.places p
   where p.lat between pos.lat - 0.012 and pos.lat + 0.012 and p.lng between pos.lng - 0.012 and pos.lng + 0.012
     and public.distance_m(pos.lng, pos.lat, p.lng, p.lat) between 250 and 1200
   order by random() limit 1;
  if spot_lng is null then
    spot_lat := pos.lat + 500 * cos(bearing) / 110574;
    spot_lng := pos.lng + 500 * sin(bearing) / (111320 * cos(radians(pos.lat)));
  end if;
  if p_kind = 'bicycle' then
    pick := 1 + floor(random() * array_length(bike_shops, 1))::integer;
    insert into public.repair_jobs (user_id, kind, shop, keeper, lng, lat, price, wait_s)
    values (uid, p_kind, bike_shops[pick], bike_keepers[pick], spot_lng, spot_lat, public.repair_price(p_kind), public.repair_wait_s(p_kind))
    returning * into j;
  else
    pick := 1 + floor(random() * array_length(motor_shops, 1))::integer;
    insert into public.repair_jobs (user_id, kind, shop, keeper, lng, lat, price, wait_s)
    values (uid, p_kind, motor_shops[pick], motor_keepers[pick], spot_lng, spot_lat, public.repair_price(p_kind), public.repair_wait_s(p_kind))
    returning * into j;
  end if;
  return jsonb_build_object('ok', true, 'job', public.repair_job_json(j));
end;
$$;

-- The player's repair jobs still open.
create or replace function public.my_repairs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  perform public.close_done_repairs(uid);
  return coalesce((select jsonb_agg(public.repair_job_json(j) order by j.id) from public.repair_jobs j
                    where j.user_id = uid and j.closed_at is null), '[]'::jsonb);
end;
$$;

-- "That's OK": at the shop, pay, and the repair starts (the vehicle is ready at ready_at, collected or not).
create or replace function public.repair_agree(p_job bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  j public.repair_jobs%rowtype;
  pos public.player_positions%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into j from public.repair_jobs where id = p_job and user_id = uid and closed_at is null for update;
  if j.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if j.agreed_at is not null then
    return jsonb_build_object('ok', true, 'job', public.repair_job_json(j));
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, j.lng, j.lat) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  begin
    balance := public.apply_coin_change(uid, -j.price, 'spend', 'Repair at ' || j.shop, null);
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', j.price);
  end;
  update public.repair_jobs set agreed_at = now(), ready_at = now() + make_interval(secs => wait_s) where id = j.id returning * into j;
  -- The vehicle is being repaired (a call-out can't be booked on top); taking it out after ready_at finishes it.
  update public.player_vehicles set repair_ready_at = j.ready_at where user_id = uid and kind = j.kind and broken_at is not null;
  return jsonb_build_object('ok', true, 'job', public.repair_job_json(j), 'balance', balance);
end;
$$;

-- "Thank you": the repaired vehicle goes back into the pocket, as good as new.
create or replace function public.repair_collect(p_job bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  j public.repair_jobs%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into j from public.repair_jobs where id = p_job and user_id = uid and closed_at is null for update;
  if j.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if j.ready_at is null or now() < j.ready_at - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'not_ready', 'job', public.repair_job_json(j));
  end if;
  update public.player_vehicles
     set broken_at = null, repair_ready_at = null,
         tyre = case when kind = 'bicycle' then 100 else tyre end,
         engine = case when kind = 'bicycle' then engine else greatest(engine, 60) end
   where user_id = uid and kind = j.kind;
  update public.repair_jobs set closed_at = now() where id = j.id;
  return jsonb_build_object('ok', true, 'kind', j.kind);
end;
$$;

revoke execute on function public.repair_job_json(public.repair_jobs), public.close_done_repairs(uuid) from public, anon, authenticated;
revoke execute on function public.repair_shop(text), public.my_repairs(), public.repair_agree(bigint), public.repair_collect(bigint) from public, anon;
grant execute on function public.repair_shop(text), public.my_repairs(), public.repair_agree(bigint), public.repair_collect(bigint) to authenticated;
