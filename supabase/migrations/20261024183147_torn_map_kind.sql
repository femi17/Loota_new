-- The Torn Map puzzle (owner, 24 Oct 2026: more puzzle kinds): allowed as a key's trial and an attempt's kind.
alter table public.trial_attempts drop constraint if exists trial_attempts_kind_check;
alter table public.trial_attempts add constraint trial_attempts_kind_check check (kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap'));
alter table public.hunt_keys drop constraint if exists hunt_keys_trial_kind_check;
alter table public.hunt_keys add constraint hunt_keys_trial_kind_check check (trial_kind in ('quiz', 'sentries', 'route', 'adire', 'tornmap', 'puzzle'));
