-- Buying coins with Paystack (design doc 10.1; owner's test keys 19 Oct 2026). The game's server starts each purchase
-- (the pack's price and coins come from the server, never the phone) and records it here; when Paystack confirms the
-- payment (the player's return, or Paystack's signed webhook), credit_coin_purchase adds the coins once, and only for
-- the amount the purchase was started at.

create table public.coin_purchases (
  reference   text primary key,           -- ours, sent to Paystack ("loota_…")
  user_id     uuid not null references public.profiles (id) on delete cascade,
  pack        text not null,
  coins       integer not null check (coins > 0),
  amount_kobo integer not null check (amount_kobo > 0),
  status      text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index coin_purchases_user_idx on public.coin_purchases (user_id, created_at desc);
alter table public.coin_purchases enable row level security;
create policy "Players read their own coin purchases" on public.coin_purchases for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.coin_purchases from anon, authenticated;

-- Paystack says this reference was paid, this many kobo: the coins, once. Server code only (the secret key).
create or replace function public.credit_coin_purchase(p_reference text, p_amount_kobo integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.coin_purchases%rowtype;
  balance bigint;
begin
  select * into p from public.coin_purchases where reference = p_reference for update;
  if p.reference is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if p.status = 'paid' then
    select coins into balance from public.profiles where id = p.user_id;
    return jsonb_build_object('ok', true, 'already', true, 'coins', p.coins, 'balance', balance);
  end if;
  if p_amount_kobo is distinct from p.amount_kobo then
    update public.coin_purchases set status = 'failed' where reference = p_reference;
    return jsonb_build_object('ok', false, 'reason', 'amount');
  end if;
  balance := public.apply_coin_change(p.user_id, p.coins, 'purchase', 'Bought ' || p.coins || ' coins', 'paystack:' || p.reference);
  update public.coin_purchases set status = 'paid', paid_at = now() where reference = p_reference;
  return jsonb_build_object('ok', true, 'coins', p.coins, 'balance', balance);
end;
$$;
revoke execute on function public.credit_coin_purchase(text, integer) from public, anon, authenticated;
grant execute on function public.credit_coin_purchase(text, integer) to service_role;
