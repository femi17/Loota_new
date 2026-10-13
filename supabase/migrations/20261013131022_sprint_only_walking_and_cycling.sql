-- Sprinting is running (walk) or pedalling harder (bicycle); motor vehicles have no sprint.
create or replace function public.max_travel_speed(p_mode text)
returns double precision language sql immutable set search_path = '' as $$
  select case p_mode
    when 'bicycle' then 16.0 * 1.6
    when 'motorbike' then 35.0
    when 'car' then 45.0
    else 5.0 * 1.6
  end / 3.6 * 12;
$$;
