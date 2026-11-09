-- The broadcast plays each hunter's own movement from the actions of their game, not from a stream of positions
-- (owner, 9 Nov 2026: "If a user picks a end location, we store that, and then travel there on the broadcast… We would be
-- broadcasting this on Youtube, so It should not break"; "make sure this is not eating the supabase realtime usage").
-- As the original Loota did (travel_route_coords, travel_started_at, travel_duration_ms on player_positions, played by
-- the same simulateTravelTick on both screens): here the way they go along (once per way) and motion keyframes (when,
-- by the server's clock in ms, how far along the way in metres, and the speed) written only when the speed changes
-- (setting off, a red light, moving on, sprint, arriving) and every 10 s. The broadcast reads them by a light poll (no
-- Realtime) and plays them a few seconds behind, between keyframes it already has: smooth, and exactly where they were.
set lock_timeout = '8s';

create table if not exists public.hunter_motion (
  user_id uuid primary key references auth.users (id) on delete cascade,
  way_id bigint,                 -- null: not going along a way
  pts jsonb,                     -- the way: [[lng, lat], ...]
  keys jsonb not null default '[]'::jsonb, -- [[server ms, metres along, m/s], ...], oldest first, the last ~40
  mode text,
  updated_at timestamptz not null default now()
);
alter table public.hunter_motion enable row level security; -- read and written only through the functions below

-- The hunter's game: a new way (p_pts) and/or keyframes; returns the server's time (ms) for the game's clock.
create or replace function public.motion_put(p_way bigint, p_pts jsonb, p_keys jsonb, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.hunter_motion%rowtype;
  merged jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_way is null then
    insert into public.hunter_motion (user_id, way_id, pts, keys, mode) values (uid, null, null, '[]', p_mode)
    on conflict (user_id) do update set way_id = null, pts = null, keys = '[]', mode = excluded.mode, updated_at = now();
    return jsonb_build_object('now', floor(extract(epoch from clock_timestamp()) * 1000));
  end if;
  if jsonb_typeof(p_keys) <> 'array' or jsonb_array_length(p_keys) > 60
     or (p_pts is not null and (jsonb_typeof(p_pts) <> 'array' or jsonb_array_length(p_pts) < 2 or jsonb_array_length(p_pts) > 4000)) then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  select * into m from public.hunter_motion where user_id = uid for update;
  if p_pts is not null or m.user_id is null or m.way_id is distinct from p_way then
    if p_pts is null then
      return jsonb_build_object('ok', false, 'reason', 'way', 'now', floor(extract(epoch from clock_timestamp()) * 1000)); -- the way first
    end if;
    merged := p_keys;
    insert into public.hunter_motion (user_id, way_id, pts, keys, mode) values (uid, p_way, p_pts, merged, p_mode)
    on conflict (user_id) do update set way_id = p_way, pts = p_pts, keys = merged, mode = excluded.mode, updated_at = now();
  else
    merged := m.keys || p_keys;
    if jsonb_array_length(merged) > 40 then
      select jsonb_agg(k order by i) into merged
        from jsonb_array_elements(merged) with ordinality e(k, i)
       where i > jsonb_array_length(merged) - 40;
    end if;
    update public.hunter_motion set keys = merged, mode = p_mode, updated_at = now() where user_id = uid;
  end if;
  return jsonb_build_object('ok', true, 'now', floor(extract(epoch from clock_timestamp()) * 1000));
end;
$$;

-- The broadcast (owner only), every second or two: each hunter's way and keyframes, and the server's time (ms).
create or replace function public.broadcast_motion(p_hunt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Owner only';
  end if;
  return jsonb_build_object(
    'now', floor(extract(epoch from clock_timestamp()) * 1000),
    'hunters', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'way', m.way_id, 'keys', m.keys, 'mode', m.mode))
        from public.hunter_motion m
        join public.hunt_players p on p.user_id = m.user_id and p.hunt_id = p_hunt
       where m.way_id is not null and m.updated_at > now() - interval '30 minutes'
         and not public.wonder_cloaked(m.user_id, p_hunt)), '[]'::jsonb));
end;
$$;

-- …and a hunter's way, fetched once when it changes.
create or replace function public.broadcast_way(p_hunt uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Owner only';
  end if;
  return (select jsonb_build_object('way', m.way_id, 'pts', m.pts)
            from public.hunter_motion m
            join public.hunt_players p on p.user_id = m.user_id and p.hunt_id = p_hunt
           where m.user_id = p_user and not public.wonder_cloaked(m.user_id, p_hunt));
end;
$$;

revoke all on function public.motion_put(bigint, jsonb, jsonb, text) from public, anon;
grant execute on function public.motion_put(bigint, jsonb, jsonb, text) to authenticated;
revoke all on function public.broadcast_motion(uuid) from public, anon;
grant execute on function public.broadcast_motion(uuid) to authenticated;
revoke all on function public.broadcast_way(uuid, uuid) from public, anon;
grant execute on function public.broadcast_way(uuid, uuid) to authenticated;
