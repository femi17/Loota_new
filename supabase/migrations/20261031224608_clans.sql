-- Clans (owner, 31 Oct 2026: "when they join during onboarding… ask them if they want to clan up or solo… the ready
-- player hunt vibe… they can join a clan where they share resources or solo. This will handle referral"). Decisions:
-- hunters still win alone, the clan helps; up to 5 members; members share a chat, see each other on the map, and give
-- each other items, Wonders and coins; an invite link puts a friend straight into your clan, and when that new player
-- joins their first hunt, both get bonus coins. Leaving is a state (left_at), never a delete.
--   clans: name (unique, any case), crest (an emoji), colour.
--   clan_members: one active membership per player; each member has their own invite code (who invited whom).
--   clan_messages: the clan's chat.
--   clan_referrals: a new player brought in by a member's link; rewarded once, at their first hunt.
--   profiles.clan_asked_at: onboarding asked "clan up or solo" (asked once).

create table if not exists public.clans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 30),
  crest      text not null default '🛡️' check (char_length(crest) between 1 and 8),
  colour     text not null default '#F4B41A' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists clans_name_key on public.clans (lower(name));

create table if not exists public.clan_members (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references public.clans (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'member' check (role in ('leader', 'member')),
  invite_code text not null unique,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz
);
create unique index if not exists clan_members_one_active on public.clan_members (user_id) where left_at is null;
create index if not exists clan_members_clan_idx on public.clan_members (clan_id) where left_at is null;

create table if not exists public.clan_messages (
  id         bigint generated always as identity primary key,
  clan_id    uuid not null references public.clans (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists clan_messages_clan_idx on public.clan_messages (clan_id, id desc);

create table if not exists public.clan_referrals (
  invitee     uuid primary key references public.profiles (id) on delete cascade,
  inviter     uuid references public.profiles (id) on delete set null,
  clan_id     uuid references public.clans (id) on delete set null,
  created_at  timestamptz not null default now(),
  rewarded_at timestamptz
);

alter table public.profiles add column if not exists clan_asked_at timestamptz;

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_messages enable row level security;
alter table public.clan_referrals enable row level security;
revoke all on public.clans, public.clan_members, public.clan_messages, public.clan_referrals from anon, authenticated;

-- How much a referral earns each of the two players.
create or replace function public.clan_referral_coins() returns integer language sql immutable set search_path = '' as $$ select 250 $$;

-- The caller's active membership.
create or replace function public.my_membership(uid uuid)
returns public.clan_members language sql stable security definer set search_path = '' as $$
  select * from public.clan_members where user_id = uid and left_at is null limit 1;
$$;
revoke execute on function public.my_membership(uuid) from public, anon, authenticated;

create or replace function public.new_invite_code() returns text language sql volatile set search_path = '' as $$
  select upper(substr(md5(gen_random_uuid()::text), 1, 8));
$$;
revoke execute on function public.new_invite_code() from public, anon, authenticated;

-- My clan: its name, crest, colour, members (and who's been on the map lately), my invite code.
create or replace function public.my_clan()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
  c public.clans%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('clan', null, 'asked', (select clan_asked_at is not null from public.profiles where id = uid));
  end if;
  select * into c from public.clans where id = m.clan_id;
  return jsonb_build_object(
    'clan', jsonb_build_object('id', c.id, 'name', c.name, 'crest', c.crest, 'colour', c.colour),
    'me', jsonb_build_object('role', m.role, 'invite', m.invite_code),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'role', cm.role,
                  'joinedAt', cm.joined_at, 'seenAt', pp.updated_at, 'me', p.id = uid) order by cm.joined_at), '[]'::jsonb)
                from public.clan_members cm join public.profiles p on p.id = cm.user_id
                left join public.player_positions pp on pp.user_id = cm.user_id
                where cm.clan_id = c.id and cm.left_at is null),
    'max', 5);
end;
$$;

