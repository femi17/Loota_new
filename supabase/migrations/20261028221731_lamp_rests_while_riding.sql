-- The lamp rests while you ride, and lets go of what you've left behind (owner, 28 Oct 2026: "when inside a plane or
-- train, one cannot go to find a relic even when the lamps turn on").
--   * On a bus, train, plane or taxi (a trip not ended, waiting included) the lamp offers nothing: no Detour is spawned
--     around the stop you left, nothing new is picked.
--   * A Detour or whisper more than lamp_left_behind_m() from the hunter (they flew, rode or drove away) is let go:
--     no rest before the next, and it isn't offered again (the Detour is set aside, the whisper fades).

create or replace function public.lamp_left_behind_m() returns double precision
language sql immutable set search_path = '' as $$ select 5000::double precision $$;

create or replace function public.lamp_state()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  far double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null then
    return jsonb_build_object('now', now(), 'current', null);
  end if;
  hunting := public.in_live_hunt(uid); -- in free roam: smaller rewards, and no Orb

  -- Riding: the lamp rests until you're off.
  if exists (select 1 from public.transit_trips t where t.user_id = uid and t.ended_at is null) then
    return jsonb_build_object('now', now(), 'current', null, 'hunt', hunting, 'riding', true);
  end if;

  my_area := public.detour_area(pos.lng, pos.lat);

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

  -- Left behind: too far away now to go and get. Let go of it, with no rest before the next.
  if lamp.current_kind = 'detour' then
    select public.distance_m(pos.lng, pos.lat, d.lng, d.lat) into far from public.detours d where d.id::text = lamp.current_id;
    if far > public.lamp_left_behind_m() then
      insert into public.lamp_dismissed (user_id, item) values (uid, 'detour:' || lamp.current_id) on conflict do nothing;
    end if;
  elsif lamp.current_kind = 'whisper' then
    select public.distance_m(pos.lng, pos.lat, l.lng, l.lat) into far from public.player_leads l where l.id::text = lamp.current_id;
    if far > public.lamp_left_behind_m() then
      update public.player_leads set resolved_at = now() where id::text = lamp.current_id and resolved_at is null;
    end if;
  end if;
  if far > public.lamp_left_behind_m() then
    update public.player_lamp set current_kind = null, current_id = null where user_id = uid returning * into lamp;
  end if;

  cur_kind := lamp.current_kind;
  cur_id := lamp.current_id;
  if cur_kind = 'orb' and not hunting then
    cur_kind := null; -- the hunt ended: the Orb is no longer the lamp's business
  end if;

  if not public.lamp_item_open(uid, cur_kind, cur_id) then
    -- The last thing is done (claimed, tried, over, let go): the lamp rests a while before the next.
    if lamp.current_kind is not null then
      update public.player_lamp set current_kind = null, current_id = null, rest_until = now() + make_interval(mins => public.lamp_rest_minutes())
       where user_id = uid returning * into lamp;
    end if;
    if lamp.rest_until > now() then
      return jsonb_build_object('now', now(), 'current', null, 'hunt', hunting, 'restUntil', lamp.rest_until);
    end if;
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
             'item', d.reward_item, 'qty', d.reward_qty,
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
$function$;
