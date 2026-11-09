-- Real weather (owner, 9 Nov 2026: "How can we add weather it case it rains and all so we can apply that too"; chose
-- real weather, and rain slowing as the Rain Charm does). The weather of each ~10 km square (0.1°) where hunters are,
-- from MET Norway (api.met.no, free and open to commercial use with credit), looked up by our server at most every 30
-- minutes and kept here. Rain and storms are rain effects as a Rain Charm's (world_effects, weather 'rain' or 'storm';
-- created by nobody): the same rules, so Shields protect, nobody is slowed near a live key, and at most twice an hour;
-- storms slow walkers and bikes by 30% (the game reads it from my_effects), rain 20%. Fog, cloud and snow are drawn,
-- not felt. The broadcast reads each hunter's square's weather (broadcast_state).
set lock_timeout = '8s';

create or replace function public.weather_cell(p_lng double precision, p_lat double precision)
returns text language sql immutable set search_path = '' as $$
  select floor(p_lng * 10)::int || '_' || floor(p_lat * 10)::int;
$$;

create table if not exists public.weather_cells (
  cell text primary key,
  lng double precision not null,
  lat double precision not null,
  kind text not null check (kind in ('clear', 'cloudy', 'fog', 'rain', 'storm', 'snow')),
  symbol text,
  heavy boolean not null default false,
  temp real,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  effect_id uuid references public.world_effects (id) on delete set null
);
alter table public.weather_cells enable row level security;
revoke all on public.weather_cells from anon, authenticated;

alter table public.world_effects add column if not exists weather text check (weather in ('rain', 'storm'));

/** A square's fresh weather (our server only): kept, and its rain effect started, carried on or ended. */
create or replace function public.weather_set(p_lng double precision, p_lat double precision, p_kind text, p_symbol text,
                                              p_heavy boolean, p_temp real, p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c text := public.weather_cell(p_lng, p_lat);
  w public.weather_cells%rowtype;
  e public.world_effects%rowtype;
  centre_lng double precision := (floor(p_lng * 10) + 0.5) / 10;
  centre_lat double precision := (floor(p_lat * 10) + 0.5) / 10;
  wet text := case when p_kind in ('rain', 'storm') then p_kind end;
begin
  insert into public.weather_cells (cell, lng, lat, kind, symbol, heavy, temp, checked_at, expires_at)
  values (c, centre_lng, centre_lat, p_kind, p_symbol, coalesce(p_heavy, false), p_temp, now(), p_expires)
  on conflict (cell) do update set kind = excluded.kind, symbol = excluded.symbol, heavy = excluded.heavy, temp = excluded.temp,
                                   checked_at = now(), expires_at = excluded.expires_at
  returning * into w;
  select * into e from public.world_effects where id = w.effect_id for update;
  if e.id is not null and e.ends_at > now() and e.weather is not distinct from wet then
    -- Still raining (or storming): it carries on a little past the next look
    update public.world_effects set ends_at = p_expires + interval '10 minutes' where id = e.id;
  else
    if e.id is not null and e.ends_at > now() then
      update public.world_effects set ends_at = now() where id = e.id; -- stopped, or turned to a storm (a new one below)
    end if;
    if wet is not null then
      insert into public.world_effects (kind, weather, lng, lat, radius_m, ends_at, created_by)
      values ('rain', wet, centre_lng, centre_lat, 7000, p_expires + interval '10 minutes', null)
      returning * into e;
      update public.weather_cells set effect_id = e.id where cell = c;
    else
      update public.weather_cells set effect_id = null where cell = c;
    end if;
  end if;
  return jsonb_build_object('kind', w.kind, 'symbol', w.symbol, 'heavy', w.heavy, 'temp', w.temp, 'until', w.expires_at);
end;
$$;
revoke all on function public.weather_set(double precision, double precision, text, text, boolean, real, timestamptz) from public, anon, authenticated;

/** The weather where the player is, as kept (null: not looked up yet, or it's gone stale). */
create or replace function public.weather_here()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', w.kind, 'symbol', w.symbol, 'heavy', w.heavy, 'temp', w.temp, 'until', w.expires_at,
                            'fresh', w.expires_at > now())
    from public.player_positions pp
    join public.weather_cells w on w.cell = public.weather_cell(pp.lng, pp.lat)
   where pp.user_id = auth.uid() and w.expires_at > now() - interval '30 minutes';
$$;
revoke all on function public.weather_here() from public, anon;
grant execute on function public.weather_here() to authenticated;

-- my_effects: whether a rain is real weather, and a storm
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.my_effects()'::regprocedure);
  if position('''mine'', e.created_by = uid));' in d) = 0 then
    raise exception 'my_effects changed';
  end if;
  execute replace(d, '''mine'', e.created_by = uid));', '''mine'', e.created_by = uid, ''weather'', e.weather));');
  -- broadcast_state: each hunter's square's weather
  d := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  if position('''helper'', (select v.flat_helper' in d) = 0 or position('''weather''' in d) > 0 then
    raise exception 'broadcast_state changed';
  end if;
  execute replace(d, '''helper'', (select v.flat_helper', '''weather'', (select jsonb_build_object(''kind'', w.kind, ''heavy'', w.heavy, ''temp'', w.temp)
                        from public.weather_cells w
                       where w.cell = public.weather_cell(pp.lng, pp.lat) and w.expires_at > now() - interval ''30 minutes''),
          ''helper'', (select v.flat_helper');
  -- take_quota: the weather, 12 a minute (the game asks every few minutes)
  d := pg_get_functiondef('public.take_quota(text)'::regprocedure);
  if position('(''hunters_near'', 30, 60))' in d) = 0 then
    raise exception 'take_quota changed';
  end if;
  execute replace(d, '(''hunters_near'', 30, 60))', '(''hunters_near'', 30, 60), (''weather'', 12, 60))');
end;
$$;
