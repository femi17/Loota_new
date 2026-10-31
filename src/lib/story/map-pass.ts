import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A day's pass for the story map check on the live site (owner, 31 Oct 2026). Both ends hold the database's secret key,
 * so each works the pass out from it; the key itself never travels, and a pass is only good for its day (UTC).
 */
export function mapPass(secret: string, day = new Date().toISOString().slice(0, 10)) {
  return createHmac("sha256", secret).update(`loota story map check ${day}`).digest("hex");
}

/** Today's pass or yesterday's (a check started just before midnight). */
export function mapPassOk(secret: string, pass: string) {
  const now = Date.now();
  return [now, now - 86_400_000].some((t) => {
    const want = Buffer.from(mapPass(secret, new Date(t).toISOString().slice(0, 10)));
    const got = Buffer.from(pass);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
