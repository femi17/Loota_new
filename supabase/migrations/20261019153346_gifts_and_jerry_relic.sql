-- Thank-you gifts and the Jerry Can relic (owner, 19 Oct 2026: "I had a jerry can, and I was still made to purchase one";
-- "helping strangers… should not be limited to giving only coins, they can give small items like jack, jerry can").
-- The Jerry Can relic is a full jerry can: it works on a vehicle standing at the roadside out of fuel too. A traveller
-- you help gives a relic (Jerry Can, Second Wind, Shield), a full jerry can, a tyre kit (pump and patches: a bicycle's
-- tyres pumped or a flat fixed anywhere) or coins.

create table if not exists public.player_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item    text not null check (item in ('tyre_kit')),
  qty     integer not null default 0 check (qty >= 0),
  primary key (user_id, item)
);
alter table public.player_items enable row level security;
create policy "Players read their items" on public.player_items for select to authenticated using (user_id = (select auth.uid()));

/** A thank-you from someone you helped: a relic, a full jerry can, a tyre kit, or 15 coins. */
create or replace function public.road_gift(p_user uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  roll double precision := random();
  k public.player_kegs%rowtype;
  gift_relic text;
begin
  if roll < 0.4 then
    gift_relic := (array['jerry_can', 'jerry_can', 'second_wind', 'second_wind', 'shield'])[1 + floor(random() * 5)::integer];
    insert into public.player_relics (user_id, relic, charges, expires_at) values (p_user, gift_relic, 1, now() + interval '7 days');
    return jsonb_build_object('kind', 'relic', 'relic', gift_relic);
  end if;
  if roll < 0.55 then
    select * into k from public.player_kegs where user_id = p_user;
    if k.user_id is null or k.uses_left <= 0 then
      insert into public.player_kegs (user_id, fuel, uses_left) values (p_user, public.keg_capacity(), 50)
      on conflict (user_id) do update set fuel = excluded.fuel, uses_left = 50, bought_at = now();
      return jsonb_build_object('kind', 'keg', 'fresh', true);
    elsif k.fuel < public.keg_capacity() then
      update public.player_kegs set fuel = public.keg_capacity() where user_id = p_user;
      return jsonb_build_object('kind', 'keg', 'fresh', false);
    end if;
  elsif roll < 0.7 then
    insert into public.player_items (user_id, item, qty) values (p_user, 'tyre_kit', 1)
    on conflict (user_id, item) do update set qty = public.player_items.qty + 1;
    return jsonb_build_object('kind', 'item', 'item', 'tyre_kit');
  end if;
  perform public.apply_coin_change(p_user, 15, 'earn', 'A thank-you from a traveller', p_ref);
  return jsonb_build_object('kind', 'coins', 'amount', 15);
end;
$$;
revoke execute on function public.road_gift(uuid, text) from public, anon, authenticated;

/** Using a small item: the tyre kit pumps the bicycle's tyres (or fixes a flat), wherever you are. */
create or replace function public.use_item(p_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  have integer;
  v public.player_vehicles%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_item is distinct from 'tyre_kit' then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select qty into have from public.player_items where user_id = uid and item = p_item for update;
  if coalesce(have, 0) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  select * into v from public.player_vehicles where user_id = uid and kind = 'bicycle' for update; -- ridden or in the pocket
  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
  end if;
  if v.tyre >= 95 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  update public.player_vehicles set tyre = 100 where id = v.id;
  update public.player_items set qty = qty - 1 where user_id = uid and item = p_item;
  return jsonb_build_object('ok', true, 'flat', v.tyre <= 0, 'left', have - 1);
end;
$$;
revoke execute on function public.use_item(text) from public, anon;
grant execute on function public.use_item(text) to authenticated;

create or replace function public.use_relic(p_relic uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.player_relics%rowtype;
  pos public.player_positions%rowtype;
  fuel_now double precision;
  valid_until timestamptz;
  raised jsonb;
  v public.player_vehicles%rowtype;
  remounted boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.player_relics where id = p_relic and user_id = uid for update;
  if not found or r.charges < 1 or r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  if r.relic = 'shield' then
    return jsonb_build_object('ok', false, 'reason', 'passive');
  elsif r.relic = 'fast_pass' then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  elsif r.relic = 'lockdown_orb' then
    raised := public.raise_dome(uid);
    if not (raised ->> 'ok')::boolean then
      return raised;
    end if;
    update public.player_relics set charges = charges - 1 where id = r.id;
    perform public.place_orb(); -- used: it hides again somewhere new
    return raised || jsonb_build_object('relic', 'lockdown_orb');
  elsif r.relic = 'jerry_can' then
    -- A full jerry can (owner, 19 Oct 2026: "I had a jerry can and was still made to buy one"): into the motorbike or
    -- car being ridden, or one standing at the roadside out of fuel within 30 m (then back on it); a tank to 65% at most.
    select * into pos from public.player_positions where user_id = uid;
    select * into v from public.player_vehicles where user_id = uid and kind in ('motorbike', 'car') and in_use for update;
    if v.id is null and pos.user_id is not null then
      select * into v from public.player_vehicles
       where user_id = uid and stranded_at is not null and public.distance_m(lng, lat, pos.lng, pos.lat) <= 30
       limit 1 for update;
    end if;
    if v.id is null then
      select * into v from public.player_vehicles where user_id = uid and stranded_at is not null limit 1;
      if v.id is not null then
        return jsonb_build_object('ok', false, 'reason', 'far', 'kind', v.kind, 'lng', v.lng, 'lat', v.lat);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'no_vehicle');
    end if;
    if v.fuel >= public.keg_capacity() then
      return jsonb_build_object('ok', false, 'reason', 'full');
    end if;
    update public.player_vehicles set fuel = public.keg_capacity() where id = v.id returning fuel into fuel_now;
    if v.stranded_at is not null then
      perform public.settle_rental(uid);
      update public.player_vehicles set in_use = false where user_id = uid and in_use;
      update public.player_vehicles set stranded_at = null, in_use = true, lng = pos.lng, lat = pos.lat where id = v.id;
      update public.player_positions set mode = v.kind where user_id = uid;
      remounted := true;
    end if;
  elsif r.relic = 'radar' then
    valid_until := greatest(now(), coalesce((select radar_until from public.player_boosts where user_id = uid), now())) + interval '5 minutes';
    insert into public.player_boosts (user_id, radar_until) values (uid, valid_until)
    on conflict (user_id) do update set radar_until = excluded.radar_until;
  elsif r.relic = 'rain_charm' then
    select * into pos from public.player_positions where user_id = uid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'position');
    end if;
    valid_until := now() + interval '10 minutes';
    insert into public.world_effects (kind, lng, lat, radius_m, ends_at, created_by)
    values ('rain', pos.lng, pos.lat, 5000, valid_until, uid);
  end if;

  update public.player_relics set charges = charges - 1 where id = r.id;
  return jsonb_build_object('ok', true, 'relic', r.relic, 'energy', case when r.relic = 'second_wind' then 50 end,
    'fuel', fuel_now, 'until', valid_until, 'kind', v.kind, 'remounted', remounted);
end;
$$;

create or replace function public.road_event_answer(p_event bigint, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  pos public.player_positions%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  right_answer boolean;
  fine integer := 0;
  reward integer := 0;
  balance bigint;
  result text;
  hint jsonb;
  bearing double precision;
  gift jsonb;
  dirs text[] := array['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into e from public.road_events where id = p_event and user_id = uid and resolved_at is null for update;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  right_answer := e.question is not null and p_choice >= 0 and p_choice = (e.question ->> 'answer')::integer;

  if e.kind = 'checkpoint' then
    if cardinality(e.missing) = 0 and right_answer then
      result := 'passed';
    else
      -- Missing papers: 20 coins each; in order but a wrong answer (or paying): 20.
      select least(20 * greatest(1, cardinality(e.missing)), coins)::integer into fine from public.profiles where id = uid;
      if fine > 0 then
        balance := public.apply_coin_change(uid, -fine, 'spend',
          case when cardinality(e.missing) > 0 then 'Fine at a police checkpoint: no ' || array_to_string(e.missing, ', ') else 'Fine at a police checkpoint' end, null);
      end if;
      result := 'fined';
    end if;
  elsif e.kind = 'seller' then
    if right_answer then
      reward := 25;
      balance := public.apply_coin_change(uid, reward, 'earn', 'A street seller''s riddle', 'road-event:' || e.id);
      result := 'won';
    else
      result := case when p_choice = -1 then 'declined' else 'lost' end;
    end if;
  else
    if p_choice = 1 then
      if e.hunt_id is not null then
        -- In a hunt: which way the player's next key's area lies, and roughly how far.
        select * into pos from public.player_positions where user_id = uid;
        select * into hp from public.hunt_players where hunt_id = e.hunt_id and user_id = uid;
        select * into k from public.hunt_keys where hunt_id = e.hunt_id and n = coalesce(hp.keys_held, 0) + 1;
        if k.n is not null and pos.user_id is not null then
          bearing := degrees(atan2((k.area_lng - pos.lng) * cos(radians(pos.lat)), k.area_lat - pos.lat));
          hint := jsonb_build_object('direction', dirs[1 + (floor((bearing + 360 + 22.5) / 45)::integer % 8)],
            'band', public.distance_band(public.distance_m(pos.lng, pos.lat, k.area_lng, k.area_lat)), 'key', k.n);
        end if;
        -- Sometimes a little something besides.
        if random() < 0.4 then
          gift := public.road_gift(uid, 'road-event:' || e.id);
        end if;
      else
        -- In free roam: a thank-you gift (owner, 19 Oct 2026: "not limited to coins… small items like… jerry can").
        gift := public.road_gift(uid, 'road-event:' || e.id);
      end if;
      if gift ->> 'kind' = 'coins' then
        reward := (gift ->> 'amount')::integer;
      end if;
      result := 'helped';
    else
      result := 'declined';
    end if;
  end if;

  update public.road_events set resolved_at = now(), outcome = result where id = e.id;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'outcome', result, 'right', right_answer,
    'correct', case when e.question is not null then e.question -> 'choices' ->> (e.question ->> 'answer')::integer end,
    'fine', fine, 'reward', reward, 'hint', hint, 'gift', gift, 'balance', balance, 'missing', to_jsonb(e.missing),
    'holdS', case when result in ('fined', 'helped') then 15 else 0 end);
end;
$$;
