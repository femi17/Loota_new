/**
 * The jammed stretches of road around a spot, as lines to draw (src/game/clock.ts decides: a stretch of road and a
 * 15-minute window, the same for every player). Drawn by the game under the hunter, and by the broadcast around the
 * hunter it follows, so viewers see why they slow down (owner, 9 Nov 2026: "add the traffic light, the traffic, so
 * viewers can know the reason the slows down is because of the traffic or traffic light").
 */
import * as roads from "./roads";
import { jamOn, trafficLevel, type Jam } from "./clock";
import { distanceM, type LngLat } from "./geo";
import type { RoadCellData } from "./roadData";

const pointsOf = new WeakMap<RoadCellData, Map<number, { lng: number; lat: number }>>();

/** The jams within `maxM` of `at` at time `ms` (this device's clock): lines with `jam` 1 (slow) or 2 (at a standstill). */
export function jamLines(cells: RoadCellData[], at: LngLat, ms: number, maxM: number): GeoJSON.Feature[] {
  const level = trafficLevel(ms, at.lng, at.lat);
  const features: GeoJSON.Feature[] = [];
  if (level <= 0) return features;
  for (const cell of cells) {
    const urban = roads.cellUrban(cell);
    if (urban <= 0) continue;
    let pts = pointsOf.get(cell);
    if (!pts) {
      pts = new Map(cell.points.map((p) => [p.id, p]));
      pointsOf.set(cell, pts);
    }
    for (const way of cell.ways) {
      let line: [number, number][] = [];
      let lineJam: Jam = 0;
      const flush = () => {
        if (lineJam && line.length > 1) features.push({ type: "Feature", properties: { jam: lineJam }, geometry: { type: "LineString", coordinates: line } });
        line = [];
      };
      for (let i = 1; i < way.points.length; i++) {
        const a = pts.get(way.points[i - 1]);
        const b = pts.get(way.points[i]);
        if (!a || !b) continue;
        const jam = jamOn(way.cls, roads.jamStretch(way, a), urban, level, ms);
        if (jam !== lineJam || !line.length) {
          flush();
          lineJam = jam;
          if (jam && distanceM([at.lng, at.lat], [a.lng, a.lat]) > maxM) lineJam = 0;
          line = [[a.lng, a.lat]];
        }
        line.push([b.lng, b.lat]);
      }
      flush();
    }
  }
  return features;
}
