-- The key's place on the broadcast (owner, 9 Nov 2026: step 3). A hunter at a key's place walks about it themselves (the
-- joystick), so their game saves where they are a few times a second as the scene's track ([server ms, x, z, facing,
-- inside 0/1]), in a batch about once a second (scene_track; the last 400 kept, ~100 s); the broadcast plays it a few
-- seconds behind between the points either side. A key's place's scene carries the hunter's own arrangement of it
-- (its places and things), so it's allowed more room (80 kB).
set lock_timeout = '8s';

alter table public.hunter_scenes add column if not exists track jsonb not null default '[]'::jsonb;

create or replace function public.scene_track(p_id bigint, p_track jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  merged jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if jsonb_typeof(p_track) <> 'array' or jsonb_array_length(p_track) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  select track || p_track into merged from public.hunter_scenes where id = p_id and user_id = uid;
  if merged is null then
    return jsonb_build_object('ok', false);
  end if;
  if jsonb_array_length(merged) > 400 then
    select jsonb_agg(k order by i) into merged
      from jsonb_array_elements(merged) with ordinality e(k, i)
     where i > jsonb_array_length(merged) - 400;
  end if;
  update public.hunter_scenes set track = merged, updated_at = now() where id = p_id and user_id = uid;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.scene_track(bigint, jsonb) from public, anon;
grant execute on function public.scene_track(bigint, jsonb) to authenticated;

do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.scene_start(bigint,jsonb)'::regprocedure);
  if position('length(p_data::text) > 20000' in d) = 0 then
    raise exception 'scene_start changed';
  end if;
  execute replace(d, 'length(p_data::text) > 20000', 'length(p_data::text) > 80000');
  d := pg_get_functiondef('public.broadcast_motion(uuid)'::regprocedure);
  if position('''lines'', s.lines))' in d) = 0 then
    raise exception 'broadcast_motion changed';
  end if;
  execute replace(d, '''lines'', s.lines))', '''lines'', s.lines, ''track'', s.track))');
end;
$$;
