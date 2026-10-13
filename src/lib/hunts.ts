import { createClient } from "@/lib/supabase/server";
import type { HuntSummary } from "@/game/hunt";

/** Published hunts that are coming up, running, or ended in the last week. */
export async function listHunts(): Promise<HuntSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_hunts");
  return (data ?? []) as HuntSummary[];
}

/** The hunt a player is taking part in: the one asked for, or their running (else next) joined hunt. */
export function pickHunt(hunts: HuntSummary[], wanted?: string): HuntSummary | null {
  const joined = hunts.filter((h) => h.joined && h.phase !== "ended");
  return joined.find((h) => h.id === wanted) ?? joined.find((h) => h.phase === "live") ?? joined[0] ?? null;
}
