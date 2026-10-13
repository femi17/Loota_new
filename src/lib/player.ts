import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookForId, normalizeLook, type AvatarLook } from "@/lib/avatar";

export type Player = {
  id: string;
  username: string;
  look: AvatarLook;
  /** False until the player has saved a look of their own. */
  lookChosen: boolean;
  coins: number;
  home: { lng: number; lat: number } | null;
  /** Where the player last was on the map (null until they first move). */
  position: { lng: number; lat: number; mode: "walk" | "bicycle" } | null;
};

/** The signed-in player's profile, or null when nobody is signed in. Server only. */
export async function getPlayer(): Promise<Player | null> {
  // Always per request: the Supabase client reads the clock while checking the session.
  await connection();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const id = auth?.claims?.sub;
  if (!id) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, username, avatar, coins, home_lng, home_lat")
    .eq("id", id)
    .single();
  if (!data) return null;

  const { data: pos } = await supabase.from("player_positions").select("lng, lat, mode").eq("user_id", id).maybeSingle();

  const lookChosen = !!data.avatar && typeof data.avatar === "object" && "hair" in data.avatar;

  return {
    id: data.id,
    username: data.username,
    look: lookChosen ? normalizeLook(data.avatar) : lookForId(data.id),
    lookChosen,
    coins: Number(data.coins),
    home: data.home_lng != null && data.home_lat != null ? { lng: data.home_lng, lat: data.home_lat } : null,
    position: pos ? { lng: pos.lng, lat: pos.lat, mode: pos.mode === "bicycle" ? "bicycle" : "walk" } : null,
  };
}
