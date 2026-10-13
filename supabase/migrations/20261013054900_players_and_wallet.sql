-- Loota Phase 0: player profiles, home location and the coin wallet.
-- Applied with the Supabase MCP or `npm run db:push`.

-- ---------------------------------------------------------------------------
-- Profiles: one row per player, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar      jsonb not null default '{"skin": "#8D5524", "shirt": "#2F6FEB"}'::jsonb,
  home_lng    double precision check (home_lng between -180 and 180),
  home_lat    double precision check (home_lat between -90 and 90),
  home_set_at timestamptz,
  coins       bigint not null default 0 check (coins >= 0),
  created_at  timestamptz not null default now()
);

-- Hunter names are unique regardless of letter case.
create unique index profiles_username_lower_key on public.profiles (lower(username));

-- ---------------------------------------------------------------------------
-- Coin transactions: every change to a wallet, for auditing and support.
-- ---------------------------------------------------------------------------
create table public.coin_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount        bigint not null check (amount <> 0),
  balance_after bigint not null,
  kind          text not null check (kind in ('purchase', 'spend', 'earn', 'refund', 'admin')),
  reason        text not null,
  reference     text unique, -- e.g. a Paystack reference; makes repeats safe
  created_at    timestamptz not null default now()
);

create index coin_transactions_user_created_idx on public.coin_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security: players see only their own rows. Coins, home location
-- and transactions can't be written from the browser.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.coin_transactions enable row level security;

create policy "Players read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Players update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, avatar) on public.profiles to authenticated;

create policy "Players read their own transactions"
  on public.coin_transactions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.coin_transactions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create a profile when someone signs up. Uses the hunter name they chose,
-- adding digits if it was taken in the meantime.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen text;
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_]{3,20}$' then
    wanted := 'Loota_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  chosen := wanted;
  while exists (select 1 from public.profiles where lower(username) = lower(chosen)) loop
    chosen := left(wanted, 15) || '_' || floor(random() * 10000)::int;
  end loop;

  insert into public.profiles (id, username) values (new.id, chosen);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Is a hunter name free? Used by the sign-up form.
-- ---------------------------------------------------------------------------
create function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select name ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Set or move home. Allowed once every 30 days so players can't fake their
-- location to start closer to each hunt.
-- ---------------------------------------------------------------------------
create function public.set_home(lng double precision, lat double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_set timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if lng not between -180 and 180 or lat not between -90 and 90 then
    raise exception 'Invalid location';
  end if;

  select home_set_at into last_set from public.profiles where id = auth.uid() for update;
  if last_set is not null and last_set > now() - interval '30 days' then
    raise exception 'Home can only be moved once every 30 days';
  end if;

  update public.profiles
     set home_lng = lng, home_lat = lat, home_set_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function public.set_home(double precision, double precision) from public, anon;
grant execute on function public.set_home(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- The only way coins change. Server-side code only (secret key). Atomic, never
-- lets a balance go below zero, and a repeated reference is applied once.
-- ---------------------------------------------------------------------------
create function public.apply_coin_change(
  p_user uuid,
  p_amount bigint,
  p_kind text,
  p_reason text,
  p_reference text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_balance bigint;
begin
  if p_reference is not null then
    select balance_after into new_balance
      from public.coin_transactions where reference = p_reference;
    if found then
      return new_balance; -- already applied
    end if;
  end if;

  -- The coins >= 0 check rejects spending more than the player has.
  update public.profiles set coins = coins + p_amount
   where id = p_user
   returning coins into new_balance;
  if not found then
    raise exception 'No such player';
  end if;

  insert into public.coin_transactions (user_id, amount, balance_after, kind, reason, reference)
  values (p_user, p_amount, new_balance, p_kind, p_reason, p_reference);

  return new_balance;
end;
$$;

revoke execute on function public.apply_coin_change(uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_coin_change(uuid, bigint, text, text, text) to service_role;
