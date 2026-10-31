/** A day in Lagos (UTC+1 all year), as YYYY-MM-DD. */
const lagosDay = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);

/**
 * The day the next story hunt takes (owner, 31 Oct 2026: "hunts is everyday 9am - 9pm"): the first day with no hunt
 * starting on it, from today if it's still before 9 am in Lagos, else from tomorrow.
 */
export function nextHuntDay(starts: string[], now = Date.now()) {
  const taken = new Set(starts.map((s) => lagosDay(Date.parse(s))));
  let t = new Date(now + 3_600_000).getUTCHours() >= 9 ? now + 86_400_000 : now;
  while (taken.has(lagosDay(t))) t += 86_400_000;
  return lagosDay(t);
}

/** "Saturday 1 November". */
export const dayName = (day: string) =>
  new Date(`${day}T12:00:00+01:00`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
