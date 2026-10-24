-- The hunt card names the next key's trial: a puzzle (which one, if the key is set to one) or a quiz's category.

create or replace function public.hunt_state(p_hunt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  k public.hunt_keys%rowtype;
  t public.trial_attempts%rowtype;
  phase text;
  thrown jsonb;
begin
  select * into h from public.hunts where id = p_hunt and published;
  if not found then
    return null;
  end if;
  thrown := public.settle_trial(p_hunt, uid);
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  phase := public.hunt_phase(h);

  if hp.user_id is not null and phase = 'live' and hp.finished_at is null then
    select * into k from public.hunt_keys where hunt_id = p_hunt and n = hp.keys_held + 1;
    select * into t from public.trial_attempts where hunt_id = p_hunt and user_id = uid and status = 'active';
  end if;

  return jsonb_build_object(
    'id', h.id, 'title', h.title, 'prize', h.prize, 'winners', h.winners,
    'startsAt', h.starts_at, 'endsAt', h.ends_at, 'phase', phase,
    'keys', public.real_keys(p_hunt), 'joined', hp.user_id is not null,
    'keysHeld', public.keys_in(p_hunt, coalesce(hp.keys_held, 0)), 'finishedAt', hp.finished_at, 'place', hp.place,
    'winnersFound', (select count(*) from public.hunt_players p where p.hunt_id = p_hunt and p.finished_at is not null),
    'riddle', k.riddle, 'category', k.category, 'trialKind', k.trial_kind,
    -- On a relay's trail: the stop before this one was a relay chest (the key is at this one, or further on).
    'trail', coalesce(k.n is not null and exists (select 1 from public.hunt_keys r where r.hunt_id = p_hunt and r.n = k.n - 1 and r.relay), false),
    'clue', case when k.n is not null and hp.approach_key = k.n then coalesce(k.approach_clue, 'You''re in the right area. Follow the heat to the exact spot.') end,
    'trial', case when t.id is not null then public.trial_view(t, h.seconds_per_question) end,
    'thrown', thrown);
end;
$$;
