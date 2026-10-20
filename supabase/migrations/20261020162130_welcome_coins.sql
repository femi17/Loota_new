-- Welcome coins (owner, 20 Oct 2026: 500): a new player gets them when they finish setting up (their first home),
-- once only (the reference), so they can eat, pump a tyre, rent a bike and play before ever buying coins.
create or replace function public.welcome_coins() returns integer language sql immutable set search_path = '' as $$ select 500 $$;

create or replace function public.set_home(lng double precision, lat double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_set timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if lng not between -180 and 180 or lat not between -90 and 90 then
    raise exception 'Invalid location';
  end if;

  select home_set_at into last_set from public.profiles where id = auth.uid() for update;
  if last_set is not null and last_set > now() - interval '30 days' then
    raise exception 'Home can only be moved once every 30 days';
  end if;

  update public.profiles
     set home_lng = lng, home_lat = lat, home_set_at = now()
   where id = auth.uid();

  -- The first home: welcome to Loota.
  if last_set is null then
    perform public.apply_coin_change(auth.uid(), public.welcome_coins(), 'earn', 'Welcome to Loota', 'welcome:' || auth.uid());
  end if;
end;
$$;
