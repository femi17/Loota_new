-- The metal detector (owner, 25 Oct 2026: "let hear the sound if someone is closer to the key location, like a metal
-- detector. I think there should be an option to buy metal detector"; bought once for 300 coins and kept; it beeps,
-- faster as you close in, and picks up a key from 1.5 times farther). Everyone keeps the silent heat (the chip and the
-- glowing edges); key_pulse says whether the hunter has one ("detector") and reaches farther for them.

alter table public.profiles add column if not exists detector boolean not null default false;

create or replace function public.detector_price() returns integer language sql immutable set search_path = '' as $$ select 300 $$;

create or replace function public.buy_detector()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me public.profiles%rowtype;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into me from public.profiles where id = uid for update;
  if me.detector then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  if me.coins < public.detector_price() then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'price', public.detector_price());
  end if;
  balance := public.apply_coin_change(uid, -public.detector_price(), 'spend', 'A metal detector', 'detector:' || uid);
  update public.profiles set detector = true where id = uid;
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;
revoke execute on function public.buy_detector() from public, anon;
grant execute on function public.buy_detector() to authenticated;

-- The detector: as before (the riddle clock's wrong place, trap chests), reaching 1.5 times farther with a bought
-- metal detector; it says whether the hunter has one.
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
  far_m double precision; -- how far the detector reaches (twice as far in golden minutes, 1.5 times with a detector)
  trap jsonb;
  outside boolean;
  has_detector boolean;
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
  select coalesce(detector, false) into has_detector from public.profiles where id = uid;
  to_spot := public.distance_m(p_lng, p_lat, k.spot_lng, k.spot_lat);
  to_area := public.distance_m(p_lng, p_lat, k.area_lng, k.area_lat);
  far_m := (case when public.golden_until(h) is not null then 2 else 1 end) * (case when has_detector then 1.5 else 1 end);
  reach := greatest(coalesce(k.area_radius_m, 1000), 1000) * far_m;
  outside := to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m;
  -- At their answer, and it isn't here: a new 15 seconds to answer again.
  if outside and hp.guess_n = k.n and public.distance_m(p_lng, p_lat, hp.guess_lng, hp.guess_lat) <= 150 then
    update public.hunt_players set guess_n = null, riddle_n = k.n, riddle_at = now() where hunt_id = p_hunt and user_id = uid;
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'wrongPlace', hp.guess_name, 'detector', has_detector);
  end if;
  if outside and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'detector', has_detector);
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
    'trap', trap, 'detector', has_detector,
    'clue', coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.'));
end;
$$;
