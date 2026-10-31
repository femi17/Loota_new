-- The story hunt's trailer (owner, 31 Oct 2026: "What will be in the lobby, story trailer, I will create that, and there
-- should be a place for me to upload it"): a video the owner makes and uploads in the admin; the lobby shows it.
--   hunts.trailer_path: its path in the public bucket "story-trailers" (uploads only by the owner's server code: a
--   signed upload URL, like the story pictures).
alter table public.hunts add column if not exists trailer_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-trailers', 'story-trailers', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
