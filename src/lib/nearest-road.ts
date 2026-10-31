/** The nearest point a hunter on foot can reach, so a key is never inside a building or on water. */
export async function nearestRoad(point: { lng: number; lat: number }) {
  try {
    const res = await fetch(`https://routing.openstreetmap.de/routed-foot/nearest/v1/foot/${point.lng},${point.lat}?number=1`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { waypoints?: { location: [number, number]; distance: number }[] };
    const w = data.waypoints?.[0];
    if (!w) return null;
    return { lng: w.location[0], lat: w.location[1], movedM: Math.round(w.distance) };
  } catch {
    return null;
  }
}

