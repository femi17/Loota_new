-- The Djinn's weekly surprise Wager, switched on (owner, 19 Oct 2026). Once a week, at a moment drawn from the week
-- (Monday to Thursday, 9:00 to 20:59 Lagos time; djinn_planned_start), the first player to look at the Djinn after it
-- opens the Wager for everyone, unless a hunt is live (between hunts only the Djinn). A Wager that ended within an
-- hour of starting was a test's (opened and ended at once): it isn't the week's.

create or replace function public.djinn_auto() returns boolean language sql immutable set search_path = '' as $$ select true $$;

create or replace function public.djinn_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.djinn_wagers%rowtype;
  e public.djinn_entries%rowtype;
  week_start timestamptz := date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  stage text;
  seals jsonb;
  chosen jsonb;
  winner_name text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.djinn_auto() and now() >= public.djinn_planned_start(week_start)
     and not exists (select 1 from public.djinn_wagers where starts_at >= week_start and ends_at > starts_at + interval '1 hour')
     and not exists (select 1 from public.hunts h where public.hunt_phase(h) = 'live') then
    perform pg_advisory_xact_lock(hashtext('djinn:open'));
    if not exists (select 1 from public.djinn_wagers where starts_at >= week_start and ends_at > starts_at + interval '1 hour') then
      perform public.djinn_open_wager();
    end if;
  end if;

  select * into w from public.djinn_wagers
   where starts_at <= now() and (ends_at > now() or claimed_at > now() - interval '1 day')
   order by starts_at desc limit 1;
  if w.id is null then
    return jsonb_build_object('now', now(), 'wager', null);
  end if;
  if w.winner is not null then
    select username into winner_name from public.profiles where id = w.winner;
  end if;

  select * into e from public.djinn_entries where wager_id = w.id and user_id = uid;
  stage := case
    when w.winner = uid then 'won'
    when w.winner is not null or w.ends_at <= now() then 'over'
    when e.vault = 'empty' then 'fooled'
    when e.chosen_site is not null then 'chosen'
    when e.gate_score >= 1 then 'seals'
    when coalesce(e.retry_at, public.djinn_timed_out(e)) > now() then 'turned_away'
    when e.gate_started_at is not null and e.gate_score is null and now() <= e.gate_deadline + interval '5 seconds' then 'gate'
    else 'summoned'
  end;

  if stage in ('seals', 'chosen', 'fooled') then
    select jsonb_agg(jsonb_build_object('id', s.id, 'verse', s.verse, 'burned', s.id = any (e.burned)) order by array_position(w.site_ids, s.id))
      into seals from public.djinn_sites s where s.id = any (w.site_ids);
  end if;
  if e.chosen_site is not null then
    select jsonb_build_object('id', s.id, 'name', s.name, 'country', s.country, 'lng', s.lng, 'lat', s.lat, 'verse', s.verse)
      into chosen from public.djinn_sites s where s.id = e.chosen_site;
  end if;

  return jsonb_build_object(
    'now', now(),
    'wager', jsonb_build_object('id', w.id, 'wonder', w.wonder, 'extraWonder', w.extra_wonder, 'startsAt', w.starts_at, 'endsAt', w.ends_at,
      'claimedBy', winner_name, 'claimedAt', w.claimed_at),
    'stage', stage,
    'gate', case when stage = 'gate' then jsonb_build_object(
      'deadline', e.gate_deadline, 'seconds', public.djinn_gate_seconds(),
      'cipher', w.gate -> 'cipher' -> 'text',
      'floor', jsonb_build_object('grid', w.gate -> 'floor' -> 'grid', 'riddle', w.gate -> 'floor' -> 'riddle'),
      'scales', w.gate -> 'scales') end,
    'retryAt', case when stage = 'turned_away' then coalesce(e.retry_at, public.djinn_timed_out(e)) end,
    'favour', e.favour,
    'riddle', case when stage in ('seals', 'chosen', 'fooled') then w.riddle end,
    'seals', seals,
    'chosen', chosen);
end;
$$;
