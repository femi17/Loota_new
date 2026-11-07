set lock_timeout = '8s';
-- A recovery truck bringing a far-away stranded vehicle back (owner, 7 Nov 2026): back in the pocket at this time.
alter table public.player_vehicles add column if not exists recovery_ready_at timestamptz;
