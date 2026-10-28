import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Station } from "@/game/radio";

const known = new Map<string, { at: number; stations: Station[] }>();
const KEEP_MS = 24 * 3600_000;

type Listing = { stationuuid: string; name: string; url_resolved: string; codec: string; lastcheckok: number; state: string; tags: string };

/**
 * GET /api/radio?country=CA: a country's radio, for Loota Radio where the hunter is (owner, 27 Oct 2026: "it is not only
 * focused on Nigeria but the country which you find yourself"): its most-listened stations in the public directory
 * (radio-browser.info, as Nigeria's were picked), that a browser can play (https, MP3 or AAC, not a playlist). Kept a
 * day. Signed-in players only.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const country = (request.nextUrl.searchParams.get("country") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return Response.json({ error: "Which country?" }, { status: 400 });
  const hit = known.get(country);
  if (hit && Date.now() - hit.at < KEEP_MS) return Response.json({ stations: hit.stations });
  try {
    const res = await fetch(
      `https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/${country}?hidebroken=true&order=clickcount&reverse=true&limit=80`,
      { headers: { "User-Agent": "Loota/1.0 (treasure-hunt game)" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`radio-browser ${res.status}`);
    const seen = new Set<string>();
    const stations: Station[] = [];
    for (const s of (await res.json()) as Listing[]) {
      const url = s.url_resolved;
      if (!s.lastcheckok || !url.startsWith("https://") || /m3u8|\/hls\/|playlist/i.test(url) || !/^(MP3|AAC\+?)$/i.test(s.codec)) continue;
      const name = s.name.replace(/^[#\s*]+/, "").trim().slice(0, 40);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const what = [s.state?.trim(), s.tags.split(",")[0]?.trim()].filter(Boolean).join(" · ") || "Radio";
      stations.push({ id: s.stationuuid, name, what, url });
      if (stations.length === 12) break;
    }
    known.set(country, { at: Date.now(), stations });
    return Response.json({ stations });
  } catch {
    return Response.json({ stations: [] });
  }
}
