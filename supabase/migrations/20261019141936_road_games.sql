-- Games with the people met on the road (owner, 19 Oct 2026: "for those lost on the way, or passersby that they meet,
-- let them play a game, like mate in 1 chess… not just options riddle"). A passer-by (the seller's place) mostly
-- challenges you to a game for 25 coins (a riddle now and then); a stranded traveller you've helped offers one for
-- 20. The games: mate in one (puzzles from scripts/build-chess-puzzles.mjs, each with exactly one mating move), the
-- three cups (find the coin after the shuffle), and pairs (turn the cards two at a time, find all six pairs with at
-- most six misses). The answers stay here: the player sends a move, the server judges it.

create table if not exists public.chess_puzzles (
  id       integer generated always as identity primary key,
  fen      text not null unique,
  solution text not null, -- the one mating move, from and to squares (e.g. g4c8)
  san      text not null  -- the same in chess notation (Qc8#), to show after
);
alter table public.chess_puzzles enable row level security; -- no policies: read only through the functions below

alter table public.road_events add column if not exists game jsonb;           -- a game to play, with its answer
alter table public.road_events add column if not exists played_at timestamptz;
alter table public.road_events add column if not exists game_won boolean;

/** A game for the road: mate in one, the three cups, or pairs (with what the server needs to judge it). */
create or replace function public.road_game(p_type text default null) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  t text := p_type;
  pz public.chess_puzzles%rowtype;
  first_cup integer;
  under integer;
  swaps jsonb := '[]'::jsonb;
  a integer;
  b integer;
  n integer;
  cards jsonb;
begin
  if t is null then
    t := (array['chess', 'cups', 'pairs'])[1 + floor(random() * 3)::integer];
  end if;
  if t = 'chess' then
    select * into pz from public.chess_puzzles order by random() limit 1;
    if pz.id is not null then
      return jsonb_build_object('type', 'chess', 'fen', pz.fen, 'answer', pz.solution, 'san', pz.san);
    end if;
    t := 'cups';
  end if;
  if t = 'cups' then
    -- The coin under a cup, then 5 to 8 swaps of two cups; it ends under `answer`.
    first_cup := floor(random() * 3)::integer;
    under := first_cup;
    n := 5 + floor(random() * 4)::integer;
    for i in 1 .. n loop
      a := floor(random() * 3)::integer;
      b := (a + 1 + floor(random() * 2)::integer) % 3;
      swaps := swaps || jsonb_build_array(jsonb_build_array(a, b));
      if under = a then under := b; elsif under = b then under := a; end if;
    end loop;
    return jsonb_build_object('type', 'cups', 'start', first_cup, 'swaps', swaps, 'ms', 520, 'answer', under::text);
  end if;
  -- Pairs: six pictures, twice each, shuffled.
  select jsonb_agg(c order by random()) into cards
    from (select c from unnest(array['🥭', '🌶️', '🥥', '🍌', '🐐', '🥁', '🛺', '⚽', '🍍', '🦜']) as c order by random() limit 6) six,
         generate_series(1, 2);
  return jsonb_build_object('type', 'pairs', 'cards', cards, 'misses', 6);
end;
$$;
revoke execute on function public.road_game(text) from public, anon, authenticated;

/** Pairs, replayed: the flips two at a time; won if every card is matched with at most `misses` wrong pairs. */
create or replace function public.pairs_won(p_cards jsonb, p_flips jsonb, p_misses integer) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n integer := jsonb_array_length(p_cards);
  matched boolean[] := array_fill(false, array[jsonb_array_length(p_cards)]);
  found integer := 0;
  wrong integer := 0;
  a integer;
  b integer;
begin
  if jsonb_typeof(p_flips) <> 'array' or jsonb_array_length(p_flips) % 2 <> 0 or jsonb_array_length(p_flips) > 4 * n then
    return false;
  end if;
  for i in 0 .. jsonb_array_length(p_flips) / 2 - 1 loop
    a := (p_flips ->> (2 * i))::integer;
    b := (p_flips ->> (2 * i + 1))::integer;
    if a is null or b is null or a = b or a < 0 or b < 0 or a >= n or b >= n or matched[a + 1] or matched[b + 1] then
      return false;
    end if;
    if p_cards ->> a = p_cards ->> b then
      matched[a + 1] := true;
      matched[b + 1] := true;
      found := found + 2;
    else
      wrong := wrong + 1;
    end if;
  end loop;
  return found = n and wrong <= p_misses;
end;
$$;

-- What the player sees: the game without its answer (the cups' shuffle is shown move by move anyway).
create or replace function public.road_event_json(e public.road_events) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'kind', e.kind, 'npc', e.npc,
    'prompt', e.question ->> 'prompt', 'choices', e.question -> 'choices', 'missing', to_jsonb(e.missing),
    'game', case when e.game is not null then e.game - 'answer' - 'san' end, 'played', e.played_at is not null);
$$;

create or replace function public.road_event_roll(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  pos public.player_positions%rowtype;
  e public.road_events%rowtype;
  what text;
  in_hunt boolean;
  missing text[];
  officers text[] := array['Officer Bello', 'Inspector Okafor', 'Sergeant Ade', 'Officer Musa'];
  travellers text[] := array['Mr Femi', 'Blessing', 'Uncle Joe', 'Aisha', 'Emeka'];
  sellers text[] := array['Mama Titi', 'Iya Basira', 'Aunty Grace', 'Mama Nkechi'];
  -- Who plays which game by the road: an old chess player, a cups hustler, children with their cards.
  chess_players text[] := array['Baba Sola', 'Uncle Ikenna', 'Mallam Sani', 'Pa Adewale'];
  cup_men text[] := array['Tunde Wayo', 'Sharp Kola', 'Emeka Cups', 'Bobo Lagos'];
  card_kids text[] := array['Little Bisi', 'Chidi and Ada', 'Tobi', 'Zainab'];
  g jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_hunt is not null then
    select * into h from public.hunts where id = p_hunt and published;
    select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  end if;
  in_hunt := h.id is not null and public.hunt_phase(h) = 'live' and hp.user_id is not null and hp.finished_at is null;
  -- One still waiting for an answer (a reload): the same one.
  select * into e from public.road_events where user_id = uid and resolved_at is null and created_at > now() - interval '3 minutes' order by id desc limit 1;
  if e.id is not null then
    return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
  end if;
  if exists (select 1 from public.road_events where user_id = uid and created_at > now() - interval '4 minutes') or random() >= 1.0 / 3 then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  if (in_hunt and exists (select 1 from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active'))
     or exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', true, 'event', null);
  end if;
  select * into pos from public.player_positions where user_id = uid;
  missing := public.missing_papers(uid, pos.mode, pos.lng, pos.lat);
  if pos.mode in ('motorbike', 'car') then
    what := case when random() < 0.6 then 'checkpoint' else 'traveller' end;
  elsif pos.mode = 'bicycle' and cardinality(missing) > 0 then
    what := case when random() < 0.5 then 'checkpoint' else 'seller' end; -- riding without a light at night
  else
    what := case when random() < 0.5 then 'seller' else 'traveller' end;
  end if;
  -- A passer-by mostly brings a game (a riddle now and then); a traveller has one to offer once you've helped.
  g := case when what = 'traveller' or (what = 'seller' and random() < 0.7) then public.road_game() end;
  insert into public.road_events (user_id, hunt_id, kind, npc, question, missing, game)
  values (uid, case when in_hunt then p_hunt end, what,
          case when what = 'checkpoint' then officers[1 + floor(random() * array_length(officers, 1))::integer]
               when what = 'seller' and g ->> 'type' = 'chess' then chess_players[1 + floor(random() * 4)::integer]
               when what = 'seller' and g ->> 'type' = 'cups' then cup_men[1 + floor(random() * 4)::integer]
               when what = 'seller' and g ->> 'type' = 'pairs' then card_kids[1 + floor(random() * 4)::integer]
               when what = 'seller' then sellers[1 + floor(random() * array_length(sellers, 1))::integer]
               else travellers[1 + floor(random() * array_length(travellers, 1))::integer] end,
          case when what = 'checkpoint' then public.road_safety_question()
               when what = 'seller' and g is null then public.make_classic_question(case when random() < 0.5 then 'nigeria' else 'general' end, 1) - 'bank_id' end,
          case when what = 'checkpoint' then missing else '{}' end,
          g)
  returning * into e;
  return jsonb_build_object('ok', true, 'event', public.road_event_json(e));
end;
$$;

/** Playing the game of a passer-by (before answering anything) or of a traveller you've just helped: won or not. */
create or replace function public.road_event_play(p_event bigint, p_move text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  won boolean;
  reward integer := 0;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into e from public.road_events where id = p_event and user_id = uid for update;
  if e.id is null or e.game is null or e.played_at is not null or e.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if (e.kind = 'seller' and e.resolved_at is not null) or (e.kind = 'traveller' and e.outcome is distinct from 'helped') or e.kind = 'checkpoint' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  won := case e.game ->> 'type'
    when 'chess' then lower(trim(coalesce(p_move, ''))) = e.game ->> 'answer'
    when 'cups' then trim(coalesce(p_move, '')) = e.game ->> 'answer'
    when 'pairs' then coalesce(public.pairs_won(e.game -> 'cards', p_move::jsonb, (e.game ->> 'misses')::integer), false)
    else false end;
  if won then
    reward := case when e.kind = 'seller' then 25 else 20 end;
    balance := public.apply_coin_change(uid, reward, 'earn',
      case e.game ->> 'type' when 'chess' then 'Mate in one on the road' when 'cups' then 'Found the coin under the cup' else 'All the pairs on the road' end,
      'road-game:' || e.id);
  end if;
  update public.road_events
     set played_at = now(), game_won = won,
         resolved_at = coalesce(resolved_at, now()),
         outcome = case when kind = 'seller' then case when won then 'won' else 'lost' end else outcome end
   where id = e.id;
  if balance is null then
    select coins into balance from public.profiles where id = uid;
  end if;
  return jsonb_build_object('ok', true, 'won', won, 'reward', reward, 'balance', balance,
    'answer', e.game ->> 'answer', 'san', e.game ->> 'san');
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'reason', 'move');
end;
$$;
revoke execute on function public.road_event_play(bigint, text) from public, anon;
grant execute on function public.road_event_play(bigint, text) to authenticated;
