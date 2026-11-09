-- Scenes on the broadcast (owner, 9 Nov 2026: "how do we handle the road side event, like the police, or random user
-- stopping users… do we display the scene if user agrees either pumping a flat, refueling etc"; step 2 of the
-- broadcast). Each scene a hunter goes into (a checkpoint, a traveller, a seller, the vulcanizer, the pump, a buka, a
-- mechanic, a ward, the ticket office…) is saved by their game: when it starts and ends (the server's clock, ms), how
-- it's built (the same 3D model and where it stands), and what's said, line by line. The broadcast reads them with the
-- hunters' motion (broadcast_motion, no Realtime) and plays them a few seconds behind, the words as captions.
set lock_timeout = '8s';

create table if not exists public.hunter_scenes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_ms bigint not null,
  ended_ms bigint,
  data jsonb not null,           -- kind, model {make, args}, origin, facing, spots, keeper {look, at}, you {from, to}; title, sign, keeper's name
  lines jsonb not null default '[]'::jsonb, -- [[server ms, "them"|"you", text], ...]
  updated_at timestamptz not null default now()
);
create index if not exists hunter_scenes_user_started on public.hunter_scenes (user_id, started_ms desc);
alter table public.hunter_scenes enable row level security; -- only through the functions below

-- The hunter's game: a scene begins (any still open is ended there).
create or replace function public.scene_start(p_ms bigint, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_id bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  update public.hunter_scenes set ended_ms = p_ms, updated_at = now() where user_id = uid and ended_ms is null;
  insert into public.hunter_scenes (user_id, started_ms, data) values (uid, p_ms, p_data) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- …its lines as they're said, what it's called once known, and its end.
create or replace function public.scene_update(p_id bigint, p_lines jsonb, p_meta jsonb, p_end bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if (p_lines is not null and (jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 or length(p_lines::text) > 20000))
     or (p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or length(p_meta::text) > 2000)) then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  update public.hunter_scenes
     set lines = case when p_lines is null then lines
                      when jsonb_array_length(lines) + jsonb_array_length(p_lines) > 200 then lines
                      else lines || p_lines end,
         data = case when p_meta is null then data else data || p_meta end,
         ended_ms = coalesce(p_end, ended_ms),
         updated_at = now()
   where id = p_id and user_id = uid;
  return jsonb_build_object('ok', found);
end;
$$;

-- The broadcast's poll: the hunters' motion, and their scenes of the last few minutes.
create or replace function public.broadcast_motion(p_hunt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Owner only';
  end if;
  return jsonb_build_object(
    'now', now_ms,
    'hunters', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'way', m.way_id, 'keys', m.keys, 'mode', m.mode))
        from public.hunter_motion m
        join public.hunt_players p on p.user_id = m.user_id and p.hunt_id = p_hunt
       where m.way_id is not null and m.updated_at > now() - interval '30 minutes'
         and not public.wonder_cloaked(m.user_id, p_hunt)), '[]'::jsonb),
    'scenes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'user', s.user_id, 'start', s.started_ms, 'end', s.ended_ms, 'data', s.data, 'lines', s.lines))
        from public.hunter_scenes s
        join public.hunt_players p on p.user_id = s.user_id and p.hunt_id = p_hunt
       where s.started_ms > now_ms - 15 * 60000
         and (s.ended_ms is null or s.ended_ms > now_ms - 60000)
         and not public.wonder_cloaked(s.user_id, p_hunt)), '[]'::jsonb));
end;
$$;

revoke all on function public.scene_start(bigint, jsonb) from public, anon;
grant execute on function public.scene_start(bigint, jsonb) to authenticated;
revoke all on function public.scene_update(bigint, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.scene_update(bigint, jsonb, jsonb, bigint) to authenticated;
