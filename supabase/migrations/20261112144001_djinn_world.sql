-- The Djinn's world (owner, 12 Nov 2026: "when I got to taj marha, a location I picked from the jinee, nothing happened.
-- IT should at least tell me, if it was the right location or wrong… we make it like the key location. They go in to the
-- 3d world, solve some puzzle roam the world and find nothing, except traps… Let it have 3 puzzles to solve"). Within
-- 300 m of the place chosen from the seals, "Explore the place" opens a town of its own, as at a key: six places, one of
-- them the Djinn's vault (its first lock), three of them traps, and small houses with boxes (traps and sand) and the
-- chain's second and third locks. Behind the third lock: the Wonder at the real place; an empty vault at a false one.
-- A lock out of time jams for 30 s, then has a new puzzle. This replaces the old 60 m chamber.
set lock_timeout = '8s';

create table public.djinn_worlds (
  user_id uuid not null references auth.users (id) on delete cascade,
  wager_id uuid not null references public.djinn_wagers (id) on delete cascade,
  site_id bigint not null references public.djinn_sites (id),
  room text,
  dug text,
  out_until timestamptz,
  dodge jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, wager_id)
);
alter table public.djinn_worlds enable row level security; -- only the game's functions read and write it

create table public.djinn_world_puzzles (
  user_id uuid not null,
  wager_id uuid not null,
  room integer not null check (room between 1 and 7),
  kind text not null,
  puzzle jsonb not null,
  solution jsonb not null,
  started_at timestamptz not null default now(),
  seconds integer not null default 60,
  tries integer not null default 0,
  solved_at timestamptz,
  outcome text check (outcome in ('lock', 'trap', 'dust', 'wonder', 'empty', 'too_late')),
  primary key (user_id, wager_id, room),
  foreign key (user_id, wager_id) references public.djinn_worlds (user_id, wager_id) on delete cascade
);
alter table public.djinn_world_puzzles enable row level security;

-- The town at a place: six places named for its setting, which of them is the vault and which are traps its own for each
-- player and wager (never said to the player: only the server knows).
create or replace function public.djinn_world_spec(p_site public.djinn_sites, p_user uuid, p_wager uuid)
returns jsonb
language sql
stable
set search_path to ''
as $$
  with names(ord, id, name, kind) as (
    select * from (values
      (1, 'p1', case p_site.setting when 'desert' then 'The caravan inn' when 'coast' then 'The harbour store' when 'river' then 'The boatmen''s rest' when 'jungle' then 'The vine-covered shrine' when 'mountain' then 'The shepherds'' hut' else 'The caretaker''s lodge' end, 'parlour'),
      (2, 'p2', case p_site.kind when 'tomb' then 'The mourners'' hall' when 'temple' then 'The priests'' house' when 'fortress' then 'The old guardhouse' when 'natural' then 'The ranger''s cabin' else 'The scribes'' room' end, 'library'),
      (3, 'p3', 'The old cistern', 'cellar'),
      (4, 'p4', 'The lamp-seller''s shop', 'storeroom'),
      (5, 'p5', case p_site.kind when 'tomb' then 'The marble gatehouse' when 'temple' then 'The incense store' when 'fortress' then 'The armoury' when 'lost_city' then 'The buried hall' else 'The stonecutters'' yard' end, 'chapel'),
      (6, 'p6', 'The pilgrims'' rest', 'bedroom')
    ) v
  ),
  shuffled as (
    select n.*, row_number() over (order by md5(p_user::text || ':' || p_wager::text || ':' || n.id)) as k from names n
  )
  select jsonb_build_object(
    'title', 'The Djinn''s ground at ' || p_site.name,
    'style', case p_site.kind when 'fortress' then 'fort' when 'natural' then 'cave' when 'monument' then 'manor' else 'stone' end,
    'layout', 'court',
    'scene', jsonb_build_object(
      'ground', case p_site.setting when 'desert' then 'desert' when 'city' then 'city' else 'laterite' end,
      'pieces', case when p_site.setting = 'river' then '["river"]'::jsonb else '[]'::jsonb end),
    'rooms', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind,
                'role', case when s.k = 1 then 'right' when s.k <= 4 then 'trap' else 'safe' end) order by s.ord) from shuffled s));
$$;

