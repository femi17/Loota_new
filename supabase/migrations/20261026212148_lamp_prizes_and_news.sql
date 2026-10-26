-- The Lamp gives more than coins and relics (owner, 26 Oct 2026: "the lamp only gives jerry can, it should give cruise
-- and other things too"): cruise tokens and tyre kits among its prizes, in a hunt or not. And news for everyone
-- (owner: "when a user picks a tool, all users should see an announcement"): a relic picked up on the map, or a
-- Lamp prize that isn't coins, goes into world_news, which every player's map reads (world_news()).

-- ---- Lamp prizes -------------------------------------------------------------------------------------------------
alter table public.detours
  add column if not exists reward_item text check (reward_item in ('cruise', 'tyre_kit')),
  add column if not exists reward_qty integer not null default 0;

create or replace function public.spawn_detour(p_area text, p_lng double precision, p_lat double precision)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  spot public.places%rowtype;
  roll double precision := random();
  pick integer;
  d_kind text;
  d_title text;
  d_story text;
  d_coins integer := 0;
  d_relic text;
  d_item text;
  d_qty integer := 0;
  d_prize text;
  d_capacity integer;
  d_minutes integer;
  -- What a Detour can hold besides coins (cruise tokens twice as likely as each relic).
  common text[] := array['shield', 'second_wind', 'jerry_can', 'rain_charm', 'cruise', 'cruise', 'tyre_kit'];
  rare text[] := array['radar', 'fast_pass', 'cruise'];
  flash_titles text[] := array['A merchant''s lost pouch', 'The fallen trinket', 'The tailor''s secret', 'A forgotten parcel'];
  flash_stories text[] := array[
    'A merchant''s mule kicked a pouch loose near %s. Street boys are already sniffing around: it won''t last.',
    'An old woman near %s swears something glowing fell off a danfo''s roof. Get there before the sweepers do.',
    'A tailor near %s sewed something strange into a coat hem and left it on the line. Quick, before the owner comes back.',
    'A dispatch rider dropped a parcel in a street near %s and rode off. Someone will pick it up soon.'];
  rush_titles text[] := array['Gold at the roadside', 'The drummer''s call', 'The generous madam'];
  rush_stories text[] := array[
    'A courier''s bag split open near %s. The first %s hunters to get there share what fell out.',
    'A drummer in a street near %s will reward the first %s hunters who find him. After that, he packs up and goes.',
    'A rich madam near %s is celebrating, and the first %s hunters to greet her get a gift.'];
  flash_rush_titles text[] := array['The smugglers'' stash', 'The vanishing stall'];
  flash_rush_stories text[] := array[
    'Smugglers hid a stash near %s. The first %s hunters to crack its lock take a share, and the police are on their way.',
    'A stall near %s appears for only half an hour and serves only the first %s customers. Its goods are rare.'];
begin
  -- A place with its street spot found, if any (in the streets, off the main roads).
  select * into spot from public.places
   where lat between p_lat - 0.04 and p_lat + 0.04 and lng between p_lng - 0.04 and p_lng + 0.04
     and public.distance_m(p_lng, p_lat, lng, lat) between 500 and 4000
   order by street_lng is null, random() limit 1;
  if spot.id is null then
    return; -- no named places around here (yet)
  end if;

  if roll < 0.5 then
    d_kind := 'flash';
    d_minutes := 20 + floor(random() * 21)::integer;
    pick := 1 + floor(random() * array_length(flash_titles, 1))::integer;
    d_title := flash_titles[pick];
    d_story := format(flash_stories[pick], spot.name);
    if random() < 0.5 then d_coins := 30 + floor(random() * 51)::integer;
    else d_prize := common[1 + floor(random() * array_length(common, 1))::integer]; end if;
  elsif roll < 0.8 then
    d_kind := 'rush';
    d_minutes := 60;
    d_capacity := 5 + floor(random() * 16)::integer;
    pick := 1 + floor(random() * array_length(rush_titles, 1))::integer;
    d_title := rush_titles[pick];
    d_story := format(rush_stories[pick], spot.name, d_capacity);
    if random() < 0.45 then d_coins := 40 + floor(random() * 61)::integer;
    else d_prize := common[1 + floor(random() * array_length(common, 1))::integer]; end if;
  else
    d_kind := 'flash_rush';
    d_minutes := 30;
    d_capacity := 3 + floor(random() * 6)::integer;
    pick := 1 + floor(random() * array_length(flash_rush_titles, 1))::integer;
    d_title := flash_rush_titles[pick];
    d_story := format(flash_rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_prize := rare[1 + floor(random() * array_length(rare, 1))::integer];
    else d_coins := 120 + floor(random() * 81)::integer; end if;
  end if;
  if d_prize = 'cruise' then
    d_item := 'cruise';
    d_qty := case d_kind when 'flash' then 2 when 'rush' then 3 else 4 end;
  elsif d_prize = 'tyre_kit' then
    d_item := 'tyre_kit';
    d_qty := 1;
  else
    d_relic := d_prize;
  end if;

  insert into public.detours (kind, area, title, story, place_name, lng, lat, reward_coins, reward_relic, reward_item, reward_qty, capacity, ends_at)
  values (d_kind, p_area, d_title, d_story, spot.name, coalesce(spot.street_lng, spot.lng), coalesce(spot.street_lat, spot.lat),
          d_coins, d_relic, d_item, d_qty, d_capacity, now() + make_interval(mins => d_minutes));
end;
$function$;

-- ---- News for everyone --------------------------------------------------------------------------------------------
create table if not exists public.world_news (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind in ('relic', 'lamp')),
  prize   text not null,         -- a relic, 'cruise' or 'tyre_kit'
  qty     integer not null default 1,
  place   text
);
create index if not exists world_news_at on public.world_news (at);
alter table public.world_news enable row level security; -- read only through world_news()

create or replace function public.announce(p_user uuid, p_kind text, p_prize text, p_qty integer, p_place text)
returns void language sql security definer set search_path = '' as $$
  insert into public.world_news (user_id, kind, prize, qty, place) values (p_user, p_kind, p_prize, p_qty, p_place);
$$;
revoke all on function public.announce(uuid, text, text, integer, text) from public, anon, authenticated;

-- The news since the last look (at most the last 2 minutes, the latest 10); the first look only sets the clock.
create or replace function public.world_news(p_since timestamptz default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('now', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('at', n.at, 'kind', n.kind, 'prize', n.prize, 'qty', n.qty, 'place', n.place,
                                        'who', coalesce(p.username, 'A hunter'), 'mine', n.user_id = auth.uid()) order by n.at)
      from (select * from public.world_news
             where at > greatest(coalesce(p_since, now()), now() - interval '2 minutes')
             order by at desc limit 10) n
      left join public.profiles p on p.id = n.user_id), '[]'::jsonb));
