import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with the secret key: bypasses row level security.
 * Server code only (route handlers, server functions); never import it into a
 * client component.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