-- Where the player is in the Djinn's world: their open wager and chosen place (no vault opened yet), within 300 m of it,
-- not racing in a hunt. Their state in the world (made the first time).
create or replace function public.djinn_world_here(p_user uuid)
returns table (wager_id uuid, real_site bigint, s public.djinn_sites, w public.djinn_worlds, reason text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  q record;
  pos public.player_positions%rowtype;
begin
  if p_user is null then
    reason := 'none'; return next; return;
  end if;
  if public.racing_now(p_user) then
    reason := 'hunting'; return next; return;
  end if;
  select * into q from public.djinn_my_quest(p_user);
  if q.wager_id is null then
    reason := 'none'; return next; return;
  end if;
  select * into s from public.djinn_sites ds where ds.id = q.site_id;
  select * into pos from public.player_positions pp where pp.user_id = p_user;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, s.lng, s.lat) > 320 then
    reason := 'far'; return next; return;
  end if;
  insert into public.djinn_worlds (user_id, wager_id, site_id) values (p_user, q.wager_id, q.site_id)
  on conflict on constraint djinn_worlds_pkey do nothing;
  select * into w from public.djinn_worlds dw where dw.user_id = p_user and dw.wager_id = q.wager_id for update;
  wager_id := q.wager_id;
  real_site := q.real_site;
  return next;
end;
$$;

-- What the player sees (as house_public: the places, never which is which; the boxes, shut or opened).
create or replace function public.djinn_world_public(p_site public.djinn_sites, w public.djinn_worlds)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with spec as (select public.djinn_world_spec(p_site, w.user_id, w.wager_id) as j)
  select jsonb_build_object(
    'key', 0,
    'djinn', true,
    'place', p_site.name,
    'title', spec.j ->> 'title',
    'style', spec.j ->> 'style',
    'layout', spec.j ->> 'layout',
    'scene', spec.j -> 'scene',
    'room', w.room,
    'dug', w.dug,
    'outUntil', w.out_until,
    'rooms', (select jsonb_agg(jsonb_build_object('id', r ->> 'id', 'name', r ->> 'name', 'kind', r ->> 'kind', 'outdoor', false, 'locked', false,
                'chest', coalesce((r ->> 'role') = 'right' and w.dug = (r ->> 'id'), false)) order by ord)
              from jsonb_array_elements(spec.j -> 'rooms') with ordinality as x(r, ord)),
    'objects', '[]'::jsonb,
    'items', '[]'::jsonb,
    'inner', (select jsonb_agg(jsonb_build_object('n', g, 'open', p.solved_at is not null, 'outcome', p.outcome) order by g)
                from generate_series(1, 7) g
                left join public.djinn_world_puzzles p on p.user_id = w.user_id and p.wager_id = w.wager_id and p.room = g),
    'at', jsonb_build_object('lng', p_site.lng, 'lat', p_site.lat))
  from spec;
$$;

-- Is the player in the vault (the right place, walked into)?
create or replace function public.djinn_world_inside(p_site public.djinn_sites, w public.djinn_worlds)
returns boolean
language sql
stable
set search_path to ''
as $$
  select w.dug is not null and exists (
    select 1 from jsonb_array_elements(public.djinn_world_spec(p_site, w.user_id, w.wager_id) -> 'rooms') r
     where r ->> 'id' = w.dug and r ->> 'role' = 'right')
$$;

