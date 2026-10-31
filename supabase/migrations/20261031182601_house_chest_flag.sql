-- The house's public view: "chest" is false (not null) until the hunter is in the right room.
create or replace function public.house_public(k public.hunt_keys, hp public.hunt_players)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'key', k.n,
    'title', coalesce(k.house ->> 'title', 'The house'),
    'room', hp.house_room,
    'outUntil', hp.house_out_until,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r ->> 'id', 'name', r ->> 'name', 'kind', r ->> 'kind',
                'locked', coalesce(r ? 'needs' and not (('open:' || (r ->> 'id')) = any (hp.house_items)), false),
                'chest', coalesce((r ->> 'role') = 'right' and hp.house_room = (r ->> 'id'), false)) order by ord), '[]'::jsonb)
              from jsonb_array_elements(k.house -> 'rooms') with ordinality as x(r, ord)),
    'objects', (select coalesce(jsonb_agg(jsonb_build_object('id', o ->> 'id', 'room', r ->> 'id', 'kind', o ->> 'kind', 'label', o ->> 'label')), '[]'::jsonb)
                from jsonb_array_elements(k.house -> 'rooms') r, jsonb_array_elements(coalesce(r -> 'objects', '[]'::jsonb)) o),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i, 'name', k.house -> 'items' -> i ->> 'name', 'icon', coalesce(k.house -> 'items' -> i ->> 'icon', '📦'))), '[]'::jsonb)
              from unnest(hp.house_items) i where i not like 'open:%'),
    'at', jsonb_build_object('lng', k.spot_lng, 'lat', k.spot_lat));
$$;
revoke execute on function public.house_public(public.hunt_keys, public.hunt_players) from public, anon, authenticated;
