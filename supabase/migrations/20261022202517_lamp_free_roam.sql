-- The lamp's finds in free roam too, with smaller rewards (owner, 22 Oct 2026: "Yes, smaller rewards"). Between hunts
-- the lamp shows Detours and whispers again and hidden finds lie on the map, but coins are halved, and the relics that
-- only matter in a hunt (Radar, Fast Pass) come as 60 coins instead. The Lockdown Orb stays a hunt-only thing.

/** What a Detour gives a player who isn't in a live hunt. */
create or replace function public.detour_reward(d public.detours, p_hunting boolean, out coins integer, out relic text)
language sql immutable set search_path = '' as $$
  select case when p_hunting then d.reward_coins
              when d.reward_relic in ('radar', 'fast_pass') then 60
              else d.reward_coins / 2 end,
         case when p_hunting or d.reward_relic not in ('radar', 'fast_pass') then d.reward_relic end;
$$;
revoke execute on function public.detour_reward(public.detours, boolean) from public, anon, authenticated;

create or replace function public.lamp_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  my_area text;
  active integer;
  latest timestamptz;
  lamp public.player_lamp%rowtype;
  cur_kind text;
  cur_id text;
  lead uuid;
  item jsonb;
  hunting boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('now', now(), 'current', null);
  end if;
  my_area := public.detour_area(pos.lng, pos.lat);
  hunting := public.in_live_hunt(uid); -- in free roam: smaller rewards, and no Orb

  -- Keep two Detours going in the area, a new one at most every 8 minutes.
  perform pg_advisory_xact_lock(hashtext('detours:' || my_area));
  select count(*) filter (where ends_at > now()), max(starts_at) into active, latest from public.detours where area = my_area;
  if active < 2 and (latest is null or latest < now() - interval '8 minutes') then
    perform public.spawn_detour(my_area, pos.lng, pos.lat);
  end if;

  -- Whispers fade.
  update public.player_leads set resolved_at = now()
   where user_id = uid and resolved_at is null and created_at < now() - make_interval(mins => public.whisper_minutes());

  insert into public.player_lamp (user_id) values (uid) on conflict (user_id) do nothing;
  select * into lamp from public.player_lamp where user_id = uid for update;
  cur_kind := lamp.current_kind;
  cur_id := lamp.current_id;
  if cur_kind = 'orb' and not hunting then
    cur_kind := null; -- the hunt ended: the Orb is no longer the lamp's business
  end if;

  if not public.lamp_item_open(uid, cur_kind, cur_id) then
    cur_kind := null;
    cur_id := null;
    -- The next thing: the Orb (within 25 km, in a hunt), then the area's Detours (soonest ending first), then a whisper.
    if hunting then
      select 'orb', w.id::text into cur_kind, cur_id
        from public.world_items w
       where w.relic = 'lockdown_orb' and w.taken_by is null and w.expires_at > now()
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = uid and x.item = 'orb:' || w.id)
         and public.distance_m(pos.lng, pos.lat, w.lng, w.lat) < 25000
       limit 1;
    end if;
    if cur_kind is null then
      select 'detour', d.id::text into cur_kind, cur_id
        from public.detours d
       where d.area = my_area and d.ends_at > now() and (d.capacity is null or d.claimed < d.capacity)
         and not exists (select 1 from public.detour_claims c where c.detour_id = d.id and c.user_id = uid)
         and not exists (select 1 from public.lamp_dismissed x where x.user_id = uid and x.item = 'detour:' || d.id)
       order by d.ends_at
       limit 1;
    end if;
    if cur_kind is null then
      select 'whisper', l.id::text into cur_kind, cur_id
        from public.player_leads l where l.user_id = uid and l.resolved_at is null order by l.created_at limit 1;
    end if;
    -- Nothing else: a new whisper, every 30 minutes at most.
    if cur_kind is null and (lamp.whisper_at is null or lamp.whisper_at < now() - interval '30 minutes') then
      lead := public.whisper_lead(uid, pos.lng, pos.lat);
      if lead is not null then
        cur_kind := 'whisper';
        cur_id := lead::text;
        update public.player_lamp set whisper_at = now() where user_id = uid;
      end if;
    end if;
    update public.player_lamp set current_kind = cur_kind, current_id = cur_id where user_id = uid;
  end if;

  if cur_kind = 'orb' then
    select jsonb_build_object('type', 'orb', 'id', w.id, 'lng', w.lng, 'lat', w.lat,
             'metres', round(public.distance_m(pos.lng, pos.lat, w.lng, w.lat)), 'endsAt', w.expires_at)
      into item from public.world_items w where w.id::text = cur_id;
  elsif cur_kind = 'detour' then
    select jsonb_build_object('type', 'detour', 'id', d.id, 'kind', d.kind, 'title', d.title, 'story', d.story, 'place', d.place_name,
             'lng', d.lng, 'lat', d.lat, 'metres', round(public.distance_m(pos.lng, pos.lat, d.lng, d.lat)),
             'endsAt', d.ends_at, 'capacity', d.capacity, 'claimed', d.claimed,
             'coins', (public.detour_reward(d, hunting)).coins, 'relic', (public.detour_reward(d, hunting)).relic,
             'mine', (select c.outcome from public.detour_claims c where c.detour_id = d.id and c.user_id = uid))
      into item from public.detours d where d.id::text = cur_id;
  elsif cur_kind = 'whisper' then
    select jsonb_build_object('type', 'whisper', 'id', l.id, 'lng', l.lng, 'lat', l.lat,
             'metres', round(public.distance_m(pos.lng, pos.lat, l.lng, l.lat)),
             'endsAt', l.created_at + make_interval(mins => public.whisper_minutes()))
      into item from public.player_leads l where l.id::text = cur_id;
  end if;
  return jsonb_build_object('now', now(), 'current', item, 'hunt', hunting);
