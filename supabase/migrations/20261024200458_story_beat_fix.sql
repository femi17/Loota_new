-- hunt_story_beat: its variable "n" clashed with hunt_keys.n in the relay check.

create or replace function public.hunt_story_beat(p_hunt uuid, p_beat text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h public.hunts%rowtype;
  hp public.hunt_players%rowtype;
  want integer; -- the key the beat is about (not "n": hunt_keys has a column n)
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
    want := substring(p_beat from 5)::integer;
    reached := public.keys_in(p_hunt, hp.keys_held) >= want;
  elsif p_beat ~ '^relay:[0-9]+$' then
    want := substring(p_beat from 7)::integer;
    reached := exists (select 1 from public.hunt_keys k where k.hunt_id = p_hunt and k.relay and k.n <= hp.keys_held
                       and public.stop_key(p_hunt, k.n) = want);
  end if;
  if not reached then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;
  select lines into got from public.hunt_story where hunt_id = p_hunt and beat = p_beat;
  return jsonb_build_object('ok', true, 'beat', p_beat, 'lines', got, 'keys', public.real_keys(p_hunt));
end;
$$;
