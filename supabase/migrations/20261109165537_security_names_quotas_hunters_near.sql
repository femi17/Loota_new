-- Security, the optional fixes from the audit (owner, 9 Nov 2026: "fix the optional security improvements").
-- 1. Reserved names: no player can be called Loota, Admin, Support and the like (or Loota-anything but the names the
--    game gives itself, Loota_<8 hex>), to pass as the game; the owner's accounts may.
-- 2. Per-player limits on what costs the server (take_quota): the place search (40 a minute), filling an area abroad
--    (15), what's around (60), who's near (30).
-- 3. Who's really near (hunters_near): the game draws a hunter heard on the live channel only if the server has them
--    near, with the name and look the server has, and a Mirror's copies only while their Mirror lasts; a cloaked
--    hunter isn't listed. A player can no longer put a made-up hunter on the maps around them.
set lock_timeout = '8s';

create or replace function public.username_reserved(name text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(name) in ('loota', 'admin', 'administrator', 'owner', 'official', 'support', 'help', 'helpdesk', 'moderator',
                         'mod', 'staff', 'system', 'team', 'root', 'security', 'broadcast', 'host', 'gamemaster', 'gm')
      or lower(name) ~ '^(admin|official|support|moderator|staff|system)'
      or (lower(name) ~ '^loota' and lower(name) !~ '^loota_[0-9a-f]{8}(_[0-9]{1,4})?$');
$$;

alter table public.profiles add constraint profiles_username_not_reserved check (is_admin or not public.username_reserved(username));

create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select name ~ '^[A-Za-z0-9_]{3,20}$'
     and not public.username_reserved(name)
     and not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen text;
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_]{3,20}$' or public.username_reserved(wanted) then
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

create table if not exists public.api_quota (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  window_start timestamptz not null default now(),
  used integer not null default 0,
  primary key (user_id, kind)
);
alter table public.api_quota enable row level security;
revoke all on public.api_quota from anon, authenticated;

create or replace function public.take_quota(p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lim integer;
  win integer;
  q public.api_quota%rowtype;
begin
  if uid is null then
    return false;
  end if;
  select v.l, v.w into lim, win
    from (values ('geocode', 40, 60), ('fill', 15, 60), ('nearby', 60, 60), ('hunters_near', 30, 60)) v(k, l, w)
   where v.k = p_kind;
  if lim is null then
    return false;
  end if;
  insert into public.api_quota (user_id, kind) values (uid, p_kind) on conflict do nothing;
  select * into q from public.api_quota where user_id = uid and kind = p_kind for update;
  if q.window_start < now() - make_interval(secs => win) then
    update public.api_quota set window_start = now(), used = 1 where user_id = uid and kind = p_kind;
    return true;
  end if;
  if q.used >= lim then
    return false;
  end if;
  update public.api_quota set used = used + 1 where user_id = uid and kind = p_kind;
  return true;
end;
$$;
revoke all on function public.take_quota(text) from public, anon;
grant execute on function public.take_quota(text) to authenticated;

create or replace function public.hunters_near()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me record;
  dlng double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.take_quota('hunters_near') then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select lng, lat into me from public.player_positions where user_id = uid;
  if me.lng is null then
    return jsonb_build_object('ok', true, 'hunters', '[]'::jsonb);
  end if;
  dlng := 0.06 / greatest(cos(radians(me.lat)), 0.2);
  return jsonb_build_object('ok', true, 'hunters', coalesce((
    select jsonb_agg(h) from (
      select jsonb_build_object('id', pp.user_id, 'name', pr.username, 'look', pr.avatar, 'lng', pp.lng, 'lat', pp.lat,
               'mirrored', exists (select 1 from public.wonder_events e
                                    where e.wonder = 'mirror_of_many' and e.user_id = pp.user_id and e.ends_at > now())) h
        from public.player_positions pp
        join public.profiles pr on pr.id = pp.user_id
       where pp.user_id <> uid and pp.updated_at > now() - interval '15 minutes'
         and pp.lat between me.lat - 0.06 and me.lat + 0.06 and pp.lng between me.lng - dlng and me.lng + dlng
         and not exists (select 1 from public.wonder_events e
                          where e.wonder = 'phantom_cloak' and e.user_id = pp.user_id and e.ends_at > now())
       limit 60) near), '[]'::jsonb));
end;
$$;
revoke all on function public.hunters_near() from public, anon;
grant execute on function public.hunters_near() to authenticated;
