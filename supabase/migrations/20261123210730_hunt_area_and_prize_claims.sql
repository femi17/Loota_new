set lock_timeout = '8s';

-- Where a hunt's keys are (owner, 23 Nov 2026: "picking a state, a country or worldwide")
alter table public.hunts drop constraint hunts_region_check;
alter table public.hunts add column area_country text, add column area_state text;
update public.hunts set region = 'country', area_country = 'NG' where region = 'nigeria';
alter table public.hunts add constraint hunts_region_check check (
  (region = 'world' and area_country is null and area_state is null)
  or (region = 'country' and area_country ~ '^[A-Z]{2}$' and area_state is null)
  or (region = 'state' and area_country ~ '^[A-Z]{2}$' and length(area_state) between 2 and 60)
);
comment on column public.hunts.area_country is 'A country or state hunt: the country (two-letter code) every key is in.';
comment on column public.hunts.area_state is 'A state hunt: the state or region every key is in (e.g. Lagos).';

-- A finisher's email and, for a winner, the prize code (owner, 23 Nov 2026: "an email after getting the whole key,
-- and we verify the token matches the one in the database"). Only the code's SHA-256 is kept.
create table public.prize_claims (
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  place int not null check (place >= 1),
  winner boolean not null,
  code_hash text,
  email_to text,
  sending_at timestamptz,
  emailed_at timestamptz,
  paid_at timestamptz,
  paid_note text check (length(paid_note) <= 200),
  created_at timestamptz not null default now(),
  primary key (hunt_id, user_id)
);
create unique index prize_claims_code on public.prize_claims (code_hash) where code_hash is not null;
alter table public.prize_claims enable row level security;
-- No policies: only the server (secret key) reads and writes it.
comment on table public.prize_claims is 'One row per hunter who finished a hunt: the finish email, and a winner''s prize code (hashed) and payment.';
