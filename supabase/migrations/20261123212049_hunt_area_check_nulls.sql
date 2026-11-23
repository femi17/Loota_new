set lock_timeout = '8s';
-- A missing country or state made the check unknown (null), which Postgres lets through: require them outright.
update public.hunts set region = 'world', area_country = null, area_state = null
 where (region = 'country' and (area_country is null or area_country !~ '^[A-Z]{2}$'))
    or (region = 'state' and (area_country is null or area_state is null));
alter table public.hunts drop constraint hunts_region_check;
alter table public.hunts add constraint hunts_region_check check (
  (region = 'world' and area_country is null and area_state is null)
  or (region = 'country' and area_country is not null and area_country ~ '^[A-Z]{2}$' and area_state is null)
  or (region = 'state' and area_country is not null and area_country ~ '^[A-Z]{2}$' and area_state is not null and length(area_state) between 2 and 60)
);
