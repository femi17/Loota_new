-- The Masquerade's trap chests (owner, 25 Oct 2026: "do it"; light and playful). A key can have a decoy chest the
-- Masquerade planted 150-280 m from the real one (hunt_keys.trap_*, set in /admin). Within 60 m it rises like the real
-- one (key_pulse sends it as "trap"); the tell is the detector, which always reads the real key: the trap rises where
-- the heat is only Hot. Opening it (spring_trap, within 40 m) costs 25 coins and leaves the hunter dizzy for 15 s;
-- once per hunter and key, then it's gone for them.

alter table public.hunt_keys
  add column if not exists trap_lng double precision,
  add column if not exists trap_lat double precision;
alter table public.hunt_players add column if not exists traps_sprung integer[] not null default '{}';

create or replace function public.trap_cost() returns integer language sql immutable set search_path = '' as $$ select 25 $$;

create or replace function public.key_pulse(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  pos jsonb;
  to_spot double precision;
  to_area double precision;
  reach double precision;
  heat double precision;
  far_m double precision; -- how far the detector reaches (twice as far in golden minutes)
  trap jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', case when hp.user_id is null then 'not_joined' else 'finished' end);
  end if;
  if exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'trial');
  end if;
  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
  if k.n is null then
    return jsonb_build_object('ok', false, 'reason', 'no_key');
  end if;
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);
  far_m := case when public.golden_until(h) is not null then 2 else 1 end;
  reach := greatest(coalesce(k.area_radius_m, 1000), 1000) * far_m;
  if to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n);
  end if;
  if hp.approach_key is distinct from k.n then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
  end if;
  -- The Masquerade's decoy, rising like the real chest (not once it's been sprung).
  if k.trap_lng is not null and not (k.n = any (hp.traps_sprung))
     and public.distance_m(p_lng, p_lat, k.trap_lng, k.trap_lat) <= 60 then
    trap := jsonb_build_object('lng', k.trap_lng, 'lat', k.trap_lat);
  end if;
  heat := round((greatest(0, least(1, 1 - ln(greatest(to_spot, 60) / 60) / ln(reach / 60))) * 20)::numeric) / 20;
  return jsonb_build_object('ok', true, 'inArea', true, 'key', k.n, 'heat', heat, 'near', to_spot <= 60,
    'spot', case when to_spot <= 60 then jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat, 'scene', k.scene) end,
    'trap', trap,
    'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'));
end;
$$;

-- Opening the Masquerade's trap chest: 25 coins (or what's left) and 15 s dizzy, once per key.
create or replace function public.spring_trap(p_hunt uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  pos jsonb;
  lost integer;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid for update;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_hunting');
  end if;
  select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
  if k.trap_lng is null or k.n = any (hp.traps_sprung) then
    return jsonb_build_object('ok', false, 'reason', 'no_trap');
  end if;
  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position');
  end if;
  if public.distance_m(p_lng, p_lat, k.trap_lng, k.trap_lat) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  update public.hunt_players set traps_sprung = traps_sprung || k.n where hunt_id = p_hunt and user_id = uid;
  select least(public.trap_cost(), coins)::integer into lost from public.profiles where id = uid;
  if lost > 0 then
    balance := public.apply_coin_change(uid, -lost, 'spend', 'The Masquerade''s trap chest', null);
  else
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'lost', lost, 'balance', balance, 'dizzyS', 15);
end;
$$;
revoke execute on function public.spring_trap(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.spring_trap(uuid, double precision, double precision, text) to authenticated;