-- Onboarding's question, answered "solo" (or later from the lobby): asked once.
create or replace function public.clan_go_solo()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set clan_asked_at = coalesce(clan_asked_at, now()) where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_clan(p_name text, p_crest text, p_colour text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.clans%rowtype;
  nm text := trim(p_name);
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if (public.my_membership(uid)).id is not null then
    return jsonb_build_object('ok', false, 'reason', 'in_clan');
  end if;
  if char_length(nm) < 2 or char_length(nm) > 30 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  if exists (select 1 from public.clans where lower(name) = lower(nm)) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  insert into public.clans (name, crest, colour, created_by)
  values (nm, coalesce(nullif(trim(p_crest), ''), '🛡️'), case when p_colour ~ '^#[0-9A-Fa-f]{6}$' then p_colour else '#F4B41A' end, uid)
  returning * into c;
  insert into public.clan_members (clan_id, user_id, role, invite_code) values (c.id, uid, 'leader', public.new_invite_code());
  update public.profiles set clan_asked_at = coalesce(clan_asked_at, now()) where id = uid;
  return jsonb_build_object('ok', true, 'clan', c.id);
end;
$$;

-- Join with a member's invite code. A new player (under a week old, never referred) records a referral.
create or replace function public.join_clan(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  inv public.clan_members%rowtype;
  members int;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if (public.my_membership(uid)).id is not null then
    return jsonb_build_object('ok', false, 'reason', 'in_clan');
  end if;
  select * into inv from public.clan_members where invite_code = upper(trim(p_code)) and left_at is null;
  if inv.id is null then
    return jsonb_build_object('ok', false, 'reason', 'code');
  end if;
  select count(*) into members from public.clan_members where clan_id = inv.clan_id and left_at is null;
  if members >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  insert into public.clan_members (clan_id, user_id, role, invite_code) values (inv.clan_id, uid, 'member', public.new_invite_code());
  update public.profiles set clan_asked_at = coalesce(clan_asked_at, now()) where id = uid;
  if inv.user_id <> uid
     and (select created_at from public.profiles where id = uid) > now() - interval '7 days'
     and not exists (select 1 from public.hunt_players where user_id = uid) then
    insert into public.clan_referrals (invitee, inviter, clan_id) values (uid, inv.user_id, inv.clan_id) on conflict (invitee) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'clan', inv.clan_id);
end;
$$;

-- The clan an invite code belongs to (for the invite page), or nothing.
create or replace function public.clan_of_invite(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'crest', c.crest, 'colour', c.colour, 'by', p.username,
           'members', (select count(*) from public.clan_members x where x.clan_id = c.id and x.left_at is null))
    from public.clan_members m join public.clans c on c.id = m.clan_id join public.profiles p on p.id = m.user_id
   where m.invite_code = upper(trim(p_code)) and m.left_at is null;
$$;

-- Leave the clan (the last one out leaves it empty; a leader leaving hands the lead to the longest-standing member).
create or replace function public.leave_clan()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_clan');
  end if;
  update public.clan_members set left_at = now() where id = m.id;
  if m.role = 'leader' then
    update public.clan_members set role = 'leader'
     where id = (select id from public.clan_members where clan_id = m.clan_id and left_at is null order by joined_at limit 1);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The chat: the latest messages (after an id, for polling), and sending one.
create or replace function public.clan_chat(p_after bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_clan');
  end if;
  return jsonb_build_object('ok', true, 'messages', (
    select coalesce(jsonb_agg(x order by x.id), '[]'::jsonb) from (
      select cm.id, cm.body, cm.created_at as "at", p.username as "by", cm.user_id = uid as mine
        from public.clan_messages cm left join public.profiles p on p.id = cm.user_id
       where cm.clan_id = m.clan_id and cm.id > coalesce(p_after, 0)
       order by cm.id desc limit 60) x));
end;
$$;

create or replace function public.clan_say(p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
  body text := trim(p_body);
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_clan');
  end if;
  if char_length(body) < 1 or char_length(body) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'length');
  end if;
  if (select count(*) from public.clan_messages where user_id = uid and created_at > now() - interval '10 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'slow');
  end if;
  insert into public.clan_messages (clan_id, user_id, body) values (m.clan_id, uid, body);
  return jsonb_build_object('ok', true);
end;
$$;

-- Where my clanmates are on the map (seen in the last day).
create or replace function public.clan_positions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.clan_members%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  m := public.my_membership(uid);
  if m.id is null then
    return jsonb_build_object('ok', true, 'mates', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'colour', (select colour from public.clans where id = m.clan_id), 'crest', (select crest from public.clans where id = m.clan_id),
    'mates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'lng', pp.lng, 'lat', pp.lat, 'mode', pp.mode, 'seenAt', pp.updated_at)), '[]'::jsonb)
              from public.clan_members cm join public.profiles p on p.id = cm.user_id join public.player_positions pp on pp.user_id = cm.user_id
              where cm.clan_id = m.clan_id and cm.left_at is null and cm.user_id <> uid and pp.updated_at > now() - interval '1 day'));
end;
$$;

-- Gifts between clanmates: coins, a relic, a Wonder.
create or replace function public.clan_mate(uid uuid, p_to uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uid <> p_to and exists (
    select 1 from public.clan_members a join public.clan_members b on b.clan_id = a.clan_id
     where a.user_id = uid and a.left_at is null and b.user_id = p_to and b.left_at is null);
$$;
revoke execute on function public.clan_mate(uuid, uuid) from public, anon, authenticated;

create or replace function public.clan_give_coins(p_to uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  have bigint;
  ref text := 'gift:' || gen_random_uuid();
  to_name text;
  balance bigint;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.clan_mate(uid, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'not_mate');
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'amount');
  end if;
  select coins into have from public.profiles where id = uid for update;
  if have < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end if;
  select username into to_name from public.profiles where id = p_to;
  balance := public.apply_coin_change(uid, -p_amount, 'spend', 'A gift to ' || to_name, ref || ':from');
  perform public.apply_coin_change(p_to, p_amount, 'earn', 'A gift from ' || (select username from public.profiles where id = uid), ref || ':to');
  return jsonb_build_object('ok', true, 'balance', balance);
end;
$$;

create or replace function public.clan_give_relic(p_relic uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.clan_mate(uid, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'not_mate');
  end if;
  update public.player_relics set user_id = p_to where id = p_relic and user_id = uid and expires_at > now() and charges > 0;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'item');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.clan_give_wonder(p_wonder uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.clan_mate(uid, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'not_mate');
  end if;
  update public.player_wonders set user_id = p_to where id = p_wonder and user_id = uid and used_at is null and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'item');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- What I could give: my relics and unused Wonders.
create or replace function public.clan_giftables()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'relics', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'relic', relic, 'charges', charges)), '[]'::jsonb)
               from public.player_relics where user_id = auth.uid() and expires_at > now() and charges > 0),
    'wonders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'wonder', wonder)), '[]'::jsonb)
                from public.player_wonders where user_id = auth.uid() and used_at is null and expires_at > now()));
