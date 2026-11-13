-- The idling law, tightened (owner, 13 Nov 2026: "I login now, bought a ticket to travel, the bus was moving, then I found
-- myself to be in jail. Why is there a delay allowing to do all that before telling me I am in jail"):
--   * arrested, no travelling: no bus, train or plane ticket, no taxi or vehicle brought ('arrested');
--   * out of the cell (served or bailed), the still clock waits until they've moved: a cell at a roadside post is on
--     the main road, and closing the game there had them arrested again on their return (a loop).
set lock_timeout = '8s';
do $$
declare
  fn text;
  f text;
  a text := '    raise exception ''Not signed in'';
  end if;
';
begin
  foreach fn in array array['public.start_trip(bigint, bigint, jsonb, boolean)', 'public.request_pickup(text, double precision, double precision, text, jsonb, jsonb, text, double precision, double precision)', 'public.board_taxi()'] loop
    f := pg_get_functiondef(fn::regprocedure);
    if position(a in f) = 0 then
      raise exception '% : not found', fn;
    end if;
    f := regexp_replace(f, '    raise exception ''Not signed in'';\n  end if;\n', '    raise exception ''Not signed in'';
  end if;
  -- Arrested (the idling law): the police have them; no travelling
  if (public.jailed(uid)).id is not null then
    return jsonb_build_object(''ok'', false, ''reason'', ''arrested'');
  end if;
');
    execute f;
  end loop;
end $$;

-- Out of the cell: the still clock starts only once they've moved (keep_still_since sets it as they go 15 m)
do $$
declare
  f text := pg_get_functiondef('public.idle_law(boolean)'::regprocedure);
  a text := 'update public.player_positions set still_since = now(), on_main_road = false where user_id = uid;';
begin
  if position(a in f) = 0 then
    raise exception 'idle_law: not found';
  end if;
  execute replace(f, a, 'update public.player_positions set still_since = ''infinity'', on_main_road = false where user_id = uid; -- (counts again once they move)');
  f := pg_get_functiondef('public.pay_bail()'::regprocedure);
  if position(a in f) = 0 then
    raise exception 'pay_bail: not found';
  end if;
  execute replace(f, a, 'update public.player_positions set still_since = ''infinity'', on_main_road = false where user_id = uid; -- (counts again once they move)');
end $$;
