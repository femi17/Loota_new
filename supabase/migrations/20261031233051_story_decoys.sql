-- A story hunt without naming a place (owner, 1 Nov 2026: "do we need a modal asking where…? We do not need that. We
-- have a search icon, user can use that"). Hunters travel with the map's own search; the key's place says "This is the
-- place" when they reach it. The wrong place is the story's own decoys: each near miss the story tempts hunters with is
-- on the map (hunt_decoys), and stopping at one springs a deep trap, once per decoy. A trap that sends a hunter "back to
-- where they set off" sends them to where this key's leg began (leg_n: the first pulse after the last key).
-- The riddle clock in a story hunt is never started (start_riddle does nothing), so a search never waits for a named place.

create table if not exists public.hunt_decoys (
  id        bigint generated always as identity primary key,
  hunt_id   uuid not null references public.hunts (id) on delete cascade,
  key_n     integer not null,
  place     text not null,
  lng       double precision not null,
  lat       double precision not null,
  radius_m  integer not null default 100
);
create index if not exists hunt_decoys_key on public.hunt_decoys (hunt_id, key_n);
alter table public.hunt_decoys enable row level security;
revoke all on public.hunt_decoys from anon, authenticated;

alter table public.hunt_players
  add column if not exists leg_n integer,
  add column if not exists decoys_sprung bigint[] not null default '{}';

-- The story clock: a penalty's wait, or open.
create or replace function public.riddle_clock(hp public.hunt_players, n integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  cycle double precision := public.riddle_answer_s() + public.riddle_wait_s();
  e double precision;
  c double precision;
  story boolean := exists (select 1 from public.hunts where id = hp.hunt_id and story is not null);
begin
  if hp.guess_n = n then
    return jsonb_build_object('phase', 'locked', 'key', n, 'story', story,
      'guess', jsonb_build_object('name', hp.guess_name, 'lng', hp.guess_lng, 'lat', hp.guess_lat));
  end if;
  if story then
    if hp.riddle_at > now() then
      return jsonb_build_object('phase', 'wait', 'key', n, 'story', true, 'now', now(), 'until', hp.riddle_at);
    end if;
    return jsonb_build_object('phase', 'open', 'key', n, 'story', true);
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
revoke execute on function public.riddle_clock(public.hunt_players, integer) from public, anon, authenticated;

-- Opening a riddle: nothing to start in a story hunt; elsewhere, never cutting short a penalty's wait.
create or replace function public.start_riddle(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
begin
  if uid is null then
    raise exception 'Not signed in';
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
  if h.story is null and hp.guess_n is distinct from n and (hp.riddle_n is distinct from n or hp.riddle_at is null) then
    update public.hunt_players set riddle_n = n, riddle_at = greatest(now(), coalesce(riddle_at, now()))
     where hunt_id = p_hunt and user_id = uid
    returning * into hp;
  end if;
  return jsonb_build_object('ok', true) || public.riddle_clock(hp, n);
end;
$$;

-- Hunters already in a story hunt whose riddle was started: unstarted, so their search never waits for a named place.
update public.hunt_players hp set riddle_n = null
  from public.hunts h
 where h.id = hp.hunt_id and h.story is not null and hp.guess_n is null and hp.riddle_n is not null;

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
  d public.hunt_decoys%rowtype;
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
  if k.exact_m is not null then
    -- Where this key's leg began (a trap can send the hunter back there): the first pulse after the last key.
    if hp.leg_n is distinct from k.n then
      update public.hunt_players set leg_n = k.n, leg_lng = p_lng, leg_lat = p_lat where hunt_id = p_hunt and user_id = uid;
    end if;
    -- One of the story's decoys for this key (a near miss the story tempts you with): the trap springs, once each.
    if outside then
      select * into d from public.hunt_decoys
       where hunt_id = p_hunt and key_n = k.n and not (id = any (hp.decoys_sprung))
         and public.distance_m(p_lng, p_lat, lng, lat) <= radius_m
       order by public.distance_m(p_lng, p_lat, lng, lat) limit 1;
      if d.id is not null then
        update public.hunt_players set decoys_sprung = decoys_sprung || d.id where hunt_id = p_hunt and user_id = uid;
        penalty := public.deal_penalty(uid, p_hunt, 'deep');
        return jsonb_build_object('ok', true, 'inArea', false, 'key', k.n, 'wrongPlace', d.place, 'detector', has_detector, 'penalty', penalty);
      end if;
    end if;
  end if;
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
      'house', k.house is not null, 'clue', 'This is the place.');
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
