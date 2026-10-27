-- "Get me out": every use is kept (where the hunter was stuck, where they were put), so the places the map gets wrong can
-- be found and fixed; and it's 3 a day at most, so it can't stand in for travelling.
create table if not exists public.unstuck_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_lng double precision not null,
  from_lat double precision not null,
  to_lng double precision not null,
  to_lat double precision not null,
  moved_m double precision not null
);
create index if not exists unstuck_log_user_at on public.unstuck_log (user_id, at);
alter table public.unstuck_log enable row level security;

create or replace function public.free_me(p_lng double precision, p_lat double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  moved double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid for update;
  if pos.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_position');
  end if;
  if exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'trip');
  end if;
  if exists (select 1 from public.wonder_events e
              where e.wonder = 'hourglass_of_ages' and e.ends_at > now() and uid = any (e.affected)) then
    return jsonb_build_object('ok', false, 'reason', 'frozen');
  end if;
  moved := public.distance_m(pos.lng, pos.lat, p_lng, p_lat);
  if moved > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if moved > 30 and pos.freed_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'next', pos.freed_at + interval '10 minutes');
  end if;
  if moved > 30 and (select count(*) from public.unstuck_log l where l.user_id = uid and l.at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'today');
  end if;
  if public.dome_blocking(uid, p_lng, p_lat) is not null and public.dome_blocking(uid, pos.lng, pos.lat) is null then
    return jsonb_build_object('ok', false, 'reason', 'dome');
  end if;
  update public.player_positions
     set lng = p_lng, lat = p_lat, updated_at = now(), road_fixed_at = now(),
         freed_at = case when moved > 30 then now() else freed_at end
   where user_id = uid;
  if moved > 30 then
    insert into public.unstuck_log (user_id, from_lng, from_lat, to_lng, to_lat, moved_m)
    values (uid, pos.lng, pos.lat, p_lng, p_lat, moved);
  end if;
  return jsonb_build_object('ok', true, 'lng', p_lng, 'lat', p_lat, 'moved', round(moved));
end;
$$;
revoke execute on function public.free_me(double precision, double precision) from public, anon;
grant execute on function public.free_me(double precision, double precision) to authenticated;
