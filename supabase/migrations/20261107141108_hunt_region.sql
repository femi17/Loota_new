set lock_timeout = '8s';
-- Where a hunt's keys may be (owner, 7 Nov 2026: "The hunt creation should have the option of worldwide and Nigeria"):
-- 'world' spreads the keys around the world; 'nigeria' keeps every key in Nigeria.
alter table public.hunts add column if not exists region text not null default 'world' check (region in ('world', 'nigeria'));
