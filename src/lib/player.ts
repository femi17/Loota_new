import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOOK, isValidLook, type AvatarLook } from "@/lib/avatar";

export type Player = {
  id: string;
  username: string;
  look: AvatarLook;
  coins: number;
  home: { lng: number; lat: number } | null;
};

/** The signed-in player's profile, or null when nobody is signed in. Server only. */
export async function getPlayer(): Promise<Player | null> {
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

  return {
    id: data.id,
    username: data.username,
    look: isValidLook(data.avatar) ? data.avatar : DEFAULT_LOOK,
    coins: Number(data.coins),
    home: data.home_lng != null && data.home_lat != null ? { lng: data.home_lng, lat: data.home_lat } : null,
  };
}
