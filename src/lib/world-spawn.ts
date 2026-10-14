import type { SupabaseClient } from "@supabase/supabase-js";
import { CELL_DEG, RELIC_WEIGHTS, type ItemKind, type RelicId } from "@/game/items";

/** How long a square's finds last before it can be restocked. (No loose coin drops: owner's call, 14 Oct 2026.) */
const LIFETIME_HOURS = 6;

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

function randomRelic(): RelicId {
  const total = RELIC_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [relic, weight] of RELIC_WEIGHTS) {
    if ((roll -= weight) < 0) return relic;
  }
  return "shield";
}

/** Move a point to the nearest footway or road (free OSM routing service). Null if there's no road within 150 m. */
async function snapToRoad(lng: number, lat: number): Promise<[number, number] | null> {
  try {
    const res = await fetch(`https://routing.openstreetmap.de/routed-foot/nearest/v1/driving/${lng},${lat}?number=1`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { waypoints?: { location: [number, number]; distance: number }[] };
    const w = json.waypoints?.[0];
    return w && w.distance < 150 ? w.location : null;
  } catch {
    return null;
  }
}

/**
 * Stock one square with an intel scroll, one hidden find (a coin cache or a
 * relic) and a decoy spot, all on real roads. Only the caller that
 * wins `claim_cell` stocks it, so two players arriving together can't double it.
 */
export async function stockCell(admin: SupabaseClient, cell: string): Promise<boolean> {
  const { data: claimed, error } = await admin.rpc("claim_cell", { p_cell: cell });
  if (error || !claimed) return false;

  const [x, y] = cell.split(":").map(Number);
  const randomPoint = () => snapToRoad((x + Math.random()) * CELL_DEG, (y + Math.random()) * CELL_DEG);

  const plan: { kind: ItemKind | "decoy"; coins?: number; relic?: RelicId; hidden?: boolean }[] = [
    { kind: "intel" },
    Math.random() < 0.6 ? { kind: "cache", coins: randomInt(40, 100), hidden: true } : { kind: "relic", relic: randomRelic(), hidden: true },
    { kind: "decoy" },
  ];
  // A few road look-ups at a time, to be gentle on the free routing service.
  const spots: ([number, number] | null)[] = [];
  for (let i = 0; i < plan.length; i += 4) {
    spots.push(...(await Promise.all(plan.slice(i, i + 4).map(() => randomPoint()))));
  }

  const expires = new Date(Date.now() + LIFETIME_HOURS * 3600_000).toISOString();
  const rows = plan.flatMap((p, i) => {
    const spot = spots[i];
    if (!spot || p.kind === "decoy") return [];
    return [{ cell, kind: p.kind, coins: p.coins ?? 0, relic: p.relic ?? null, hidden: p.hidden ?? false, lng: spot[0], lat: spot[1], expires_at: expires }];
  });

  if (rows.length === 0) {
    // No roads found (or the routing service is down): let the next visit try again.
    await admin.from("world_cells").update({ spawned_at: new Date(0).toISOString() }).eq("cell", cell);
    return false;
  }

  const decoy = spots[plan.length - 1];
  await admin.from("world_cells").update({ decoy_lng: decoy?.[0] ?? null, decoy_lat: decoy?.[1] ?? null }).eq("cell", cell);
  const { error: insertError } = await admin.from("world_items").insert(rows);
  return !insertError;
}
