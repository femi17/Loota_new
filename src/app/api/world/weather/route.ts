import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { weatherCell, weatherOf } from "@/game/weather";

/** MET Norway asks every caller to say who they are (their terms of service). */
const USER_AGENT = "Loota/1.0 https://loota-plum.vercel.app";
const MIN_MS = 15 * 60_000;
const MAX_MS = 60 * 60_000;

type Kept = { kind: string; symbol: string | null; heavy: boolean; temp: number | null; expires_at: string };
const reply = (w: Pick<Kept, "kind" | "heavy" | "temp"> | null) => Response.json({ weather: w ? { kind: w.kind, heavy: w.heavy, temp: w.temp } : null });

/**
 * POST /api/world/weather: the real weather where the signed-in player is (their saved position, not one they send):
 * their ~10 km square's, as kept, or looked up from MET Norway when it's due (at most every 30 minutes a square, as its
 * forecast says; shared by everyone there). Rain and storms become rain effects there (weather_set): they slow walkers
 * and bikes as a Rain Charm does. { weather: { kind, heavy, temp } | null }.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const user = auth?.claims?.sub;
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: allowed } = await supabase.rpc("take_quota", { p_kind: "weather" });
  if (!allowed) return Response.json({ error: "Too many at once: wait a moment" }, { status: 429 });

  const admin = createAdminClient();
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", user).maybeSingle();
  if (!pos) return reply(null);
  const { data: kept } = (await admin.from("weather_cells").select("kind, symbol, heavy, temp, expires_at").eq("cell", weatherCell(pos.lng, pos.lat)).maybeSingle()) as { data: Kept | null };
  if (kept && Date.parse(kept.expires_at) > Date.now()) return reply(kept);

  // Due: the forecast for the square's middle (MET Norway takes at most 4 decimals)
  const lng = (Math.floor(pos.lng * 10) + 0.5) / 10;
  const lat = (Math.floor(pos.lat * 10) + 0.5) / 10;
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return reply(kept);
    const data = (await res.json()) as {
      properties: { timeseries: { time: string; data: { instant: { details: { air_temperature?: number } }; next_1_hours?: { summary: { symbol_code: string } } } }[] };
    };
    // The hour we're in
    const now = Date.now();
    const series = data.properties.timeseries;
    const at = series.findLast((t) => Date.parse(t.time) <= now) ?? series[0];
    const symbol = at?.data.next_1_hours?.summary.symbol_code ?? "clearsky_day";
    const { kind, heavy } = weatherOf(symbol);
    const temp = at?.data.instant.details.air_temperature ?? null;
    // Looked at again when MET Norway says its forecast is next updated (15 minutes to an hour)
    const expires = Math.min(now + MAX_MS, Math.max(now + MIN_MS, Date.parse(res.headers.get("expires") ?? "") || now + 30 * 60_000));
    const { data: set } = await admin.rpc("weather_set", {
      p_lng: pos.lng,
      p_lat: pos.lat,
      p_kind: kind,
      p_symbol: symbol,
      p_heavy: heavy,
      p_temp: temp === null ? null : Math.round(temp * 10) / 10,
      p_expires: new Date(expires).toISOString(),
    });
    return reply((set as Kept | null) ?? { kind, heavy, temp, symbol, expires_at: "" });
  } catch {
    return reply(kept); // the service didn't answer: the last we had (or none)
  }
}
