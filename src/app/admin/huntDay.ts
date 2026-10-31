/** A day in Lagos (UTC+1 all year), as YYYY-MM-DD. */
export const lagosDay = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);

/**
 * The day the next story hunt is for (owner, 31 Oct 2026: one hunt a day, 9 am to 9 pm, each made before 9 am on its
 * day): today until 9 am in Lagos, then tomorrow. Never further ahead: a day that has its hunt waits for the next 9 am.
 */
export function nextHuntDay(now = Date.now()) {
  return lagosDay(new Date(now + 3_600_000).getUTCHours() >= 9 ? now + 86_400_000 : now);
}

/** "Saturday 1 November". */
export const dayName = (day: string) =>
  new Date(`${day}T12:00:00+01:00`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
