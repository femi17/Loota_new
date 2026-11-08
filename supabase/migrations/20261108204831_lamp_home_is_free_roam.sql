-- Free roam is the lamp's ground (owner, 8 Nov 2026: "in the free roam, can we make it like the ground for the lamps, the
-- lamps only shows in the free roam, and it points to stuff user can do, both the jinee and the other lamps"). While a
-- hunter is racing in a live hunt (joined, not finished), the lamp is off: no Detours, whispers or Djinn for them. In free
-- roam (no hunt, the hunt resting at night, or finished) it holds everything, at full rewards (free roam paid half since
-- 22 Oct). The Djinn's Wager no longer waits for every hunt to end: it opens on its weekly day for everyone in free roam.
set lock_timeout = '8s';

create or replace function public.racing_now(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hunt_players hp join public.hunts h on h.id = hp.hunt_id
     where hp.user_id = p_user and hp.finished_at is null and public.hunt_phase(h) = 'live');
$$;

create or replace function public.detour_reward(d public.detours, p_hunting boolean, out coins integer, out relic text)
returns record language sql immutable set search_path = '' as $$
  select d.reward_coins, d.reward_relic; -- full rewards wherever the lamp is (p_hunting kept for the callers)
$$;

do $$
declare
  d text;
  fixes text[][] := array[
    array['public.lamp_state()',
          E'  hunting := public.in_live_hunt(uid); -- in free roam: smaller rewards, and no Orb\n',
          E'  hunting := public.in_live_hunt(uid); -- the Orb only for someone in a hunt\n  if public.racing_now(uid) then\n    return jsonb_build_object(''now'', now(), ''current'', null, ''hunt'', true, ''off'', true); -- racing: the lamp is off\n  end if;\n'],
    array['public.start_detour(uuid)',
          E'  select * into d from public.detours where id = p_detour;\n',
          E'  if public.racing_now(uid) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''hunting'');\n  end if;\n  select * into d from public.detours where id = p_detour;\n'],
    array['public.djinn_state()',
          E'\n     and not exists (select 1 from public.hunts h where public.hunt_phase(h) = ''live'') then',
          E' then'],
    array['public.djinn_state()',
          E'    ''now'', now(),\n    ''wager'',',
          E'    ''now'', now(), ''off'', public.racing_now(uid),\n    ''wager'','],
    array['public.djinn_start_gate()',
          E'  select * into w from public.djinn_wagers where starts_at',
          E'  if public.racing_now(uid) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''hunting'');\n  end if;\n  select * into w from public.djinn_wagers where starts_at'],
    array['public.djinn_enter_chamber()',
          E'  select * into q from public.djinn_my_quest(uid);\n',
          E'  if public.racing_now(uid) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''hunting'');\n  end if;\n  select * into q from public.djinn_my_quest(uid);\n']
  ];
  i int;
begin
  for i in 1 .. array_length(fixes, 1) loop
    d := pg_get_functiondef(fixes[i][1]::regprocedure);
    if position(fixes[i][2] in d) = 0 then
      raise exception 'not found in %: %', fixes[i][1], fixes[i][2];
    end if;
    execute replace(d, fixes[i][2], fixes[i][3]);
  end loop;
end;
$$;
