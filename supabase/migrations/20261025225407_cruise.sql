-- Cruise (owner, 25 Oct 2026: "a cruise button… users can collect tokens to fill it up… it allows users to move without
-- pressing the keys… it can only go straight, users will need to monitor it"; chose: beside Sprint; tokens from the
-- streets, travellers' gifts, buying, and a free daily top-up; 15 s a token, up to 8 held). The game spends a token
-- every 15 s of cruising (use_cruise_token); the server keeps the count.

alter table public.profiles
  add column if not exists cruise_tokens integer not null default 0,
  add column if not exists cruise_daily_on date;
alter table public.profiles drop constraint if exists profiles_cruise_tokens_check;
alter table public.profiles add constraint profiles_cruise_tokens_check check (cruise_tokens between 0 and 8);

create or replace function public.cruise_max() returns integer language sql immutable set search_path = '' as $$ select 8 $$;

-- Tokens lying in the side streets (stocked by the game's server around players: src/lib/cruise-drops.ts).
create table if not exists public.cruise_drops (
  id         bigint generated always as identity primary key,
  cell       text not null,
  lng        double precision not null,
  lat        double precision not null,
  expires_at timestamptz not null,
  taken_by   uuid references public.profiles (id) on delete set null,
  taken_at   timestamptz
);
create index if not exists cruise_drops_live on public.cruise_drops (cell) where taken_at is null;
alter table public.cruise_drops enable row level security;
revoke all on public.cruise_drops from anon, authenticated;

-- The player's tokens, with the day's free two (Lagos days).
create or replace function public.cruise_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me public.profiles%rowtype;
  today date := (now() at time zone 'Africa/Lagos')::date;
  daily boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into me from public.profiles where id = uid for update;
  if me.cruise_daily_on is distinct from today then
    daily := me.cruise_tokens < public.cruise_max();
    update public.profiles set cruise_tokens = least(public.cruise_max(), cruise_tokens + 2), cruise_daily_on = today
     where id = uid returning * into me;
  end if;
  return jsonb_build_object('tokens', me.cruise_tokens, 'max', public.cruise_max(), 'daily', daily);
end;
$$;

-- Spend a token (15 s of cruising).
create or replace function public.use_cruise_token()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  left_now integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set cruise_tokens = cruise_tokens - 1 where id = uid and cruise_tokens > 0 returning cruise_tokens into left_now;
  if left_now is null then
    return jsonb_build_object('ok', false, 'reason', 'none', 'tokens', 0);
  end if;
  return jsonb_build_object('ok', true, 'tokens', left_now);
end;
$$;

-- Buy tokens: 10 coins each, up to 4 at a time (never past the most you can hold).
create or replace function public.buy_cruise_tokens()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me public.profiles%rowtype;
  n integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into me from public.profiles where id = uid for update;
  n := least(4, public.cruise_max() - me.cruise_tokens);
  if n <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'full', 'tokens', me.cruise_tokens);
  end if;
  if me.coins < n * 10 then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', n * 10, 'tokens', me.cruise_tokens);
  end if;
  balance := public.apply_coin_change(uid, -(n * 10), 'spend', n || ' cruise tokens', null);
  update public.profiles set cruise_tokens = cruise_tokens + n where id = uid;
  return jsonb_build_object('ok', true, 'bought', n, 'tokens', me.cruise_tokens + n, 'balance', balance);
end;
$$;

-- Tokens lying within 600 m of where the server last saw the player.
create or replace function public.cruise_drops_near()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'lng', d.lng, 'lat', d.lat)), '[]'::jsonb)
    from public.player_positions p
    join public.cruise_drops d on d.taken_at is null and d.expires_at > now()
     and d.lat between p.lat - 0.006 and p.lat + 0.006 and d.lng between p.lng - 0.006 and p.lng + 0.006
     and public.distance_m(p.lng, p.lat, d.lng, d.lat) <= 600
   where p.user_id = auth.uid();
$$;

-- Pick a token up (within 40 m of it, by the server's last position).
create or replace function public.take_cruise_drop(p_drop bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.cruise_drops%rowtype;
  pos public.player_positions%rowtype;
  now_tokens integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into d from public.cruise_drops where id = p_drop for update;
  if d.id is null or d.taken_at is not null or d.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, d.lng, d.lat) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  select cruise_tokens into now_tokens from public.profiles where id = uid for update;
  if now_tokens >= public.cruise_max() then
    return jsonb_build_object('ok', false, 'reason', 'full', 'tokens', now_tokens);
  end if;
  update public.cruise_drops set taken_by = uid, taken_at = now() where id = d.id;
  update public.profiles set cruise_tokens = cruise_tokens + 1 where id = uid;
  return jsonb_build_object('ok', true, 'tokens', now_tokens + 1);
end;
$$;

revoke execute on function public.cruise_state(), public.use_cruise_token(), public.buy_cruise_tokens(),
  public.cruise_drops_near(), public.take_cruise_drop(bigint) from public, anon;
grant execute on function public.cruise_state(), public.use_cruise_token(), public.buy_cruise_tokens(),
  public.cruise_drops_near(), public.take_cruise_drop(bigint) to authenticated;

-- A traveller's thank-you can be two cruise tokens.
create or replace function public.road_gift(p_user uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  roll double precision := random();
  k public.player_kegs%rowtype;
  gift_relic text;
  had integer;
begin
  if roll < 0.35 then
    gift_relic := (array['jerry_can', 'jerry_can', 'second_wind', 'second_wind', 'shield'])[1 + floor(random() * 5)::integer];
    insert into public.player_relics (user_id, relic, charges, expires_at) values (p_user, gift_relic, 1, now() + interval '7 days');
    return jsonb_build_object('kind', 'relic', 'relic', gift_relic);
  end if;
  if roll < 0.5 then
    select * into k from public.player_kegs where user_id = p_user;
    if k.user_id is null or k.uses_left <= 0 then
      insert into public.player_kegs (user_id, fuel, uses_left) values (p_user, public.keg_capacity(), 50)
      on conflict (user_id) do update set fuel = excluded.fuel, uses_left = 50, bought_at = now();
      return jsonb_build_object('kind', 'keg', 'fresh', true);
    elsif k.fuel < public.keg_capacity() then
      update public.player_kegs set fuel = public.keg_capacity() where user_id = p_user;
      return jsonb_build_object('kind', 'keg', 'fresh', false);
    end if;
  elsif roll < 0.62 then
    insert into public.player_items (user_id, item, qty) values (p_user, 'tyre_kit', 1)
    on conflict (user_id, item) do update set qty = public.player_items.qty + 1;
    return jsonb_build_object('kind', 'item', 'item', 'tyre_kit');
  elsif roll < 0.8 then
    select cruise_tokens into had from public.profiles where id = p_user;
    if had < public.cruise_max() then
      update public.profiles set cruise_tokens = least(public.cruise_max(), cruise_tokens + 2) where id = p_user;
      return jsonb_build_object('kind', 'cruise', 'tokens', least(2, public.cruise_max() - had));
    end if;
  end if;
  perform public.apply_coin_change(p_user, 15, 'earn', 'A thank-you from a traveller', p_ref);
  return jsonb_build_object('kind', 'coins', 'amount', 15);
end;
$$;