end;
$$;

create or replace function public.start_detour(p_detour uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.detours%rowtype;
  pos public.player_positions%rowtype;
  q jsonb;
  claim public.detour_claims%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into d from public.detours where id = p_detour;
  if d.id is null or d.ends_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'over');
  end if;
  if d.capacity is not null and d.claimed >= d.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, d.lng, d.lat) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if exists (select 1 from public.detour_claims where detour_id = d.id and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'tried');
  end if;
  q := public.make_question((array['maths', 'sequences', 'general', 'nigeria'])[1 + floor(random() * 4)::integer], 1 + floor(random() * 2)::integer) - 'bank_id';
  insert into public.detour_claims (detour_id, user_id, question, deadline)
  values (d.id, uid, q, now() + interval '30 seconds')
  returning * into claim;
  return jsonb_build_object('ok', true, 'title', d.title, 'question', q ->> 'prompt', 'options', q -> 'choices',
    'seconds', 30, 'deadline', claim.deadline, 'now', now());
end;
$$;

create or replace function public.answer_detour(p_detour uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  claim public.detour_claims%rowtype;
  d public.detours%rowtype;
  right_answer integer;
  result text;
  balance bigint;
  got_coins integer;
  got_relic text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into claim from public.detour_claims where detour_id = p_detour and user_id = uid and outcome = 'asked' for update;
  if claim.detour_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into d from public.detours where id = p_detour for update;
  select r.coins, r.relic into got_coins, got_relic from public.detour_reward(d, public.in_live_hunt(uid)) r;
  right_answer := (claim.question ->> 'answer')::integer;
  if p_choice <> right_answer then
    result := 'wrong';
  elsif now() > claim.deadline + interval '3 seconds' then
    result := 'late';
  elsif d.capacity is not null and d.claimed >= d.capacity then
    result := 'full';
  else
    result := 'won';
    update public.detours set claimed = claimed + 1 where id = d.id;
    if got_coins > 0 then
      balance := public.apply_coin_change(uid, got_coins, 'earn', 'Detour: ' || d.title, 'detour:' || d.id);
    end if;
    if got_relic is not null then
      insert into public.player_relics (user_id, relic, charges, expires_at)
      values (uid, got_relic, case got_relic when 'rain_charm' then 2 else 1 end, now() + interval '7 days');
    end if;
  end if;
  update public.detour_claims set outcome = result, answered_at = now() where detour_id = p_detour and user_id = uid;
  return jsonb_build_object('ok', true, 'outcome', result, 'answer', claim.question -> 'choices' ->> right_answer,
    'coins', case when result = 'won' then got_coins else 0 end,
    'relic', case when result = 'won' then got_relic end, 'balance', balance);
end;
$$;

create or replace function public.pickup_item(p_item uuid, p_lng double precision, p_lat double precision, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos jsonb;
  item public.world_items%rowtype;
  target_id uuid;
  lead_lng double precision;
  lead_lat double precision;
  decoy boolean;
  balance bigint;
  hunting boolean;
  got integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  hunting := public.in_live_hunt(uid);

  pos := public.save_position(p_lng, p_lat, p_mode);
  if not (pos ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'position', 'lng', pos -> 'lng', 'lat', pos -> 'lat');
  end if;

  select * into item from public.world_items where id = p_item for update;
  if not found or item.taken_by is not null or item.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if item.relic = 'lockdown_orb' and not hunting then
    return jsonb_build_object('ok', false, 'reason', 'no_hunt');
  end if;
  if public.distance_m(p_lng, p_lat, item.lng, item.lat) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;

  update public.world_items set taken_by = uid, taken_at = now() where id = p_item;

  if item.kind in ('coins', 'cache') then
    got := case when hunting then item.coins else greatest(1, item.coins / 2) end; -- half in free roam
    balance := public.apply_coin_change(
      uid, got, 'earn',
      case item.kind when 'cache' then 'Found a coin cache' else 'Picked up coins' end,
      'item:' || p_item
    );
    return jsonb_build_object('ok', true, 'kind', item.kind, 'coins', got, 'balance', balance, 'freeRoam', not hunting);
  end if;

  if item.kind = 'relic' then
    insert into public.player_relics (user_id, relic, charges, expires_at)
    values (uid, item.relic, case item.relic when 'rain_charm' then 2 else 1 end, now() + interval '7 days');
    return jsonb_build_object('ok', true, 'kind', 'relic', 'relic', item.relic);
  end if;

  -- Intel: 3 in 4 point to a real hidden find within 3 km; the rest are decoys.
  decoy := random() < 0.25;
  if not decoy then
    select w.id, w.lng, w.lat into target_id, lead_lng, lead_lat
      from public.world_items w
     where w.hidden and w.taken_by is null and w.expires_at > now()
       and public.distance_m(p_lng, p_lat, w.lng, w.lat) < 3000
       and not exists (select 1 from public.player_leads l where l.user_id = uid and l.item_id = w.id)
     order by random() limit 1;
    decoy := target_id is null;
  end if;
  if decoy then
    select c.decoy_lng, c.decoy_lat into lead_lng, lead_lat
      from public.world_cells c
     where c.decoy_lng is not null and public.distance_m(p_lng, p_lat, c.decoy_lng, c.decoy_lat) < 3000
     order by random() limit 1;
    if lead_lng is null then
      return jsonb_build_object('ok', true, 'kind', 'intel', 'lead', null);
    end if;
  end if;

  insert into public.player_leads (user_id, item_id, is_decoy, lng, lat)
  values (uid, case when decoy then null else target_id end, decoy, lead_lng, lead_lat);
  return jsonb_build_object('ok', true, 'kind', 'intel', 'lead', jsonb_build_object('lng', lead_lng, 'lat', lead_lat));
end;
$$;

create or replace function public.world_nearby()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  here_lng double precision;
  here_lat double precision;
  cx bigint;
  cy bigint;
  decoys integer;
  hunting boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select lng, lat into here_lng, here_lat from public.player_positions where user_id = uid;
  if not found then
    select home_lng, home_lat into here_lng, here_lat from public.profiles where id = uid;
  end if;
  if here_lng is null then
    raise exception 'Set your home first';
  end if;
  cx := floor(here_lng / 0.005);
  cy := floor(here_lat / 0.005);
  hunting := public.in_live_hunt(uid); -- in free roam: everything but the Lockdown Orb

  -- Arriving at a decoy lead: there's nothing here.
  with done as (
    update public.player_leads set resolved_at = now()
     where user_id = uid and resolved_at is null and is_decoy
       and public.distance_m(here_lng, here_lat, lng, lat) < 30
    returning 1
  )
  select count(*) into decoys from done;

  -- Leads to finds that are gone are closed too.
  update public.player_leads l set resolved_at = now()
   from public.world_items w
   where l.user_id = uid and l.resolved_at is null and l.item_id = w.id
     and (w.taken_by is not null or w.expires_at < now());

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'relic', w.relic, 'lng', w.lng, 'lat', w.lat))
        from public.world_items w
       where w.taken_by is null and w.expires_at > now()
         and (hunting or w.relic is distinct from 'lockdown_orb')
         and w.cell in (
           select (cx + dx) || ':' || (cy + dy) from generate_series(-2, 2) dx, generate_series(-2, 2) dy
         )
         and (public.distance_m(here_lng, here_lat, w.lng, w.lat) < 40
              or exists (select 1 from public.player_leads l
                          where l.user_id = uid and l.item_id = w.id and l.resolved_at is null
                            and public.distance_m(here_lng, here_lat, w.lng, w.lat) < 150))
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'lng', l.lng, 'lat', l.lat))
        from public.player_leads l where l.user_id = uid and l.resolved_at is null
    ), '[]'::jsonb),
    'decoysFound', decoys,
    'staleCells', coalesce((
      select jsonb_agg(c.cell order by abs(c.dx) + abs(c.dy))
        from (select (cx + dx) || ':' || (cy + dy) as cell, dx, dy
                from generate_series(-1, 1) dx, generate_series(-1, 1) dy) c
       where not exists (select 1 from public.world_cells wc
                          where wc.cell = c.cell and wc.spawned_at > now() - interval '6 hours')
    ), '[]'::jsonb)
  );
end;
$$;
