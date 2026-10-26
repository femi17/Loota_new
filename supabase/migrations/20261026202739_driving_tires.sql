-- Riding and driving tire you too (owner, 26 Oct 2026: "Even when someone is riding a motorbike or driving a car, their
-- energy should still deplete so we can tell them to go rest, they have been driving for too long"). Energy per metre
-- for a motorbike (0.12 a second at full pace) and a car (0.08), gentler than walking (0.35) or cycling (0.5); the game
-- uses the same (src/game/movement.ts MODES). Out of energy on a motor vehicle you don't faint (save_position only
-- faints walkers and cyclists): you can't ride on until you've rested.

create or replace function public.energy_per_m(p_mode text) returns double precision language sql immutable set search_path = '' as $$
  select case p_mode when 'walk' then 0.35 when 'bicycle' then 0.5 when 'motorbike' then 0.12 when 'car' then 0.08 else 0 end
         / public.base_speed(p_mode);
$$;
