-- A trial names the key it's for, not its stop (relay keys: stop 3 after a relay chest is Key 2).
create or replace function public.trial_view(t public.trial_attempts, p_seconds integer)
returns jsonb language sql stable set search_path = '' as $$
  select case when t.kind = 'quiz' then jsonb_build_object(
    'attempt', t.id,
    'key', public.stop_key(t.hunt_id, t.key_n),
    'index', t.current,
    'count', jsonb_array_length(t.questions),
    'prompt', t.questions -> t.current ->> 'prompt',
    'choices', t.questions -> t.current -> 'choices',
    'show', t.questions -> t.current ->> 'show',
    'showSeconds', coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0),
    'seconds', p_seconds,
    'secondsLeft', greatest(0, p_seconds + coalesce((t.questions -> t.current ->> 'showSeconds')::integer, 0) - extract(epoch from now() - t.asked_at)))
  else jsonb_build_object(
    'attempt', t.id,
    'key', public.stop_key(t.hunt_id, t.key_n),
    'kind', 'puzzle',
    'puzzleKind', t.kind,
    'level', t.level,
    'puzzle', t.puzzle,
    'lives', t.lives,
    'seconds', public.puzzle_seconds(t.kind, t.level),
    'secondsLeft', case when t.deadline is null then null else greatest(0, extract(epoch from t.deadline - now())) end)
  end;
$$;
