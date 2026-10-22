-- Riding past a police checkpoint (owner, 22 Oct 2026: "Chance of a fine"): p_choice -3 at a checkpoint. Usually
-- you get away with it (60%); caught, the fine is 2.5 times what stopping costs (50 coins with your papers in order)
-- and you're held 60 s while it's written up. On average it costs about what stopping does: a gamble, not a free
-- pass. Stored as 'fined' (caught) or 'declined' (got away); the game is told 'caught' or 'escaped'.

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
  told text; -- what the game is told, when it differs from what's stored
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

  if e.kind = 'checkpoint' and p_choice = -3 then
    if random() < 0.4 then
      select least((50 * greatest(1, cardinality(e.missing)))::integer, coins)::integer into fine from public.profiles where id = uid;
      if fine > 0 then
        balance := public.apply_coin_change(uid, -fine, 'spend', 'Caught riding past a police checkpoint', null);
      end if;
      result := 'fined';
      told := 'caught';
    else
      result := 'declined';
      told := 'escaped';
    end if;
  elsif e.kind = 'checkpoint' then
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
  return jsonb_build_object('ok', true, 'outcome', coalesce(told, result), 'right', right_answer,
    'correct', case when e.question is not null then e.question -> 'choices' ->> (e.question ->> 'answer')::integer end,
    'fine', fine, 'reward', reward, 'hint', hint, 'gift', gift, 'balance', balance, 'missing', to_jsonb(e.missing),
    'holdS', case when told = 'caught' then 60 when result in ('fined', 'helped') then 15 else 0 end);
end;
$$;
