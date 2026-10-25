import { roadCellsAround } from "./road-cells";
import type { MapDrawing, MapLine, MapName } from "@/game/puzzles/tornmap";

const WIDTH: Record<string, 1 | 2 | 3> = {
  motorway: 3, motorway_link: 2, trunk: 3, trunk_link: 2, primary: 3, primary_link: 2,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
};
const SKIP = new Set(["footway", "path", "steps", "cycleway", "bridleway", "pedestrian"]);

/**
 * The streets within `halfM` metres of a spot (a square), as a map drawing in 0–1 (y down) for the Torn Map puzzle
 * (owner, 24 Oct 2026): main roads thick, streets thin, up to five street names along their longest stretch.
 */
export async function drawingAround(lng: number, lat: number, halfM: number): Promise<MapDrawing> {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  const toX = (x: number) => ((x - lng) * kx) / (2 * halfM) + 0.5;
  const toY = (y: number) => 0.5 - ((y - lat) * ky) / (2 * halfM);
  const lines: MapLine[] = [];
  const named = new Map<string, { len: number; x: number; y: number; angle: number }>();
  const seen = new Set<string>();
  for (const c of await roadCellsAround(lng, lat, halfM)) {
    if (!c) continue;
    const at = new Map(c.points.map((p) => [p.id, p]));
    for (const w of c.ways) {
      if (SKIP.has(w.cls)) continue;
      const pts: number[] = [];
      for (const id of w.points) {
        const p = at.get(id);
        if (p) pts.push(Math.round(toX(p.lng) * 10000) / 10000, Math.round(toY(p.lat) * 10000) / 10000);
      }
      if (pts.length < 4) continue;
      // Only streets that come into the square (with a margin), once each.
      let inside = false;
      for (let k = 0; k < pts.length; k += 2) if (pts[k] > -0.2 && pts[k] < 1.2 && pts[k + 1] > -0.2 && pts[k + 1] < 1.2) inside = true;
      const sig = pts.join(",");
      if (!inside || seen.has(sig)) continue;
      seen.add(sig);
      lines.push({ pts, w: WIDTH[w.cls] ?? 1 });
      // Where to write the name: the longest stretch well inside the square.
      if (w.name) {
        for (let k = 2; k < pts.length; k += 2) {
          const [x1, y1, x2, y2] = [pts[k - 2], pts[k - 1], pts[k], pts[k + 1]];
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          if (mx < 0.12 || mx > 0.88 || my < 0.12 || my > 0.88) continue;
          const len = Math.hypot(x2 - x1, y2 - y1);
          let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          if (len > (named.get(w.name)?.len ?? 0.06)) named.set(w.name, { len, x: mx, y: my, angle });
        }
      }
    }
  }
  const names: MapName[] = [...named.entries()]
    .sort((a, b) => b[1].len - a[1].len)
    .slice(0, 5)
    .map(([text, v]) => ({ text: text.length > 22 ? `${text.slice(0, 21)}…` : text, x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000, angle: Math.round(v.angle) }));
  return { lines, names };
}