-- A trap of the Djinn's (the hunt's penalties belong to a hunt): sand, darts or smoke; out of the place a while.
create or replace function public.djinn_world_penalty(p_user uuid, p_wager uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  pick integer := 1 + floor(random() * 3)::integer;
  have bigint;
  cost integer := 0;
  balance bigint;
  energy_now integer;
  free_at timestamptz := now() + interval '15 seconds';
  title text;
  body text;
  scene text;
  effect text;
begin
  if pick = 1 then
    title := 'The sinking sand';
    body := 'The floor tips you into a pit of sand. You claw your way out, but your purse is lighter.';
    scene := 'fall';
    effect := 'coins';
    select coins into have from public.profiles where id = p_user;
    cost := least(20, coalesce(have, 0))::integer;
    balance := case when cost > 0 then public.apply_coin_change(p_user, -cost, 'spend', 'A trap in the Djinn''s world', null) else coalesce(have, 0) end;
  elsif pick = 2 then
    title := 'The darts of the djinn';
    body := 'Brass darts fly from the walls. You dive clear, but it costs you: 15 energy.';
    scene := 'darts';
    effect := 'energy';
    cost := 15;
    update public.player_positions set energy = greatest(0, energy - 15) where user_id = p_user returning energy into energy_now;
  else
    title := 'The Djinn''s smoke';
    body := 'Purple smoke pours from the cracks and the Djinn laughs. You stagger out, coughing: 20 s before you can go back in.';
    scene := 'smoke';
    effect := 'wait';
    cost := 20;
    free_at := now() + interval '20 seconds';
  end if;
  update public.djinn_worlds set room = null, dodge = null, out_until = free_at
   where user_id = p_user and wager_id = p_wager;
  return jsonb_build_object('code', 'djinn_' || scene, 'tier', 'soft', 'title', title, 'body', body, 'scene', scene,
    'effect', effect, 'amount', cost, 'balance', balance, 'energy', energy_now, 'until', free_at);
end;
$$;

-- ---- What the player does there (signed in: auth.uid()) ----

create or replace function public.djinn_world_view()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  h record;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.djinn_world_here(uid);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  if (h.w).dodge is not null then
    return jsonb_build_object('ok', false, 'reason', 'trapped', 'penalty', public.djinn_world_penalty(uid, h.wager_id));
  end if;
  update public.player_positions set lng = (h.s).lng, lat = (h.s).lat, updated_at = now() where user_id = uid;
  return jsonb_build_object('ok', true) || public.djinn_world_public(h.s, h.w);
end;
$$;

create or replace function public.djinn_world_step(p_room text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  h record;
  w public.djinn_worlds%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.djinn_world_here(uid);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  if (h.w).dodge is not null then
    return jsonb_build_object('ok', false, 'reason', 'dodge');
  end if;
  if p_room is not null and not exists (select 1 from jsonb_array_elements(public.djinn_world_spec(h.s, uid, h.wager_id) -> 'rooms') r where r ->> 'id' = p_room) then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  update public.djinn_worlds set room = p_room where user_id = uid and wager_id = h.wager_id returning * into w;
  return jsonb_build_object('ok', true) || public.djinn_world_public(h.s, w);
end;
$$;

-- Walking into a place searches it: a trap's challenge (dodge it in time or it springs), nothing, or the vault.
create or replace function public.djinn_world_enter(p_room text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  h record;
  r jsonb;
  challenge jsonb;
  w public.djinn_worlds%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.djinn_world_here(uid);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  w := h.w;
  if w.dodge is not null then
    if (w.dodge ->> 'until')::timestamptz < now() then
      return jsonb_build_object('ok', true, 'trap', true, 'penalty', public.djinn_world_penalty(uid, h.wager_id));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'dodge');
  end if;
  if w.out_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'out', 'until', w.out_until);
  end if;
  select x into r from jsonb_array_elements(public.djinn_world_spec(h.s, uid, h.wager_id) -> 'rooms') x where x ->> 'id' = p_room;
  if r is null then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if r ->> 'role' = 'trap' then
    challenge := public.house_challenge();
    update public.djinn_worlds set dodge = jsonb_build_object('room', p_room, 'answer', challenge -> 'answer', 'until', now() + interval '7 seconds')
     where user_id = uid and wager_id = h.wager_id;
    return jsonb_build_object('ok', true, 'trap', true,
      'dodge', jsonb_build_object('prompt', challenge -> 'prompt', 'options', challenge -> 'options', 'seconds', 5));
  end if;
  update public.djinn_worlds set room = p_room, dug = p_room where user_id = uid and wager_id = h.wager_id returning * into w;
  return jsonb_build_object('ok', true) || public.djinn_world_public(h.s, w);
end;
$$;

create or replace function public.djinn_world_dodge(p_choice integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  h record;
  d jsonb;
  late boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.djinn_world_here(uid);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  d := (h.w).dodge;
  if d is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  update public.djinn_worlds set dodge = null where user_id = uid and wager_id = h.wager_id;
  late := (d ->> 'until')::timestamptz < now();
  if not late and p_choice = (d ->> 'answer')::integer then
    update public.djinn_worlds set room = null, out_until = now() + interval '3 seconds' where user_id = uid and wager_id = h.wager_id;
    return jsonb_build_object('ok', true, 'dodged', true, 'room', d ->> 'room');
  end if;
  return jsonb_build_object('ok', true, 'dodged', false, 'late', late, 'room', d ->> 'room', 'penalty', public.djinn_world_penalty(uid, h.wager_id));
end;
$$;

-- ---- The locks and boxes (the game's server only: /api/djinn/room makes and checks the puzzles) ----

-- What each box holds: the vault's lock (1), four boxes in the houses (two traps, two of sand), the second lock (6) and
-- the last (7: the vault itself).
create or replace function public.djinn_world_order(p_user uuid, p_wager uuid)
returns text[]
language sql
immutable
set search_path to ''
as $$
  select array['lock'] || (select array_agg(c order by md5(p_user::text || ':' || p_wager::text || ':' || ord))
    from unnest(array['trap', 'dust', 'trap', 'dust']) with ordinality as x(c, ord)) || array['lock', 'vault']
$$;

create or replace function public.djinn_world_chain_waiting(p_user uuid, p_wager uuid, p_room integer)
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select before from (select case p_room when 6 then 1 when 7 then 6 end as before) b
   where before is not null
     and not exists (select 1 from public.djinn_world_puzzles p
                      where p.user_id = p_user and p.wager_id = p_wager and p.room = b.before and p.solved_at is not null);
$$;

create or replace function public.djinn_world_room_try(p_user uuid, p_room integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h record;
  v public.djinn_world_puzzles%rowtype;
begin
  select * into h from public.djinn_world_here(p_user);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  if p_room is null or p_room not between 1 and 7 then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if p_room = 1 and not public.djinn_world_inside(h.s, h.w) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  if public.djinn_world_chain_waiting(p_user, h.wager_id, p_room) is not null then
    return jsonb_build_object('ok', false, 'reason', 'chain');
  end if;
  select * into v from public.djinn_world_puzzles where user_id = p_user and wager_id = h.wager_id and room = p_room;
  if v.room is null then
    return jsonb_build_object('ok', true, 'try', 0, 'wager', h.wager_id);
  end if;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'open', true, 'outcome', v.outcome);
  end if;
  if now() <= v.started_at + make_interval(secs => v.seconds + 3) then
    return jsonb_build_object('ok', true, 'try', v.tries, 'wager', h.wager_id);
  end if;
  if now() < v.started_at + make_interval(secs => v.seconds + 33) then
    return jsonb_build_object('ok', false, 'reason', 'jammed', 'seconds', ceil(extract(epoch from v.started_at + make_interval(secs => v.seconds + 33) - now())));
  end if;
  return jsonb_build_object('ok', true, 'try', v.tries + 1, 'wager', h.wager_id);
end;
$$;

create or replace function public.djinn_world_room_ready(p_user uuid, p_room integer, p_kind text, p_puzzle jsonb, p_solution jsonb, p_try integer, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h record;
  v public.djinn_world_puzzles%rowtype;
  secs integer := greatest(20, least(300, coalesce(p_seconds, 60)));
begin
  select * into h from public.djinn_world_here(p_user);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  if p_room is null or p_room not between 1 and 7 then
    return jsonb_build_object('ok', false, 'reason', 'no_room');
  end if;
  if p_room = 1 and not public.djinn_world_inside(h.s, h.w) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  if public.djinn_world_chain_waiting(p_user, h.wager_id, p_room) is not null then
    return jsonb_build_object('ok', false, 'reason', 'chain');
  end if;
  insert into public.djinn_world_puzzles (user_id, wager_id, room, kind, puzzle, solution, started_at, tries, seconds)
  values (p_user, h.wager_id, p_room, p_kind, p_puzzle, p_solution, now(), coalesce(p_try, 0), secs)
  on conflict (user_id, wager_id, room) do update
     set kind = excluded.kind, puzzle = excluded.puzzle, solution = excluded.solution, started_at = now(), tries = excluded.tries, seconds = excluded.seconds
   where public.djinn_world_puzzles.solved_at is null and public.djinn_world_puzzles.tries < excluded.tries;
  select * into v from public.djinn_world_puzzles where user_id = p_user and wager_id = h.wager_id and room = p_room;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'open', true, 'outcome', v.outcome);
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'open', false, 'kind', v.kind, 'puzzle', v.puzzle, 'seconds', v.seconds,
    'secondsLeft', greatest(0, ceil(extract(epoch from v.started_at + make_interval(secs => v.seconds) - now()))));
end;
$$;

create or replace function public.djinn_world_room_get(p_user uuid, p_room integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h record;
  v public.djinn_world_puzzles%rowtype;
begin
  select * into h from public.djinn_world_here(p_user);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  select * into v from public.djinn_world_puzzles where user_id = p_user and wager_id = h.wager_id and room = p_room;
  if v.room is null then
    return jsonb_build_object('ok', false, 'reason', 'no_puzzle');
  end if;
  return jsonb_build_object('ok', true, 'kind', v.kind, 'puzzle', v.puzzle, 'solution', v.solution, 'open', v.solved_at is not null,
    'late', v.solved_at is null and now() > v.started_at + make_interval(secs => v.seconds + 3));
end;
$$;

-- A box opened (its puzzle solved): a lock (on to the next), sand, a trap, or behind the last lock the vault: the Wonder
-- at the real place (the Wager won, as the old chamber did), an empty vault at a false one.
create or replace function public.djinn_world_room_open(p_user uuid, p_room integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  h record;
  v public.djinn_world_puzzles%rowtype;
  wg public.djinn_wagers%rowtype;
  got text;
begin
  select * into h from public.djinn_world_here(p_user);
  if h.reason is not null then
    return jsonb_build_object('ok', false, 'reason', h.reason);
  end if;
  if p_room = 1 and not public.djinn_world_inside(h.s, h.w) then
    return jsonb_build_object('ok', false, 'reason', 'not_inside');
  end if;
  select * into v from public.djinn_world_puzzles where user_id = p_user and wager_id = h.wager_id and room = p_room for update;
  if v.room is null then
    return jsonb_build_object('ok', false, 'reason', 'no_puzzle');
  end if;
  if public.djinn_world_chain_waiting(p_user, h.wager_id, p_room) is not null then
    return jsonb_build_object('ok', false, 'reason', 'chain');
  end if;
  if v.solved_at is not null then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', v.outcome, 'already', true);
  end if;
  got := (public.djinn_world_order(p_user, h.wager_id))[p_room];
  if got = 'vault' then
    select * into wg from public.djinn_wagers where id = h.wager_id for update;
    if (h.s).id <> wg.real_site then
      got := 'empty';
      update public.djinn_entries set vault = 'empty' where wager_id = wg.id and user_id = p_user;
    elsif wg.winner is not null or wg.ends_at <= now() then
      got := 'too_late';
    else
      got := 'wonder';
      update public.djinn_wagers set winner = p_user, claimed_at = now() where id = wg.id;
      update public.djinn_entries set vault = 'won' where wager_id = wg.id and user_id = p_user;
      insert into public.player_wonders (user_id, wonder, wager_id) values (p_user, wg.wonder, wg.id);
      if wg.extra_wonder is not null then
        insert into public.player_wonders (user_id, wonder, wager_id) values (p_user, wg.extra_wonder, wg.id);
      end if;
    end if;
  end if;
  update public.djinn_world_puzzles set solved_at = now(), outcome = got where user_id = p_user and wager_id = h.wager_id and room = p_room;
  if got = 'lock' then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'next', case p_room when 1 then 6 else 7 end, 'lock', case p_room when 1 then 1 else 2 end);
  elsif got = 'trap' then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'penalty', public.djinn_world_penalty(p_user, h.wager_id));
  elsif got in ('wonder', 'empty', 'too_late') then
    return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got, 'place', (h.s).name, 'wonder', wg.wonder, 'extraWonder', wg.extra_wonder);
  end if;
  return jsonb_build_object('ok', true, 'room', p_room, 'outcome', got);
end;
$$;

-- The old 60 m chamber gives way to the world (its answers still close any attempt left open).
create or replace function public.djinn_enter_chamber()
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select jsonb_build_object('ok', false, 'reason', 'world')
$$;

-- Who may call what: the player's own moves (signed in), the rest the game's server only.
revoke execute on function public.djinn_world_view(), public.djinn_world_step(text), public.djinn_world_enter(text), public.djinn_world_dodge(integer) from public, anon;
grant execute on function public.djinn_world_view(), public.djinn_world_step(text), public.djinn_world_enter(text), public.djinn_world_dodge(integer) to authenticated, service_role;
revoke execute on function
  public.djinn_world_spec(public.djinn_sites, uuid, uuid), public.djinn_world_here(uuid), public.djinn_world_public(public.djinn_sites, public.djinn_worlds),
  public.djinn_world_inside(public.djinn_sites, public.djinn_worlds), public.djinn_world_penalty(uuid, uuid), public.djinn_world_order(uuid, uuid),
  public.djinn_world_chain_waiting(uuid, uuid, integer), public.djinn_world_room_try(uuid, integer),
  public.djinn_world_room_ready(uuid, integer, text, jsonb, jsonb, integer, integer), public.djinn_world_room_get(uuid, integer),
  public.djinn_world_room_open(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.djinn_world_spec(public.djinn_sites, uuid, uuid), public.djinn_world_here(uuid), public.djinn_world_public(public.djinn_sites, public.djinn_worlds),
  public.djinn_world_inside(public.djinn_sites, public.djinn_worlds), public.djinn_world_penalty(uuid, uuid), public.djinn_world_order(uuid, uuid),
  public.djinn_world_chain_waiting(uuid, uuid, integer), public.djinn_world_room_try(uuid, integer),
  public.djinn_world_room_ready(uuid, integer, text, jsonb, jsonb, integer, integer), public.djinn_world_room_get(uuid, integer),
  public.djinn_world_room_open(uuid, integer)
  to service_role;