$$;

-- A referral pays both players when the new one joins their first hunt.
create or replace function public.clan_referral_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.clan_referrals%rowtype;
begin
  select * into r from public.clan_referrals where invitee = new.user_id and rewarded_at is null for update;
  if r.invitee is null then
    return new;
  end if;
  update public.clan_referrals set rewarded_at = now() where invitee = r.invitee;
  perform public.apply_coin_change(r.invitee, public.clan_referral_coins(), 'earn', 'Welcome to the clan: your first hunt', 'referral:' || r.invitee || ':invitee');
  if r.inviter is not null then
    perform public.apply_coin_change(r.inviter, public.clan_referral_coins(), 'earn', 'Your invite joined their first hunt', 'referral:' || r.invitee || ':inviter');
  end if;
  return new;
end;
$$;
revoke execute on function public.clan_referral_reward() from public, anon, authenticated;
create or replace trigger clan_referral_reward after insert on public.hunt_players for each row execute function public.clan_referral_reward();

grant execute on function public.my_clan(), public.clan_go_solo(), public.create_clan(text, text, text), public.join_clan(text),
  public.clan_of_invite(text), public.leave_clan(), public.clan_chat(bigint), public.clan_say(text), public.clan_positions(),
  public.clan_give_coins(uuid, integer), public.clan_give_relic(uuid, uuid), public.clan_give_wonder(uuid, uuid), public.clan_giftables() to authenticated;
revoke execute on function public.my_clan(), public.clan_go_solo(), public.create_clan(text, text, text), public.join_clan(text),
  public.clan_of_invite(text), public.leave_clan(), public.clan_chat(bigint), public.clan_say(text), public.clan_positions(),
  public.clan_give_coins(uuid, integer), public.clan_give_relic(uuid, uuid), public.clan_give_wonder(uuid, uuid), public.clan_giftables() from public, anon;
