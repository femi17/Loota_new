-- One device a player (owner, 3 Nov 2026: "If a user joins on 2 device, we close one so it doesn't affect the
-- broadcast"). Each time the game opens it claims the player's session (the newest wins); a game that isn't the
-- current one closes and offers "Play here instead". The broadcast ignores live positions from any other.
create table if not exists public.player_sessions (
  user_id uuid primary key, -- no link to auth.users, so an account can still be removed (see one_device_no_user_link)
  session_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.player_sessions enable row level security;
create policy "players read their own session" on public.player_sessions for select to authenticated using (user_id = auth.uid());

create or replace function public.claim_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  insert into public.player_sessions (user_id, session_id, claimed_at) values (uid, p_session, now())
  on conflict (user_id) do update set session_id = excluded.session_id, claimed_at = excluded.claimed_at;
  return jsonb_build_object('ok', true, 'session', p_session);
end;
$$;
revoke execute on function public.claim_session(uuid) from public, anon;
grant execute on function public.claim_session(uuid) to authenticated;

-- The broadcast: each hunter's current device.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.broadcast_state(uuid)'::regprocedure);
  if position($q$'mode', pp.mode, 'seenAt', pp.updated_at,$q$ in def) = 0 then
    raise exception 'broadcast_state: expected text not found';
  end if;
  execute replace(def, $q$'mode', pp.mode, 'seenAt', pp.updated_at,$q$,
    $q$'mode', pp.mode, 'seenAt', pp.updated_at,
          'session', (select ps.session_id from public.player_sessions ps where ps.user_id = p.user_id),$q$);
end;
$$;
