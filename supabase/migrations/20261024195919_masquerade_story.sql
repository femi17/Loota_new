-- The story (owner, 24 Oct 2026: villain "The Masquerade", tone "light & playful"). A hunt's story is a set of beats,
-- each a few lines said by the Masquerade, the Keeper or the narrator: at the start, after each key, at a relay chest,
-- at the finish. Written per hunt in /admin (Claude can draft them); a beat reaches a player only once they've reached
-- it (no spoilers), and without one the game tells a default.

create table if not exists public.hunt_story (
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  beat    text not null check (beat ~ '^(start|finish|key:[0-9]+|relay:[0-9]+)$'),
  lines   jsonb not null, -- [{ "who": "masquerade" | "keeper" | "narrator", "text": "…" }]
  primary key (hunt_id, beat)
);
alter table public.hunt_story enable row level security;
revoke all on public.hunt_story from anon, authenticated; -- only through hunt_story_beat

-- A beat of the story for the signed-in player, if they've reached it: the start (the hunt has begun and they're in
-- it), "key:N" (they hold N keys), "relay:N" (they've opened the relay chest on the way to Key N), the finish.
create or replace function public.hunt_story_beat(p_hunt uuid, p_beat text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  n integer;
  reached boolean := false;
  got jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into h from public.hunts where id = p_hunt and published;
  select * into hp from public.hunt_players where hunt_id = p_hunt and user_id = uid;
  if h.id is null or hp.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_joined');
  end if;
  if p_beat = 'start' then
    reached := public.hunt_phase(h) in ('live', 'ended');
  elsif p_beat = 'finish' then
    reached := hp.finished_at is not null;
  elsif p_beat ~ '^key:[0-9]+$' then
    n := substring(p_beat from 5)::integer;
    reached := public.keys_in(p_hunt, hp.keys_held) >= n;
  elsif p_beat ~ '^relay:[0-9]+$' then
    n := substring(p_beat from 7)::integer;
    reached := exists (select 1 from public.hunt_keys k where k.hunt_id = p_hunt and k.relay and k.n <= hp.keys_held
                       and public.stop_key(p_hunt, k.n) = n);
  end if;
  if not reached then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;
  select lines into got from public.hunt_story where hunt_id = p_hunt and beat = p_beat;
  return jsonb_build_object('ok', true, 'beat', p_beat, 'lines', got, 'keys', public.real_keys(p_hunt));
end;
$$;
revoke execute on function public.hunt_story_beat(uuid, text) from public, anon;
grant execute on function public.hunt_story_beat(uuid, text) to authenticated;
