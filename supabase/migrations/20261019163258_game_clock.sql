-- A clock on the roadside games (owner, 19 Oct 2026: "let there be some form of urgency, add a countdown timer"):
-- 30 seconds for mate in one, 6 seconds to pick a cup once the shuffle ends, 50 seconds for pairs. The clock starts
-- when the player taps Play (road_event_game_start); a move that comes after the time (and 4 seconds' grace for the
-- network) loses.

alter table public.road_events add column if not exists game_started_at timestamptz;

/** The seconds a game allows from Play: its own clock, and for the cups the showing and the shuffle before it. */
create or replace function public.road_game_seconds(g jsonb) returns double precision
language sql immutable set search_path = '' as $$
  select coalesce((g ->> 'seconds')::double precision, case g ->> 'type' when 'chess' then 30 when 'pairs' then 50 else 6 end)
       + case when g ->> 'type' = 'cups'
              then 1.5 + jsonb_array_length(coalesce(g -> 'swaps', '[]'::jsonb)) * coalesce((g ->> 'ms')::double precision, 520) / 1000
              else 0 end;
$$;

/** Play tapped: the clock starts (once). */
create or replace function public.road_event_game_start(p_event bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  update public.road_events set game_started_at = coalesce(game_started_at, now())
   where id = p_event and user_id = uid and game is not null and played_at is null
  returning * into e;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  return jsonb_build_object('ok', true, 'seconds', public.road_game_seconds(e.game), 'startedAt', e.game_started_at);
end;
$$;
revoke execute on function public.road_event_game_start(bigint) from public, anon;
grant execute on function public.road_event_game_start(bigint) to authenticated;

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
      return jsonb_build_object('type', 'chess', 'fen', pz.fen, 'answer', pz.solution, 'san', pz.san, 'seconds', 30);
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
    return jsonb_build_object('type', 'cups', 'start', first_cup, 'swaps', swaps, 'ms', 520, 'answer', under::text, 'seconds', 6);
  end if;
  -- Pairs: six pictures, twice each, shuffled.
  select jsonb_agg(c order by random()) into cards
    from (select c from unnest(array['🥭', '🌶️', '🥥', '🍌', '🐐', '🥁', '🛺', '⚽', '🍍', '🦜']) as c order by random() limit 6) six,
         generate_series(1, 2);
  return jsonb_build_object('type', 'pairs', 'cards', cards, 'misses', 6, 'seconds', 50);
end;
$$;

create or replace function public.road_event_play(p_event bigint, p_move text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e public.road_events%rowtype;
  won boolean;
  late boolean;
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
  -- Against the clock (owner, 19 Oct 2026: "some form of urgency"): a move after the time is up loses.
  late := e.game_started_at is null or now() > e.game_started_at + make_interval(secs => public.road_game_seconds(e.game) + 4);
  won := not late and case e.game ->> 'type'
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
  return jsonb_build_object('ok', true, 'won', won, 'late', late, 'reward', reward, 'balance', balance,
    'answer', e.game ->> 'answer', 'san', e.game ->> 'san');
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'reason', 'move');
end;
$$;
