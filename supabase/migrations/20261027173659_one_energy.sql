-- One energy, whatever you do (owner, 27 Oct 2026: "it is one health life… on 5%, riding a bike, and I get on the plane
-- … the health should start from 5% but can begin to increase because they are in a rest mode… on a motorbike … it will
-- continue from 5%, and still get tired"), and a faint that sticks ("the avatar just looks like falling, and then
-- continue moving").

-- 1. Rest is never lost. Energy is worked out from the time since the position was last saved (updated_at). Anything
--    that moves that clock on without working energy out itself (a trip ending, being put on a road, Get me out, sent
--    home, a wonder) first banks the rest since: standing about at idle_regen, resting at the rest rate. A bus, train or
--    plane ride is time sat down: you come off it with what you had plus the rest. save_position works energy out
--    itself (moving and resting) and says so, so nothing is counted twice.
create or replace function public.bank_rest()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at > old.updated_at
     and new.energy is not distinct from old.energy
     and old.fainted_at is null and new.fainted_at is null
     and coalesce(current_setting('loota.energy_set', true), '') <> 'on'
     and not exists (select 1 from public.hospital_visits h where h.user_id = new.user_id and h.left_at is null) then
    new.energy := least(100, coalesce(old.energy, 100)
      + least(extract(epoch from new.updated_at - old.updated_at), 3600)
        * case when old.resting_since is not null then coalesce(old.rest_rate, public.rest_regen()) else public.idle_regen() end);
  end if;
  return new;
end;
$$;
create trigger player_positions_bank_rest before update on public.player_positions
  for each row execute function public.bank_rest();

-- save_position: marks that it has worked energy out (one line added before its insert).
do $$
declare
  def text := pg_get_functiondef('public.save_position(double precision, double precision, text)'::regprocedure);
  mark text := E'  perform set_config(''loota.energy_set'', ''on'', true);\n';
  anchor text := '  insert into public.player_positions (user_id, lng, lat, mode, updated_at, energy, fainted_at, resting_since, allow_m)';
begin
  if position(anchor in def) = 0 then
    raise exception 'save_position has changed: mark it by hand';
  end if;
  if position('loota.energy_set' in def) = 0 then
    execute replace(def, anchor, mark || anchor);
  end if;
end;
$$;

-- 2. A collapse the hunter's device saw: the server counts energy from straight lines between saves, so after winding
--    streets (or turning back) it can think there's a little left when the device reached 0. Taken at its word when
--    the server's count is low too (15 or less): on foot or a bicycle, not mid-trip, not already in care.
create or replace function public.collapse()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos public.player_positions%rowtype;
  left_now double precision;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into pos from public.player_positions where user_id = uid for update;
  if pos.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_position');
  end if;
  if pos.fainted_at is not null then
    return jsonb_build_object('ok', true);
  end if;
  if exists (select 1 from public.hospital_visits where user_id = uid and left_at is null)
     or exists (select 1 from public.transit_trips where user_id = uid and ended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  if public.current_mode(uid) not in ('walk', 'bicycle') then
    return jsonb_build_object('ok', false, 'reason', 'mode');
  end if;
  left_now := least(100, pos.energy + least(extract(epoch from now() - pos.updated_at), 3600)
                * case when pos.resting_since is not null then coalesce(pos.rest_rate, public.rest_regen()) else public.idle_regen() end);
  if left_now > 15 then
    return jsonb_build_object('ok', false, 'reason', 'not_tired', 'energy', round(left_now::numeric, 1));
  end if;
  update public.player_positions
     set energy = 0, fainted_at = now(), resting_since = null, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.collapse() from public, anon;
grant execute on function public.collapse() to authenticated;
