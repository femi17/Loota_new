-- Movement is automatic along the drawn way (owner, 8 Nov 2026: "When the route is drawn, let movement me auto, that means
-- we would not need cruise logic again or joystick"; "on the map, players should not steer but only make decisions"), so
-- cruise tokens are retired: no more in Detours, from travellers, in the streets or free each day. Tokens held are
-- returned as coins (10 each, their price), and live Detours that held them hold 40 coins instead.
set lock_timeout = '8s';

do $$
declare
  d text;
  fixes text[][] := array[
    array['public.spawn_detour(text,double precision,double precision)',
          E'array[''shield'', ''second_wind'', ''jerry_can'', ''rain_charm'', ''cruise'', ''cruise'', ''tyre_kit'']',
          E'array[''shield'', ''second_wind'', ''jerry_can'', ''rain_charm'', ''tyre_kit'']'],
    array['public.spawn_detour(text,double precision,double precision)',
          E'array[''radar'', ''fast_pass'', ''cruise'']',
          E'array[''radar'', ''fast_pass'']'],
    array['public.road_gift(uuid,text)',
          E'  elsif roll < 0.8 then\n    select cruise_tokens',
          E'  elsif false then -- cruise tokens retired (8 Nov 2026)\n    select cruise_tokens'],
    array['public.cruise_state()',
          E'  if me.cruise_daily_on is distinct from today then',
          E'  if false then -- no daily tokens: retired (8 Nov 2026)'],
    array['public.cruise_drops_near()',
          E'   where p.user_id = auth.uid();',
          E'   where p.user_id = auth.uid() and false; -- retired (8 Nov 2026)']
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

update public.detours set reward_item = null, reward_qty = 0, reward_coins = 40
 where reward_item = 'cruise' and ends_at > now();

do $$
declare
  p record;
begin
  for p in select id, cruise_tokens from public.profiles where cruise_tokens > 0 for update loop
    perform public.apply_coin_change(p.id, p.cruise_tokens * 10, 'earn', 'Cruise tokens returned as coins', 'cruise-refund:' || p.id);
    update public.profiles set cruise_tokens = 0 where id = p.id;
  end loop;
end;
$$;
