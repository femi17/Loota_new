-- Story hunts (owner, 31 Oct 2026: "the hunt is a story generation sequence… what I need is to enter the number of keys,
-- the start time is from 9am to 9pm… when the story is generated, I should get a prompt for image generation… and where
-- I will upload it to").
--   hunts.story: the story engine's work while it writes, then the finished story (plan, chapters, decoys, checks).
--   hunts.story_status: writing | ready | failed (null: an ordinary hand-made hunt).
--   hunts.keys_wanted: how many keys the owner asked for.
--   story_pictures: one row per scene picture: the ChatGPT prompt, and the uploaded image's path in Storage.
--   story_registry: every story's places, decoys, characters, titles, locks and channels, so no story repeats them
--     (shared by the admin and the command-line engine; replaces docs/stories/registry.json).
--   Storage bucket "story-pictures" (public read; uploads only by the owner's server code).

alter table public.hunts add column if not exists story jsonb;
alter table public.hunts add column if not exists story_status text check (story_status in ('writing', 'ready', 'failed'));
alter table public.hunts add column if not exists keys_wanted integer check (keys_wanted between 1 and 30);

create table if not exists public.story_pictures (
  hunt_id     uuid not null references public.hunts (id) on delete cascade,
  n           integer not null,
  chapter     integer not null,
  prompt      text not null,
  path        text,
  uploaded_at timestamptz,
  primary key (hunt_id, n)
);
alter table public.story_pictures enable row level security;
-- Players will see a published hunt's pictures (the story player comes later).
create policy "story pictures of published hunts" on public.story_pictures for select
  using (exists (select 1 from public.hunts h where h.id = hunt_id and h.published));

create table if not exists public.story_registry (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  hunt_id    uuid references public.hunts (id) on delete set null,
  title      text not null,
  genre      text,
  theme      text,
  locks      text[] not null default '{}',
  channels   text[] not null default '{}',
  places     jsonb not null default '[]',
  decoys     text[] not null default '{}',
  characters text[] not null default '{}'
);
alter table public.story_registry enable row level security; -- server code only (secret key)

insert into storage.buckets (id, name, public) values ('story-pictures', 'story-pictures', true) on conflict (id) do nothing;

-- The pilot, The Bronze Compass, so no story reuses its places, decoys or people.
insert into public.story_registry (title, genre, theme, locks, channels, places, decoys, characters)
select 'The Bronze Compass', 'family mystery', 'a lost bronze or artwork returning home',
  array['riddle-conditions', 'acrostic', 'count-cipher', 'time-zone', 'old-name'],
  array['radio', 'voicemail', 'player-strip', 'phone-call', 'compass-tool'],
  '[{"name":"Igun Street, Benin City","lng":5.62937,"lat":6.33677},{"name":"Belém Tower, Lisbon","lng":-9.21593,"lat":38.69159},{"name":"British Museum, Great Russell Street, London","lng":-0.12671,"lat":51.51931},{"name":"Humboldt Forum, Berlin","lng":13.40123,"lat":52.51703},{"name":"Oba''s Palace, Benin City","lng":5.6201,"lat":6.332}]'::jsonb,
  array['Sakponba Road', 'Akpakpava Road', 'Lagos Street, Benin City', 'Ihama Road', 'Airport Road, Benin City', 'Oba Market', 'Siluko Road', 'Plymouth Road', 'Ikpokpan Road', 'Ekenhuan Road', 'Second West Circular Road', 'Benin-Sapele Road', 'Mission Road, Benin City', 'National Museum, Benin City', 'Porto', 'Rome', 'Accra', 'Istanbul', 'Kampala', 'Entebbe', 'Yaoundé', 'Rio de Janeiro', 'Cristo Rei, Almada', 'Jerónimos Monastery', 'Monument to the Discoveries', 'Horniman Museum', 'Tower of London', 'Jesus College, Cambridge', 'University of Aberdeen', 'Glasgow', 'Weltmuseum, Vienna', 'Christiansborg Palace, Copenhagen', 'Royal Palace, Stockholm', 'Royal Palace, Madrid', 'Louvre, Paris', 'Prague Castle', 'Buda Castle, Budapest', 'Royal Castle, Warsaw', 'Berlin Cathedral', 'Emotan Shrine, Benin City'],
  array['Ehizogie', 'Osayi', 'Isoken Osagie', 'Professor Osagie', 'Pa Eweka', 'Margaret', 'Lennart Voss', 'The Masquerade']
where not exists (select 1 from public.story_registry where title = 'The Bronze Compass');
