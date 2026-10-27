-- The world beyond Nigeria (owner, 27 Oct 2026, in the United States: "I cannot pump my tire at the gas station… when
-- I pass bus signs on the map my bus icon is not lit up"). Petrol stations, places to eat and rest, tyre shops,
-- mechanics, hospitals and bus stops were imported for Nigeria only. Each ~5 km square a hunter comes to elsewhere is
-- filled once from OpenStreetMap (src/lib/fill-area.ts) and kept; this records which squares are done.
create table if not exists public.filled_areas (
  cell text primary key,
  started_at timestamptz not null default now(),
  filled_at timestamptz,
  failed_at timestamptz,
  places integer,
  stops integer
);
alter table public.filled_areas enable row level security;
