-- The hunt list says whether a hunt runs all day (test hunts), so the clock at the top of the map shows "Back in" only
-- for hunts that rest from 9 pm to 9 am.
create or replace function public.list_hunts()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.title, 'prize', h.prize, 'description', h.description,
      'winners', h.winners, 'startsAt', h.starts_at, 'endsAt', h.ends_at,
      'phase', public.hunt_phase(h),
      'allDay', h.all_day,
      'keys', public.real_keys(h.id),
      'players', (select count(*) from public.hunt_players p where p.hunt_id = h.id),
      'joined', exists (select 1 from public.hunt_players p where p.hunt_id = h.id and p.user_id = auth.uid()))
    order by h.starts_at), '[]'::jsonb)
  from public.hunts h
  where h.published and h.ends_at > now() - interval '7 days';
$function$;