$$;
revoke all on function public.world_news(timestamptz) from public, anon;
grant execute on function public.world_news(timestamptz) to authenticated;

-- ---- Claiming a Detour: the new prizes, and the news ---------------------------------------------------------------
create or replace function public.answer_detour(p_detour uuid, p_choice integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  claim public.detour_claims%rowtype;
  d public.detours%rowtype;
  right_answer integer;
  result text;
  balance bigint;
  got_coins integer;
  got_relic text;
  got_qty integer := 0;
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
      perform public.announce(uid, 'lamp', got_relic, 1, d.place_name);
    end if;
    if d.reward_item = 'cruise' then
      -- Cruise tokens, up to the most a hunter can hold.
      update public.profiles set cruise_tokens = least(public.cruise_max(), cruise_tokens + d.reward_qty) where id = uid;
      got_qty := d.reward_qty;
      perform public.announce(uid, 'lamp', 'cruise', d.reward_qty, d.place_name);
    elsif d.reward_item = 'tyre_kit' then
      insert into public.player_items (user_id, item, qty) values (uid, 'tyre_kit', d.reward_qty)
      on conflict (user_id, item) do update set qty = public.player_items.qty + excluded.qty;
      got_qty := d.reward_qty;
      perform public.announce(uid, 'lamp', 'tyre_kit', d.reward_qty, d.place_name);
    end if;
  end if;
  update public.detour_claims set outcome = result, answered_at = now() where detour_id = p_detour and user_id = uid;
  return jsonb_build_object('ok', true, 'outcome', result, 'answer', claim.question -> 'choices' ->> right_answer,
    'coins', case when result = 'won' then got_coins else 0 end,
    'relic', case when result = 'won' then got_relic end,
    'item', case when result = 'won' then d.reward_item end, 'qty', got_qty, 'balance', balance);
end;
$function$;

-- ---- The lamp shows the new prizes ----------------------------------------------------------------------------------
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

-- ---- Picking up a relic on the map: the news --------------------------------------------------------------------------
create or replace function public.pickup_item(p_item uuid, p_lng double precision, p_lat double precision, p_mode text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    perform public.announce(uid, 'relic', item.relic, 1, null); -- everyone hears of it (owner, 26 Oct 2026)
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
$function$;
