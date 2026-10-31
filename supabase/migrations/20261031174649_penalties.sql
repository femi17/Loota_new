-- Penalties (owner, 31 Oct 2026: "For someone that goes to the wrong location, we can deploy a deep penalty because in
-- movies they always end up dead"; "the penalty shouldn't always be the same every time… a database of penalties… like
-- 500 - 1000"). A story key (hunt_keys.exact_m) has no hot and cold any more: arrive and you know. At the right place
-- the chest is there; at the wrong one a random deep penalty from this table. Soft penalties are for the wrong room
-- inside a key's house (to come).
--   penalties: one trap each: what happens (title, body, a scene for the picture) and what it costs (effect, amount):
--     wait   seconds before the hunter can name a new place;
--     coins  coins lost (never more than they have);
--     energy energy lost;
--     back   sent back to where they set off for this key (deep only).
--   hunt_players.leg_lng/leg_lat: where the hunter stood when they named their place (set by lock_guess);
--   hunt_players.last_penalty: never the same penalty twice in a row; penalties_taken: how many so far.
-- The penalties are seeded from scripts/penalties (npm run penalties:seed); only the server reads them.

create table if not exists public.penalties (
  code       text primary key,
  tier       text not null check (tier in ('soft', 'deep')),
  effect     text not null check (effect in ('wait', 'coins', 'energy', 'back')),
  amount     integer not null check (amount > 0),
  title      text not null,
  body       text not null,
  scene      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (effect <> 'back' or tier = 'deep')
);
alter table public.penalties enable row level security;
revoke all on public.penalties from anon, authenticated;

alter table public.hunt_players
  add column if not exists leg_lng double precision,
  add column if not exists leg_lat double precision,
  add column if not exists last_penalty text,
  add column if not exists penalties_taken integer not null default 0;

-- The riddle clock, with a penalty's wait: a clock started in the future is a wait until then.
create or replace function public.riddle_clock(hp public.hunt_players, n integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  c double precision;
begin
  if hp.guess_n = n then
    return jsonb_build_object('phase', 'locked', 'key', n,
      'guess', jsonb_build_object('name', hp.guess_name, 'lng', hp.guess_lng, 'lat', hp.guess_lat));
  end if;
  if hp.riddle_n is distinct from n or hp.riddle_at is null then
    return jsonb_build_object('phase', 'ready', 'key', n, 'answerS', public.riddle_answer_s(), 'waitS', public.riddle_wait_s());
  end if;
  if hp.riddle_at > now() then
    return jsonb_build_object('phase', 'wait', 'key', n, 'now', now(), 'until', hp.riddle_at);
  end if;
  e := extract(epoch from now() - hp.riddle_at);
  c := floor(e / cycle);
  if e - c * cycle < public.riddle_answer_s() then
    return jsonb_build_object('phase', 'answer', 'key', n, 'now', now(),
      'endsAt', hp.riddle_at + make_interval(secs => c * cycle + public.riddle_answer_s()));
  end if;
  return jsonb_build_object('phase', 'wait', 'key', n, 'now', now(),
    'until', hp.riddle_at + make_interval(secs => (c + 1) * cycle));
end;
$$;

-- Naming a place: not while a penalty's wait runs; and remember where the hunter set off from.
create or replace function public.lock_guess(p_hunt uuid, p_lng double precision, p_lat double precision, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  here record;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_lng is null or p_lat is null or abs(p_lng) > 180 or abs(p_lat) > 90 or coalesce(length(trim(p_name)), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_place');
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  if h.id is null or public.hunt_phase(h) <> 'live' then
    return jsonb_build_object('ok', false, 'reason', 'not_live');
  end if;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid for update;
  if hp.user_id is null or hp.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_hunting');
  end if;
  n := hp.keys_held + 1;
  if hp.guess_n = n then
    return jsonb_build_object('ok', false, 'reason', 'locked') || public.riddle_clock(hp, n);
  end if;
  if hp.riddle_n is distinct from n or hp.riddle_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_started') || public.riddle_clock(hp, n);
  end if;
  if hp.riddle_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
  end if;
  e := extract(epoch from now() - hp.riddle_at);
  if e - floor(e / cycle) * cycle >= public.riddle_answer_s() + 2 then
    return jsonb_build_object('ok', false, 'reason', 'too_late') || public.riddle_clock(hp, n);
  end if;
  select lng, lat into here from public.player_positions where user_id = uid;
  update public.hunt_players
     set guess_n = n, guess_lng = p_lng, guess_lat = p_lat, guess_name = left(trim(p_name), 120), guess_at = now(),
         leg_lng = here.lng, leg_lat = here.lat
   where hunt_id = p_hunt and user_id = uid
  returning * into hp;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;

-- Deal a random penalty of a tier to a hunter (never the one they had last), apply what it costs, and say what happened.
create or replace function public.deal_penalty(p_user uuid, p_hunt uuid, p_tier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  hp public.hunt_players%rowtype;
  pen public.penalties%rowtype;
  cost integer;
  have bigint;
  balance bigint;
  energy_now integer;
  move_to jsonb;
begin
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = p_user;
  select * into pen from public.penalties
   where tier = p_tier and active and code is distinct from hp.last_penalty
     and (effect <> 'back' or hp.leg_lng is not null)
   order by random() limit 1;
  if pen.code is null then
    return null;
  end if;
  cost := pen.amount;
  if pen.effect = 'wait' then
    update public.hunt_players set riddle_at = now() + make_interval(secs => pen.amount) where hunt_id = p_hunt and user_id = p_user;
  elsif pen.effect = 'coins' then
    select coins into have from public.profiles where id = p_user;
    cost := least(pen.amount, coalesce(have, 0))::integer;
    if cost > 0 then
      balance := public.apply_coin_change(p_user, -cost, 'spend', 'A trap: ' || pen.title, null);
    else
      balance := coalesce(have, 0);
    end if;
  elsif pen.effect = 'energy' then
    update public.player_positions set energy = greatest(0, energy - pen.amount) where user_id = p_user returning energy into energy_now;
  elsif pen.effect = 'back' then
    update public.player_positions set lng = hp.leg_lng, lat = hp.leg_lat, updated_at = now(), resting_since = null where user_id = p_user;
    update public.player_vehicles set lng = hp.leg_lng, lat = hp.leg_lat where user_id = p_user and in_use;
    move_to := jsonb_build_object('lng', hp.leg_lng, 'lat', hp.leg_lat);
  end if;
  update public.hunt_players set last_penalty = pen.code, penalties_taken = penalties_taken + 1 where hunt_id = p_hunt and user_id = p_user;
  return jsonb_build_object('code', pen.code, 'tier', pen.tier, 'title', pen.title, 'body', pen.body, 'scene', pen.scene,
    'effect', pen.effect, 'amount', cost, 'balance', balance, 'energy', energy_now, 'moveTo', move_to,
    'until', case when pen.effect = 'wait' then now() + make_interval(secs => pen.amount) end);
end;
$$;
revoke execute on function public.deal_penalty(uuid, uuid, text) from public, anon, authenticated;

-- The key's pulse: a story key has no hot and cold. In its place, the chest is right there ('exact'); at the wrong
-- place, a deep penalty as well as a new answer.
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
  penalty jsonb;
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
  -- An exact key: only the place itself (or the chest) counts, however good the detector.
  outside := case when k.exact_m is not null then to_area > k.exact_m and to_spot > k.exact_m
                  else to_area > coalesce(k.area_radius_m, 1000) * far_m and to_spot > 1000 * far_m end;
  -- At their answer, and it isn't here: a new 15 seconds to answer again (and, at a story key, a deep penalty).
  if outside and hp.guess_n = k.n and public.distance_m(p_lng, p_lat, hp.guess_lng, hp.guess_lat) <= 150 then
    update public.hunt_players set guess_n = null, riddle_n = k.n, riddle_at = now() where hunt_id = p_hunt and user_id = uid;
    if k.exact_m is not null then
      penalty := public.deal_penalty(uid, p_hunt, 'deep');
    end if;
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'wrongPlace', hp.guess_name, 'detector', has_detector, 'penalty', penalty);
  end if;
  if outside and hp.approach_key is distinct from k.n then
    return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'detector', has_detector);
  end if;
  if hp.approach_key is distinct from k.n then
    update public.hunt_players set approach_key = k.n where hunt_id = p_hunt and user_id = uid;
  end if;
  -- A story key: no hot and cold, the chest is right there.
  if k.exact_m is not null then
    return jsonb_build_object('ok', true, 'inArea', true, 'exact', true, 'key', k.n, 'near', to_spot <= 60,
      'spot', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat, 'scene', k.scene), 'detector', has_detector,
      'clue', 'This is the place.');
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
