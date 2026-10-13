-- handle_new_user() should only ever run as the sign-up trigger, never be
-- callable through the API (flagged by the Supabase security advisor).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
