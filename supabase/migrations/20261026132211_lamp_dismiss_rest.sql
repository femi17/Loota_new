-- The Lamp rests after "Let it go" too (owner, 26 Oct 2026: the next thing shouldn't come straight away): letting the
-- current thing go clears it and starts the 15-minute rest, as finishing one does (lamp_state).

create or replace function public.lamp_dismiss(p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_kind = 'whisper' then
    update public.player_leads set resolved_at = now() where id::text = p_id and user_id = uid and resolved_at is null;
  elsif p_kind in ('orb', 'detour') then
    insert into public.lamp_dismissed (user_id, item) values (uid, p_kind || ':' || p_id) on conflict do nothing;
  else
    return jsonb_build_object('ok', false);
  end if;
  update public.player_lamp set current_kind = null, current_id = null, rest_until = now() + make_interval(mins => public.lamp_rest_minutes())
   where user_id = uid and current_kind = p_kind and current_id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
